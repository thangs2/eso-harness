/**
 * HTTP contract for the routes added by CR-010/CR-011.
 * These assert the status codes that AC-19/AC-20/AC-36 name, not just service behavior.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import { REQUEST_SPEC_REF } from '../src/platform/registry/types.js';
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
        assert.equal(silentBody.verdict.score, 0);
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
        assert.equal(detailBody.receipt.specVersion, 2);
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
        // B0-9 — detail.spec points at the normative doc (reference only, no prose) and the receipt
        // seals the same doc/version/section; the UI-only anchor stays out of the hashed bytes.
        assert.deepEqual(detailBody.spec, { ...REQUEST_SPEC_REF });
        assert.deepEqual(receipt.payload.specRef, {
            doc: REQUEST_SPEC_REF.doc,
            version: REQUEST_SPEC_REF.version,
            section: REQUEST_SPEC_REF.section,
        });
        assert.equal(receipt.payload.specRef.anchor, undefined);

        // issue-or-get: the receipt route is idempotent per trace
        const again = await call(`/api/v1/consumers/receipto/requests/${traceId}/receipt`);
        assert.equal(again.status, 200);
        assert.equal((await again.json() as any).receiptId, receipt.receiptId);

        const verifyRoute = await call(`/api/v1/consumers/receipto/receipts/${receipt.receiptId}/verify`);
        assert.equal(verifyRoute.status, 200);
        assert.deepEqual(await verifyRoute.json(), { ok: true, hashMatches: true, hmacMatches: true, chained: true });
    });

    test('Q2 — scope/check with traceId then GET detail shows writeGate', async () => {
        const { call } = await fixture();
        const { mkdtempSync, mkdirSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const root = mkdtempSync(join(tmpdir(), 'eso-http-write-gate-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        mkdirSync(join(root, 'docs'), { recursive: true });
        const consumer = await call('/api/v1/consumers', {
            method: 'POST',
            body: JSON.stringify({ id: 'gateo', name: 'Gateo', root }),
        });
        assert.ok([200, 201].includes(consumer.status), `create consumer: ${consumer.status}`);

        const traceId = 'trace-q2-gate';
        const prompt = await call('/api/v1/consumers/gateo/observations', {
            method: 'POST',
            body: JSON.stringify({
                traceId,
                hostId: 'cursor',
                runtimeKey: 'cursor:cursor-agent',
                event: 'prompt.submitted',
                evidence: { userQuery: 'why was this file write allowed?' },
            }),
        });
        assert.ok([200, 201].includes(prompt.status), `prompt.submitted: ${prompt.status}`);

        const allowed = await call('/api/v1/consumers/gateo/scope/check', {
            method: 'POST',
            body: JSON.stringify({
                allowedFiles: ['src/**'],
                target: 'src/a.ts',
                traceId,
                actor: { kind: 'operator', label: 'operator@test' },
            }),
        });
        assert.equal(allowed.status, 200);
        assert.equal((await allowed.json() as any).allowed, true);

        const first = await call(`/api/v1/consumers/gateo/requests/${traceId}`);
        assert.equal(first.status, 200);
        const firstGate = (await first.json() as any).writeGate;
        assert.equal(typeof firstGate.decisionId, 'string');
        assert.equal(firstGate.allowed, true);
        assert.equal(firstGate.code, null);
        assert.equal(firstGate.target, 'src/a.ts');
        assert.deepEqual(firstGate.actor, { kind: 'operator', label: 'operator@test' });
        assert.equal(Number.isNaN(new Date(firstGate.at).getTime()), false);

        // A later check on the same trace becomes the gate the detail reports.
        const blocked = await call('/api/v1/consumers/gateo/scope/check', {
            method: 'POST',
            body: JSON.stringify({ allowedFiles: ['src/**'], target: 'docs/other.md', traceId }),
        });
        assert.equal(blocked.status, 200);
        assert.equal((await blocked.json() as any).code, 'BLOCKED_SCOPE');

        const second = await call(`/api/v1/consumers/gateo/requests/${traceId}`);
        assert.equal(second.status, 200);
        const secondGate = (await second.json() as any).writeGate;
        assert.equal(secondGate.allowed, false);
        assert.equal(secondGate.code, 'BLOCKED_SCOPE');
        assert.equal(secondGate.target, 'docs/other.md');
        assert.notEqual(secondGate.decisionId, firstGate.decisionId, 'latest decision wins');
    });

    test('P8 — detail has the 8 pipeline-v2 stages in fixed order + effectiveness', async () => {
        const { call } = await fixture();
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const root = mkdtempSync(join(tmpdir(), 'eso-http-pipeline-v2-'));
        const consumer = await call('/api/v1/consumers', {
            method: 'POST',
            body: JSON.stringify({ id: 'pipelineo', name: 'Pipelineo', root }),
        });
        assert.ok([200, 201].includes(consumer.status), `create consumer: ${consumer.status}`);

        const traceId = 'trace-p8-stages';
        const seed = async (event: string, evidence: Record<string, unknown>, at: string, outcome?: string) => {
            const res = await call('/api/v1/consumers/pipelineo/observations', {
                method: 'POST',
                body: JSON.stringify({
                    traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', event, evidence, at,
                    ...(outcome ? { outcome } : {}),
                }),
            });
            assert.ok([200, 201].includes(res.status), `${event}: ${res.status}`);
        };
        await seed('prompt.submitted', { userQuery: 'why did this turn proceed?' }, '2026-11-24T10:00:00.000Z');
        await seed('decision.recorded', {
            winner: 'plan',
            verdict: 'allow',
            basis: 'core.slp says build then verify',
            refs: [{ kind: 'law', path: 'AGENTS.md' }],
            recon: [{ adapter: 'codegraph', calls: 2 }],
            distill: { memorySaved: true, lessons: 1 },
            actor: { kind: 'host', id: 'cursor', role: 'builder' },
        }, '2026-11-24T10:00:02.000Z');
        await seed('action.recorded', {
            tool: 'apply_patch', outcome: 'PASS', files: ['src/a.ts'], actor: { kind: 'host', id: 'cursor' },
        }, '2026-11-24T10:00:03.000Z', 'PASS');
        await seed('evidence.packet', { hash: 'sha256:abc', actor: { kind: 'host', id: 'cursor' } }, '2026-11-24T10:00:05.000Z');

        const res = await call(`/api/v1/consumers/pipelineo/requests/${traceId}`);
        assert.equal(res.status, 200);
        const body = await res.json() as any;
        const stages = body.systemStages;
        assert.deepEqual(stages.map((stage: any) => stage.id), [
            'intake-law', 'decision-jev', 'evidence-recon', 'sufficiency', 'slp', 'execution', 'seal', 'report',
        ]);
        assert.deepEqual(stages.map((stage: any) => stage.stepNumber), [1, 2, 3, 4, 5, 6, 7, 8]);
        assert.deepEqual(stages.map((stage: any) => stage.title), [
            'Intake & Law Gate', 'Decision & JEV', 'Evidence Recon', 'Sufficiency Gate',
            'SLP Orchestration', 'Execution & Write Gate', 'Seal & Distill', 'Report & Audit',
        ]);
        for (const stage of stages) {
            assert.ok(['waterfall', 'rules', 'decisions', 'telemetry'].includes(stage.tab), `${stage.id} tab`);
            assert.ok(stage.details.length <= 3, `${stage.id} has at most 3 details`);
            for (const detail of stage.details) {
                assert.equal(typeof detail.value, 'string');
                assert.ok(detail.value.length > 0, `${stage.id} detail value is never empty`);
                assert.equal(typeof detail.detail, 'string');
            }
        }
        // Stage 1 reads verdict.ruleRefs; stage 2 has no JEV on this trace; stage 3 reads signals.recon.
        assert.equal(stages[0].status, 'ok');
        assert.match(String(stages[0].details[2].value), /AGENTS\.md/);
        assert.equal(stages[1].status, 'info');
        assert.equal(stages[1].details[1].value, 'not reported');
        assert.equal(stages[2].status, 'ok');

        // Effectiveness: same data, no new table — 8 steps and every field a count/boolean.
        const keys = [
            'stepsTotal', 'stepsWithEvidence', 'rolesAssigned', 'rolesObserved', 'workersTotal',
            'workersObserved', 'failures', 'durationMs', 'writeGateChecked', 'receiptSealed', 'gaps',
        ];
        assert.deepEqual(Object.keys(body.effectiveness).sort(), [...keys].sort());
        assert.equal(body.effectiveness.stepsTotal, 8);
        assert.equal(body.effectiveness.stepsTotal, stages.length);
        // Evidence is the stage's own flag, not its presentation status: `warn` can fire with no data
        // and `info` can carry a value, so the count must never be derived from status.
        assert.equal(
            body.effectiveness.stepsWithEvidence,
            stages.filter((stage: any) => stage.evidenced === true).length,
        );
        for (const stage of stages) {
            assert.equal(typeof stage.evidenced, 'boolean', `${stage.id} declares evidenced`);
        }
        assert.equal(body.effectiveness.workersTotal, body.pipeline.length);
        assert.equal(typeof body.effectiveness.workersObserved, 'number');
        assert.equal(body.effectiveness.failures, 0);
        assert.equal(body.effectiveness.durationMs, 5000);
        assert.equal(body.effectiveness.writeGateChecked, false);
        assert.equal(body.effectiveness.receiptSealed, true);
        assert.equal(body.effectiveness.gaps, body.verdict.gaps.length);
        assert.equal(typeof body.effectiveness.writeGateChecked, 'boolean');
        assert.equal(typeof body.effectiveness.receiptSealed, 'boolean');
        assert.equal(typeof body.effectiveness.gaps, 'number');
    });

    test('P8 — detail.jev: null for a legacy decision, echo + match, mismatch ⇒ JEV_BAND_MISMATCH', async () => {
        const { call } = await fixture();
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const root = mkdtempSync(join(tmpdir(), 'eso-http-jev-'));
        const consumer = await call('/api/v1/consumers', {
            method: 'POST',
            body: JSON.stringify({ id: 'jevvo', name: 'Jevvo', root }),
        });
        assert.ok([200, 201].includes(consumer.status), `create consumer: ${consumer.status}`);

        const seed = async (traceId: string, event: string, evidence: Record<string, unknown>, at: string) => {
            const res = await call('/api/v1/consumers/jevvo/observations', {
                method: 'POST',
                body: JSON.stringify({ traceId, hostId: 'cursor', runtimeKey: 'cursor:cursor-agent', event, evidence, at }),
            });
            assert.ok([200, 201].includes(res.status), `${traceId} ${event}: ${res.status}`);
        };
        const detail = async (traceId: string) => {
            const res = await call(`/api/v1/consumers/jevvo/requests/${traceId}`);
            assert.equal(res.status, 200);
            return res.json() as any;
        };

        // The contract refusal reaches the HTTP surface as its own 422 code.
        const noConfidence = await call('/api/v1/consumers/jevvo/observations', {
            method: 'POST',
            body: JSON.stringify({
                traceId: 'trace-p8-no-confidence', hostId: 'cursor', runtimeKey: 'cursor:cursor-agent',
                event: 'decision.recorded', at: '2026-11-24T08:59:00.000Z',
                evidence: { winner: 'plan', verdict: 'allow', basis: 'core.slp', jev: { mode: 'active', consent: true } },
            }),
        });
        assert.equal(noConfidence.status, 422);
        assert.equal((await noConfidence.json() as any).code, 'JEV_CONFIDENCE_REQUIRED');

        // A decision without evidence.jev ⇒ detail.jev is null; B0-3 stays valid, nothing is inferred.
        await seed('trace-p8-legacy', 'prompt.submitted', { userQuery: 'legacy' }, '2026-11-24T09:00:00.000Z');
        await seed('trace-p8-legacy', 'decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'core.slp' }, '2026-11-24T09:00:01.000Z');
        assert.equal((await detail('trace-p8-legacy')).jev, null);

        // A matching report: confidence 0.9 ≥ the default 0.8 auto threshold ⇒ expected band auto.
        const jev = { mode: 'active', consent: true, confidence: 0.9, band: 'auto', decision: 'auto', reason: 'active: auto' };
        await seed('trace-p8-match', 'prompt.submitted', { userQuery: 'jev' }, '2026-11-24T09:10:00.000Z');
        await seed('trace-p8-match', 'decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'core.slp', jev }, '2026-11-24T09:10:02.000Z');
        // A later decision without jev must not erase the earlier report (latest *carrier* wins).
        await seed('trace-p8-match', 'decision.recorded', { winner: 'plan', verdict: 'allow', basis: 'later, no jev' }, '2026-11-24T09:10:03.000Z');
        const matched = await detail('trace-p8-match');
        assert.deepEqual(matched.jev, { ...jev, expectedBand: 'auto', match: true, at: '2026-11-24T09:10:02.000Z' });
        assert.equal(matched.checks.some((check: any) => check.checkId === 'JEV_BAND_MISMATCH'), false);
        assert.equal(matched.verdict.gaps.some((gap: any) => gap.code === 'JEV_BAND_MISMATCH'), false);

        // A contradicted band is recorded as a check; the verdict is left exactly as adjudicated.
        await seed('trace-p8-mismatch', 'prompt.submitted', { userQuery: 'mismatch' }, '2026-11-24T09:20:00.000Z');
        await seed('trace-p8-mismatch', 'decision.recorded', {
            winner: 'plan', verdict: 'allow', basis: 'core.slp',
            jev: { mode: 'active', consent: true, confidence: 0.9, band: 'confirm', decision: 'confirm' },
        }, '2026-11-24T09:20:01.000Z');
        const mismatched = await detail('trace-p8-mismatch');
        assert.equal(mismatched.jev.mode, 'active');
        assert.equal(mismatched.jev.confidence, 0.9);
        assert.equal(mismatched.jev.band, 'confirm');
        assert.equal(mismatched.jev.expectedBand, 'auto');
        assert.equal(mismatched.jev.match, false);
        const check = mismatched.checks.find((item: any) => item.checkId === 'JEV_BAND_MISMATCH');
        assert.ok(check, 'JEV_BAND_MISMATCH check is present');
        assert.equal(check.status, 'warn');
        assert.match(String(check.detail), /confirm/);
        assert.match(String(check.detail), /auto/);
        // The mismatch does not overwrite (or add to) the adjudicated verdict.
        assert.equal(mismatched.verdict.level, 'partial');
        assert.deepEqual(mismatched.verdict.gaps.map((gap: any) => gap.code).sort(), [
            'ACTION_MISSING', 'ACTOR_MISSING', 'EVIDENCE_MISSING',
        ]);
        assert.equal(mismatched.effectiveness.receiptSealed, true);
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
