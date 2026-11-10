import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    MemoryPlatformStore,
    RegistryService,
    type Actor,
} from '../src/platform/registry/index.js';
import {
    GENERATED_MARKER,
    MaterialProvisioningService,
} from '../src/provisioning/material/index.js';
import { SchemaProvisioningService } from '../src/provisioning/schema/index.js';
import { ProvisioningStateService } from '../src/provisioning/state/index.js';

const actor: Actor = { kind: 'operator', label: 'test@operator' };

function tempRoot(): string {
    return mkdtempSync(join(tmpdir(), 'eso-state-test-'));
}

function dispose(dirs: string[]): void {
    for (const dir of dirs) {
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {}
    }
}

describe('P1-ESO-625-L5.7 — Provisioning State Service', () => {
    test('AC-40-1: Provisioned consumer readSetup returns ready=true', async () => {
        const root = tempRoot();
        const dirs = [root];
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();

            const consumer = await registry.createConsumer({
                id: 'c-state-prov',
                name: 'State Prov Consumer',
                root,
                actor,
            });

            // Provision material and schema
            const materialService = new MaterialProvisioningService(store);
            await materialService.provision(consumer.id);

            const schemaService = new SchemaProvisioningService(store);
            await schemaService.provision(consumer.id);

            const stateService = new ProvisioningStateService(store);
            const persisted = await stateService.persistSetup(consumer.id);
            assert.equal(persisted.setup.ready, true);
            assert.equal(persisted.schema.exists, true);
            assert.equal(persisted.material.materialized, true);
            assert.equal(persisted.material.agents, true);
            assert.equal(persisted.material.config, true);
            assert.equal(persisted.material.manifest, true);
            assert.ok(persisted.material.hash);

            const readBack = await stateService.readSetup(consumer.id);
            assert.deepEqual(readBack, persisted);
        } finally {
            dispose(dirs);
        }
    });

    test('AC-40-2: Idempotency of readSetup and persistSetup', async () => {
        const root = tempRoot();
        const dirs = [root];
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();

            const consumer = await registry.createConsumer({
                id: 'c-state-idemp',
                name: 'State Idempotent Consumer',
                root,
                actor,
            });

            const materialService = new MaterialProvisioningService(store);
            await materialService.provision(consumer.id);
            const schemaService = new SchemaProvisioningService(store);
            await schemaService.provision(consumer.id);

            const stateService = new ProvisioningStateService(store);
            const first = await stateService.persistSetup(consumer.id);
            const second = await stateService.persistSetup(consumer.id);
            assert.equal(first.consumerId, second.consumerId);
            assert.equal(first.schema.exists, second.schema.exists);
            assert.equal(first.material.hash, second.material.hash);
            assert.equal(first.material.materialized, second.material.materialized);
            assert.equal(first.setup.ready, second.setup.ready);

            const read1 = await stateService.readSetup(consumer.id);
            const read2 = await stateService.readSetup(consumer.id);
            assert.deepEqual(read1, read2);
        } finally {
            dispose(dirs);
        }
    });

    test('AC-40-2: Unprovisioned consumer returns ready=false', async () => {
        const root = tempRoot();
        const dirs = [root];
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();

            const consumer = await registry.createConsumer({
                id: 'c-state-unprov',
                name: 'Unprovisioned Consumer',
                root,
                actor,
            });

            // Drop the schema so it is unprovisioned
            await store.dropSchema(consumer.id);

            const stateService = new ProvisioningStateService(store);
            const unprovState = await stateService.readSetup(consumer.id);
            assert.equal(unprovState.schema.exists, false);
            assert.equal(unprovState.material.materialized, false);
            assert.equal(unprovState.material.agents, false);
            assert.equal(unprovState.setup.ready, false);

            // persistSetup on unprovisioned consumer remains ready=false
            const persisted = await stateService.persistSetup(consumer.id);
            assert.equal(persisted.setup.ready, false);
        } finally {
            dispose(dirs);
        }
    });

    test('INV-2: Partial states reflect accurately', async () => {
        const root = tempRoot();
        const dirs = [root];
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();

            const consumer = await registry.createConsumer({
                id: 'c-state-partial',
                name: 'Partial Consumer',
                root,
                actor,
            });

            const stateService = new ProvisioningStateService(store);

            // Schema exists, but material missing
            const res1 = await stateService.readSetup(consumer.id);
            assert.equal(res1.schema.exists, true);
            assert.equal(res1.material.materialized, false);
            assert.equal(res1.setup.ready, false);

            // Provision only AGENTS.md manually
            writeFileSync(join(root, 'AGENTS.md'), '# Agents');
            const res2 = await stateService.readSetup(consumer.id);
            assert.equal(res2.material.agents, true);
            assert.equal(res2.material.config, false);
            assert.equal(res2.material.manifest, false);
            assert.equal(res2.material.materialized, false);
            assert.equal(res2.setup.ready, false);
        } finally {
            dispose(dirs);
        }
    });

    test('INV-3: Fail-closed on missing consumer', async () => {
        const store = new MemoryPlatformStore();
        const stateService = new ProvisioningStateService(store);

        await assert.rejects(
            stateService.readSetup('non-existent'),
            (err: any) => err.code === 'CONSUMER_NOT_FOUND'
        );

        await assert.rejects(
            stateService.persistSetup('non-existent'),
            (err: any) => err.code === 'CONSUMER_NOT_FOUND'
        );
    });

    test('INV-3: Fail-closed with SETUP_INFO_MISSING when expecting ready state', async () => {
        const root = tempRoot();
        const dirs = [root];
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();

            const consumer = await registry.createConsumer({
                id: 'c-state-missing',
                name: 'Missing Material',
                root,
                actor,
            });

            const stateService = new ProvisioningStateService(store);

            // expectReady on unprovisioned consumer fails closed
            await assert.rejects(
                stateService.persistSetup(consumer.id, { expectReady: true }),
                (err: any) => err.code === 'SETUP_INFO_MISSING'
            );

            // Corrupted config.json fails closed
            mkdirSync(join(root, '.harness'), { recursive: true });
            writeFileSync(join(root, 'AGENTS.md'), 'test');
            writeFileSync(join(root, '.harness', 'config.json'), '{invalid json');
            writeFileSync(join(root, '.harness', 'manifest.json'), '{}');

            await assert.rejects(
                stateService.persistSetup(consumer.id, { expectReady: true }),
                (err: any) => err.code === 'SETUP_INFO_MISSING'
            );
        } finally {
            dispose(dirs);
        }
    });

    test('INV-1 & Hash Consistency: Modifying material file breaks ready state', async () => {
        const root = tempRoot();
        const dirs = [root];
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();

            const consumer = await registry.createConsumer({
                id: 'c-state-tamper',
                name: 'Tamper Consumer',
                root,
                actor,
            });

            const materialService = new MaterialProvisioningService(store);
            await materialService.provision(consumer.id);
            const schemaService = new SchemaProvisioningService(store);
            await schemaService.provision(consumer.id);

            const stateService = new ProvisioningStateService(store);
            await stateService.persistSetup(consumer.id);

            const initial = await stateService.readSetup(consumer.id);
            assert.equal(initial.setup.ready, true);
            assert.equal(initial.material.materialized, true);

            // Tamper with AGENTS.md (preserving marker so it remains an ESO file, but changing content)
            writeFileSync(join(root, 'AGENTS.md'), `<!-- ${GENERATED_MARKER} -->\nTampered content`);

            const tampered = await stateService.readSetup(consumer.id);
            assert.equal(tampered.material.materialized, false);
            assert.equal(tampered.setup.ready, false);

            // B4: persistSetup must NOT re-bless tampered material or bless the new hash
            await stateService.persistSetup(consumer.id);
            const stillTampered = await stateService.readSetup(consumer.id);
            assert.equal(stillTampered.material.materialized, false, 'persistSetup must not re-bless tampered material');
            assert.equal(stillTampered.setup.ready, false, 'tampered consumer must remain unready');

            // persistSetup with expectReady fails closed with SETUP_INFO_MISSING
            await assert.rejects(
                stateService.persistSetup(consumer.id, { expectReady: true }),
                (err: any) => err.code === 'SETUP_INFO_MISSING'
            );

            // Legitimate re-provisioning via MaterialProvisioningService restores ready state
            await materialService.provision(consumer.id);
            const recovered = await stateService.readSetup(consumer.id);
            assert.equal(recovered.material.materialized, true);
            assert.equal(recovered.setup.ready, true);
            assert.equal(recovered.material.hash, initial.material.hash);
        } finally {
            dispose(dirs);
        }
    });
});
