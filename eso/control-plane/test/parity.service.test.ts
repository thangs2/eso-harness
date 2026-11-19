import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { ParityService } from '../src/modules/parity/parity.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-parity-'));
    roots.push(root);
    await store.insertConsumer({
        id: 'parity-consumer', name: 'Parity', root, sdlcRoot: 'sdlc', schemaName: 'c_parity', status: 'ready', version: 1,
        storageMode: 'schema', materializedHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return new ParityService(store);
}

const run = (hostId: string, outcome = 'PASS') => ({ hostId, runtimeKey: `${hostId}:runtime`, flowId: 'flow', workerId: 'worker-build', outcome, policy: { tier: 'balanced' }, evidence: { completeness: 0.9 } });

describe('Phase 4 host parity', () => {
    it('passes when policy and outcome match', async () => {
        const service = await fixture();
        const result = await service.compare('parity-consumer', { left: run('host-a'), right: run('host-b') });
        assert.equal(result.gate, true);
        assert.equal(result.policyParity, true);
        assert.equal(result.outcomeParity, true);
    });

    it('fails gate on outcome mismatch but keeps evidence diagnostic', async () => {
        const service = await fixture();
        const result = await service.compare('parity-consumer', { left: run('host-a'), right: run('host-b', 'FAIL') });
        assert.equal(result.gate, false);
        assert.equal(result.outcomeParity, false);
    });

    it('fails gate on policy mismatch', async () => {
        const service = await fixture();
        const right = { ...run('host-b'), policy: { tier: 'reasoning' } };
        const result = await service.compare('parity-consumer', { left: run('host-a'), right });
        assert.equal(result.gate, false);
        assert.equal(result.policyParity, false);
    });
});
