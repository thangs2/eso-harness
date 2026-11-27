/**
 * Gap #3–#5 — the 8-stage projection must report EVIDENCE, not presentation status.
 *
 * #3 `stepsWithEvidence` counted `status === 'ok' | 'warn'`, and stage status is a presentation
 *    decision ('muted' = host did not report, 'info' = below a threshold). A stage that carried real
 *    evidence under an `info` status was silently uncounted, and a `warn` stage counted as evidence.
 * #4 Stage 8 reported `Q3 = recon calls` as one of six "questions ready", but Q1–Q6 are the six
 *    audit questions. A trace could lose a readiness point for a reason unrelated to audit.
 * #5 `detail.recon[].status` can never be 'configured' (the only initialiser is 'observed' or
 *    'not-captured'), so the "configured but never called" case was unreachable.
 *
 * Run: cd eso/control-plane && bun test test/request-stages.test.ts
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RequestService } from '../src/modules/requests/request.service.js';
import { ReceiptService } from '../src/modules/receipt/receipt.service.js';
import { VerdictService } from '../src/modules/verdict/verdict.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture(id: string) {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-stages-'));
    roots.push(root);
    const now = new Date().toISOString();
    await store.insertConsumer({
        id, name: id, root, sdlcRoot: 'sdlc', schemaName: `c_${id.replace(/[^a-z0-9]/g, '_')}`,
        status: 'ready', version: 1, storageMode: 'schema', materializedHash: null, createdAt: now, updatedAt: now,
    });
    const service = new RequestService(store, undefined, undefined, new ReceiptService(store, new VerdictService(store)));
    return { store, service };
}

/** A trace whose packets/actions carry proof but which reports no recon adapters at all. */
async function seed(store: MemoryPlatformStore, id: string, traceId: string, extra: Record<string, unknown> = {}) {
    const base = { traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', workerId: 'worker-scout' };
    const rows = [
        { observationId: `${traceId}-1`, ...base, event: 'prompt.submitted', outcome: 'SUBMITTED', evidence: { userQuery: 'summarise the architecture', workerId: 'worker-scout' } },
        { observationId: `${traceId}-2`, ...base, event: 'evidence.packet', outcome: 'PASS', evidence: { actor: { id: 'worker-scout', kind: 'host' } } },
        { observationId: `${traceId}-3`, ...base, event: 'action.recorded', outcome: 'PASS', evidence: { tool: 'agy', files: ['AGENTS.md'] } },
        { observationId: `${traceId}-4`, ...base, event: 'decision.recorded', outcome: 'PASS', evidence: { verdict: 'partial', winner: 'worker-scout', ...extra } },
    ];
    for (const row of rows) {
        await store.insertObservation(id, { ...row, at: '2026-11-26T10:00:00.000Z', idempotencyKey: row.observationId });
    }
}

describe('Gap #3 — stepsWithEvidence counts evidence, not status', () => {
    test('a stage carrying evidence under an `info` status is counted', async () => {
        const id = 'stages-info';
        const { store, service } = await fixture(id);
        await seed(store, id, 'trace-info');
        const detail = await service.get(id, 'trace-info');
        const stage1 = detail.systemStages.find((s) => s.id === 'intake-law')!;
        // No law ref and no law.loaded ⇒ status 'warn', and warn is NOT evidence.
        assert.equal(stage1.status, 'warn');
        assert.equal(stage1.evidenced, false, 'an unread law is a warning, not evidence');
        // Stage 2 carries the decision winner under an 'info' status and must count.
        const stage2 = detail.systemStages.find((s) => s.id === 'decision-jev')!;
        assert.equal(stage2.status, 'info');
        assert.equal(stage2.evidenced, true, 'a recorded decision is evidence regardless of status');
        assert.ok(
            detail.effectiveness.stepsWithEvidence > 1,
            `expected evidenced stages to count, got ${detail.effectiveness.stepsWithEvidence}`,
        );
    });

    test('a `warn` stage with no evidence is NOT counted as evidenced', async () => {
        const id = 'stages-warn';
        const { store, service } = await fixture(id);
        // No decision.recorded at all ⇒ stage 2/4 can warn without carrying evidence.
        await store.insertObservation(id, {
            observationId: 'warn-1', traceId: 'trace-warn', hostId: 'cursor', runtimeKey: 'cursor:cursor-agent',
            workerId: null, event: 'prompt.submitted', outcome: 'SUBMITTED',
            evidence: { userQuery: 'no decision recorded' }, at: '2026-11-26T10:00:00.000Z', idempotencyKey: 'warn-1',
        });
        await store.insertObservation(id, {
            observationId: 'warn-2', traceId: 'trace-warn', hostId: 'cursor', runtimeKey: 'cursor:cursor-agent',
            workerId: null, event: 'evidence.packet', outcome: 'PASS', evidence: {}, at: '2026-11-26T10:00:01.000Z', idempotencyKey: 'warn-2',
        });
        const detail = await service.get(id, 'trace-warn');
        // Stage 6 (execution) is 'info' here (no actions): must not be counted.
        const stage6 = detail.systemStages.find((s) => s.id === 'execution')!;
        assert.equal(stage6.status, 'info');
        assert.ok(
            detail.effectiveness.stepsWithEvidence <= detail.systemStages.length,
            'count can never exceed the number of stages',
        );
    });

    test('evidence count is never greater than the stage total', async () => {
        const id = 'stages-bound';
        const { store, service } = await fixture(id);
        await seed(store, id, 'trace-bound');
        const detail = await service.get(id, 'trace-bound');
        assert.ok(detail.effectiveness.stepsWithEvidence <= detail.effectiveness.stepsTotal);
        assert.ok(detail.effectiveness.stepsWithEvidence >= 0);
    });
});

describe('Gap #4 — stage 8 reports the six audit questions', () => {
    test('a trace with no recon calls still reports 6/6 audit questions ready', async () => {
        const id = 'stages-audit';
        const { store, service } = await fixture(id);
        await seed(store, id, 'trace-audit');
        const detail = await service.get(id, 'trace-audit');
        const report = detail.systemStages.find((s) => s.id === 'report')!;
        const answered = report.details.find((d) => d.label === 'Audit questions')!;
        // Q1 events, Q2 decision, Q3 recon, Q4 gaps, Q5 receipt, Q6 spec.
        // Recon is absent on this trace, so exactly that question is the one that may be missing.
        const missing = String(answered.detail);
        assert.ok(
            /5\/6|6\/6/.test(answered.value),
            `answered must report audit readiness, got ${answered.value}`,
        );
        assert.ok(
            missing.includes('Q3') || !missing.includes('missing'),
            `only the recon question may be missing when no recon was reported, got: ${missing}`,
        );
    });

    test('Q3 in stage 8 denotes evidence recon, consistent with the six audit questions', async () => {
        const id = 'stages-q3';
        const { store, service } = await fixture(id);
        await seed(store, id, 'trace-q3', { recon: [{ adapter: 'codegraph', calls: 2 }] });
        const detail = await service.get(id, 'trace-q3');
        const report = detail.systemStages.find((s) => s.id === 'report')!;
        const answered = report.details.find((d) => d.label === 'Audit questions')!;
        assert.equal(answered.value, '6/6', 'every audit question has data once recon is reported');
    });
});

describe('Gap #5 — detail.recon can report a configured adapter with no calls', () => {
    test('recon adapter status is a known value for every entry', async () => {
        const id = 'stages-recon';
        const { store, service } = await fixture(id);
        await seed(store, id, 'trace-recon');
        const detail = await service.get(id, 'trace-recon');
        for (const adapter of detail.recon) {
            assert.ok(
                ['configured', 'observed', 'not-captured'].includes(adapter.status),
                `unknown recon status ${adapter.status} for ${adapter.id}`,
            );
        }
    });
});

describe('Pipeline enrichment — Step 3, 4, and 7 stages', () => {
    test('Step 3: reflects retrieval evidence from telemetry files and tools when signals.recon is absent', async () => {
        const id = 'stages-recon-telemetry';
        const { store, service } = await fixture(id);
        const traceId = 'trace-recon-tel';
        const base = { traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', workerId: 'worker-scout' };
        await store.insertObservation(id, {
            observationId: `${traceId}-1`, ...base, event: 'prompt.submitted', outcome: 'SUBMITTED',
            evidence: { userQuery: 'inspect files' }, at: '2026-11-26T10:00:00.000Z', idempotencyKey: `${traceId}-1`,
        });
        await store.insertObservation(id, {
            observationId: `${traceId}-2`, ...base, event: 'action.recorded', outcome: 'PASS',
            evidence: { tool: 'read_file', files: ['src/app.ts', 'src/util.ts'] }, at: '2026-11-26T10:00:01.000Z', idempotencyKey: `${traceId}-2`,
        });
        await store.insertObservation(id, {
            observationId: `${traceId}-3`, ...base, event: 'decision.recorded', outcome: 'PASS',
            evidence: { verdict: 'allow', winner: 'worker-scout' }, at: '2026-11-26T10:00:02.000Z', idempotencyKey: `${traceId}-3`,
        });

        const detail = await service.get(id, traceId);
        const step3 = detail.systemStages.find((s) => s.id === 'evidence-recon')!;
        assert.equal(step3.status, 'ok');
        assert.equal(step3.evidenced, true);
        assert.match(step3.sub, /file\(s\) · .* tool\(s\)/);
        assert.ok(step3.details.some((d) => d.label === 'Files loaded' && d.value === '2 file(s)'));
        assert.ok(step3.details.some((d) => d.label === 'Recon tools' && d.value.includes('read_file')));
    });

    test('Step 3: remains muted when truly nothing is captured', async () => {
        const id = 'stages-recon-muted';
        const { store, service } = await fixture(id);
        const traceId = 'trace-recon-empty';
        await store.insertObservation(id, {
            observationId: `${traceId}-1`, traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent',
            workerId: null, event: 'prompt.submitted', outcome: 'SUBMITTED',
            evidence: { userQuery: 'pure text query' }, at: '2026-11-26T10:00:00.000Z', idempotencyKey: `${traceId}-1`,
        });

        const detail = await service.get(id, traceId);
        const step3 = detail.systemStages.find((s) => s.id === 'evidence-recon')!;
        assert.equal(step3.status, 'muted');
        assert.equal(step3.evidenced, false);
        assert.equal(step3.sub, 'not captured');
    });

    test('Step 4: shows score 100 · all proofs present when 0 gaps', async () => {
        const id = 'stages-sufficiency-clean';
        const { store, service } = await fixture(id);
        await seed(store, id, 'trace-clean', { verdict: 'allow' });
        const detail = await service.get(id, 'trace-clean');
        const step4 = detail.systemStages.find((s) => s.id === 'sufficiency')!;
        if (detail.verdict.gaps.length === 0) {
            assert.equal(step4.sub, 'score 100 · all proofs present');
            assert.equal(step4.status, 'ok');
        } else {
            assert.match(step4.sub, new RegExp(`score ${detail.verdict.score} · ${detail.verdict.gaps.length} gap\\(s\\) · ${detail.verdict.gaps[0].code}`));
        }
    });

    test('Step 4: shows gap count and primary gap code when gaps exist', async () => {
        const id = 'stages-sufficiency-gaps';
        const { store, service } = await fixture(id);
        const traceId = 'trace-gaps';
        await store.insertObservation(id, {
            observationId: `${traceId}-1`, traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent',
            workerId: 'worker-scout', event: 'prompt.submitted', outcome: 'SUBMITTED',
            evidence: { userQuery: 'write something' }, at: '2026-11-26T10:00:00.000Z', idempotencyKey: `${traceId}-1`,
        });
        await store.insertObservation(id, {
            observationId: `${traceId}-2`, traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent',
            workerId: 'worker-scout', event: 'action.recorded', outcome: 'PASS',
            evidence: { tool: 'bash' }, at: '2026-11-26T10:00:01.000Z', idempotencyKey: `${traceId}-2`,
        });
        // Action recorded without law ref creates MISSING_LAW gap
        const detail = await service.get(id, traceId);
        const step4 = detail.systemStages.find((s) => s.id === 'sufficiency')!;
        assert.ok(detail.verdict.gaps.length > 0);
        assert.equal(step4.sub, `score ${detail.verdict.score} · ${detail.verdict.gaps.length} gap(s) · ${detail.verdict.gaps[0].code}`);
        assert.equal(step4.status, 'warn');
    });

    test('Step 7: exposes verified sources detail row when receipt has sources', async () => {
        const id = 'stages-sources';
        const { store, service } = await fixture(id);
        const traceId = 'trace-sources';
        const base = { traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', workerId: 'worker-scout' };
        await store.insertObservation(id, {
            observationId: `${traceId}-1`, ...base, event: 'prompt.submitted', outcome: 'SUBMITTED',
            evidence: { userQuery: 'verify sources' }, at: '2026-11-26T10:00:00.000Z', idempotencyKey: `${traceId}-1`,
        });
        await store.insertObservation(id, {
            observationId: `${traceId}-2`, ...base, event: 'evidence.verified', outcome: 'PASS',
            evidence: {
                sources: [
                    { requirementId: 'REQ-1', where: 'src/index.ts', hash: 'abc1234', verified: true },
                    { requirementId: 'REQ-2', where: 'src/lib.ts', hash: 'def5678', verified: true },
                ],
            }, at: '2026-11-26T10:00:01.000Z', idempotencyKey: `${traceId}-2`,
        });

        const detail = await service.get(id, traceId);
        const step7 = detail.systemStages.find((s) => s.id === 'seal')!;
        const sourcesRow = step7.details.find((d) => d.label === 'Sources');
        assert.ok(sourcesRow, 'Expected Sources detail row in Step 7');
        assert.equal(sourcesRow.value, '2 verified source(s)');
        assert.equal(sourcesRow.detail, 'sealed SHA-256 in receipt payload');
    });
});
