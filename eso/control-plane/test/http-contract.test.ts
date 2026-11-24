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

    test('P1 — observations accept decision.recorded, invalid payload is 422 OBSERVATION_INVALID', async () => {
        const { call } = await fixture();
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const root = mkdtempSync(join(tmpdir(), 'eso-http-obs-'));
        const consumer = await call('/api/v1/consumers', {
            method: 'POST',
            body: JSON.stringify({ id: 'fineso', name: 'Fineso', root }),
        });
        assert.ok([200, 201].includes(consumer.status), `create consumer: ${consumer.status}`);

        const envelope = { traceId: 'trace-fineso-1', hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', event: 'decision.recorded' };
        const valid = await call('/api/v1/consumers/fineso/observations', {
            method: 'POST',
            body: JSON.stringify({
                ...envelope,
                outcome: 'PASS',
                evidence: {
                    winner: 'plan',
                    verdict: 'allow',
                    basis: 'rule core.slp says build then verify',
                    refs: [{ kind: 'rule', path: 'agents/rules/core.slp.mdc', line: 42 }],
                    actor: { kind: 'host', id: 'cursor', role: 'builder' },
                    schemaVersion: 1,
                },
            }),
        });
        assert.ok([200, 201].includes(valid.status), `valid decision: ${valid.status}`);
        assert.equal((await valid.json() as any).created, true);

        // Contract validation never rewrites evidence: actor/schemaVersion stay in the stored JSONB.
        const listed = await call('/api/v1/consumers/fineso/observations');
        assert.equal(listed.status, 200);
        const stored = (await listed.json() as any).items[0];
        assert.equal(stored.evidence.actor.kind, 'host');
        assert.equal(stored.evidence.schemaVersion, 1);

        const invalid = await call('/api/v1/consumers/fineso/observations', {
            method: 'POST',
            body: JSON.stringify({
                ...envelope,
                traceId: 'trace-fineso-2',
                evidence: { verdict: 'allow', basis: 'winner is missing' },
            }),
        });
        assert.equal(invalid.status, 422);
        const body = await invalid.json() as any;
        assert.equal(body.code, 'OBSERVATION_INVALID');
        assert.match(String(body.detail), /winner/);
    });

    test('P6a — detail.signals: null for a legacy decision, echoes seeded signals, no back-fill', async () => {
        const { call } = await fixture();
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const root = mkdtempSync(join(tmpdir(), 'eso-http-signals-'));
        const consumer = await call('/api/v1/consumers', {
            method: 'POST',
            body: JSON.stringify({ id: 'signalo', name: 'Signalo', root }),
        });
        assert.ok([200, 201].includes(consumer.status), `create consumer: ${consumer.status}`);

        const post = (traceId: string, event: string, evidence: Record<string, unknown>, at: string) =>
            call('/api/v1/consumers/signalo/observations', {
                method: 'POST',
                body: JSON.stringify({ traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', event, evidence, at }),
            });
        const stored = async (traceId: string, event: string, evidence: Record<string, unknown>, at: string) => {
            const res = await post(traceId, event, evidence, at);
            assert.ok([200, 201].includes(res.status), `${event}: ${res.status}`);
        };

        // A decision that predates P6a reports no signal keys ⇒ signals is null, never inferred.
        await stored('trace-p6-legacy', 'prompt.submitted', { userQuery: 'legacy turn' }, '2026-11-24T01:00:00.000Z');
        await stored('trace-p6-legacy', 'decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'core.slp' }, '2026-11-24T01:00:01.000Z');
        const legacy = await call('/api/v1/consumers/signalo/requests/trace-p6-legacy');
        assert.equal(legacy.status, 200);
        assert.equal((await legacy.json() as any).signals, null);

        // Seeded signals are echoed verbatim. A later decision without signals must not erase them:
        // the latest *carrier* row wins.
        const signals = {
            preflight: { state: 'HOT', fingerprint: 'G1:abc' },
            recon: [{ adapter: 'codegraph', calls: 2 }, { adapter: 'docgraph', calls: 1 }],
            brainTier: 'flash',
            distill: { memorySaved: true, lessons: 3 },
        };
        const traceId = 'trace-p6-signals';
        await stored(traceId, 'prompt.submitted', { userQuery: 'signals please' }, '2026-11-24T02:00:00.000Z');
        await stored(traceId, 'decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'core.slp build then verify', ...signals }, '2026-11-24T02:00:01.000Z');
        await stored(traceId, 'decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'later decision without signals' }, '2026-11-24T02:00:02.000Z');

        const detail = await call(`/api/v1/consumers/signalo/requests/${traceId}`);
        assert.equal(detail.status, 200);
        assert.deepEqual((await detail.json() as any).signals, signals);

        // Partial carrier: sub-fields it omits are null, not back-filled from another row.
        const partial = 'trace-p6-partial';
        await stored(partial, 'prompt.submitted', { userQuery: 'partial signals' }, '2026-11-24T03:00:00.000Z');
        await stored(partial, 'decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'tier only', brainTier: 'zero' }, '2026-11-24T03:00:01.000Z');
        const partialDetail = await call(`/api/v1/consumers/signalo/requests/${partial}`);
        assert.equal(partialDetail.status, 200);
        assert.deepEqual((await partialDetail.json() as any).signals, {
            preflight: null,
            recon: null,
            brainTier: 'zero',
            distill: null,
        });
    });

    test('P2 — detail carries verdict; verdict route matches; silent trace ⇒ unknown + HOST_SILENT', async () => {
        const { call } = await fixture();
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const root = mkdtempSync(join(tmpdir(), 'eso-http-verdict-'));
        const consumer = await call('/api/v1/consumers', {
            method: 'POST',
            body: JSON.stringify({ id: 'verdicto', name: 'Verdicto', root }),
        });
        assert.ok([200, 201].includes(consumer.status), `create consumer: ${consumer.status}`);

        const post = (traceId: string, event: string, evidence: Record<string, unknown>) =>
            call('/api/v1/consumers/verdicto/observations', {
                method: 'POST',
                body: JSON.stringify({ traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', event, evidence }),
            });

        const hostActor = { kind: 'host', id: 'cursor', role: 'builder' };
        const allowTrace = 'trace-p2-allow';
        for (const [event, evidence] of [
            ['prompt.submitted', { userQuery: 'why did this turn proceed?' }],
            ['decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'core.slp build then verify', actor: hostActor, schemaVersion: 1 }],
            ['evidence.packet', { hash: 'sha256:abc123', actor: hostActor }],
            ['action.recorded', { tool: 'apply_patch', outcome: 'PASS', files: ['src/example.ts'], actor: hostActor }],
        ] as Array<[string, Record<string, unknown>]>) {
            const stored = await post(allowTrace, event, evidence);
            assert.ok([200, 201].includes(stored.status), `${event}: ${stored.status}`);
        }

        const detail = await call(`/api/v1/consumers/verdicto/requests/${allowTrace}`);
        assert.equal(detail.status, 200);
        const detailBody = await detail.json() as any;
        assert.equal(detailBody.verdict.level, 'allow');
        assert.equal(detailBody.verdict.score, 100);
        assert.equal(detailBody.verdict.actor.role, 'builder');

        const verdictRoute = await call(`/api/v1/consumers/verdicto/requests/${allowTrace}/verdict`);
        assert.equal(verdictRoute.status, 200);
        assert.deepEqual(await verdictRoute.json(), detailBody.verdict);

        const silentTrace = 'trace-p2-silent';
        const silentPost = await post(silentTrace, 'prompt.submitted', { userQuery: 'no decision was recorded' });
        assert.ok([200, 201].includes(silentPost.status));
        const silent = await call(`/api/v1/consumers/verdicto/requests/${silentTrace}`);
        assert.equal(silent.status, 200);
        const silentBody = await silent.json() as any;
        assert.equal(silentBody.verdict.level, 'unknown');
        assert.equal(silentBody.verdict.score, 75);
        assert.ok(silentBody.verdict.gaps.some((gap: any) => gap.code === 'HOST_SILENT' && /cannot prove why/.test(gap.consequence)));
    });

    test('P4 — receipt route returns the id; verify route returns ok true', async () => {
        const { call } = await fixture();
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const root = mkdtempSync(join(tmpdir(), 'eso-http-receipt-'));
        const consumer = await call('/api/v1/consumers', {
            method: 'POST',
            body: JSON.stringify({ id: 'receipto', name: 'Receipto', root }),
        });
        assert.ok([200, 201].includes(consumer.status), `create consumer: ${consumer.status}`);

        const traceId = 'trace-p4-receipt';
        const post = (event: string, evidence: Record<string, unknown>) =>
            call('/api/v1/consumers/receipto/observations', {
                method: 'POST',
                body: JSON.stringify({ traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', event, evidence }),
            });
        const hostActor = { kind: 'host', id: 'cursor', role: 'builder' };
        for (const [event, evidence] of [
            ['prompt.submitted', { userQuery: 'why did this turn proceed?' }],
            ['decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'core.slp build then verify', actor: hostActor, schemaVersion: 1 }],
            ['evidence.packet', { hash: 'sha256:abc123', actor: hostActor }],
            ['action.recorded', { tool: 'apply_patch', outcome: 'PASS', files: ['src/example.ts'], actor: hostActor }],
        ] as Array<[string, Record<string, unknown>]>) {
            const stored = await post(event, evidence);
            assert.ok([200, 201].includes(stored.status), `${event}: ${stored.status}`);
        }

        const detail = await call(`/api/v1/consumers/receipto/requests/${traceId}`);
        assert.equal(detail.status, 200);
        const detailBody = await detail.json() as any;
        assert.equal(typeof detailBody.verdict.receiptId, 'string');
        assert.ok(detailBody.verdict.receiptId.length > 0);
        // P5a — the detail exposes a receipt summary, not the sealed digest.
        assert.deepEqual(
            Object.keys(detailBody.receipt).sort(),
            ['chained', 'createdAt', 'hash', 'hashPrefix', 'hmacPresent', 'receiptId', 'specVersion', 'verdictLevel']
        );
        assert.equal(detailBody.receipt.receiptId, detailBody.verdict.receiptId);
        assert.match(detailBody.receipt.hashPrefix, /^[0-9a-f]{12}$/);
        assert.equal(detailBody.receipt.chained, false, 'first receipt is genesis, not chained');
        assert.equal(typeof detailBody.receipt.hmacPresent, 'boolean');
        assert.equal(detailBody.receipt.specVersion, 1);
        assert.equal(detailBody.receipt.verdictLevel, 'allow');
        assert.equal(typeof detailBody.receipt.createdAt, 'string');

        const receiptRoute = await call(`/api/v1/consumers/receipto/requests/${traceId}/receipt`);
        assert.equal(receiptRoute.status, 200);
        const receipt = await receiptRoute.json() as any;
        assert.equal(receipt.receiptId, detailBody.verdict.receiptId);
        assert.equal(receipt.traceId, traceId);
        assert.equal(receipt.prevHash, 'GENESIS');
        assert.match(receipt.hash, /^[0-9a-f]{64}$/);
        assert.equal(detailBody.receipt.hashPrefix, receipt.hash.slice(0, 12));
        // The digest is not a secret: a third party must be able to recompute/verify it (V3).
        assert.equal(detailBody.receipt.hash, receipt.hash);
        assert.equal(detailBody.receipt.hmacPresent, receipt.hmac !== null && receipt.hmac !== '');

        // issue-or-get: the receipt route is idempotent per trace
        const again = await call(`/api/v1/consumers/receipto/requests/${traceId}/receipt`);
        assert.equal(again.status, 200);
        assert.equal((await again.json() as any).receiptId, receipt.receiptId);

        const verifyRoute = await call(`/api/v1/consumers/receipto/receipts/${receipt.receiptId}/verify`);
        assert.equal(verifyRoute.status, 200);
        assert.deepEqual(await verifyRoute.json(), { ok: true, hashMatches: true, hmacMatches: true, chained: true });
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
