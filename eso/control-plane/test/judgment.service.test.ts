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
    return { service: new JudgmentService(store), root };
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

    it('keeps actor scope and records authenticated identity', async () => {
        const { service } = await fixture();
        const result = await service.evaluate('judgment-consumer', {
            requirements: [requirement],
            answers: [{ requirement: 'AC-1', claim: 'x', basis: 'verified', exists: 'present' }],
            actor: { kind: 'machine', label: 'worker-build' },
        }, operator);
        assert.equal(result.actor.kind, 'machine');
        assert.equal(result.actor.label, 'worker-build');
        assert.equal(result.actor.authenticated_kind, 'operator');
    });

    it('rejects missing requirement source', async () => {
        const { service } = await fixture();
        await assert.rejects(
            service.evaluate('judgment-consumer', { requirements: [{ subject: 'x', min_basis: 'declared' }] }, operator),
            (error: any) => /SOURCE_MISSING/.test(String(error.detail)),
        );
    });
});
