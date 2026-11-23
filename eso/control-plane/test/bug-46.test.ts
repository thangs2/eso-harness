/**
 * BUG-46 — one durable evidence path.
 *
 * Both host evidence write paths (`POST /consumers/:id/ingest/events` and
 * `POST /consumers/:id/evidence`) must persist through `PlatformStore`, so a restart loses nothing
 * and there is a single source of truth. These tests pin the BUG-46 fix and keep AC-36 / AC-19
 * intact: 202 + idempotent by `event_id`, UNKNOWN_SCHEMA 400, PAYLOAD_TOO_LARGE 413, and the
 * append-only evidence surface (201, duplicate 409, PUT/DELETE 405, unknown 404).
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { MemoryPlatformStore, type PlatformStore } from '../src/platform/registry/store.js';
import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { EvidenceIngestService } from '../src/modules/ingest/ingest.service.js';
import { StoreEvidenceLedger } from '../src/modules/ingest/store-evidence-ledger.js';
import { EvidenceLedgerService } from '../src/modules/evidence-ledger/evidence-ledger.service.js';

const CONSUMER = 'c-bug46';
const servers: any[] = [];

afterEach(async () => {
    for (const app of servers.splice(0)) await app.close();
});

async function fixture(store: PlatformStore = new MemoryPlatformStore()) {
    const app = await createPlatformServer({
        store,
        auth: new AuthService({ user: 'operator', password: 'secret', token: 'token' }),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app);
    const address = app.server.address() as any;
    const base = `http://127.0.0.1:${address.port}`;
    const auth = `Basic ${Buffer.from('operator:secret').toString('base64')}`;
    const call = (path: string, init: any = {}) =>
        fetch(`${base}${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json', ...(init.headers || {}) } });
    return { store, call };
}

function envelope(eventId: string, overrides: Record<string, unknown> = {}) {
    return {
        schema: 'eso.event.v1',
        event_id: eventId,
        occurred_at: new Date(Date.now() - 60_000).toISOString(),
        kind: 'turn',
        payload: { text: 'hello' },
        provenance: { source: 'hook' },
        redaction: { applied: true },
        ...overrides,
    };
}

const postIngest = (call: any, event: Record<string, unknown>) =>
    call(`/api/v1/consumers/${CONSUMER}/ingest/events`, { method: 'POST', body: JSON.stringify({ events: [event] }) });

const postEvidence = (call: any, body: Record<string, unknown>) =>
    call(`/api/v1/consumers/${CONSUMER}/evidence`, { method: 'POST', body: JSON.stringify(body) });

describe('BUG-46 — durable, single-source host evidence', () => {
    test('ingest is idempotent by event_id and survives a new service instance on the same store', async () => {
        const { store, call } = await fixture();
        const event = envelope(randomUUID());

        const first = await postIngest(call, event);
        assert.equal(first.status, 202);
        const accepted = await first.json() as any;
        assert.equal(accepted.accepted, 1);
        assert.equal(accepted.duplicate, 0);

        const again = await postIngest(call, event);
        assert.equal(again.status, 202);
        const duplicate = await again.json() as any;
        assert.equal(duplicate.accepted, 0);
        assert.equal(duplicate.duplicate, 1);
        assert.equal(duplicate.events[0].received_at, accepted.events[0].received_at, 'original received_at is kept');

        // A restart creates new services over the same store — the record is still there.
        const restarted = new EvidenceIngestService(new StoreEvidenceLedger(store));
        const records = await restarted.records(CONSUMER);
        assert.equal(records.length, 1);
        assert.equal(records[0].eventId, event.event_id);
        assert.equal(records[0].receivedAt, accepted.events[0].received_at);

        const rows = await store.listEvidence(CONSUMER, { origin: 'ingest' });
        assert.equal(rows.length, 1, 'a duplicate appends nothing');
        assert.equal(rows[0].origin, 'ingest');
    });

    test('/evidence persists the append-only record and reads it back from a fresh instance', async () => {
        const { store, call } = await fixture();
        const hash = 'a'.repeat(64);
        const created = await postEvidence(call, { id: 'ev-1', kind: 'turn', contentHash: hash, sourceHash: hash });
        assert.equal(created.status, 201);
        assert.equal((await created.json()).id, 'ev-1');

        const fetched = await call(`/api/v1/consumers/${CONSUMER}/evidence/ev-1`);
        assert.equal(fetched.status, 200);
        assert.equal((await fetched.json()).contentHash, hash);

        // append-only still holds: same id is a conflict, not an overwrite.
        const duplicate = await postEvidence(call, { id: 'ev-1', kind: 'turn', contentHash: hash, sourceHash: hash });
        assert.equal(duplicate.status, 409);

        // Restart: new server + new service, same store.
        const restartedStore = store;
        const { call: restartedCall } = await fixture(restartedStore);
        const afterRestart = await restartedCall(`/api/v1/consumers/${CONSUMER}/evidence/ev-1`);
        assert.equal(afterRestart.status, 200);
        assert.equal((await afterRestart.json()).id, 'ev-1');

        const ledger = new EvidenceLedgerService(store);
        const rows = await ledger.list(CONSUMER);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, 'ev-1');
    });

    test('both routes write the one evidence table and each keeps its own projection', async () => {
        const { store, call } = await fixture();
        const event = envelope(randomUUID());
        const hash = 'b'.repeat(64);

        assert.equal((await postIngest(call, event)).status, 202);
        assert.equal((await postEvidence(call, { id: 'claim-1', kind: 'turn', contentHash: hash, sourceHash: hash })).status, 201);

        const all = await store.listEvidence(CONSUMER);
        assert.equal(all.length, 2, 'both write paths land in one durable table');
        assert.deepEqual(all.map((row) => row.origin).sort(), ['evidence', 'ingest']);

        // The projections stay separated by origin so neither route changes its AC-36/AC-19 shape.
        const ingest = new EvidenceIngestService(new StoreEvidenceLedger(store));
        assert.deepEqual((await ingest.records(CONSUMER)).map((row) => row.eventId), [event.event_id]);
        const ledger = new EvidenceLedgerService(store);
        assert.deepEqual((await ledger.list(CONSUMER)).map((row) => row.id), ['claim-1']);
    });

    test('AC-19 append-only surface still answers 405/404 and DOC_CONTRACT_VIOLATION', async () => {
        const { store, call } = await fixture();
        const hash = 'c'.repeat(64);
        assert.equal((await postEvidence(call, { id: 'keep', kind: 'turn', contentHash: hash, sourceHash: hash })).status, 201);

        const put = await call(`/api/v1/consumers/${CONSUMER}/evidence/keep`, { method: 'PUT', body: '{}' });
        assert.equal(put.status, 405);
        const del = await call(`/api/v1/consumers/${CONSUMER}/evidence/keep`, { method: 'DELETE', body: '{}' });
        assert.equal(del.status, 405);
        const missing = await call(`/api/v1/consumers/${CONSUMER}/evidence/nope`);
        assert.equal(missing.status, 404);

        const mismatch = await postEvidence(call, { id: 'bad', kind: 'turn', contentHash: hash, sourceHash: 'd'.repeat(64) });
        assert.equal(mismatch.status, 409);
        assert.equal((await mismatch.json()).code, 'DOC_CONTRACT_VIOLATION');
        assert.equal((await store.listEvidence(CONSUMER, { origin: 'evidence' })).length, 1, 'a rejected claim writes nothing');
    });

    test('AC-36 UNKNOWN_SCHEMA 400 and PAYLOAD_TOO_LARGE 413 still reject before writing', async () => {
        const { store, call } = await fixture();
        const event = envelope(randomUUID());

        const badSchema = await call(`/api/v1/consumers/${CONSUMER}/ingest/events`, {
            method: 'POST',
            body: JSON.stringify({ schema: 'nope', events: [event] }),
        });
        assert.equal(badSchema.status, 400);
        assert.equal((await badSchema.json()).code, 'UNKNOWN_SCHEMA');

        const oversized = await call(`/api/v1/consumers/${CONSUMER}/ingest/events`, {
            method: 'POST',
            body: JSON.stringify({ events: Array.from({ length: 501 }, () => event) }),
        });
        assert.equal(oversized.status, 413);
        assert.equal((await oversized.json()).code, 'PAYLOAD_TOO_LARGE');

        assert.equal((await store.listEvidence(CONSUMER)).length, 0, 'a rejected batch writes nothing');
    });

    test('DDL bootstrap declares the durable evidence table idempotently', () => {
        const bootstrap = readFileSync(new URL('../sql/knowledge.bootstrap.sql', import.meta.url), 'utf8');
        assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS knowledge_evidence\s*\(/);
        assert.match(bootstrap, /UNIQUE \(origin, evidence_id\)/);
        assert.match(bootstrap, /CREATE INDEX IF NOT EXISTS knowledge_evidence_origin/);
    });
});
