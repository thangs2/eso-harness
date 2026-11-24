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

    test('AC-38 — capability card hợp lệ 200; L4 thiếu cross-session bị từ chối', async () => {
        const { call } = await fixture();
        const baseCard = {
            schemaVersion: 1,
            host: { id: 'h1', version: '1.0.0' },
            probedAt: new Date().toISOString(),
            status: 'measured',
            publishLevels: true,
            levels: { overall: 'L1', chain: { observe: 'L1', inject: 'unknown', memoryRead: 'unknown', memoryWrite: 'unknown' } },
            dimensions: [
                { dimension: 'observe', status: 'measured', evidence: [{ kind: 'session-event', summary: 'turn captured' }] },
            ],
            events: [],
            evidence: [{ kind: 'session-event', summary: 'turn captured' }],
            limitations: [],
        };
        const ok = await call('/api/v1/consumers/c-http/hosts/h1/capability', { method: 'POST', body: JSON.stringify(baseCard) });
        assert.equal(ok.status, 200);

        const l4 = await call('/api/v1/consumers/c-http/hosts/h2/capability', {
            method: 'POST',
            body: JSON.stringify({ ...baseCard, host: { id: 'h2', version: '1.0.0' }, levels: { ...baseCard.levels, overall: 'L4' } }),
        });
        assert.equal(l4.status, 409);

        const blocked = await call('/api/v1/consumers/c-http/hosts/h3/capability', {
            method: 'POST',
            body: JSON.stringify({ ...baseCard, host: { id: 'h3', version: '1.0.0' }, publishLevels: true, reason: 'PROBE_BLOCKED' }),
        });
        assert.equal(blocked.status, 409);

        const missing = await call('/api/v1/consumers/c-http/hosts/none/capability');
        assert.equal(missing.status, 404);
    });

    test('BUG-13 — config preview 200 + save stale 409 + save ok 200', async () => {
        const { call } = await fixture();
        // consumer must exist for config routes: register through the API with a temp root
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const root = mkdtempSync(join(tmpdir(), 'eso-http-cfg-'));
        const created = await call('/api/v1/consumers', {
            method: 'POST',
            body: JSON.stringify({ id: 'cfg-http', name: 'Cfg', root }),
        });
        assert.ok([201, 200].includes(created.status), `create consumer: ${created.status}`);

        const preview = await call('/api/v1/consumers/cfg-http/config/preview');
        assert.equal(preview.status, 200);
        const body = await preview.json() as any;
        assert.match(body.hash, /^[0-9a-f]{64}$/);

        const stale = await call('/api/v1/consumers/cfg-http/config', {
            method: 'PUT',
            body: JSON.stringify({ hash: 'deadbeef' }),
        });
        assert.equal(stale.status, 409);

        const ok = await call('/api/v1/consumers/cfg-http/config', {
            method: 'PUT',
            body: JSON.stringify({ hash: body.hash }),
        });
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).ok, true);
    });

    test('self-upgrade list + arch ask reachable', async () => {
        const { call } = await fixture();
        const list = await call('/api/v1/self-upgrade/proposals');
        assert.equal(list.status, 200);
        assert.ok(Array.isArray(await list.json()));

        const ask = await call('/api/v1/arch/ask', { method: 'POST', body: JSON.stringify({ kind: 'monolith', module: 'src/common/http/server.ts' }) });
        assert.equal(ask.status, 200);
    });

    test('V2 telemetry — POST 202, unknown surface 422, summary counts', async () => {
        const { call } = await fixture();

        const views = ['surface.observatory.open', 'surface.events.open', 'raw.evidence.expand'];
        for (const surface of views) {
            const recorded = await call('/api/v1/telemetry/ui', {
                method: 'POST',
                body: JSON.stringify({ surface, consumerId: 'c-telemetry', session: 'page-1' }),
            });
            assert.equal(recorded.status, 202);
            const body = await recorded.json() as any;
            assert.equal(body.surface, surface);
            assert.equal(body.consumerId, 'c-telemetry');
            assert.equal(body.session, 'page-1');
        }

        const bad = await call('/api/v1/telemetry/ui', {
            method: 'POST',
            body: JSON.stringify({ surface: 'surface.not-a-surface' }),
        });
        assert.equal(bad.status, 422);
        assert.equal((await bad.json()).code, 'INVALID_STATE');

        const summary = await call('/api/v1/telemetry/summary?consumer=c-telemetry');
        assert.equal(summary.status, 200);
        const counts = await summary.json() as any;
        assert.equal(counts.surface_views, 2);
        assert.equal(counts.raw_views, 1);
        assert.equal(counts.ratio, 2 / 3);
        assert.equal(counts.bySurface['surface.observatory.open'], 1);
        assert.equal(counts.bySurface['surface.events.open'], 1);
        assert.equal(counts.bySurface['raw.evidence.expand'], 1);
    });

    test('V2 telemetry — summary requires auth', async () => {
        await fixture();
        // The fixture always adds authorization; call the server without it through a raw fetch.
        const app = servers[servers.length - 1];
        const address = app.server.address() as any;
        const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/telemetry/summary`);
        assert.equal(res.status, 401);
    });
});
