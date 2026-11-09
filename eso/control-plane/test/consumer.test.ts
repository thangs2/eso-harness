/**
 * L3.1 — register consumer.
 * RED names are pinned by sdlc/10.test/90..93.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    BunSqlPlatformStore,
    MemoryPlatformStore,
    RegistryService,
    type Actor,
} from '../src/platform/registry/index.js';
import {
    GENERATED_MARKER,
    RegistrationService,
} from '../src/modules/consumers/registration/registration.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };

function tempRoot(): string {
    return mkdtempSync(join(tmpdir(), 'eso-l31-'));
}

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) throw new Error('ESO_TEST_DB_URL is required for the L3.1 qc scenario');
    return url;
}

async function cleanup(sql: any, id: string): Promise<void> {
    await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
    await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}" CASCADE`);
}

describe('L3.1 — register consumer', () => {
    test('SCN-02-2 · AC-02-2 — Đăng ký consumer (transaction) · tdd-unit', async () => {
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        const service = new RegistrationService(registry, store);

        const dir = tempRoot();
        try {
            for (const id of ['a', 'has space', 'UPPER', 'a'.repeat(33), '']) {
                await assert.rejects(
                    service.register({ id, name: 'Bad', root: dir, actor }),
                    (error: any) => error.code === 'INVALID_CONSUMER_ID',
                    `id ${JSON.stringify(id)} must be rejected`
                );
            }

            await assert.rejects(
                service.register({ id: 'root-missing', name: 'Missing', root: join(dir, 'nope'), actor }),
                (error: any) => error.code === 'ROOT_NOT_FOUND'
            );

            const file = join(dir, 'a-file');
            writeFileSync(file, 'not a directory');
            await assert.rejects(
                service.register({ id: 'root-file', name: 'File', root: file, actor }),
                (error: any) => error.code === 'ROOT_NOT_FOUND'
            );
            assert.deepEqual(await store.listConsumers({ includeDeleted: true }), []);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-02-2 · AC-02-2 — Đăng ký consumer (transaction) · tdd-impl', async () => {
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        const service = new RegistrationService(registry, store);
        const dir = tempRoot();

        try {
            const record = await service.register({
                id: 'acme-l31',
                name: 'Acme L3.1',
                root: dir,
                sdlcRoot: join(dir, 'sdlc'),
                profile: { recipe: 'pro', hostProfile: 'cursor-superset' },
                zones: [{ name: 'human', path: 'src' }],
                actor,
            });

            assert.equal(record.status, 'ready');
            assert.equal(record.version, 1);
            assert.equal(await store.schemaExists('acme-l31'), true);

            const file = join(dir, '.harness', 'config.json');
            const generated = JSON.parse(readFileSync(file, 'utf8'));
            assert.equal(generated._generated, GENERATED_MARKER);
            assert.equal(generated._schema, 1);
            assert.equal(generated.id, 'acme-l31');
            assert.equal(generated.name, 'Acme L3.1');
            assert.equal(generated.profile.recipe, 'pro');
            assert.match(generated.hash, /^[a-f0-9]{64}$/);
            assert.equal(record.materializedHash, generated.hash);

            const events = await store.listEvents('acme-l31');
            assert.equal(events.length, 1);
            assert.equal(events[0].eventType, 'created');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-02-2 · AC-02-2 — Đăng ký consumer (transaction) · tdd-coverage', async () => {
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        const service = new RegistrationService(registry, store);
        const dir = tempRoot();

        try {
            await service.register({ id: 'acme-dup', name: 'First', root: dir, actor });
            const before = await store.getConsumer('acme-dup');

            // AC-03-2: duplicate is rejected even when the existing record is deleted.
            await store.setStatus('acme-dup', 'deleted', new Date().toISOString());
            await assert.rejects(
                service.register({ id: 'acme-dup', name: 'Second', root: dir, actor }),
                (error: any) => error.code === 'CONSUMER_EXISTS'
            );
            const after = await store.getConsumer('acme-dup');
            assert.equal(after?.name, 'First');
            assert.equal(after?.status, 'deleted');
            assert.equal(after?.version, before?.version);

            // A failed root validation creates neither a row nor a schema.
            await assert.rejects(
                service.register({ id: 'acme-bad-root', name: 'Bad', root: join(dir, 'missing'), actor }),
                (error: any) => error.code === 'ROOT_NOT_FOUND'
            );
            assert.equal(await store.getConsumer('acme-bad-root'), null);
            assert.equal(await store.schemaExists('acme-bad-root'), false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-02-2 · AC-02-2 — Đăng ký consumer (transaction) · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const registry = new RegistryService(store);
        const service = new RegistrationService(registry, store);
        const id = `l31-${Date.now().toString(36)}`;
        const dir = tempRoot();

        try {
            await registry.initialize();
            const record = await service.register({
                id,
                name: 'L3.1 QC',
                root: dir,
                profile: { recipe: 'lite', hostProfile: 'cursor' },
                actor,
            });
            assert.equal(record.status, 'ready');
            assert.equal(record.materializedHash?.length, 64);

            const rows = await sql.unsafe('SELECT id, version FROM platform.consumer WHERE id = $1', [id]);
            assert.equal(rows.length, 1);
            assert.equal(Number(rows[0].version), 1);
            assert.equal(await store.schemaExists(id), true);

            const generated = JSON.parse(readFileSync(join(dir, '.harness', 'config.json'), 'utf8'));
            assert.equal(generated._generated, GENERATED_MARKER);
            assert.equal(generated.id, id);

            await store.setStatus(id, 'deleted', new Date().toISOString());
            await assert.rejects(
                service.register({ id, name: 'Again', root: dir, actor }),
                (error: any) => error.code === 'CONSUMER_EXISTS'
            );
        } finally {
            await cleanup(sql, id);
            await sql.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
