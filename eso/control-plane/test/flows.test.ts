/**
 * Flows — draft/validate/publish/default/delete (file service, không cần DB).
 * Pin: AC-42-1…10.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore, RegistryService } from '../src/platform/registry/index.js';
import { RegistrationService } from '../src/modules/consumers/registration/registration.service.js';
import { WorkerFileService } from '../src/modules/workers/worker-file.service.js';
import { FlowFileService } from '../src/modules/flows/flow-file.service.js';

const actor = { kind: 'operator' as const, label: 'operator@test' };

async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'eso-flow-'));
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const registration = new RegistrationService(registry, store);
    await registration.register({
        id: 'flow-test',
        name: 'Flow Test',
        root,
        profile: { canonical: { agents: 'agents', harness: '.harness' } },
        actor,
    });
    const workers = new WorkerFileService(store);
    await workers.write('flow-test', {
        workers: [
            { id: 'worker-a', name: 'A', role: 'worker', layer: 'peer', scope: 'x', status: 'active' },
            { id: 'worker-b', name: 'B', role: 'worker', layer: 'peer', scope: 'x', status: 'active' },
        ] as any,
        edges: [],
    });
    const flows = new FlowFileService(store, workers);
    return { root, flows, workers, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const definition = (edges: any[] = [{ id: 'e1', from: 'worker-a', to: 'worker-b', on: 'WORKER_COMPLETED' }]) => ({
    id: 'flow-main',
    name: 'Main',
    nodes: [{ workerId: 'worker-a', x: 0, y: 0 }, { workerId: 'worker-b', x: 200, y: 0 }],
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
});

describe('flows (AC-42-1…10)', () => {
    test('AC-42-1 list rỗng, sau saveDraft có draft', async () => {
        const f = await fixture();
        try {
            assert.deepEqual(await f.flows.list('flow-test'), []);
            await f.flows.saveDraft('flow-test', 'flow-main', definition());
            const list = await f.flows.list('flow-test');
            assert.equal(list.length, 1);
            assert.equal(list[0].status, 'draft');
        } finally { f.cleanup(); }
    });

    test('AC-42-2 get draft; get flow lạ trả null', async () => {
        const f = await fixture();
        try {
            await f.flows.saveDraft('flow-test', 'flow-main', definition());
            assert.equal((await f.flows.get('flow-test', 'flow-main')).name, 'Main');
            assert.equal(await f.flows.get('flow-test', 'nope'), null);
        } finally { f.cleanup(); }
    });

    test('AC-42-7 validate: ok · unknown worker · loop warning', async () => {
        const f = await fixture();
        try {
            assert.equal((await f.flows.validate('flow-test', definition())).ok, true);
            const bad = await f.flows.validate('flow-test', { ...definition(), nodes: [{ workerId: 'ghost', x: 0, y: 0 }], edges: [] });
            assert.equal(bad.ok, false);
            assert.ok(bad.errors.includes('UNKNOWN_WORKER:ghost'));
            const loop = await f.flows.validate('flow-test', definition([
                { id: 'e1', from: 'worker-a', to: 'worker-b', on: 'WORKER_COMPLETED' },
                { id: 'e2', from: 'worker-b', to: 'worker-a', on: 'WORKER_COMPLETED' },
            ]));
            assert.equal(loop.ok, true);
            assert.ok(loop.warnings.includes('FLOW_HAS_LOOP'));
        } finally { f.cleanup(); }
    });

    test('AC-42-8 publish: draft → published, draft mất, publish lần 2 NO_DRAFT', async () => {
        const f = await fixture();
        try {
            await f.flows.saveDraft('flow-test', 'flow-main', definition());
            const published = await f.flows.publish('flow-test', 'flow-main');
            assert.equal(published.ok, true);
            assert.equal(published.flow.status, 'published');
            assert.equal((await f.flows.get('flow-test', 'flow-main')).status, 'published', 'get() fallback về bản published');
            assert.deepEqual(await f.flows.deleteDraft('flow-test', 'flow-main'), { ok: false, reason: 'NO_DRAFT' }, 'draft phải biến mất');
            assert.equal((await f.flows.get('flow-test', 'flow-main', 1)).status, 'published');
            assert.deepEqual(await f.flows.publish('flow-test', 'flow-main'), { ok: false, reason: 'NO_DRAFT' });
        } finally { f.cleanup(); }
    });

    test('AC-42-8 published là immutable: saveDraft sau publish tạo version mới', async () => {
        const f = await fixture();
        try {
            await f.flows.saveDraft('flow-test', 'flow-main', definition());
            await f.flows.publish('flow-test', 'flow-main');
            const next = await f.flows.saveDraft('flow-test', 'flow-main', definition());
            assert.equal(next.version, 2);
            assert.equal((await f.flows.get('flow-test', 'flow-main', 1)).name, 'Main');
        } finally { f.cleanup(); }
    });

    test('AC-42-9 default: chỉ version đã publish; defaultFlow trả đúng', async () => {
        const f = await fixture();
        try {
            await f.flows.saveDraft('flow-test', 'flow-main', definition());
            await f.flows.publish('flow-test', 'flow-main');
            const def = await f.flows.setDefault('flow-test', 'flow-main', 1);
            assert.equal(def.ok, true);
            assert.equal((await f.flows.defaultFlow('flow-test')).version, 1);
            assert.deepEqual(await f.flows.setDefault('flow-test', 'flow-main', 99), { ok: false, reason: 'VERSION_NOT_FOUND' });
        } finally { f.cleanup(); }
    });

    test('AC-42-10 deleteDraft: NO_DRAFT khi không có, xoá đúng draft', async () => {
        const f = await fixture();
        try {
            assert.deepEqual(await f.flows.deleteDraft('flow-test', 'flow-main'), { ok: false, reason: 'NO_DRAFT' });
            await f.flows.saveDraft('flow-test', 'flow-main', definition());
            assert.deepEqual(await f.flows.deleteDraft('flow-test', 'flow-main'), { ok: true, flowId: 'flow-main' });
            assert.deepEqual(await f.flows.list('flow-test'), []);
        } finally { f.cleanup(); }
    });

    test('AC-42-2 listVersions sau publish có version 1', async () => {
        const f = await fixture();
        try {
            await f.flows.saveDraft('flow-test', 'flow-main', definition());
            await f.flows.publish('flow-test', 'flow-main');
            const versions = await f.flows.listVersions('flow-test', 'flow-main');
            assert.equal(versions.length, 1);
            assert.equal(versions[0].version, 1);
        } finally { f.cleanup(); }
    });
});
