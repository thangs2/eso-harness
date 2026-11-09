/**
 * L4.1 — update profile + version.
 * RED names are pinned by sdlc/10.test/98..101.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    BunSqlPlatformStore,
    MemoryPlatformStore,
    RegistryService,
    type Actor,
} from '../src/platform/registry/index.js';
import { RegistrationService } from '../src/modules/consumers/registration/registration.service.js';
import { UpdateConsumerService } from '../src/modules/consumers/update/update.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };

function tempRoot(): string {
    return mkdtempSync(join(tmpdir(), 'eso-l41-'));
}

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) throw new Error('ESO_TEST_DB_URL is required for the L4.1 qc scenario');
    return url;
}

async function cleanup(sql: any, id: string): Promise<void> {
    await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
    await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}" CASCADE`);
}

async function fixture(): Promise<{
    store: MemoryPlatformStore;
    update: UpdateConsumerService;
    dir: string;
}> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const dir = tempRoot();
    await new RegistrationService(registry, store).register({
        id: 'update-acme',
        name: 'Update Acme',
        root: dir,
        profile: { recipe: 'pro', hostProfile: 'cursor' },
        actor,
    });
    return { store, update: new UpdateConsumerService(store), dir };
}

describe('L4.1 — update profile + version', () => {
    test('SCN-06-1 · AC-06-1 — Update profile + version · tdd-unit', async () => {
        const { store, update, dir } = await fixture();
        try {
            const before = await store.getConsumer('update-acme');
            const result = await update.update('update-acme', {
                expected_version: 1,
                profile: { recipe: 'lite', hostProfile: 'agents' },
                zones: [{ name: 'agent', path: 'src' }],
                actor,
            });

            assert.equal(result.consumer.version, 2);
            assert.equal(result.consumer.status, 'ready');
            assert.notEqual(result.consumer.materializedHash, before?.materializedHash);
            assert.equal(result.consumer.materializedHash?.length, 64);

            const file = JSON.parse(readFileSync(join(dir, '.harness', 'config.json'), 'utf8'));
            assert.equal(file.profile.recipe, 'lite');
            assert.equal(file.zones[0].name, 'agent');
            assert.equal(file.hash, result.consumer.materializedHash);

            const events = await store.listEvents('update-acme');
            assert.deepEqual(events.map((e) => e.eventType).sort(), ['created', 'updated']);
            assert.equal(events.find((e) => e.eventType === 'updated')?.detail.version, 2);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-06-1 · AC-06-1 — Update profile + version · tdd-impl', async () => {
        const { store, update, dir } = await fixture();
        try {
            await update.update('update-acme', { expected_version: 1, profile: { recipe: 'lite' }, actor });
            const atV2 = await store.getConsumer('update-acme');

            await assert.rejects(
                update.update('update-acme', { expected_version: 1, profile: { recipe: 'pro' }, actor }),
                (error: any) => error.code === 'STALE_VERSION'
            );
            const afterStale = await store.getConsumer('update-acme');
            assert.equal(afterStale?.version, 2);
            assert.equal(afterStale?.materializedHash, atV2?.materializedHash);

            await assert.rejects(
                update.update('update-acme', {
                    id: 'another-id',
                    expected_version: 2,
                    profile: { recipe: 'pro' },
                    actor,
                }),
                (error: any) => error.code === 'INVALID_CONSUMER_ID'
            );
            assert.equal((await store.getConsumer('update-acme'))?.version, 2);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-06-1 · AC-06-1 — Update profile + version · tdd-coverage', async () => {
        const { store, update, dir } = await fixture();
        try {
            // Missing expected_version is stale, never a silent write.
            await assert.rejects(
                update.update('update-acme', { expected_version: undefined as any, actor }),
                (error: any) => error.code === 'STALE_VERSION'
            );
            assert.equal((await store.getConsumer('update-acme'))?.version, 1);

            // Two sequential updates produce 2 and 3, and keep the file in sync each time.
            for (const version of [1, 2]) {
                const result = await update.update('update-acme', {
                    expected_version: version,
                    profile: { recipe: version === 1 ? 'lite' : 'pro' },
                    actor,
                });
                assert.equal(result.consumer.version, version + 1);
                const file = JSON.parse(readFileSync(join(dir, '.harness', 'config.json'), 'utf8'));
                assert.equal(file.hash, result.consumer.materializedHash);
                assert.equal(file._schema, 1);
            }

            await assert.rejects(
                update.update('missing-consumer', { expected_version: 1, actor }),
                (error: any) => error.code === 'CONSUMER_NOT_FOUND'
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-06-1 · AC-06-1 — Update profile + version · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const registry = new RegistryService(store);
        const registration = new RegistrationService(registry, store);
        const update = new UpdateConsumerService(store);
        const id = `l41-${Date.now().toString(36)}`;
        const dir = tempRoot();

        try {
            await registry.initialize();
            await registration.register({ id, name: 'L4.1 QC', root: dir, profile: { recipe: 'pro' }, actor });
            const first = await update.update(id, { expected_version: 1, profile: { recipe: 'lite' }, actor });
            assert.equal(first.consumer.version, 2);

            const rows = await sql.unsafe(
                'SELECT version, materialized_hash FROM platform.consumer WHERE id = $1',
                [id]
            );
            assert.equal(Number(rows[0].version), 2);
            assert.equal(rows[0].materialized_hash, first.consumer.materializedHash);

            const events = await store.listEvents(id);
            assert.deepEqual(events.map((e) => e.eventType).sort(), ['created', 'updated']);
            await assert.rejects(
                update.update(id, { expected_version: 1, actor }),
                (error: any) => error.code === 'STALE_VERSION'
            );
        } finally {
            await cleanup(sql, id);
            await sql.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
