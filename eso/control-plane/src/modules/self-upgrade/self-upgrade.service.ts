/**
 * Phase 5 F-24 — self-upgrade skills behind a human approval gate.
 *
 * An agent may only propose. `propose` records the diff and never touches the skill file.
 * `approve`/`apply`/`measure`/`rollback` require a human operator: a machine that tries to
 * approve or apply is refused with `NEEDS_APPROVAL` (task AC-32-3), any other non-human actor
 * with `FORBIDDEN_ACTOR`. Only after approval does `apply` write the skill file, and the
 * `before`/`after` measurement is recorded with the result (MET-06: defect rate must not rise;
 * a regression restores the previous content and moves the proposal to `rolled_back`).
 *
 * State machine: `proposed → approved → applied → rolled_back`; `proposed → rejected`.
 * Every transition appends an audit entry (actor, at, diff hash) to the proposal record, and the
 * whole record is persisted under `.harness/self-upgrade/proposals.json`.
 *
 * `NEEDS_APPROVAL`, `FORBIDDEN_ACTOR`, `UNKNOWN_ACTOR` and `INVALID_STATE` are BRD codes; the
 * first three are not guaranteed to be in `ERROR_STATUS` while other batches edit the shared
 * registry, so this capability throws the same `{code,status,detail}` shape locally.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Actor } from '../../platform/registry/types.js';

const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STORE_DIR = '.harness/self-upgrade';
const STORE_FILE = 'proposals.json';

export type SkillProposalStatus = 'proposed' | 'approved' | 'applied' | 'rejected' | 'rolled_back';

export interface SkillProposalInput {
    skill: string;
    diff: string;
    reason: string;
    expected_effect: string;
}

export interface MetricSample {
    defect_rate: number;
    gate_pass: number | boolean;
}

export interface MeasurementInput {
    before: MetricSample;
    after: MetricSample;
    window?: { from?: string; to?: string };
}

export interface SkillMeasurement {
    before: MetricSample;
    after: MetricSample;
    defect_rate_not_increased: boolean;
    gate_pass_not_decreased: boolean;
    effective: boolean;
    window?: { from?: string; to?: string };
    measured_at: string;
    measured_by: string;
}

export interface SkillAuditEntry {
    event: string;
    actor: string;
    actor_kind: string;
    at: string;
    diff_hash?: string;
    detail?: string;
}

export interface SkillProposal {
    proposal_id: string;
    skill: string;
    status: SkillProposalStatus;
    diff: string;
    diff_hash: string;
    reason: string;
    expected_effect: string;
    createdBy: string;
    createdAt: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    appliedBy?: string | null;
    appliedAt?: string | null;
    rejectedBy?: string | null;
    rejectedAt?: string | null;
    rejectReason?: string | null;
    rolledBackBy?: string | null;
    rolledBackAt?: string | null;
    rollbackReason?: string | null;
    previous_content_hash?: string | null;
    previous_content?: string | null;
    measurement?: SkillMeasurement | null;
    audit: SkillAuditEntry[];
}

function codedError(code: string, detail: string, status: number): never {
    const error = new Error(detail) as Error & { code: string; status: number; detail?: string };
    error.name = 'PlatformError';
    error.code = code;
    error.status = status;
    error.detail = detail;
    throw error;
}

function stateError(detail: string): never {
    codedError('INVALID_STATE', detail, 409);
}

function assertActor(actor: Actor | undefined): asserts actor is Actor {
    if (!actor || !['operator', 'machine', 'system'].includes(actor.kind)) {
        codedError('UNKNOWN_ACTOR', 'a known actor is required for a skill change', 401);
    }
}

/** Only a human operator may approve/apply/measure/rollback; a machine gets NEEDS_APPROVAL. */
function assertApprover(actor: Actor | undefined): asserts actor is Actor {
    assertActor(actor);
    if (actor.kind === 'operator') return;
    if (actor.kind === 'machine') {
        codedError('NEEDS_APPROVAL', 'a machine may propose but a human operator must approve a skill change', 409);
    }
    codedError('FORBIDDEN_ACTOR', `actor kind '${actor.kind}' cannot approve a skill change`, 403);
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function actorName(actor: Actor): string {
    return actor.label || actor.kind;
}

function normalizedGatePass(value: number | boolean): number {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
}

function normalizeSample(sample: MetricSample | undefined, side: 'before' | 'after'): MetricSample {
    if (!sample || typeof sample !== 'object') stateError(`measurement.${side} is required (defect_rate + gate_pass)`);
    const defectRate = Number(sample.defect_rate);
    if (!Number.isFinite(defectRate) || defectRate < 0) stateError(`measurement.${side}.defect_rate must be a non-negative number`);
    const gatePass = sample.gate_pass;
    if (typeof gatePass === 'boolean') return { defect_rate: defectRate, gate_pass: gatePass };
    const gatePassNumber = Number(gatePass);
    if (!Number.isFinite(gatePassNumber)) stateError(`measurement.${side}.gate_pass must be a number or boolean`);
    return { defect_rate: defectRate, gate_pass: gatePassNumber };
}

/**
 * Apply a unified diff (`---`/`+++`/`@@`) to the previous skill text.
 *
 * The implementation keeps original line numbers, so every hunk is applied in file order with a
 * context match; a hunk that does not match aborts before anything is written.
 */
function applyUnifiedDiff(content: string, diff: string): string {
    if (!diff || typeof diff !== 'string' || !diff.includes('@@')) {
        stateError('proposal diff must be a unified diff with at least one @@ hunk');
    }
    const diffLines = diff.replace(/\r\n/g, '\n').split('\n');
    const source = content.replace(/\r\n/g, '\n').split('\n');
    const endsWithNewline = source.length > 1 && source[source.length - 1] === '';
    if (endsWithNewline) source.pop();

    const hunks: { oldStart: number; oldCount: number; body: string[] }[] = [];
    let current: { oldStart: number; oldCount: number; body: string[] } | null = null;
    for (const line of diffLines) {
        const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (header) {
            current = { oldStart: Number(header[1]), oldCount: header[2] === undefined ? 1 : Number(header[2]), body: [] };
            hunks.push(current);
            continue;
        }
        if (current) current.body.push(line);
    }
    if (!hunks.length) stateError('proposal diff has no parsable @@ hunk');

    const output: string[] = [];
    let cursor = 0;
    for (const hunk of hunks) {
        const start = Math.max(0, hunk.oldStart - 1);
        if (start < cursor) stateError('proposal diff hunks overlap or are out of order');
        while (cursor < start) output.push(source[cursor++]);
        let consumed = 0;
        for (const line of hunk.body) {
            if (line.startsWith('\\')) continue;
            if (!line) continue;
            const marker = line[0];
            const value = line.slice(1);
            if (marker === ' ') {
                if (source[cursor] !== value) stateError(`proposal diff context does not match at line ${cursor + 1}`);
                output.push(source[cursor++]);
                consumed += 1;
            } else if (marker === '-') {
                if (source[cursor] !== value) stateError(`proposal diff removal does not match at line ${cursor + 1}`);
                cursor += 1;
                consumed += 1;
            } else if (marker === '+') {
                output.push(value);
            } else {
                stateError(`unsupported diff line '${line.slice(0, 20)}'`);
            }
        }
        if (hunk.oldCount !== consumed) {
            stateError(`proposal diff hunk expects ${hunk.oldCount} old line(s) but matches ${consumed}`);
        }
    }
    while (cursor < source.length) output.push(source[cursor++]);
    return output.join('\n') + (endsWithNewline ? '\n' : '');
}

export class SelfUpgradeService {
    constructor(private readonly root: string) {}

    private get storePath(): string {
        return join(this.root, STORE_DIR, STORE_FILE);
    }

    private skillPath(skill: string): string {
        return join(this.root, 'agents', 'skills', skill, 'SKILL.md');
    }

    private now(): string {
        return new Date().toISOString();
    }

    private read(): SkillProposal[] {
        try {
            const value = JSON.parse(readFileSync(this.storePath, 'utf8'));
            return Array.isArray(value?.proposals) ? value.proposals : [];
        } catch {
            return [];
        }
    }

    private write(proposals: SkillProposal[]): void {
        mkdirSync(dirname(this.storePath), { recursive: true });
        writeFileSync(
            this.storePath,
            `${JSON.stringify({ generated: 'generated by eso self-upgrade — do not edit', proposals }, null, 2)}\n`,
            'utf8',
        );
    }

    private find(proposals: SkillProposal[], proposalId: string): SkillProposal {
        const proposal = proposals.find((item) => item.proposal_id === proposalId);
        if (!proposal) stateError(`proposal '${proposalId}' not found`);
        return proposal;
    }

    private audit(proposal: SkillProposal, event: string, actor: Actor, detail?: string): void {
        proposal.audit.push({
            event,
            actor: actorName(actor),
            actor_kind: actor.kind,
            at: this.now(),
            diff_hash: proposal.diff_hash,
            ...(detail ? { detail } : {}),
        });
    }

    list(): SkillProposal[] {
        return this.read().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }

    get(proposalId: string): SkillProposal {
        return this.find(this.read(), proposalId);
    }

    /** AC-32-1: record the proposal; the skill file is untouched. */
    propose(input: SkillProposalInput, actor: Actor): SkillProposal {
        assertActor(actor);
        const skill = String(input?.skill || '').trim();
        if (!SKILL_ID.test(skill)) stateError("skill id must match ^[a-z0-9][a-z0-9-]{0,63}$");
        const diff = String(input?.diff || '');
        const reason = String(input?.reason || '').trim();
        const expectedEffect = String(input?.expected_effect || '').trim();
        if (!diff.includes('@@')) stateError('proposal diff must be a unified diff with at least one @@ hunk');
        if (!reason) stateError('proposal reason is required');
        if (!expectedEffect) stateError('proposal expected_effect is required');
        const target = this.skillPath(skill);
        if (!existsSync(target)) stateError(`skill '${skill}' has no SKILL.md`);
        // Validate the diff against the current file before accepting it as a proposal.
        applyUnifiedDiff(readFileSync(target, 'utf8'), diff);

        const at = this.now();
        const proposal: SkillProposal = {
            proposal_id: `sup-${hash(`${skill}\n${diff}\n${at}\n${randomUUID()}`).slice(0, 16)}`,
            skill,
            status: 'proposed',
            diff,
            diff_hash: hash(diff),
            reason,
            expected_effect: expectedEffect,
            createdBy: actorName(actor),
            createdAt: at,
            approvedBy: null,
            approvedAt: null,
            appliedBy: null,
            appliedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectReason: null,
            rolledBackBy: null,
            rolledBackAt: null,
            rollbackReason: null,
            previous_content_hash: null,
            previous_content: null,
            measurement: null,
            audit: [],
        };
        this.audit(proposal, 'skill.proposed', actor);
        const proposals = this.read();
        if (proposals.some((item) => item.proposal_id === proposal.proposal_id)) stateError('proposal already exists');
        proposals.push(proposal);
        this.write(proposals);
        return proposal;
    }

    /** AC-32-2 first half: a human approves the proposal; the skill is still unchanged. */
    approve(proposalId: string, actor: Actor): SkillProposal {
        assertApprover(actor);
        const proposals = this.read();
        const proposal = this.find(proposals, proposalId);
        if (proposal.status !== 'proposed') stateError(`proposal is ${proposal.status}, not proposed`);
        proposal.status = 'approved';
        proposal.approvedBy = actorName(actor);
        proposal.approvedAt = this.now();
        this.audit(proposal, 'skill.approved', actor);
        this.write(proposals);
        return proposal;
    }

    /**
     * AC-32-1/AC-32-2: apply only an approved proposal, and record the before/after measurement.
     * A defect-rate or gate-pass regression restores the previous skill and rolls the proposal back.
     */
    apply(proposalId: string, actor: Actor, measurement?: MeasurementInput): SkillProposal {
        assertApprover(actor);
        const proposals = this.read();
        const proposal = this.find(proposals, proposalId);
        if (proposal.status !== 'approved') stateError(`proposal is ${proposal.status}, not approved`);

        const target = this.skillPath(proposal.skill);
        if (!existsSync(target)) stateError(`skill '${proposal.skill}' has no SKILL.md`);
        const previous = readFileSync(target, 'utf8');
        const next = applyUnifiedDiff(previous, proposal.diff);

        writeFileSync(target, next, 'utf8');
        proposal.previous_content = previous;
        proposal.previous_content_hash = hash(previous);
        proposal.status = 'applied';
        proposal.appliedBy = actorName(actor);
        proposal.appliedAt = this.now();
        this.audit(proposal, 'skill.applied', actor);

        if (measurement) {
            proposal.measurement = this.evaluate(measurement, actor);
            this.audit(proposal, 'skill.measured', actor, measurementDetail(proposal.measurement));
            if (!proposal.measurement.effective) {
                this.rollbackContent(proposal);
                proposal.status = 'rolled_back';
                proposal.rolledBackBy = actorName(actor);
                proposal.rolledBackAt = this.now();
                proposal.rollbackReason = 'measurement regression: defect rate or gate pass is worse after apply';
                this.audit(proposal, 'skill.rolled_back', actor, proposal.rollbackReason);
            }
        }
        this.write(proposals);
        return proposal;
    }

    /** AC-32-2: measure an applied proposal; a regression rolls it back to the previous content. */
    measure(proposalId: string, measurement: MeasurementInput, actor: Actor): SkillProposal {
        assertApprover(actor);
        const proposals = this.read();
        const proposal = this.find(proposals, proposalId);
        if (proposal.status !== 'applied') stateError(`proposal is ${proposal.status}, must be applied before measuring`);
        proposal.measurement = this.evaluate(measurement, actor);
        this.audit(proposal, 'skill.measured', actor, measurementDetail(proposal.measurement));
        if (!proposal.measurement.effective) {
            this.rollbackContent(proposal);
            proposal.status = 'rolled_back';
            proposal.rolledBackBy = actorName(actor);
            proposal.rolledBackAt = this.now();
            proposal.rollbackReason = 'measurement regression: defect rate or gate pass is worse after apply';
            this.audit(proposal, 'skill.rolled_back', actor, proposal.rollbackReason);
        }
        this.write(proposals);
        return proposal;
    }

    reject(proposalId: string, actor: Actor, reason?: string): SkillProposal {
        assertApprover(actor);
        const proposals = this.read();
        const proposal = this.find(proposals, proposalId);
        if (proposal.status !== 'proposed') stateError(`proposal is ${proposal.status}, not proposed`);
        proposal.status = 'rejected';
        proposal.rejectedBy = actorName(actor);
        proposal.rejectedAt = this.now();
        proposal.rejectReason = reason ?? null;
        this.audit(proposal, 'skill.rejected', actor, reason);
        this.write(proposals);
        return proposal;
    }

    rollback(proposalId: string, actor: Actor, reason = 'operator rollback'): SkillProposal {
        assertApprover(actor);
        const proposals = this.read();
        const proposal = this.find(proposals, proposalId);
        if (proposal.status !== 'applied') stateError(`proposal is ${proposal.status}, not applied`);
        this.rollbackContent(proposal);
        proposal.status = 'rolled_back';
        proposal.rolledBackBy = actorName(actor);
        proposal.rolledBackAt = this.now();
        proposal.rollbackReason = reason;
        this.audit(proposal, 'skill.rolled_back', actor, reason);
        this.write(proposals);
        return proposal;
    }

    private rollbackContent(proposal: SkillProposal): void {
        if (typeof proposal.previous_content !== 'string') stateError('proposal has no previous skill content to restore');
        writeFileSync(this.skillPath(proposal.skill), proposal.previous_content, 'utf8');
    }

    private evaluate(measurement: MeasurementInput, actor: Actor): SkillMeasurement {
        const before = normalizeSample(measurement?.before, 'before');
        const after = normalizeSample(measurement?.after, 'after');
        const defectRateNotIncreased = after.defect_rate <= before.defect_rate;
        const gatePassNotDecreased = normalizedGatePass(after.gate_pass) >= normalizedGatePass(before.gate_pass);
        return {
            before,
            after,
            defect_rate_not_increased: defectRateNotIncreased,
            gate_pass_not_decreased: gatePassNotDecreased,
            effective: defectRateNotIncreased && gatePassNotDecreased,
            ...(measurement?.window ? { window: measurement.window } : {}),
            measured_at: this.now(),
            measured_by: actorName(actor),
        };
    }
}

function measurementDetail(measurement: SkillMeasurement): string {
    return `defect_rate ${measurement.before.defect_rate} -> ${measurement.after.defect_rate}; gate_pass ${String(
        measurement.before.gate_pass,
    )} -> ${String(measurement.after.gate_pass)}; effective=${String(measurement.effective)}`;
}
