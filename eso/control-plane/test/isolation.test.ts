/**
 * L6.1 — search_path isolation.
 * RED names are pinned by sdlc/10.test/114..117.
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
    BunScopedDb,
    IsolationService,
    assertConsumerSlug,
} from '../src/common/db/isolation.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };
const root = '/tmp/eso-l61';

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) throw new Error('ESO_TEST_DB_URL is required for the L6.1 qc scenario');
    return url;
}

async function cleanup(sql: any, id: string): Promise<void> {
    await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
    await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}" CASCADE`);
}

async function fixture(): Promise<{
    store: MemoryPlatformStore;
    isolation: IsolationService;
}> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    for (const id of ['iso-a', 'iso-b']) {
        await registry.createConsumer({ id, name: id, root, actor });
    }
    return { store, isolation: new IsolationService(store) };
}

describe('L6.1 — isolation middleware', () => {
    test('SCN-12-1 · AC-12-1 — Isolation middleware + 6 tests · tdd-unit', async () => {
        const { store, isolation } = await fixture();
        const pathA = await isolation.run('iso-a', async (session) => session.searchPath);
        assert.equal(pathA, 'c_iso-a');
        assert.equal(store.getSearchPath(), null);

        const pathB = await isolation.run('iso-b', async (session) => session.searchPath);
        assert.equal(pathB, 'c_iso-b');
        assert.equal(store.getSearchPath(), null);
        assert.notEqual(pathA, pathB);
    });

    test('SCN-12-1 · AC-12-1 — Isolation middleware + 6 tests · tdd-impl', async () => {
        const { isolation } = await fixture();
        const rows: Record<string, string> = { 'c_iso-a': 'A-data', 'c_iso-b': 'B-data' };

        // Same store/pool, sequential requests: each closure sees only its own schema.
        const a = await isolation.run('iso-a', async (session) => rows[session.searchPath]);
        const b = await isolation.run('iso-b', async (session) => rows[session.searchPath]);
        assert.equal(a, 'A-data');
        assert.equal(b, 'B-data');
        assert.notEqual(a, b);

        assert.equal(await isolation.canRead('iso-a'), true);
        assert.equal(await isolation.canRead('iso-b'), true);
    });

    test('SCN-12-1 · AC-12-1 — Isolation middleware + 6 tests · tdd-coverage', async () => {
        const { store, isolation } = await fixture();
        let calls = 0;
        const original = store.getConsumer.bind(store);
        store.getConsumer = async (id: string) => {
            calls += 1;
            return original(id);
        };

        for (const bad of ['../b', '%2e%2e%2fb', 'foo/bar', 'c_b', 'UPPER', 'a']) {
            await assert.rejects(
                isolation.resolve(bad),
                (error: any) => error.code === 'INVALID_CONSUMER_ID',
                `${bad} must be rejected before the registry`
            );
        }
        assert.equal(calls, 0, 'slug validation must run before any DB lookup');
        assert.throws(() => assertConsumerSlug('iso/a'), (e: any) => e.code === 'INVALID_CONSUMER_ID');

        // Fail-closed for every non-ready state.
        for (const [id, status] of [['iso-a', 'retired'], ['iso-b', 'deleted']] as const) {
            const other = new MemoryPlatformStore();
            const registry = new RegistryService(other);
            await registry.initialize();
            await registry.createConsumer({ id, name: id, root, actor });
            await other.setStatus(id, status, new Date().toISOString());
            const scoped = new IsolationService(other);
            await assert.rejects(scoped.resolve(id), (error: any) => error.code === 'CONSUMER_NOT_FOUND');
            assert.equal(await scoped.canRead(id), false);
        }
    });

    test('SCN-12-1 · AC-12-1 — Isolation middleware + 6 tests · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const registry = new RegistryService(store);
        const isolation = new IsolationService(store, new BunScopedDb(sql));
        const a = `l61a-${Date.now().toString(36)}`;
        const b = `l61b-${Date.now().toString(36)}`;

        try {
            await registry.initialize();
            await registry.createConsumer({ id: a, name: 'A', root, actor });
            await registry.createConsumer({ id: b, name: 'B', root, actor });

            await sql.unsafe(`CREATE TABLE "c_${a}".item (value text)`);
            await sql.unsafe(`CREATE TABLE "c_${b}".item (value text)`);
            await sql.unsafe(`INSERT INTO "c_${a}".item VALUES ('A-data')`);
            await sql.unsafe(`INSERT INTO "c_${b}".item VALUES ('B-data')`);

            const readA = await isolation.run(a, async (session) => session.query!('SELECT value FROM item'));
            const readB = await isolation.run(b, async (session) => session.query!('SELECT value FROM item'));
            assert.equal(readA[0].value, 'A-data');
            assert.equal(readB[0].value, 'B-data');

            // A third request for A still sees A after B used the same pool.
            const readAAgain = await isolation.run(a, async (session) => session.query!('SELECT value FROM item'));
            assert.equal(readAAgain[0].value, 'A-data');

            await assert.rejects(isolation.resolve('../b'), (e: any) => e.code === 'INVALID_CONSUMER_ID');
        } finally {
            await cleanup(sql, a);
            await cleanup(sql, b);
            await sql.close();
        }
    });
});
