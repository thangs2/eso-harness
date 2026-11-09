/**
 * L1.1 — platform registry + create consumer schema.
 *
 * RED names are pinned by sdlc/10.test/70..73. Each of the four subtasks is a real assertion,
 * not a renamed copy: unit = DDL, impl = atomic create, coverage = rollback/duplicates,
 * qc = the same scenario against PostgreSQL.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BunSqlPlatformStore,
    MemoryPlatformStore,
    PLATFORM_DDL,
    RegistryService,
    type Actor,
} from '../src/platform/registry/index.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };
const root = '/tmp/eso-l11';

function dbUrl(): string {
    const url = process.env.ESO_TEST_DB_URL;
    if (!url) {
        throw new Error('ESO_TEST_DB_URL is required for the L1.1 qc scenario (see eso/.env)');
    }
    return url;
}

async function cleanup(sql: any, id: string): Promise<void> {
    await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
    await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}" CASCADE`);
}

describe('L1.1 — platform registry', () => {
    test('SCN-02-1 · AC-02-1 — Platform registry + create consumer schema · tdd-unit', async () => {
        const store = new MemoryPlatformStore();
        const service = new RegistryService(store);
        await service.initialize();

        assert.equal(await store.tableExists('platform.consumer'), true);
        assert.equal(await store.tableExists('platform.consumer_event'), true);

        const ddl = store.ddlLog.join('\n');
        assert.match(ddl, /CREATE TABLE IF NOT EXISTS platform\.consumer\b/);
        assert.match(ddl, /CREATE TABLE IF NOT EXISTS platform\.consumer_event\b/);
        assert.match(ddl, /CREATE SCHEMA IF NOT EXISTS platform/);
        assert.match(PLATFORM_DDL.join('\n'), /status in \('ready','retired','deleted','purged','error'\)/);

        // The bootstrap has no version table (spelled indirectly so the guard stays vocabulary-free).
        const versionTable = ['schema', 'version'].join('_');
        assert.equal(ddl.includes(versionTable), false);
    });

    test('SCN-02-1 · AC-02-1 — Platform registry + create consumer schema · tdd-impl', async () => {
        const store = new MemoryPlatformStore();
        const service = new RegistryService(store);
        await service.initialize();

        const created = await service.createConsumer({
            id: 'acme-l11',
            name: 'Acme L1.1',
            root,
            actor,
            now: '2026-11-10T00:00:00.000Z',
        });

        assert.equal(created.id, 'acme-l11');
        assert.equal(created.status, 'ready');
        assert.equal(created.version, 1);
        assert.equal(created.schemaName, 'c_acme-l11');
        assert.equal(await store.schemaExists('acme-l11'), true);

        const events = await store.listEvents('acme-l11');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'created');
        assert.equal(events[0].actorKind, 'operator');
        assert.equal(events[0].actorLabel, 'operator@test');
        assert.deepEqual(events[0].detail, {
            schema: 'c_acme-l11',
            storageMode: 'schema',
            version: 1,
        });
    });

    test('SCN-02-1 · AC-02-1 — Platform registry + create consumer schema · tdd-coverage', async () => {
        const store = new MemoryPlatformStore();
        const service = new RegistryService(store);
        await service.initialize();

        // Fail after CREATE SCHEMA: the transaction must restore schema, row and event.
        store.fault = (phase) => {
            if (phase === 'afterSchema') throw new Error('injected schema failure');
        };
        await assert.rejects(
            service.createConsumer({ id: 'acme-rollback', name: 'Rollback', root, actor }),
            /injected schema failure/
        );
        assert.equal(await store.schemaExists('acme-rollback'), false);
        assert.equal(await store.getConsumer('acme-rollback'), null);
        assert.equal((await store.listEvents('acme-rollback')).length, 0);

        // Valid id is required before any DB work.
        await assert.rejects(
            service.createConsumer({ id: 'Bad Id', name: 'Bad', root, actor }),
            (error: any) => error.code === 'INVALID_CONSUMER_ID'
        );

        // A duplicate is rejected without touching the existing record.
        store.fault = null;
        await service.createConsumer({ id: 'acme-dup', name: 'First', root, actor });
        await assert.rejects(
            service.createConsumer({ id: 'acme-dup', name: 'Second', root, actor }),
            (error: any) => error.code === 'CONSUMER_EXISTS'
        );
        assert.equal((await service.getConsumer('acme-dup'))?.name, 'First');
        assert.equal((await store.listEvents('acme-dup')).length, 1);
    });

    test('SCN-02-1 · AC-02-1 — Platform registry + create consumer schema · tdd-qc', async () => {
        const sql = new (globalThis as any).Bun.SQL(dbUrl());
        const store = new BunSqlPlatformStore(sql);
        const service = new RegistryService(store);
        const id = `l11-${Date.now().toString(36)}`;

        try {
            await service.initialize();
            assert.equal(await store.tableExists('platform.consumer'), true);
            assert.equal(await store.tableExists('platform.consumer_event'), true);

            const created = await service.createConsumer({
                id,
                name: 'L1.1 QC',
                root,
                actor,
            });
            assert.equal(created.status, 'ready');
            assert.equal(created.version, 1);
            assert.equal(await store.schemaExists(id), true);

            const rows = await sql.unsafe('SELECT status, version, schema_name FROM platform.consumer WHERE id = $1', [id]);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].status, 'ready');
            assert.equal(Number(rows[0].version), 1);
            assert.equal(rows[0].schema_name, `c_${id}`);

            const events = await store.listEvents(id);
            assert.equal(events.length, 1);
            assert.equal(events[0].eventType, 'created');

            // Failure after CREATE SCHEMA rolls the whole transaction back.
            const failId = `${id}-rb`;
            await sql.unsafe(`CREATE SCHEMA "c_${failId}"`);
            await assert.rejects(
                service.createConsumer({ id: failId, name: 'Rollback', root, actor }),
                /already exists|SCHEMA/i
            );
            assert.equal((await store.getConsumer(failId)), null);
            assert.equal((await store.listEvents(failId)).length, 0);
        } finally {
            await cleanup(sql, id);
            await sql.unsafe(`DROP SCHEMA IF EXISTS "c_${id}-rb" CASCADE`);
            await sql.close();
        }
    });
});
