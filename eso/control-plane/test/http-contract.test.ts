/**
 * HTTP contract for the routes added by CR-010/CR-011.
 * These assert the status codes that AC-19/AC-20/AC-36 name, not just service behavior.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';

const servers: any[] = [];
afterEach(async () => {
    for (const app of servers.splice(0)) await app.close();
});

async function fixture() {
    const app = await createPlatformServer({
        store: new MemoryPlatformStore(),
        auth: new AuthService({ user: 'operator', password: 'secret', token: 'token' }),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app);
    const address = app.server.address() as any;
    const base = `http://127.0.0.1:${address.port}`;
    const auth = `Basic ${Buffer.from('operator:secret').toString('base64')}`;
    const call = (path: string, init: any = {}) =>
        fetch(`${base}${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json', ...(init.headers || {}) } });
    return { call };
}

describe('HTTP contract — CR-010/011 routes', () => {
    test('AC-36-1/2/3 — ingest 202, duplicate, UNKNOWN_SCHEMA 400', async () => {
        const { call } = await fixture();
        const event = { event_id: randomUUID(), occurred_at: new Date().toISOString(), kind: 'turn', schema: 'eso.event.v1', payload: { a: 1 } };
        const first = await call('/api/v1/consumers/c-http/ingest/events', { method: 'POST', body: JSON.stringify({ events: [event] }) });
        assert.equal(first.status, 202);
        assert.equal((await first.json()).accepted, 1);

        const again = await call('/api/v1/consumers/c-http/ingest/events', { method: 'POST', body: JSON.stringify({ events: [event] }) });
        assert.equal(again.status, 202);
        assert.equal((await again.json()).duplicate, 1);

        const bad = await call('/api/v1/consumers/c-http/ingest/events', { method: 'POST', body: JSON.stringify({ schema: 'nope', events: [event] }) });
        assert.equal(bad.status, 400);
        assert.equal((await bad.json()).code, 'UNKNOWN_SCHEMA');
    });

    test('AC-19-1/3 — evidence 201, PUT 405, unknown 404', async () => {
        const { call } = await fixture();
        const created = await call('/api/v1/consumers/c-http/evidence', {
            method: 'POST',
            body: JSON.stringify({ id: 'ev-1', kind: 'turn', contentHash: 'h1', sourceHash: 'h1' }),
        });
        assert.equal(created.status, 201);
        assert.equal((await created.json()).id, 'ev-1');

        const put = await call('/api/v1/consumers/c-http/evidence/ev-1', { method: 'PUT', body: '{}' });
        assert.equal(put.status, 405);

        const del = await call('/api/v1/consumers/c-http/evidence/ev-1', { method: 'DELETE', body: '{}' });
        assert.equal(del.status, 405);

        const missing = await call('/api/v1/consumers/c-http/evidence/nope');
        assert.equal(missing.status, 404);
    });

    test('AC-20-1 — memory propose trả 201 + status proposed', async () => {
        const { call } = await fixture();
        const res = await call('/api/v1/consumers/c-http/memory/facts', {
            method: 'POST',
            body: JSON.stringify({ text: 'fact', source: 'test' }),
        });
        assert.equal(res.status, 201);
        assert.equal((await res.json()).status, 'proposed');
    });

    test('self-upgrade list + arch ask reachable', async () => {
        const { call } = await fixture();
        const list = await call('/api/v1/self-upgrade/proposals');
        assert.equal(list.status, 200);
        assert.ok(Array.isArray(await list.json()));

        const ask = await call('/api/v1/arch/ask', { method: 'POST', body: JSON.stringify({ kind: 'monolith', module: 'src/common/http/server.ts' }) });
        assert.equal(ask.status, 200);
    });
});
