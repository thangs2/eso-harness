/**
 * L4.2 — retire / soft delete / restore.
 * RED names are pinned by sdlc/10.test/102..105.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    BunSqlPlatformStore,
    MemoryPlatformStore,
    RegistryService,
    type Actor,
} from '../src/platform/registry/index.js';
import { RegistrationService } from '../src/modules/consumers/registration/registration.service.js';
import { RegistryQueryService } from '../src/modules/consumers/query/registry-query.service.js';
import { LifecycleService } from '../src/modules/consumers/lifecycle/lifecycle.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };

function tempRoot(): string {
    return mkdtempSync(join(tmpdir(), 'eso-l42-'));
}

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) throw new Error('ESO_TEST_DB_URL is required for the L4.2 qc scenario');
    return url;
}

async function cleanup(sql: any, id: string): Promise<void> {
    await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
    await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}" CASCADE`);
}

async function fixture(): Promise<{
    store: MemoryPlatformStore;
    lifecycle: LifecycleService;
    query: RegistryQueryService;
    dir: string;
}> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const dir = tempRoot();
    await new RegistrationService(registry, store).register({
        id: 'life-acme',
        name: 'Life Acme',
        root: dir,
        profile: { recipe: 'pro' },
        actor,
    });
    return { store, lifecycle: new LifecycleService(store), query: new RegistryQueryService(store), dir };
}

describe('L4.2 — retire / soft delete / restore', () => {
    test('SCN-07-1 · AC-07-1 — Retire/soft delete/restore · tdd-unit', async () => {
        const { store, lifecycle, dir } = await fixture();
        try {
            const retired = await lifecycle.transition('life-acme', 'retire', actor);
            assert.equal(retired.status, 'retired');
            assert.equal(await store.schemaExists('life-acme'), true);
            assert.equal(existsSync(join(dir, '.harness', 'config.json')), true);

            const events = await store.listEvents('life-acme');
            assert.deepEqual(events.map((e) => e.eventType).sort(), ['created', 'retired']);
            assert.equal(await lifecycle.canReadData('life-acme'), false);
            await assert.rejects(
                lifecycle.assertDataRoute('life-acme'),
                (error: any) => error.code === 'CONSUMER_NOT_FOUND'
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-07-1 · AC-07-1 — Retire/soft delete/restore · tdd-impl', async () => {
        const { store, lifecycle, query, dir } = await fixture();
        try {
            await lifecycle.transition('life-acme', 'retire', actor);
            const reactivated = await lifecycle.transition('life-acme', 'reactivate', actor);
            assert.equal(reactivated.status, 'ready');
            assert.equal(await lifecycle.canReadData('life-acme'), true);

            const deleted = await lifecycle.transition('life-acme', 'delete', actor);
            assert.equal(deleted.status, 'deleted');
            assert.equal(await store.schemaExists('life-acme'), true);
            assert.equal(existsSync(join(dir, '.harness', 'config.json')), true);
            assert.equal((await query.list()).some((row) => row.id === 'life-acme'), false);
            assert.equal((await query.list({ includeDeleted: true })).some((row) => row.id === 'life-acme'), true);

            const restored = await lifecycle.transition('life-acme', 'restore', actor);
            assert.equal(restored.status, 'ready');
            assert.equal(await lifecycle.canReadData('life-acme'), true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-07-1 · AC-07-1 — Retire/soft delete/restore · tdd-coverage', async () => {
        const { store, lifecycle, dir } = await fixture();
        try {
            const before = await store.getConsumer('life-acme');
            const invalid: Array<[string, any]> = [
                ['reactivate', 'ready'],
                ['restore', 'ready'],
            ];
            for (const [action] of invalid) {
                await assert.rejects(
                    lifecycle.transition('life-acme', action as any, actor),
                    (error: any) => error.code === 'INVALID_STATE'
                );
            }
            assert.equal((await store.getConsumer('life-acme'))?.status, before?.status);
            assert.equal((await store.listEvents('life-acme')).length, 1);

            await lifecycle.transition('life-acme', 'retire', actor);
            await assert.rejects(
                lifecycle.transition('life-acme', 'retire', actor),
                (error: any) => error.code === 'INVALID_STATE'
            );
            await lifecycle.transition('life-acme', 'delete', actor);
            await assert.rejects(
                lifecycle.transition('life-acme', 'delete', actor),
                (error: any) => error.code === 'INVALID_STATE'
            );
            await assert.rejects(
                lifecycle.transition('missing-consumer', 'retire', actor),
                (error: any) => error.code === 'CONSUMER_NOT_FOUND'
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-07-1 · AC-07-1 — Retire/soft delete/restore · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const registry = new RegistryService(store);
        const registration = new RegistrationService(registry, store);
        const lifecycle = new LifecycleService(store);
        const id = `l42-${Date.now().toString(36)}`;
        const dir = tempRoot();

        try {
            await registry.initialize();
            await registration.register({ id, name: 'L4.2 QC', root: dir, profile: { recipe: 'pro' }, actor });

            const retired = await lifecycle.transition(id, 'retire', actor);
            assert.equal(retired.status, 'retired');
            assert.equal(await lifecycle.canReadData(id), false);

            const reactivated = await lifecycle.transition(id, 'reactivate', actor);
            assert.equal(reactivated.status, 'ready');

            const deleted = await lifecycle.transition(id, 'delete', actor);
            assert.equal(deleted.status, 'deleted');
            assert.equal(await store.schemaExists(id), true);

            const restored = await lifecycle.transition(id, 'restore', actor);
            assert.equal(restored.status, 'ready');
            assert.equal(await lifecycle.canReadData(id), true);

            const events = await store.listEvents(id);
            assert.deepEqual(
                events.map((e) => e.eventType).sort(),
                ['created', 'deleted', 'reactivated', 'restored', 'retired']
            );

            const rows = await sql.unsafe('SELECT status FROM platform.consumer WHERE id = $1', [id]);
            assert.equal(rows[0].status, 'ready');
        } finally {
            await cleanup(sql, id);
            await sql.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
