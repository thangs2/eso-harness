/**
 * ESO-615 / Task L5.5 — consumer schema provisioning.
 *
 * Contract:
 * - INV-1: Schema-expanded c_<id> in existing Postgres.
 * - INV-2: Idempotent rerun on existing matching schema.
 * - INV-3: Schema must match consumer.id; mismatch fails closed with SCHEMA_MISMATCH.
 * - INV-4: No host/source/tier/recipe field; no host projection.
 * - INV-5: No material files and no setup-info table.
 *
 * AC-40-1 (schema part only):
 *   Given a consumer in state ready, when provisioning runs, then schema c_<id> exists and is usable.
 * AC-40-3 (schema failure part only):
 *   Given a schema name that does not match the consumer id, when provisioning runs, then it fails
 *   with SCHEMA_MISMATCH and does not create/alter another schema.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    MemoryPlatformStore,
    type PlatformStore,
} from '../src/platform/registry/store.js';
import { RegistryService } from '../src/platform/registry/service.js';
import { SchemaProvisioningService } from '../src/provisioning/schema/index.js';

const actor = { kind: 'operator' as const, label: 'operator@test' };
const root = '/tmp/eso-p1-schema';

describe('P1-ESO-615-L5.5-schema — consumer schema provisioning', () => {
    test('AC-40-1 · SCN-40-1: missing schema => created', async () => {
        const store = new MemoryPlatformStore();
        await store.ensurePlatformSchema();

        const now = new Date().toISOString();
        await store.insertConsumer({
            id: 'acme-615',
            name: 'Acme 615',
            root,
            sdlcRoot: null,
            schemaName: 'c_acme-615',
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        assert.equal(await store.schemaExists('acme-615'), false);

        const service = new SchemaProvisioningService(store);
        const result = await service.provision('acme-615');

        assert.equal(result.consumerId, 'acme-615');
        assert.equal(result.schemaName, 'c_acme-615');
        assert.equal(result.created, true);
        assert.equal(await store.schemaExists('acme-615'), true);
    });

    test('AC-40-1 · INV-2: existing matching schema => idempotent', async () => {
        const store = new MemoryPlatformStore();
        await store.ensurePlatformSchema();

        const now = new Date().toISOString();
        await store.insertConsumer({
            id: 'acme-idem',
            name: 'Acme Idempotent',
            root,
            sdlcRoot: null,
            schemaName: 'c_acme-idem',
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        // Pre-create the schema
        await store.createSchema('acme-idem');
        assert.equal(await store.schemaExists('acme-idem'), true);

        const service = new SchemaProvisioningService(store);
        const result = await service.provision('acme-idem');

        assert.equal(result.consumerId, 'acme-idem');
        assert.equal(result.schemaName, 'c_acme-idem');
        assert.equal(result.created, false);
        assert.equal(await store.schemaExists('acme-idem'), true);
    });

    test('AC-40-3 · SCN-40-3 · INV-3: mismatch => SCHEMA_MISMATCH, no side effect', async () => {
        const store = new MemoryPlatformStore();
        await store.ensurePlatformSchema();

        const now = new Date().toISOString();
        // Consumer with mismatched schema name in record
        await store.insertConsumer({
            id: 'acme-mismatch',
            name: 'Acme Mismatch',
            root,
            sdlcRoot: null,
            schemaName: 'c_different-id',
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        const service = new SchemaProvisioningService(store);

        await assert.rejects(
            service.provision('acme-mismatch'),
            (error: any) => {
                const isMismatchCode = error?.code === 'SCHEMA_MISMATCH';
                const isMismatchMsg = String(error?.message || '').includes('SCHEMA_MISMATCH');
                return isMismatchCode || isMismatchMsg;
            }
        );

        // Ensure no schema was created or altered
        assert.equal(await store.schemaExists('acme-mismatch'), false);
        assert.equal(await store.schemaExists('different-id'), false);
    });

    test('AC-40-3 · SCN-40-3: explicit schemaName override mismatch fails closed with SCHEMA_MISMATCH', async () => {
        const store = new MemoryPlatformStore();
        await store.ensurePlatformSchema();

        const now = new Date().toISOString();
        await store.insertConsumer({
            id: 'acme-override',
            name: 'Acme Override',
            root,
            sdlcRoot: null,
            schemaName: 'c_acme-override',
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        const service = new SchemaProvisioningService(store);

        await assert.rejects(
            service.provision('acme-override', { schemaName: 'c_wrong-schema' }),
            (error: any) => {
                const isMismatchCode = error?.code === 'SCHEMA_MISMATCH';
                const isMismatchMsg = String(error?.message || '').includes('SCHEMA_MISMATCH');
                return isMismatchCode || isMismatchMsg;
            }
        );

        assert.equal(await store.schemaExists('acme-override'), false);
        assert.equal(await store.schemaExists('wrong-schema'), false);
    });

    test('Works with RegistryService instance passed to constructor', async () => {
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();

        const created = await registry.createConsumer({
            id: 'acme-reg',
            name: 'Acme Registry',
            root,
            actor,
        });

        const service = new SchemaProvisioningService(registry);
        const result = await service.provision(created.id);

        assert.equal(result.consumerId, 'acme-reg');
        assert.equal(result.schemaName, 'c_acme-reg');
        assert.equal(result.created, false); // createdConsumer already created it in L1.1
    });
});
