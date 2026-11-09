/**
 * L4.3 — purge.
 * RED names are pinned by sdlc/10.test/106..109.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    BunSqlPlatformStore,
    MemoryPlatformStore,
    RegistryService,
    type Actor,
} from '../src/platform/registry/index.js';
import { RegistrationService } from '../src/modules/consumers/registration/registration.service.js';
import { LifecycleService } from '../src/modules/consumers/lifecycle/lifecycle.service.js';
import { PurgeService } from '../src/modules/consumers/purge/purge.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };

function tempRoot(): string {
    return mkdtempSync(join(tmpdir(), 'eso-l43-'));
}

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) throw new Error('ESO_TEST_DB_URL is required for the L4.3 qc scenario');
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
    purge: PurgeService;
    dir: string;
}> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const dir = tempRoot();
    await new RegistrationService(registry, store).register({
        id: 'purge-acme',
        name: 'Purge Acme',
        root: dir,
        profile: { recipe: 'pro' },
        actor,
    });
    return {
        store,
        lifecycle: new LifecycleService(store),
        purge: new PurgeService(store),
        dir,
    };
}

describe('L4.3 — purge', () => {
    test('SCN-09-1 · AC-09-1 — Purge · tdd-unit', async () => {
        const { store, lifecycle, purge, dir } = await fixture();
        try {
            await lifecycle.transition('purge-acme', 'delete', actor);
            const purged = await purge.purge('purge-acme', 'purge-acme', actor);

            assert.equal(purged.status, 'purged');
            assert.equal(purged.materializedHash, null);
            assert.equal(await store.schemaExists('purge-acme'), false);
            assert.equal(existsSync(join(dir, '.harness', 'config.json')), false);

            const events = await store.listEvents('purge-acme');
            assert.deepEqual(events.map((e) => e.eventType).sort(), ['created', 'deleted', 'purged']);
            assert.equal(events.find((e) => e.eventType === 'purged')?.detail.schemaDropped, true);

            // The record itself stays for audit, not for a data route.
            assert.equal((await store.getConsumer('purge-acme'))?.status, 'purged');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-09-1 · AC-09-1 — Purge · tdd-impl', async () => {
        const { store, lifecycle, purge, dir } = await fixture();
        try {
            // A retired consumer is purgeable.
            await lifecycle.transition('purge-acme', 'retire', actor);
            const purged = await purge.purge('purge-acme', 'purge-acme', actor);
            assert.equal(purged.status, 'purged');

            await assert.rejects(
                purge.purge('missing-consumer', 'missing-consumer', actor),
                (error: any) => error.code === 'CONSUMER_NOT_FOUND'
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-09-1 · AC-09-1 — Purge · tdd-coverage', async () => {
        const { store, lifecycle, purge, dir } = await fixture();
        try {
            // AC-09-2: ready is not purgeable.
            await assert.rejects(
                purge.purge('purge-acme', 'purge-acme', actor),
                (error: any) => error.code === 'INVALID_STATE'
            );
            assert.equal((await store.getConsumer('purge-acme'))?.status, 'ready');
            assert.equal(await store.schemaExists('purge-acme'), true);

            // AC-09-3: deleted + wrong confirmation is a mismatch and changes nothing.
            await lifecycle.transition('purge-acme', 'delete', actor);
            await assert.rejects(
                purge.purge('purge-acme', 'another-id', actor),
                (error: any) => error.code === 'PURGE_CONFIRM_MISMATCH'
            );
            assert.equal((await store.getConsumer('purge-acme'))?.status, 'deleted');
            assert.equal(await store.schemaExists('purge-acme'), true);
            assert.equal(existsSync(join(dir, '.harness', 'config.json')), true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-09-1 · AC-09-1 — Purge · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const registry = new RegistryService(store);
        const registration = new RegistrationService(registry, store);
        const lifecycle = new LifecycleService(store);
        const purge = new PurgeService(store);
        const id = `l43-${Date.now().toString(36)}`;
        const dir = tempRoot();

        try {
            await registry.initialize();
            await registration.register({ id, name: 'L4.3 QC', root: dir, profile: { recipe: 'pro' }, actor });
            await lifecycle.transition(id, 'delete', actor);

            // A hand-edited artifact is not deleted by purge.
            const handWritten = { hello: 'hand-written' };
            writeFileSync(join(dir, '.harness', 'config.json'), JSON.stringify(handWritten));

            const purged = await purge.purge(id, id, actor);
            assert.equal(purged.status, 'purged');
            assert.equal(await store.schemaExists(id), false);
            assert.deepEqual(JSON.parse(readFileSync(join(dir, '.harness', 'config.json'), 'utf8')), handWritten);

            const rows = await sql.unsafe('SELECT status FROM platform.consumer WHERE id = $1', [id]);
            assert.equal(rows[0].status, 'purged');
            const events = await store.listEvents(id);
            assert.deepEqual(events.map((e) => e.eventType).sort(), ['created', 'deleted', 'purged']);
        } finally {
            await cleanup(sql, id);
            await sql.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
