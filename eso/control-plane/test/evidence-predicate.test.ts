/**
 * S2 — Server-side evidence predicate verification at ingest + pure verdict reading.
 *
 * Run: `cd eso/control-plane && bun test test/evidence-predicate.test.ts`
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { MemoryPlatformStore, RegistryService, type Actor } from '../src/platform/registry/index.js';
import { EvidencePredicateService } from '../src/modules/judgment/evidence-predicate.service.js';
import { ObservationService } from '../src/modules/observations/observation.service.js';
import { VerdictService } from '../src/modules/verdict/verdict.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };

function sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

async function setupConsumer(consumerId: string, root: string): Promise<MemoryPlatformStore> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    await registry.createConsumer({ id: consumerId, name: consumerId, root, actor });
    return store;
}

function decisionBody(traceId: string) {
    return {
        traceId,
        hostId: 'cursor',
        runtimeKey: 'cursor:cursor-agent',
        event: 'decision.recorded',
        evidence: {
            winner: 'plan',
            verdict: 'allow',
            basis: 'all requirements verified',
            actor: { kind: 'host', id: 'cursor', role: 'builder' },
            schemaVersion: 1,
        },
        idempotencyKey: randomUUID(),
    };
}

function actionBody(traceId: string) {
    return {
        traceId,
        hostId: 'cursor',
        runtimeKey: 'cursor:cursor-agent',
        event: 'action.recorded',
        outcome: 'PASS',
        evidence: {
            tool: 'apply_patch',
            outcome: 'PASS',
            files: ['src/example.ts'],
            actor: { kind: 'host', id: 'cursor' },
        },
        idempotencyKey: randomUUID(),
    };
}

describe('S2 — EvidencePredicateService & ObservationService ingest', () => {
    test('Option A: legacy packet without requirementId or knowledge/file kind is skipped cleanly', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'eso-pred-optA-'));
        try {
            const consumerId = 'pred-option-a';
            const store = await setupConsumer(consumerId, dir);
            const predicate = new EvidencePredicateService(store);
            const observations = new ObservationService(store, predicate);

            const hashOnly = await predicate.verifyPacket(consumerId, { hash: 'sha256:legacy' });
            assert.equal(hashOnly.checked, false);
            assert.deepEqual(hashOnly.results, []);
            assert.deepEqual(hashOnly.sources, []);

            const noteOnly = await predicate.verifyPacket(consumerId, {
                items: [{ id: 'note-1', kind: 'note' }],
            });
            assert.equal(noteOnly.checked, false);
            assert.deepEqual(noteOnly.results, []);

            await observations.ingest(consumerId, {
                traceId: 'trace-legacy',
                hostId: 'cursor',
                runtimeKey: 'cursor:cursor-agent',
                event: 'evidence.packet',
                evidence: { items: [{ id: 'note-1', kind: 'note' }] },
                idempotencyKey: randomUUID(),
            });

            const stored = await store.listObservations(consumerId, 50);
            assert.equal(stored.length, 1);
            assert.equal(stored[0].event, 'evidence.packet');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('forged packet ⇒ ingest succeeds, appends evidence.verified(allVerified=false), verdict downgrades allow → partial + EVIDENCE_UNVERIFIED', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'eso-pred-forged-'));
        try {
            const consumerId = 'pred-forged';
            const store = await setupConsumer(consumerId, dir);
            const observations = new ObservationService(store);
            const verdicts = new VerdictService(store);
            const traceId = 'trace-forged';

            await observations.ingest(consumerId, decisionBody(traceId));
            const packetRes = await observations.ingest(consumerId, {
                traceId,
                hostId: 'cursor',
                runtimeKey: 'cursor:cursor-agent',
                event: 'evidence.packet',
                evidence: {
                    items: [
                        {
                            id: 'missing-doc',
                            kind: 'knowledge',
                            hash: 'dummy',
                            requirementId: 'req-1',
                        },
                    ],
                    actor: { kind: 'host', id: 'cursor' },
                },
                idempotencyKey: randomUUID(),
            });
            await observations.ingest(consumerId, actionBody(traceId));

            // Critical invariant: ingest MUST NOT reject the forged packet.
            assert.equal(packetRes.ok, true);
            assert.equal(packetRes.created, true);

            const rows = await store.listObservations(consumerId, 50);
            const verifiedRow = rows.find((row) => row.event === 'evidence.verified');
            assert.ok(verifiedRow, 'evidence.verified observation must be appended');
            assert.equal(verifiedRow.trace_id ?? verifiedRow.traceId, traceId);
            assert.equal(verifiedRow.outcome, 'unverified');
            assert.equal(verifiedRow.evidence.allVerified, false);
            assert.deepEqual(verifiedRow.evidence.actor, { kind: 'eso', id: 'predicate-verifier' });
            assert.equal(verifiedRow.evidence.sources.length, 1);
            assert.equal(verifiedRow.evidence.sources[0].requirementId, 'req-1');
            assert.equal(verifiedRow.evidence.sources[0].verified, false);

            const verdict = await verdicts.ensureVerdict(consumerId, traceId);
            assert.equal(verdict.level, 'partial');
            assert.deepEqual(
                verdict.gaps.map((g) => g.code),
                ['EVIDENCE_UNVERIFIED'],
            );
            assert.equal(verdict.score, 75);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('time-travel safety: deleting KB doc after ingest does NOT change pure verdict (remains allow)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'eso-pred-timetravel-'));
        try {
            const consumerId = 'pred-timetravel';
            const docRel = 'docs/spec.md';
            const docAbs = join(dir, docRel);
            const docContent = '# Architecture Spec\n\n## Security Invariants\n\nAll inputs verified.\n';
            mkdirSync(join(dir, 'docs'), { recursive: true });
            writeFileSync(docAbs, docContent, 'utf8');
            const docHash = sha256(docContent);

            const store = await setupConsumer(consumerId, dir);
            const observations = new ObservationService(store);
            const verdicts = new VerdictService(store);
            const traceId = 'trace-timetravel';

            await observations.ingest(consumerId, decisionBody(traceId));
            await observations.ingest(consumerId, {
                traceId,
                hostId: 'cursor',
                runtimeKey: 'cursor:cursor-agent',
                event: 'evidence.packet',
                evidence: {
                    items: [
                        {
                            id: docRel,
                            kind: 'knowledge',
                            hash: `sha256:${docHash}`,
                            requirementId: 'req-spec',
                        },
                    ],
                    actor: { kind: 'host', id: 'cursor' },
                },
                idempotencyKey: randomUUID(),
            });
            await observations.ingest(consumerId, actionBody(traceId));

            const rows = await store.listObservations(consumerId, 50);
            const verifiedRow = rows.find((row) => row.event === 'evidence.verified');
            assert.ok(verifiedRow, 'evidence.verified observation must exist');
            assert.equal(verifiedRow.outcome, 'verified');
            assert.equal(verifiedRow.evidence.allVerified, true);
            assert.equal(verifiedRow.evidence.sources[0].verified, true);
            assert.equal(verifiedRow.evidence.sources[0].hash, docHash);

            // Mutate / delete KB doc AFTER the turn has been ingested.
            unlinkSync(docAbs);

            // VerdictService.ensureVerdict reads only trace observations (pure adjudicate) — still allow!
            const verdict = await verdicts.ensureVerdict(consumerId, traceId);
            assert.equal(verdict.level, 'allow');
            assert.deepEqual(verdict.gaps, []);
            assert.equal(verdict.score, 100);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('deterministic predicates: KB_TEMPLATE_PRESENT, KB_DOC_HAS_SECTION, KB_INDEX_COVERS, SNAPSHOT_MATCHES', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'eso-pred-kinds-'));
        try {
            const consumerId = 'pred-kinds';
            mkdirSync(join(dir, '.harness'), { recursive: true });
            mkdirSync(join(dir, 'docs'), { recursive: true });
            writeFileSync(
                join(dir, '.harness', 'knowledge-template.json'),
                JSON.stringify({ kinds: [{ kind: 'frd', required: true }] }),
                'utf8',
            );
            writeFileSync(
                join(dir, 'docs', 'guide.md'),
                '# Guide\n\n## Acceptance Criteria\n\nMust pass.\n',
                'utf8',
            );

            const store = await setupConsumer(consumerId, dir);
            await store.setMaterializedHash(consumerId, 'snap-abc-123');
            const predicate = new EvidencePredicateService(store);

            const pass = await predicate.verifyPacket(consumerId, {
                items: [
                    { id: 'template', kind: 'KB_TEMPLATE_PRESENT', requirementId: 'req-tpl' },
                    { id: 'docs/guide.md#Acceptance Criteria', kind: 'KB_DOC_HAS_SECTION', requirementId: 'req-sec' },
                    { id: 'docs/guide.md', kind: 'KB_INDEX_COVERS', requirementId: 'req-idx' },
                    { id: 'snap-abc-123', kind: 'SNAPSHOT_MATCHES', requirementId: 'req-snap' },
                ],
            });
            assert.equal(pass.checked, true);
            assert.equal(pass.allVerified, true);
            assert.equal(pass.snapshotId, 'snap-abc-123');
            assert.equal(pass.sources.length, 4);
            assert.ok(pass.sources.every((s) => s.verified));

            const fail = await predicate.verifyPacket(consumerId, {
                items: [
                    { id: 'docs/guide.md#Missing Section', kind: 'KB_DOC_HAS_SECTION', requirementId: 'req-sec' },
                    { id: 'snap-wrong', kind: 'SNAPSHOT_MATCHES', requirementId: 'req-snap' },
                ],
            });
            assert.equal(fail.checked, true);
            assert.equal(fail.allVerified, false);
            assert.ok(fail.sources.every((s) => !s.verified && typeof s.reason === 'string'));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
