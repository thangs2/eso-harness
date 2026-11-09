/**
 * L1.3 — event read API.
 * RED names are pinned by sdlc/10.test/78..81.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BunSqlPlatformStore,
    MemoryPlatformStore,
    RegistryService,
    type Actor,
} from '../src/platform/registry/index.js';
import {
    EVENT_LIST_PATH,
    EVENT_READ_API,
    EventReader,
    resolveEventRoute,
} from '../src/platform/events/read/event-reader.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };
const root = '/tmp/eso-l13';

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) throw new Error('ESO_TEST_DB_URL is required for the L1.3 qc scenario');
    return url;
}

async function cleanup(sql: any, id: string): Promise<void> {
    await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
    await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}" CASCADE`);
}

describe('L1.3 — event read API', () => {
    test('SCN-14-1 · AC-14-1 — Event read API (append-only) · tdd-unit', async () => {
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        await registry.createConsumer({ id: 'read-unit', name: 'Read unit', root, actor });

        const reader = new EventReader(store);
        const events = await reader.list('read-unit');

        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'created');
        assert.equal(events[0].actorKind, 'operator');
        assert.equal(events[0].actorLabel, 'operator@test');
        assert.ok(events[0].at);
        assert.equal(events[0].consumerId, 'read-unit');

        // No credential is exposed by the read model.
        assert.doesNotMatch(JSON.stringify(events), /password|token|authorization/i);
    });

    test('SCN-14-1 · AC-14-1 — Event read API (append-only) · tdd-impl', async () => {
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        await registry.createConsumer({ id: 'read-impl', name: 'Read impl', root, actor });
        await store.appendEvent({
            consumerId: 'read-impl',
            eventType: 'updated',
            actorKind: 'machine',
            actorLabel: 'cli',
            at: '2026-11-10T03:00:00.000Z',
            detail: { version: 2 },
        });

        const reader = new EventReader(store);
        const first = await reader.timeline('read-impl');
        const second = await reader.list('read-impl', 1);

        assert.equal(first.events.length, 2);
        assert.equal(second.length, 1);
        assert.equal(second[0].eventType, 'updated');

        // Reading twice must not modify the stored events.
        assert.deepEqual(await reader.list('read-impl'), first.events);
    });

    test('SCN-14-1 · AC-14-1 — Event read API (append-only) · tdd-coverage', async () => {
        const readerApi = [...EVENT_READ_API];
        assert.deepEqual(readerApi, ['list', 'timeline']);
        for (const forbidden of ['append', 'update', 'delete', 'remove', 'purge']) {
            assert.equal(readerApi.includes(forbidden as any), false, `read API must not expose ${forbidden}`);
        }

        // AC-14-3: DELETE /events/... is not a registered route; GET is.
        const get = resolveEventRoute('GET', '/api/v1/consumers/acme/events');
        assert.equal(get.kind, 'list');
        assert.equal(get.consumerId, 'acme');
        assert.equal(EVENT_LIST_PATH, '/api/v1/consumers/:id/events');

        for (const method of ['DELETE', 'PUT', 'PATCH', 'POST']) {
            const match = resolveEventRoute(method, '/api/v1/consumers/acme/events');
            assert.equal(match.kind, 'not_found');
            assert.equal(match.status, 404);
        }

        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        await registry.createConsumer({ id: 'read-guard', name: 'Read guard', root, actor });
        const reader = new EventReader(store);
        assert.equal((await reader.list('read-guard')).length, 1);

        // Unknown and purged consumers are one 404, never a data leak.
        await assert.rejects(reader.list('missing-consumer'), (e: any) => e.code === 'CONSUMER_NOT_FOUND');
        await store.setStatus('read-guard', 'purged', new Date().toISOString());
        await assert.rejects(reader.list('read-guard'), (e: any) => e.code === 'CONSUMER_NOT_FOUND');
    });

    test('SCN-14-1 · AC-14-1 — Event read API (append-only) · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const registry = new RegistryService(store);
        const reader = new EventReader(store);
        const id = `l13-${Date.now().toString(36)}`;

        try {
            await registry.initialize();
            await registry.createConsumer({ id, name: 'L1.3 QC', root, actor });

            const events = await reader.list(id);
            assert.equal(events.length, 1);
            assert.equal(events[0].eventType, 'created');
            assert.ok(events[0].id && events[0].id > 0);

            const before = JSON.stringify(events);
            const again = await reader.list(id);
            assert.equal(JSON.stringify(again), before, 'read must not mutate the event');

            // No write route is exposed for the timeline.
            assert.equal(resolveEventRoute('DELETE', `/api/v1/consumers/${id}/events`).kind, 'not_found');

            const rows = await sql.unsafe(
                `SELECT count(*)::int AS n FROM platform.consumer_event WHERE consumer_id = $1`,
                [id]
            );
            assert.equal(rows[0].n, 1);
        } finally {
            await cleanup(sql, id);
            await sql.close();
        }
    });
});
