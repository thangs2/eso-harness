/**
 * L1.2 — event store write path.
 * RED names are pinned by sdlc/10.test/74..77.
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
    EVENT_TYPES,
    EventWriter,
    type EventType,
} from '../src/platform/events/write/event-writer.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };
const root = '/tmp/eso-l12';

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) throw new Error('ESO_TEST_DB_URL is required for the L1.2 qc scenario');
    return url;
}

async function cleanup(sql: any, id: string): Promise<void> {
    await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
    await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}" CASCADE`);
}

class FailingEventStore extends MemoryPlatformStore {
    failEvents = false;
    override async appendEvent(event: any): Promise<any> {
        if (this.failEvents) throw new Error('injected event failure');
        return super.appendEvent(event);
    }
}

describe('L1.2 — event store write', () => {
    test('SCN-14-2 · AC-14-2 — Ghi event trong transaction khi tạo/đổi trạng thái consumer · tdd-unit', async () => {
        assert.deepEqual(
            [...EVENT_TYPES],
            ['created', 'updated', 'retired', 'reactivated', 'deleted', 'restored', 'purged', 'materialized']
        );

        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        await registry.createConsumer({ id: 'evt-unit', name: 'Event unit', root, actor });

        const writer = new EventWriter(store);
        const event = await writer.append({
            consumerId: 'evt-unit',
            eventType: 'updated',
            actor,
            at: '2026-11-10T01:00:00.000Z',
            detail: { fields: ['name'] },
        });

        assert.equal(event.eventType, 'updated');
        assert.equal(event.actorKind, 'operator');
        assert.equal(event.actorLabel, 'operator@test');
        assert.equal(event.at, '2026-11-10T01:00:00.000Z');
        assert.deepEqual(event.detail, { fields: ['name'] });

        // No credential field can be smuggled into an event.
        assert.doesNotMatch(JSON.stringify(event), /password|token|authorization/i);
    });

    test('SCN-14-2 · AC-14-2 — Ghi event trong transaction khi tạo/đổi trạng thái consumer · tdd-impl', async () => {
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        await registry.createConsumer({ id: 'evt-impl', name: 'Event impl', root, actor });

        const writer = new EventWriter(store);
        const event = await writer.transition('evt-impl', 'retired', 'retired', actor, {
            at: '2026-11-10T02:00:00.000Z',
            detail: { reason: 'operator request' },
        });

        assert.equal(event.eventType, 'retired');
        assert.equal((await store.getConsumer('evt-impl'))?.status, 'retired');

        const events = await writer.list('evt-impl');
        assert.equal(events.length, 2); // created + retired
        assert.deepEqual(events.map((e) => e.eventType).sort(), ['created', 'retired']);
    });

    test('SCN-14-2 · AC-14-2 — Ghi event trong transaction khi tạo/đổi trạng thái consumer · tdd-coverage', async () => {
        const store = new FailingEventStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        await registry.createConsumer({ id: 'evt-rb', name: 'Event rollback', root, actor });

        // Status must not change if the event insert fails in the same transaction.
        store.failEvents = true;
        await assert.rejects(
            new EventWriter(store).transition('evt-rb', 'retired', 'retired', actor),
            /injected event failure/
        );
        assert.equal((await store.getConsumer('evt-rb'))?.status, 'ready');
        assert.equal((await store.listEvents('evt-rb')).length, 1); // created only
        store.failEvents = false;

        // AC-14-2 sequence: created + retired + deleted + purged = 4 events.
        const writer = new EventWriter(store);
        await writer.transition('evt-rb', 'retired', 'retired', actor);
        await writer.transition('evt-rb', 'deleted', 'deleted', actor);
        await writer.transition('evt-rb', 'purged', 'purged', actor);

        const events = await writer.list('evt-rb');
        assert.equal(events.length, 4);
        assert.deepEqual(
            events.map((e) => e.eventType).sort(),
            ['created', 'deleted', 'purged', 'retired']
        );
        assert.equal((await store.getConsumer('evt-rb'))?.status, 'purged');
    });

    test('SCN-14-2 · AC-14-2 — Ghi event trong transaction khi tạo/đổi trạng thái consumer · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const registry = new RegistryService(store);
        const writer = new EventWriter(store);
        const id = `l12-${Date.now().toString(36)}`;

        try {
            await registry.initialize();
            await registry.createConsumer({ id, name: 'L1.2 QC', root, actor });

            const retired = await writer.transition(id, 'retired', 'retired', actor);
            const deleted = await writer.transition(id, 'deleted', 'deleted', actor);
            const purged = await writer.transition(id, 'purged', 'purged', actor);

            for (const event of [retired, deleted, purged]) {
                assert.ok(Number(event.id) > 0);
                assert.equal(event.consumerId, id);
                assert.equal(event.actorKind, 'operator');
            }

            const rows = await sql.unsafe(
                `SELECT event_type, actor_kind FROM platform.consumer_event WHERE consumer_id = $1 ORDER BY id`,
                [id]
            );
            assert.deepEqual(
                rows.map((r: any) => r.event_type),
                ['created', 'retired', 'deleted', 'purged']
            );
            assert.ok(rows.every((r: any) => r.actor_kind === 'operator'));

            const consumer = await store.getConsumer(id);
            assert.equal(consumer?.status, 'purged');
        } finally {
            await cleanup(sql, id);
            await sql.close();
        }
    });
});
