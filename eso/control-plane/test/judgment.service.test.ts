import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { JudgmentService } from '../src/modules/judgment/judgment.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-judgment-'));
    roots.push(root);
    await store.insertConsumer({
        id: 'judgment-consumer', name: 'Judgment', root, sdlcRoot: 'sdlc', schemaName: 'c_judgment',
        status: 'ready', version: 1, storageMode: 'schema', materializedHash: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return { service: new JudgmentService(store), store, root };
}

const operator = { kind: 'operator' as const, label: 'operator@test' };
const requirement = { subject: 'AC-1', source: 'work', min_basis: 'retrieved', asks: ['decision'] };

describe('Phase 2 judgment service', () => {
    it('returns sufficient only with a satisfying answer and allows', async () => {
        const { service } = await fixture();
        const result = await service.evaluate('judgment-consumer', {
            requirements: [requirement],
            answers: [{ requirement: 'AC-1', claim: 'evidence', basis: 'verified', exists: 'present' }],
            enforcement: 'enforce',
        }, operator);
        assert.equal(result.verdict.level, 'sufficient');
        assert.equal(result.decision, 'allow');
        assert.equal(result.wouldBlock, false);
        assert.equal(result.enforcement, 'enforce');
    });

    it('unknown is cannot-judge, never absent and never allow in enforce', async () => {
        const { service } = await fixture();
        const result = await service.evaluate('judgment-consumer', {
            requirements: [requirement], answers: [], enforcement: 'enforce',
        }, operator);
        assert.equal(result.verdict.level, 'cannot-judge');
        assert.equal(result.verdict.mode, 'block');
        assert.equal(result.decision, 'block');
        assert.equal(result.gaps.gap_items.length, 1);
        assert.equal(result.gaps.gap_items[0].exists, 'unknown');
        assert.equal(result.gaps.gap_items[0].status, 'unknown');
    });

    it('shadow records wouldBlock but does not block', async () => {
        const { service } = await fixture();
        const result = await service.evaluate('judgment-consumer', { requirements: [requirement], answers: [] }, operator);
        assert.equal(result.enforcement, 'shadow');
        assert.equal(result.wouldBlock, true);
        assert.equal(result.decision, 'allow');
    });

    it('empty requirements are cannot-judge, never sufficient', async () => {
        const { service } = await fixture();
        const result = await service.evaluate('judgment-consumer', { requirements: [] }, operator);
        assert.equal(result.verdict.level, 'cannot-judge');
        assert.equal(result.wouldBlock, true);
    });

    it('keeps actor scope and records authenticated identity without letting client spoof actor.kind', async () => {
        const { service } = await fixture();
        const result = await service.evaluate('judgment-consumer', {
            requirements: [requirement],
            answers: [{ requirement: 'AC-1', claim: 'x', basis: 'verified', exists: 'present' }],
            actor: { kind: 'machine', label: 'spoof', role: 'admin', authenticated_kind: 'machine' },
        }, operator);
        assert.equal(result.actor.kind, 'operator');
        assert.equal(result.actor.label, 'spoof');
        assert.equal(result.actor.authenticated_kind, 'operator');
        assert.equal(result.actor.requestedRole, 'admin');
        assert.equal(result.actor.role, undefined);
    });

    it('enforces store-configured worker bar over client-supplied downgrade', async () => {
        const { service, store } = await fixture();
        store.knowledgeWorker = async (_consumerId: string, workerId: string) => {
            if (workerId !== 'worker-build') return null;
            return {
                worker_id: 'worker-build',
                name: 'Worker Build',
                role: 'builder',
                bar: [{ evidence_kind: 'test_pass', min_basis: 'strict' }],
            };
        };
        const result = await service.evaluate('judgment-consumer', {
            workerId: 'worker-build',
            requirements: [requirement],
            answers: [{ requirement: 'AC-1', claim: 'x', basis: 'verified', exists: 'present' }],
            role: { name: 'downgraded', bar: [{ evidence_kind: 'test_pass', min_basis: 'declared' }] },
            roleEvidence: [{ kind: 'test_pass', basis: 'partial' }],
            enforcement: 'enforce',
        }, operator);
        assert.equal(result.role_sufficiency?.level, 'INSUFFICIENT');
        assert.equal(result.role_sufficiency?.role, 'builder');
        assert.equal(result.role_sufficiency?.deficits?.[0]?.required_basis, 'strict');
        assert.equal(result.verdict.level, 'insufficient');
        assert.equal(result.wouldBlock, true);
        assert.equal(result.decision, 'block');
    });

    it('rejects missing requirement source', async () => {
        const { service } = await fixture();
        await assert.rejects(
            service.evaluate('judgment-consumer', { requirements: [{ subject: 'x', min_basis: 'declared' }] }, operator),
            (error: any) => /SOURCE_MISSING/.test(String(error.detail)),
        );
    });

    it('derives requirements from store worker bar and knowledge docs when requirements is omitted', async () => {
        const { service, store } = await fixture();
        store.knowledgeWorker = async (_consumerId: string, workerId: string) => {
            if (workerId !== 'worker-build') return null;
            return {
                worker_id: 'worker-build',
                name: 'Worker Build',
                role: 'builder',
                bar: [{ evidence_kind: 'test_pass', min_basis: 'verified' }],
            };
        };
        store.knowledgeDocs = async () => [
            { doc_id: 'doc-law', path: 'AGENTS.md', type: 'law', status: 'active', title: 'Workspace Law' },
        ];

        const result = await service.evaluate('judgment-consumer', {
            workerId: 'worker-build',
            answers: [
                { requirement: 'test_pass', claim: 'bun test ok', basis: 'verified', exists: 'present' },
                { requirement: 'AGENTS.md', claim: 'AGENTS.md', basis: 'verified', exists: 'present' },
            ],
            roleEvidence: [{ kind: 'test_pass', basis: 'verified' }],
            enforcement: 'enforce',
        }, operator);

        assert.equal(result.verdict.level, 'sufficient');
        assert.equal(result.decision, 'allow');
        assert.equal(result.wouldBlock, false);
        assert.equal(result.verdict.requirements.length, 2);
        assert.equal(result.verdict.requirements[0].subject, 'test_pass');
        assert.equal(result.verdict.requirements[0].source, 'bar');
        assert.equal(result.verdict.requirements[1].subject, 'AGENTS.md');
        assert.equal(result.verdict.requirements[1].source, 'declared');
    });

    it('keeps explicit empty requirements: [] as cannot-judge even when worker bar exists', async () => {
        const { service, store } = await fixture();
        store.knowledgeWorker = async (_consumerId: string, workerId: string) => {
            if (workerId !== 'worker-build') return null;
            return {
                worker_id: 'worker-build',
                name: 'Worker Build',
                role: 'builder',
                bar: [{ evidence_kind: 'test_pass', min_basis: 'verified' }],
            };
        };

        const result = await service.evaluate('judgment-consumer', {
            workerId: 'worker-build',
            requirements: [],
            roleEvidence: [{ kind: 'test_pass', basis: 'verified' }],
            enforcement: 'enforce',
        }, operator);

        assert.equal(result.verdict.level, 'cannot-judge');
        assert.equal(result.verdict.cannot_judge_reason, 'no_requirement');
        assert.equal(result.wouldBlock, true);
        assert.equal(result.decision, 'block');
    });
});
