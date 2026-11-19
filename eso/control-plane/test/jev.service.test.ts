import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { JevService } from '../src/modules/judgment/jev.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture(jev: any) {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-jev-'));
    roots.push(root);
    mkdirSync(join(root, '.harness'), { recursive: true });
    writeFileSync(join(root, '.harness', 'config.json'), JSON.stringify({ profile: { profile: { integration: { jev } } } }));
    await store.insertConsumer({
        id: 'jev-consumer', name: 'JEV', root, sdlcRoot: 'sdlc', schemaName: 'c_jev', status: 'ready', version: 1,
        storageMode: 'schema', materializedHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return { service: new JevService(store), store };
}

describe('JEV decision facade', () => {
    it('off never decides', async () => {
        const { service } = await fixture({ mode: 'off' });
        const result = await service.decide('jev-consumer', { confidence: 0.99 });
        assert.equal(result.decision, 'ask');
        assert.equal(result.band, null);
    });

    it('active maps confidence to auto/confirm/ask bands', async () => {
        const { service, store } = await fixture({ mode: 'active', consent: true, autoThreshold: 0.8, confirmThreshold: 0.5 });
        assert.equal((await service.decide('jev-consumer', { confidence: 0.9 })).decision, 'auto');
        assert.equal((await service.decide('jev-consumer', { confidence: 0.6 })).decision, 'confirm');
        assert.equal((await service.decide('jev-consumer', { confidence: 0.2 })).decision, 'ask');
        const events = await store.listEvents('jev-consumer');
        assert.equal(events.some((event) => event.detail?.jevDecision?.decision === 'auto'), true);
    });

    it('shadow observes and never decides', async () => {
        const { service } = await fixture({ mode: 'shadow', consent: true, autoThreshold: 0.8, confirmThreshold: 0.5 });
        const result = await service.decide('jev-consumer', { confidence: 0.95 });
        assert.equal(result.decision, 'observe');
        assert.equal(result.band, 'auto');
    });

    it('rejects missing consent and invalid confidence', async () => {
        const { service } = await fixture({ mode: 'active', consent: false });
        await assert.rejects(service.decide('jev-consumer', { confidence: 0.9 }), (error: any) => /consent/.test(String(error.detail)));
        await assert.rejects(service.decide('jev-consumer', { confidence: 2 }), (error: any) => /confidence/.test(String(error.detail)));
    });
});
