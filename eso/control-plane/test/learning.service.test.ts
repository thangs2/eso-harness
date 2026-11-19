import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { LearningService } from '../src/modules/learning/learning.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-learning-'));
    roots.push(root);
    await store.insertConsumer({
        id: 'learning-consumer', name: 'Learning', root, sdlcRoot: 'sdlc', schemaName: 'c_learning', status: 'ready', version: 1,
        storageMode: 'schema', materializedHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return { service: new LearningService(store), store };
}

const operator = { kind: 'operator' as const, label: 'operator@test' };
const machine = { kind: 'machine' as const, label: 'worker-build' };
const proposalInput = {
    risk_kind: 'missing_test',
    risks: [{ risk_id: 'r1' }, { risk_id: 'r2' }],
    expected_effect: 'reduce missing tests by 20%',
    revert: { action: 'restore previous skill version' },
};

describe('Phase 4 learning proposals', () => {
    it('proposes, approves, applies, reverts and audits', async () => {
        const { service, store } = await fixture();
        const proposed = await service.propose('learning-consumer', proposalInput, operator);
        assert.equal(proposed.status, 'proposed');
        assert.equal((await service.approve('learning-consumer', proposed.proposal_id, operator)).status, 'approved');
        assert.equal((await service.apply('learning-consumer', proposed.proposal_id, operator)).status, 'applied');
        assert.equal((await service.revert('learning-consumer', proposed.proposal_id, operator)).status, 'reverted');
        const events = await store.listEvents('learning-consumer');
        assert.equal(events.some((event) => event.detail?.learning === 'learning.applied'), true);
    });

    it('rejects machine approval (no self-upgrade)', async () => {
        const { service } = await fixture();
        const proposed = await service.propose('learning-consumer', proposalInput, operator);
        await assert.rejects(service.approve('learning-consumer', proposed.proposal_id, machine), (error: any) => /operator/.test(String(error.detail)));
    });

    it('rejects proposal without revert', async () => {
        const { service } = await fixture();
        await assert.rejects(service.propose('learning-consumer', { ...proposalInput, revert: {} }, operator), (error: any) => /NO_REVERT/.test(String(error.detail)));
    });
    it('measures an applied proposal after the window closes', async () => {
        const { service } = await fixture();
        const proposed = await service.propose('learning-consumer', proposalInput, operator);
        await service.approve('learning-consumer', proposed.proposal_id, operator);
        await service.apply('learning-consumer', proposed.proposal_id, operator);
        const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
        const measured = await service.measure('learning-consumer', proposed.proposal_id, {
            before: { unsat_rate: 0.5, defect_rate: 2 },
            after: { unsat_rate: 0.2, defect_rate: 2 },
        }, operator, later);
        assert.equal(measured.evaluation.effective, true);
        assert.equal(measured.evaluation.metrics.unsat.decreased, true);
    });

    it('refuses measurement before the window closes', async () => {
        const { service } = await fixture();
        const proposed = await service.propose('learning-consumer', proposalInput, operator);
        await service.approve('learning-consumer', proposed.proposal_id, operator);
        await service.apply('learning-consumer', proposed.proposal_id, operator);
        await assert.rejects(service.measure('learning-consumer', proposed.proposal_id, { before: {}, after: {} }, operator), (error: any) => /NO_MEASUREMENT/.test(String(error.detail)));
    });

});
