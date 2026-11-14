import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { EvidenceRequirement } from './worker-file.service.js';

const VERBS = new Set(['read', 'write', 'append', 'approve', 'configure', 'handoff']);

function patterns(scope: string): string[] {
    return scope.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function matchesScope(pattern: string, target: string): boolean {
    if (!pattern.startsWith('/') && !pattern.includes('*')) {
        const clean = pattern.replace(/^\/+|\/+$/g, '');
        return clean.length === 0 || target === clean || target.startsWith(`${clean}/`) || target.endsWith(`/${clean}`) || target.includes(`/${clean}/`);
    }
    if (pattern.includes('*')) {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${escaped}$`).test(target);
    }
    return target === pattern || target.startsWith(pattern.endsWith('/') ? pattern : `${pattern}/`);
}

function requirementsOf(value: unknown): EvidenceRequirement[] {
    let raw: any = value;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { raw = []; }
    }
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => typeof item === 'string' ? { kind: 'manual', label: item } : item)
        .filter((item) => item && typeof item === 'object' && typeof item.kind === 'string');
}

export function evidenceLabel(requirement: EvidenceRequirement): string {
    if (requirement.kind === 'audit') return `Audit ${requirement.metric || 'rubric'} ${requirement.op || '>='} ${requirement.value ?? ''}`.trim();
    if (requirement.kind === 'verify') return `Verify ${requirement.value || 'PASS'}`;
    if (requirement.kind === 'test') return 'Tests pass';
    if (requirement.kind === 'scenario') return 'Scenario executed';
    return requirement.label || requirement.kind;
}

function satisfies(requirement: EvidenceRequirement, evidence: any): boolean {
    if (!evidence || evidence.kind !== requirement.kind) return false;
    if (requirement.kind === 'audit') {
        const actual = requirement.metric === 'critical'
            ? Number(evidence.critical)
            : Number(evidence.rubric ?? evidence.score ?? evidence.value);
        const expected = Number(requirement.value);
        if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
        if (requirement.op === '<=') return actual <= expected;
        if (requirement.op === '==') return actual === expected;
        return actual >= expected;
    }
    if (requirement.kind === 'verify') return String(evidence.status || '').toUpperCase() === String(requirement.value || 'PASS').toUpperCase();
    if (requirement.kind === 'test') return Boolean(evidence.passed ?? evidence.status === 'PASS');
    if (requirement.kind === 'scenario') return Boolean(evidence.executed ?? evidence.passed);
    return requirement.label ? String(evidence.label || '') === requirement.label : true;
}

function missingEvidence(requirements: EvidenceRequirement[], supplied: any[]): string[] {
    const reasons: string[] = [];
    for (const requirement of requirements) {
        const match = supplied.find((item) => item?.kind === requirement.kind);
        if (!match) reasons.push(`EVIDENCE_MISSING:${evidenceLabel(requirement)}`);
        else if (!satisfies(requirement, match)) reasons.push(`EVIDENCE_FAILED:${evidenceLabel(requirement)}`);
    }
    return reasons;
}

export class WorkerPolicyService {
    constructor(private readonly store: PlatformStore) {}

    async check(consumerId: string, workerId: string, action: { verb?: string; path?: string; evidence?: any[] }): Promise<any> {
        const id = assertConsumerId(consumerId);
        const worker = await this.store.knowledgeWorker(id, workerId);
        if (!worker) return { decision: 'DENY', workerId, reasons: ['WORKER_NOT_FOUND'] };
        const reasons: string[] = [];
        const warnings: string[] = [];
        const verb = String(action.verb || '').toLowerCase();

        if (!VERBS.has(verb)) reasons.push('VERB_UNKNOWN');
        if (worker.status !== 'active') reasons.push(`WORKER_NOT_ACTIVE:${worker.status}`);
        const verbs: string[] = Array.isArray(worker.verbs) ? worker.verbs : [];
        if (!verbs.includes(verb)) reasons.push(`VERB_NOT_ALLOWED:${verb}`);
        const scopes = patterns(String(worker.scope || ''));
        const scopeMatched = Boolean(action.path && scopes.some((pattern) => matchesScope(pattern, action.path!)));
        if (worker.layer === 'gate' && ['write', 'append', 'configure'].includes(verb)) {
            if (verb === 'configure') reasons.push('GATE_WORKER_CANNOT_CONFIGURE');
            else if (!action.path || !scopeMatched) reasons.push('GATE_WRITE_OUTSIDE_EVIDENCE_SCOPE');
        }

        if (action.path) {
            if (scopes.length === 0) {
                reasons.push('SCOPE_EMPTY');
            } else if (!scopeMatched) {
                reasons.push(`PATH_OUTSIDE_SCOPE:${action.path}`);
            }
        }

        const required = requirementsOf(worker.bar);
        const evidence = Array.isArray(action.evidence) ? action.evidence : [];
        const evidenceVerbs = worker.layer === 'gate' ? ['approve', 'handoff'] : ['write', 'append', 'approve', 'handoff'];
        if (evidenceVerbs.includes(verb)) {
            reasons.push(...missingEvidence(required, evidence));
        }

        if (worker.layer === 'gate' && verb === 'approve' && evidence.length === 0) warnings.push('GATE_APPROVE_WITHOUT_EVIDENCE');

        return {
            decision: reasons.length === 0 ? 'ALLOW' : 'DENY',
            workerId,
            worker: {
                name: worker.name,
                role: worker.role,
                layer: worker.layer,
                scope: worker.scope,
                status: worker.status,
                capabilities: worker.capabilities || [],
                verbs,
                bar: required,
                escalation: worker.escalation || 'allow',
            },
            action: { verb, path: action.path || null, evidence },
            reasons,
            warnings,
        };
    }

    async checkAndRecord(consumerId: string, workerId: string, action: { verb?: string; path?: string; evidence?: any[] }): Promise<any> {
        const result = await this.check(consumerId, workerId, action);
        await this.store.recordWorkerEvent(consumerId, {
            workerId,
            event: 'check',
            verb: result.action?.verb,
            path: result.action?.path,
            decision: result.decision,
            reasons: result.reasons,
            evidence: result.action?.evidence || [],
        });
        return result;
    }

    async write(consumerId: string, workerId: string, action: { path?: string; content?: string; evidence?: any[] }): Promise<any> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer?.root) return { decision: 'DENY', reasons: ['CONSUMER_ROOT_MISSING'] };
        const root = resolve(consumer.root);
        const requested = String(action.path || '');
        const target = resolve(root, requested);
        const rel = relative(root, target);
        if (!requested || rel.startsWith('..') || rel === '' || rel.includes(`..${requireSep()}`)) {
            const denied = { decision: 'DENY', workerId, reasons: ['PATH_OUTSIDE_CONSUMER'], action: { verb: 'write', path: requested } };
            await this.store.recordWorkerEvent(id, { workerId, event: 'write', verb: 'write', path: requested, decision: 'DENY', reasons: denied.reasons, evidence: action.evidence || [] });
            return denied;
        }
        const check = await this.check(id, workerId, { verb: 'write', path: target, evidence: action.evidence });
        await this.store.recordWorkerEvent(id, {
            workerId, event: 'write', verb: 'write', path: rel,
            decision: check.decision, reasons: check.reasons, evidence: check.action?.evidence || [],
        });
        if (check.decision !== 'ALLOW') return { ...check, target: rel };
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, String(action.content ?? ''), 'utf8');
        return { ...check, target: rel, written: true };
    }

    async spawn(consumerId: string, workerId: string, hostBindingId: string): Promise<any> {
        const id = assertConsumerId(consumerId);
        const worker = await this.store.knowledgeWorker(id, workerId);
        const reasons: string[] = [];
        if (!worker) reasons.push('WORKER_NOT_FOUND');
        if (worker && worker.status !== 'active') reasons.push(`WORKER_NOT_ACTIVE:${worker.status}`);
        const placements: string[] = Array.isArray(worker?.host_binding_ids) ? worker.host_binding_ids : [];
        if (!hostBindingId) reasons.push('HOST_BINDING_REQUIRED');
        else if (worker && !placements.includes(hostBindingId)) reasons.push(`PLACEMENT_MISSING:${hostBindingId}`);
        const decision = reasons.length === 0 ? 'ALLOW' : 'DENY';
        await this.store.recordWorkerEvent(id, {
            workerId, event: 'spawn', path: hostBindingId, decision, reasons, evidence: [hostBindingId],
        });
        if (decision !== 'ALLOW') return { decision, workerId, hostBindingId, reasons };

        const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const command = String(process.env.ESO_WORKER_SPAWN_COMMAND || '').trim();
        if (!command) {
            await this.store.createWorkerRun(id, { runId, workerId, hostBindingId, status: 'authorized', command: null });
            return { decision, workerId, hostBindingId, runId, status: 'authorized', reason: 'HOST_SPAWN_NOT_CONFIGURED', reasons };
        }
        let args: string[] = [];
        try {
            const parsed = JSON.parse(process.env.ESO_WORKER_SPAWN_ARGS || '[]');
            if (Array.isArray(parsed)) args = parsed.map(String);
        } catch {
            args = [];
        }
        const consumer = await this.store.getConsumer(id);
        const BunRuntime = (globalThis as any).Bun;
        try {
            const child = BunRuntime.spawn([command, ...args], {
                cwd: consumer?.root || process.cwd(),
                env: {
                    ...process.env,
                    ESO_CONSUMER_ID: id,
                    ESO_WORKER_ID: workerId,
                    ESO_HOST_BINDING_ID: hostBindingId,
                },
                stdout: 'ignore',
                stderr: 'ignore',
            });
            await this.store.createWorkerRun(id, { runId, workerId, hostBindingId, status: 'spawned', pid: child.pid, command: [command, ...args].join(' ') });
            child.exited.then((code: number) => {
                void this.store.updateWorkerRun(id, runId, { status: code === 0 ? 'exited' : 'failed' });
            });
            return { decision, workerId, hostBindingId, runId, status: 'spawned', pid: child.pid, reasons };
        } catch (error) {
            await this.store.createWorkerRun(id, { runId, workerId, hostBindingId, status: 'failed', command: [command, ...args].join(' ') });
            return { decision: 'DENY', workerId, hostBindingId, runId, status: 'failed', reasons: [`SPAWN_FAILED:${(error as Error)?.message || error}`] };
        }
    }

    async handoff(consumerId: string, fromWorkerId: string, toWorkerId: string, evidence: any[] = [], work: any = {}, outcome = ''): Promise<any> {
        const id = assertConsumerId(consumerId);
        const [from, to, edge] = await Promise.all([
            this.store.knowledgeWorker(id, fromWorkerId),
            this.store.knowledgeWorker(id, toWorkerId),
            this.store.knowledgeWorkerEdge(id, fromWorkerId, toWorkerId),
        ]);
        const reasons: string[] = [];
        if (!from) reasons.push('FROM_WORKER_NOT_FOUND');
        if (!to) reasons.push('TO_WORKER_NOT_FOUND');
        if (!edge) reasons.push('HANDOFF_EDGE_MISSING');
        const condition = String(edge?.on_label || '');
        const gateCondition = /\b(PASS|FAIL)\b/.exec(condition)?.[1] || '';
        if (gateCondition) {
            if (!outcome) reasons.push(`HANDOFF_OUTCOME_REQUIRED:${gateCondition}`);
            else if (outcome.toUpperCase() !== gateCondition) reasons.push(`HANDOFF_CONDITION_MISMATCH:${outcome}!=${gateCondition}`);
        }
        if (from && from.status !== 'active') reasons.push(`FROM_WORKER_NOT_ACTIVE:${from.status}`);
        if (to && to.status !== 'active') reasons.push(`TO_WORKER_NOT_ACTIVE:${to.status}`);
        const required = requirementsOf(to?.bar);
        reasons.push(...missingEvidence(required, evidence));
        const decision = reasons.length === 0 ? 'ALLOW' : 'DENY';
        const handoffId = `ho-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        if (decision === 'ALLOW') {
            await this.store.createWorkerHandoff(id, {
                handoffId,
                fromWorkerId,
                toWorkerId,
                condition: edge?.on_label || null,
                work,
                evidence,
            });
        }
        await this.store.recordWorkerEvent(id, {
            workerId: fromWorkerId, event: 'handoff', path: toWorkerId, decision, reasons, evidence,
        });
        return { decision, handoffId: decision === 'ALLOW' ? handoffId : null, from: fromWorkerId, to: toWorkerId, condition: edge?.on_label || null, reasons };
    }

    async acceptHandoff(consumerId: string, workerId: string, handoffId: string): Promise<any> {
        const accepted = await this.store.acceptWorkerHandoff(assertConsumerId(consumerId), handoffId, workerId);
        return { decision: accepted ? 'ACCEPTED' : 'DENY', handoff: accepted || null, reason: accepted ? null : 'HANDOFF_NOT_PENDING_OR_NOT_TARGET' };
    }

    listHandoffs(consumerId: string, workerId?: string, limit = 50): Promise<any[]> {
        return this.store.listWorkerHandoffs(assertConsumerId(consumerId), workerId, limit);
    }

    listRuns(consumerId: string, workerId?: string, limit = 50): Promise<any[]> {
        return this.store.listWorkerRuns(assertConsumerId(consumerId), workerId, limit);
    }

    listEvents(consumerId: string, workerId?: string, limit = 50): Promise<any[]> {
        return this.store.listWorkerEvents(assertConsumerId(consumerId), workerId, limit);
    }
}

function requireSep(): string {
    return process.platform === 'win32' ? '\\' : '/';
}
