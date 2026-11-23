/**
 * AC legacy batch 3 — US-18/27/30/33/34/35 (US-15 lives in `qc/eso-consumers-list.test.mjs`).
 *
 * One test per AC; SCN/AC ids are pinned so `RTM-LEGACY-01` can link them directly.
 * Service level only: this slice adds no route and changes no implementation.
 *
 * Source: sdlc/06.analysis/03.scn/SCN-{18,27,30,33,34,35}.md
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { explainTurnVerdict } from '../../core/src/diagnosis.mjs';
import { formatGapReport } from '../../core/src/gaps.mjs';
import { setTicketDoneStatus } from '../../core/src/ticket-pack.mjs';
import {
    UI_STATES,
    projectS1WorkOverview,
    projectS5ArtefactReconstruct,
    renderStateFrame,
} from '../../core/src/ui-frames.mjs';
import { electCapabilityProvider } from '../../adapters/src/election.mjs';
import { evaluateRoleSufficiency } from '../../iam/src/role.mjs';

import { assertApprover } from '../src/common/approval/approval.js';
import { KnowledgeMappingCheckService } from '../src/modules/knowledge/knowledge-mapping-check.service.js';
import { KnowledgeMappingService } from '../src/modules/knowledge/knowledge-mapping.service.js';
import { LearningService } from '../src/modules/learning/learning.service.js';
import { transitionTaskStatus } from '../src/modules/scope/domain/scope.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import type { Actor } from '../src/platform/registry/types.js';

const operator: Actor = { kind: 'operator', label: 'operator@test' };
const machine: Actor = { kind: 'machine', label: 'worker-build@test' };

const roots: string[] = [];
function tempRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

async function insertReady(store: MemoryPlatformStore, id: string, root: string): Promise<void> {
    const now = new Date().toISOString();
    await store.insertConsumer({
        id, name: id, root, sdlcRoot: 'sdlc', schemaName: `c_${id.replace(/[^a-z0-9]/g, '_')}`,
        status: 'ready', version: 1, storageMode: 'schema', materializedHash: null,
        createdAt: now, updatedAt: now,
    });
}

async function mappingFixture(files: Record<string, string>): Promise<{
    store: MemoryPlatformStore;
    check: KnowledgeMappingCheckService;
}> {
    const store = new MemoryPlatformStore();
    const root = tempRoot('eso-batch3-mapping-');
    for (const [relative, body] of Object.entries(files)) {
        const absolute = join(root, relative);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, body, 'utf8');
    }
    await insertReady(store, 'batch3-mapping', root);
    return { store, check: new KnowledgeMappingCheckService(store) };
}

async function learningFixture(): Promise<{ service: LearningService; store: MemoryPlatformStore }> {
    const store = new MemoryPlatformStore();
    const root = tempRoot('eso-batch3-learning-');
    await insertReady(store, 'batch3-learning', root);
    return { service: new LearningService(store), store };
}

const proposalInput = {
    risk_kind: 'missing_test',
    risks: [{ risk_id: 'r1' }, { risk_id: 'r2' }],
    expected_effect: 'reduce missing tests',
    revert: { action: 'restore previous skill version' },
};

describe('AC legacy batch 3', () => {
    // ---------------------------------------------------------------------
    // US-18 — F-10 explain why (SCN-18).
    // ---------------------------------------------------------------------

    test('SCN-18-1 · AC-18-1 — verdict có record ⇒ why + requirements, không đổi dữ liệu', () => {
        const record = {
            project: 'batch3-why',
            turn_id: 'turn-b3-1',
            at: '2026-11-01T00:00:00.000Z',
            level: 'insufficient',
            mode: 'ask',
            basis: 'retrieved',
            rule_version: '1.0.0',
            payload: {
                requirements: [{ subject: 'AC-18-1', asks: 'test', min_basis: 'verified', source: 'work' }],
                answers: [{ requirement: 'AC-18-1', claim: null, basis: 'inferred', exists: 'absent' }],
                files_used: [{ path: 'src/explain.ts' }],
                unknowns: [],
            },
        };
        const before = JSON.stringify(record);

        const result = explainTurnVerdict({
            project: 'batch3-why',
            turn_id: 'turn-b3-1',
            turnRecord: record,
        });

        // `why`: the unmet requirement carries its own reason, and the recorded conclusion is read back.
        assert.equal(result.unmet.length, 1);
        assert.equal(result.unmet[0].subject, 'AC-18-1');
        assert.ok(String(result.unmet[0].reason || '').length > 0, 'unmet requirement must explain why');
        assert.equal(result.prior_conclusion.level, 'insufficient');
        assert.equal(result.prior_conclusion.basis, 'retrieved');
        assert.ok(Array.isArray(result.unknowns));

        // Postcondition: read-only — the recorded verdict is byte-identical.
        assert.equal(JSON.stringify(record), before);
    });

    test('SCN-18-2 · AC-18-2 — verdict không tồn tại ⇒ 404 NO_RECORD', () => {
        assert.throws(
            () => explainTurnVerdict({ project: 'batch3-why', turn_id: 'turn-not-recorded', turnRecord: null }),
            (error: any) => {
                assert.equal(error.code, 'NO_RECORD');
                assert.equal(error.status, 404);
                assert.match(String(error.message), /không có bản ghi/);
                return true;
            },
        );
    });

    test('SCN-18-3 · AC-18-3 — không có gap ⇒ gaps[] rỗng + lý do, không bịa gap', () => {
        const record = {
            project: 'batch3-why',
            turn_id: 'turn-b3-3',
            at: '2026-11-01T00:00:00.000Z',
            level: 'sufficient',
            mode: 'do',
            basis: 'verified',
            rule_version: '1.0.0',
            payload: {
                requirements: [{ subject: 'AC-18-3', asks: 'test', min_basis: 'verified', source: 'work' }],
                answers: [{ requirement: 'AC-18-3', claim: 'passed', basis: 'verified', exists: 'present' }],
                files_used: [{ path: 'src/explain.ts' }],
                unknowns: [],
            },
        };

        const result = explainTurnVerdict({
            project: 'batch3-why',
            turn_id: 'turn-b3-3',
            turnRecord: record,
        });

        assert.deepEqual(result.unmet, []);
        assert.deepEqual(result.missing_evidence, []);

        const report = formatGapReport({ level: 'sufficient', gaps: [] });
        assert.equal(report.total_gaps, 0);
        assert.deepEqual(report.gap_items, []);
        // The reason for the empty list is the recorded level/basis, not an invented gap.
        assert.equal(report.level, 'sufficient');
        assert.equal(result.prior_conclusion.level, 'sufficient');
        assert.equal(result.prior_conclusion.basis, 'verified');
    });

    // ---------------------------------------------------------------------
    // US-27 — F-19 sufficiency per actor (SCN-27).
    // ---------------------------------------------------------------------

    test('SCN-27-1 · AC-27-1 — actor có identity ⇒ verdict theo role', () => {
        const verifyRole = {
            name: 'verify',
            bar: [{ evidence_kind: 'test_pass', min_basis: 'partial' }],
        };
        const verdict = evaluateRoleSufficiency({
            role: verifyRole,
            evidence: [{ kind: 'test_pass', basis: 'partial' }],
        });

        assert.equal(verdict.role, 'verify');
        assert.equal(verdict.level, 'SUFFICIENT');
        assert.deepEqual(verdict.deficits, []);
    });

    test('SCN-27-2 · AC-27-2 — không identity ⇒ UNKNOWN_ACTOR + nêu rõ, không mượn verdict', () => {
        const result = evaluateRoleSufficiency({ role: undefined, evidence: [] });
        assert.equal(result.code, 'UNKNOWN_ACTOR');
        assert.equal(result.level, 'unknown');
        assert.match(String(result.reason), /no bar\/identity/);
    });

    test('SCN-27-3 · AC-27-3 — 2 role khác bar, cùng task ⇒ kết quả khác là đúng', () => {
        const evidence = [{ kind: 'test_pass', basis: 'partial' }];
        const peerRole = {
            name: 'peer',
            bar: [{ evidence_kind: 'test_pass', min_basis: 'partial' }],
        };
        const leadRole = {
            name: 'lead',
            bar: [{ evidence_kind: 'test_pass', min_basis: 'strict' }],
        };

        const peer = evaluateRoleSufficiency({ role: peerRole, evidence });
        const lead = evaluateRoleSufficiency({ role: leadRole, evidence });

        assert.equal(peer.level, 'SUFFICIENT');
        assert.equal(lead.level, 'INSUFFICIENT');
        assert.notEqual(peer.level, lead.level);
        assert.equal(lead.deficits.length, 1);
        assert.equal(lead.deficits[0].reason, 'INSUFFICIENT_BASIS');
        assert.equal(lead.deficits[0].required_basis, 'strict');
    });

    // ---------------------------------------------------------------------
    // US-30 — F-22 capability source (SCN-30).
    // ---------------------------------------------------------------------

    test('SCN-30-1 · AC-30-1 — host có native ⇒ host-native + reason', async () => {
        const audit: any[] = [];
        const election = await electCapabilityProvider({
            project: 'batch3-hosts',
            turnId: 'turn-b3-30-1',
            capabilityKind: 'memory',
            host: 'cursor',
            branches: {
                'host-native': { available: true, provider_id: 'cursor-native' },
                'eso-native': { available: true, provider_id: 'eso-native' },
                external: { available: true, provider_id: 'external' },
            },
            turnAuditLog: audit,
        });

        assert.equal(election.branch, 'host-native');
        assert.equal(election.provider_id, 'cursor-native');
        assert.equal(election.guarantee, 'G-FULL');
        assert.match(String(election.reason), /host-native/);
        assert.equal(audit.length, 1);
        assert.equal(audit[0].branch, 'host-native');
    });

    test('SCN-30-2 · AC-30-2 — host thiếu ⇒ none + lý do, không giả vờ native', async () => {
        const audit: any[] = [];
        const election = await electCapabilityProvider({
            project: 'batch3-hosts',
            turnId: 'turn-b3-30-2',
            capabilityKind: 'memory',
            host: 'cursor',
            branches: {},
            turnAuditLog: audit,
        });

        assert.equal(election.branch, 'none');
        assert.equal(election.provider_id, null);
        assert.equal(election.guarantee, 'G-DEGRADED');
        assert.equal(election.level, 'degraded');
        assert.match(String(election.reason), /memory/);
        assert.match(String(election.reason), /cursor/);
        assert.equal(audit.length, 1);
        assert.equal(audit[0].branch, 'none');
    });

    test('SCN-30-3 · AC-30-3 — capability lạ ⇒ UNKNOWN_CAPABILITY', async () => {
        await assert.rejects(
            electCapabilityProvider({
                project: 'batch3-unknown-kind',
                turnId: 'turn-b3-30-3',
                capabilityKind: 'teleport',
                host: 'cursor',
                branches: {},
            }),
            (error: any) => error.code === 'UNKNOWN_CAPABILITY',
        );
    });

    // ---------------------------------------------------------------------
    // US-33 — F-25 authority (SCN-33).
    // ---------------------------------------------------------------------

    test('SCN-33-1 · AC-33-1 — operator duyệt ⇒ allowed + event', async () => {
        const { service, store } = await learningFixture();
        const proposed = await service.propose('batch3-learning', proposalInput, machine);

        const approved = await service.approve('batch3-learning', proposed.proposal_id, operator);

        assert.equal(approved.status, 'approved');
        assert.equal(approved.approvedBy, operator.label);

        const events = await store.listEvents('batch3-learning');
        const approval = events.find((event) => (event.detail as any)?.learning === 'learning.approved');
        assert.ok(approval, 'approval must append a learning.approved event');
        assert.equal(approval!.actorKind, 'operator');
        assert.equal(approval!.actorLabel, operator.label);
    });

    test('SCN-33-2 · AC-33-2 — máy gọi Done ⇒ denied + FORBIDDEN_ACTOR, không đổi', () => {
        // Done-specific guard: a machine role never produces a Done record.
        assert.throws(
            () => setTicketDoneStatus({ ticketKey: 'ESO-B3', actorRole: 'machine' }),
            (error: any) => {
                assert.ok(
                    ['DONE_FORBIDDEN', 'FORBIDDEN_ACTOR'].includes(error.code),
                    `Then = denied + FORBIDDEN_ACTOR, got ${error.code}`,
                );
                return true;
            },
        );
        // Shared authority guard: a non-human actor calling a human action is FORBIDDEN_ACTOR.
        assert.throws(
            () => assertApprover({ kind: 'system', label: 'scheduler@test' }),
            (error: any) => error.code === 'FORBIDDEN_ACTOR',
        );
        // Postcondition: only the operator path yields Done.
        assert.equal(setTicketDoneStatus({ ticketKey: 'ESO-B3', actorRole: 'operator' }).status, 'Done');
        // The Done path is unreachable for a machine even through the generic status transition.
        assert.throws(
            () => transitionTaskStatus({ currentStatus: 'In Review', newStatus: 'Done', actorRole: 'agent' }),
            (error: any) => ['DONE_FORBIDDEN', 'FORBIDDEN_ACTOR'].includes(error.code),
        );
    });

    test('SCN-33-3 · AC-33-3 — không rõ actor ⇒ UNKNOWN_ACTOR, không đổi', () => {
        assert.throws(
            () => assertApprover({} as any),
            (error: any) => error.code === 'UNKNOWN_ACTOR',
        );
    });

    // ---------------------------------------------------------------------
    // US-34 — F-26 surface S1–S5 (SCN-34). AC-34-1/2 are covered by
    // qc/eso-surfaces.test.mjs; this batch closes AC-34-3.
    // ---------------------------------------------------------------------

    test('SCN-34-3 · AC-34-3 — số không nguồn ⇒ bị chặn khỏi bề mặt (null, không bịa số)', () => {
        // FRD-F26 §2.6: no surface may display a number without a source.
        const loading = renderStateFrame({ state: UI_STATES.ST2_LOADING, data: {} });
        assert.equal(loading.active_requests, null);

        const stale = renderStateFrame({ state: UI_STATES.ST6_STALE, data: {} });
        assert.equal(stale.coverage, null);

        const partial = renderStateFrame({ state: UI_STATES.ST5_PARTIAL, data: {} });
        assert.equal(partial.completeness, null);

        const s1 = projectS1WorkOverview({
            project: 'batch3-surfaces',
            turns: [{ turn_id: 'turn-b3-34-3', work: 'surface guard', level: 'sufficient' }],
        });
        assert.equal(s1.rows[0].completeness_bar, null);

        const s5 = projectS5ArtefactReconstruct({
            artefactId: 'artefact-b3',
            record: { turn_id: 'turn-b3-34-3' },
            fileIsDirty: true,
        });
        assert.equal(s5.file_hash, null);
        assert.equal(s5.content_notice, 'không lấy lại được nội dung');
    });

    // ---------------------------------------------------------------------
    // US-35 — F-27 HUMAN/AI document relation (SCN-35).
    // ---------------------------------------------------------------------

    test('SCN-35-1 · AC-35-1 — hai lớp khớp ⇒ 100% resolve, 0 finding', async () => {
        const { store, check } = await mappingFixture({
            'docs/human.md': '---\nrepresentation: human\n---\n# Human source\nShort body.\n',
            'docs/agent.md': '---\nrepresentation: agent\nhuman_sot: docs/human.md\n---\n# Agent projection\nDifferent summary.\n',
        });

        const result = await check.check('batch3-mapping');

        assert.equal(result.status, 'pass');
        assert.deepEqual(result.findings, []);
        assert.equal(result.checked.human, 1);
        assert.equal(result.checked.agent, 1);

        const mapping = await new KnowledgeMappingService(store).mapping('batch3-mapping');
        assert.equal(mapping.projections.length, 1);
        assert.equal(mapping.projections[0].humanPath, 'docs/human.md');
    });

    test('SCN-35-2 · AC-35-2 — chép nguyên văn ⇒ DOC_CONTRACT_VIOLATION', async () => {
        const body = '\n# Human source\n' + 'x'.repeat(120) + '\n';
        const { check } = await mappingFixture({
            'docs/human.md': '---\nrepresentation: human\n---' + body,
            'docs/agent.md': '---\nrepresentation: agent\nhuman_sot: docs/human.md\n---' + body,
        });
        const result = await check.check('batch3-mapping');
        const finding = result.findings.find((f: any) => f.code === 'DOC_CONTRACT_VIOLATION');
        assert.ok(finding, `findings: ${JSON.stringify(result.findings)}`);
        assert.equal(finding.severity, 'error');
    });

    test('SCN-35-3 · AC-35-3 — mục AI mồ côi ⇒ finding mồ côi, không auto-link', async () => {
        const { store, check } = await mappingFixture({
            'docs/human.md': '---\nrepresentation: human\n---\n# Human source\nShort body.\n',
            'docs/orphan.md': '---\nrepresentation: agent\n---\n# Orphan projection\nNo human source.\n',
        });

        const result = await check.check('batch3-mapping');

        assert.equal(result.status, 'fail');
        const orphan = result.findings.find((finding) => finding.code === 'MISSING_HUMAN_SOT');
        assert.ok(orphan, 'an agent item without human_sot must be a finding');
        assert.equal(orphan!.severity, 'error');
        assert.equal(orphan!.path, 'docs/orphan.md');

        // The checker reports; it never invents a human source for the orphan.
        const mapping = await new KnowledgeMappingService(store).mapping('batch3-mapping');
        const projection = mapping.projections.find((item) => item.aiPath === 'docs/orphan.md');
        assert.ok(projection, 'the orphan must stay in relations as an unresolved projection');
        assert.equal(projection!.humanPath, null);
    });
});

// Cleanup after the whole file (node:test has no file-scoped afterAll hook here).
process.on('exit', () => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
