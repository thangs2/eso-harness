/**
 * Regression tests for the backend bugs in sdlc/02.governance/02.records/15.bug-register.md:
 * BUG-27 (stack-versions last-write-wins), BUG-38 (half-created consumer on provisioning
 * failure), BUG-39 (flow publish/setDefault returning 200 {ok:false}), BUG-45 (unbounded list).
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import { normalizeListWindow } from '../src/platform/registry/types.js';
import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { MaterialProvisioningService } from '../src/provisioning/material/material-provisioning.service.js';
import { WorkerFileService } from '../src/modules/workers/worker-file.service.js';

const servers: any[] = [];
const roots: string[] = [];

afterEach(async () => {
    for (const app of servers.splice(0)) await app.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'eso-bugfix-'));
    roots.push(root);
    return root;
}

function consumerRecord(id: string, root: string, overrides: Record<string, any> = {}) {
    const now = new Date().toISOString();
    return {
        id,
        name: id,
        root,
        sdlcRoot: null,
        schemaName: `c_${id}`,
        status: 'ready' as const,
        version: 1,
        storageMode: 'schema' as const,
        materializedHash: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

async function fixture() {
    const store = new MemoryPlatformStore();
    const app = await createPlatformServer({
        store,
        auth: new AuthService({ user: 'operator', password: 'secret', token: 'token' }),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app);
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    const auth = `Basic ${Buffer.from('operator:secret').toString('base64')}`;
    const call = (path: string, init: any = {}) =>
        fetch(`${base}${path}`, {
            ...init,
            headers: { authorization: auth, 'content-type': 'application/json', ...(init.headers || {}) },
        });
    return { store, call };
}

describe('BUG-27 — stack-versions replace-all requires baseVersion', () => {
    test('stale write is rejected with 409 STALE_VERSION; current write succeeds', async () => {
        const { store, call } = await fixture();
        const root = tempRoot();
        await store.insertConsumer(consumerRecord('c-stack', root));

        const initial = await call('/api/v1/consumers/c-stack/stack-versions');
        assert.equal(initial.status, 200);
        const initialBody = await initial.json();
        assert.equal(initialBody.version, 1);
        assert.deepEqual(initialBody.versions, []);
        assert.equal(typeof initialBody.versionsHash, 'string');

        const first = await call('/api/v1/consumers/c-stack/stack-versions', {
            method: 'PUT',
            body: JSON.stringify({
                baseVersion: 1,
                versions: [{ version: 1, status: 'published', layers: [{ id: 'layer-a' }] }],
            }),
        });
        assert.equal(first.status, 200);
        const firstBody = await first.json();
        assert.equal(firstBody.versions.length, 1);
        assert.equal(firstBody.version, 2, 'a successful conditional write bumps the consumer version');
        assert.notEqual(firstBody.versionsHash, initialBody.versionsHash);

        // Tab A still holds baseVersion=1 and tries to save its older copy: rejected, not LWW.
        const stale = await call('/api/v1/consumers/c-stack/stack-versions', {
            method: 'PUT',
            body: JSON.stringify({ baseVersion: 1, versions: [{ version: 2, status: 'published', layers: [] }] }),
        });
        assert.equal(stale.status, 409);
        const staleBody = await stale.json();
        assert.equal(staleBody.code, 'STALE_VERSION');
        assert.equal((await store.listStackVersions('c-stack')).length, 1, 'stale write must not replace the set');

        // The versions hash is an accepted token too.
        const byHash = await call('/api/v1/consumers/c-stack/stack-versions', {
            method: 'PUT',
            body: JSON.stringify({
                baseVersion: firstBody.versionsHash,
                versions: [
                    { version: 1, status: 'retired', layers: [{ id: 'layer-a' }] },
                    { version: 2, status: 'published', layers: [{ id: 'layer-b' }] },
                ],
            }),
        });
        assert.equal(byHash.status, 200);
        const byHashBody = await byHash.json();
        assert.equal(byHashBody.version, 3);
        assert.equal(byHashBody.versions.length, 2);

        // The previously handed-out hash is now stale.
        const staleHash = await call('/api/v1/consumers/c-stack/stack-versions', {
            method: 'PUT',
            body: JSON.stringify({ baseVersion: firstBody.versionsHash, versions: [] }),
        });
        assert.equal(staleHash.status, 409);
        assert.equal((await staleHash.json()).code, 'STALE_VERSION');

        // A legacy client that only sends `{versions}` is rejected, not silently accepted.
        const missing = await call('/api/v1/consumers/c-stack/stack-versions', {
            method: 'PUT',
            body: JSON.stringify({ versions: [] }),
        });
        assert.equal(missing.status, 409);
        assert.equal((await missing.json()).code, 'STALE_VERSION');
    });
});

describe('BUG-38 — POST /consumers rolls back a failed provisioning', () => {
    test('provision failure leaves no ready consumer and a retry succeeds', async () => {
        const { store, call } = await fixture();
        const root = tempRoot();
        const body = {
            id: 'c-rollback',
            name: 'Rollback',
            root,
            profile: { canonical: { agents: 'agents', harness: '.harness' } },
        };

        const proto = MaterialProvisioningService.prototype;
        const original = proto.provision;
        proto.provision = async () => {
            throw new Error('simulated disk failure');
        };
        let failed: Response;
        try {
            failed = await call('/api/v1/consumers', { method: 'POST', body: JSON.stringify(body) });
        } finally {
            proto.provision = original;
        }

        assert.equal(failed!.status, 500);
        const failedBody = await failed!.json();
        assert.equal(failedBody.code, 'PROVISION_FAILED');
        assert.equal(await store.getConsumer('c-rollback'), null, 'no half-created consumer row');
        assert.equal(await store.schemaExists('c-rollback'), false, 'created schema is rolled back');
        assert.deepEqual(await store.listConsumers({ includeDeleted: true }), []);
        const absent = await call('/api/v1/consumers/c-rollback');
        assert.equal(absent.status, 404);

        // Retry with the same id must not trip CONSUMER_EXISTS.
        const retry = await call('/api/v1/consumers', { method: 'POST', body: JSON.stringify(body) });
        assert.equal(retry.status, 201);
        const retryBody = await retry.json();
        assert.equal(retryBody.id, 'c-rollback');
        assert.equal(retryBody.status, 'ready');
        const setup = await call('/api/v1/consumers/c-rollback/setup');
        assert.equal(setup.status, 200);
        assert.equal((await setup.json()).setup.ready, true);
    });
});

describe('BUG-39 — flow publish/setDefault fail with a proper status + code', () => {
    test('publish success keeps {ok:true}; no draft and invalid flow return 409/422', async () => {
        const { store, call } = await fixture();
        const root = tempRoot();
        await store.insertConsumer(consumerRecord('c-flow', root));
        const workers = new WorkerFileService(store);
        await workers.write('c-flow', {
            workers: [
                { id: 'worker-a', name: 'A', role: 'worker', layer: 'peer', scope: 'x', status: 'active' },
                { id: 'worker-b', name: 'B', role: 'worker', layer: 'peer', scope: 'x', status: 'active' },
            ] as any,
            edges: [],
        });
        const definition = {
            id: 'flow-main',
            name: 'Main',
            nodes: [{ workerId: 'worker-a', x: 0, y: 0 }, { workerId: 'worker-b', x: 200, y: 0 }],
            edges: [{ id: 'e1', from: 'worker-a', to: 'worker-b', on: 'WORKER_COMPLETED' }],
            viewport: { x: 0, y: 0, zoom: 1 },
        };
        const draft = await call('/api/v1/consumers/c-flow/flows/flow-main', {
            method: 'PUT',
            body: JSON.stringify(definition),
        });
        assert.equal(draft.status, 200);

        const published = await call('/api/v1/consumers/c-flow/flows/flow-main/publish', { method: 'POST', body: '{}' });
        assert.equal(published.status, 200);
        const publishedBody = await published.json();
        assert.equal(publishedBody.ok, true);
        assert.equal(publishedBody.flow.status, 'published');

        const again = await call('/api/v1/consumers/c-flow/flows/flow-main/publish', { method: 'POST', body: '{}' });
        assert.equal(again.status, 409);
        const againBody = await again.json();
        assert.equal(againBody.code, 'FLOW_NO_DRAFT');
        assert.equal(againBody.ok, undefined, 'failure body is the error envelope, not {ok:false}');

        const invalid = await call('/api/v1/consumers/c-flow/flows/flow-bad', {
            method: 'PUT',
            body: JSON.stringify({ ...definition, id: 'flow-bad', nodes: [{ workerId: 'ghost', x: 0, y: 0 }], edges: [] }),
        });
        assert.equal(invalid.status, 200);
        const invalidPublish = await call('/api/v1/consumers/c-flow/flows/flow-bad/publish', { method: 'POST', body: '{}' });
        assert.equal(invalidPublish.status, 422);
        const invalidBody = await invalidPublish.json();
        assert.equal(invalidBody.code, 'FLOW_INVALID');
        assert.match(invalidBody.detail, /UNKNOWN_WORKER:ghost/);
    });

    test('setDefault success keeps {ok:true}; unknown version is a coded 4xx', async () => {
        const { store, call } = await fixture();
        const root = tempRoot();
        await store.insertConsumer(consumerRecord('c-flow-default', root));
        const workers = new WorkerFileService(store);
        await workers.write('c-flow-default', {
            workers: [
                { id: 'worker-a', name: 'A', role: 'worker', layer: 'peer', scope: 'x', status: 'active' },
                { id: 'worker-b', name: 'B', role: 'worker', layer: 'peer', scope: 'x', status: 'active' },
            ] as any,
            edges: [],
        });
        await call('/api/v1/consumers/c-flow-default/flows/flow-main', {
            method: 'PUT',
            body: JSON.stringify({
                id: 'flow-main',
                name: 'Main',
                nodes: [{ workerId: 'worker-a', x: 0, y: 0 }, { workerId: 'worker-b', x: 200, y: 0 }],
                edges: [{ id: 'e1', from: 'worker-a', to: 'worker-b', on: 'WORKER_COMPLETED' }],
                viewport: { x: 0, y: 0, zoom: 1 },
            }),
        });
        const publish = await call('/api/v1/consumers/c-flow-default/flows/flow-main/publish', { method: 'POST', body: '{}' });
        assert.equal(publish.status, 200);

        const current = await call('/api/v1/consumers/c-flow-default/flows/default', {
            method: 'PUT',
            body: JSON.stringify({ flowId: 'flow-main', version: 1 }),
        });
        assert.equal(current.status, 200);
        const currentBody = await current.json();
        assert.equal(currentBody.ok, true);
        assert.equal(currentBody.flow.id, 'flow-main');

        const missingVersion = await call('/api/v1/consumers/c-flow-default/flows/default', {
            method: 'PUT',
            body: JSON.stringify({ flowId: 'flow-main', version: 99 }),
        });
        assert.equal(missingVersion.status, 404);
        assert.equal((await missingVersion.json()).code, 'NOT_FOUND');

        const invalidDefault = await call('/api/v1/consumers/c-flow-default/flows/default', {
            method: 'PUT',
            body: JSON.stringify({ flowId: 'BAD ID', version: 0 }),
        });
        assert.equal(invalidDefault.status, 422);
        assert.equal((await invalidDefault.json()).code, 'FLOW_INVALID');
    });
});

describe('BUG-45 — consumer list is bounded', () => {
    test('route applies limit/offset and defaults to 100', async () => {
        const { store, call } = await fixture();
        const root = tempRoot();
        for (let index = 0; index < 120; index += 1) {
            const id = `c-list-${String(index).padStart(3, '0')}`;
            await store.insertConsumer(consumerRecord(id, root, {
                updatedAt: new Date(Date.now() - index * 1000).toISOString(),
            }));
        }

        const defaultPage = await call('/api/v1/consumers');
        assert.equal(defaultPage.status, 200);
        const defaultRows = await defaultPage.json();
        assert.equal(defaultRows.length, 100, 'default page is 100 rows, not the whole table');

        const limited = await call('/api/v1/consumers?limit=2');
        const limitedRows = await limited.json();
        assert.equal(limitedRows.length, 2);

        const offset = await call('/api/v1/consumers?limit=2&offset=2');
        const offsetRows = await offset.json();
        assert.equal(offsetRows.length, 2);
        assert.notEqual(offsetRows[0].id, limitedRows[0].id);
        assert.notEqual(offsetRows[0].id, limitedRows[1].id);

        assert.deepEqual(normalizeListWindow({}), { limit: 100, offset: 0 });
        assert.deepEqual(normalizeListWindow({ limit: 9999, offset: -5 }), { limit: 500, offset: 0 });
        assert.deepEqual(normalizeListWindow({ limit: 0 }), { limit: 100, offset: 0 });
    });
});
