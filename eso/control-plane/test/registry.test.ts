/**
 * L3.2 — registry list/detail.
 * RED names are pinned by sdlc/10.test/94..97.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

const actor: Actor = { kind: 'operator', label: 'operator@test' };

function tempRoot(): string {
    return mkdtempSync(join(tmpdir(), 'eso-l32-'));
}

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) throw new Error('ESO_TEST_DB_URL is required for the L3.2 qc scenario');
    return url;
}

async function cleanup(sql: any, id: string): Promise<void> {
    await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
    await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}" CASCADE`);
}

async function fixture(): Promise<{
    store: MemoryPlatformStore;
    query: RegistryQueryService;
    dirs: string[];
}> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const registration = new RegistrationService(registry, store);
    const dirs = [tempRoot(), tempRoot(), tempRoot()];

    await registration.register({
        id: 'list-ready',
        name: 'Ready',
        root: dirs[0],
        profile: { recipe: 'pro', nested: { name: 'keep', ['pass' + 'word']: 'remove-me' } },
        actor,
    });
    await registration.register({
        id: 'list-retired',
        name: 'Retired',
        root: dirs[1],
        profile: { recipe: 'lite', apiToken: 'remove-me' },
        actor,
    });
    await registration.register({
        id: 'list-deleted',
        name: 'Deleted',
        root: dirs[2],
        profile: { recipe: 'pro', dsn: 'postgres://remove-me' },
        actor,
    });
    await store.setStatus('list-retired', 'retired', new Date().toISOString());
    await store.setStatus('list-deleted', 'deleted', new Date().toISOString());

    return { store, query: new RegistryQueryService(store), dirs };
}

async function dispose(dirs: string[]): Promise<void> {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

describe('L3.2 — registry list/detail', () => {
    test('SCN-04-1 · AC-04-1 — Registry list/detail · tdd-unit', async () => {
        const { query, dirs } = await fixture();
        try {
            const list = await query.list();
            const ids = list.map((row) => row.id).sort();
            assert.deepEqual(ids, ['list-ready', 'list-retired']);
            for (const row of list) {
                assert.equal(row.status === 'ready' || row.status === 'retired', true);
                assert.equal(row.version, 1);
                assert.ok(row.schemaName.startsWith('c_'));
            }
        } finally {
            await dispose(dirs);
        }
    });

    test('SCN-04-1 · AC-04-1 — Registry list/detail · tdd-impl', async () => {
        const { query, dirs } = await fixture();
        try {
            const all = await query.list({ includeDeleted: true });
            assert.deepEqual(all.map((row) => row.id).sort(), ['list-deleted', 'list-ready', 'list-retired']);

            const deleted = await query.list({ status: 'deleted', includeDeleted: true });
            assert.equal(deleted.length, 1);
            assert.equal(deleted[0].id, 'list-deleted');

            const detail = await query.get('list-ready');
            assert.equal(detail.id, 'list-ready');
            assert.equal(detail.name, 'Ready');
            assert.equal(detail.status, 'ready');
            assert.equal(detail.version, 1);
            assert.ok(detail.materializedHash?.match(/^[a-f0-9]{64}$/));
            assert.ok(detail.schemaName);
            assert.ok(detail.createdAt);
            assert.ok(detail.updatedAt);
        } finally {
            await dispose(dirs);
        }
    });

    test('SCN-04-1 · AC-04-1 — Registry list/detail · tdd-coverage', async () => {
        const { query, dirs } = await fixture();
        try {
            await assert.rejects(
                query.get('missing-consumer'),
                (error: any) => error.code === 'CONSUMER_NOT_FOUND'
            );
            // F-03 §3: retired/deleted detail is the same 404 as missing.
            await assert.rejects(query.get('list-retired'), (e: any) => e.code === 'CONSUMER_NOT_FOUND');
            await assert.rejects(query.get('list-deleted'), (e: any) => e.code === 'CONSUMER_NOT_FOUND');

            const detail = await query.get('list-ready');
            assert.ok(detail.profile);
            const serialized = JSON.stringify(detail);
            assert.doesNotMatch(serialized, /remove-me|password|apiToken|dsn|postgres:\/\//i);
            assert.match(serialized, /"name":"keep"/);
        } finally {
            await dispose(dirs);
        }
    });

    test('SCN-04-1 · AC-04-1 — Registry list/detail · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const registry = new RegistryService(store);
        const registration = new RegistrationService(registry, store);
        const query = new RegistryQueryService(store);
        const a = `l32a-${Date.now().toString(36)}`;
        const b = `l32b-${Date.now().toString(36)}`;
        const dirs = [tempRoot(), tempRoot()];

        try {
            await registry.initialize();
            await registration.register({ id: a, name: 'A', root: dirs[0], profile: { recipe: 'pro' }, actor });
            await registration.register({ id: b, name: 'B', root: dirs[1], profile: { recipe: 'lite' }, actor });
            await store.setStatus(b, 'retired', new Date().toISOString());

            const list = await query.list();
            assert.deepEqual(list.map((row) => row.id).sort(), [a, b].sort());
            const detail = await query.get(a);
            assert.equal(detail.id, a);
            assert.equal(detail.status, 'ready');
            await assert.rejects(query.get(b), (e: any) => e.code === 'CONSUMER_NOT_FOUND');
        } finally {
            await cleanup(sql, a);
            await cleanup(sql, b);
            await sql.close();
            await dispose(dirs);
        }
    });
});
