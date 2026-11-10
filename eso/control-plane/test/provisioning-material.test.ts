import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore, RegistryService, type Actor } from '../src/platform/registry/index.js';
import {
    GENERATED_MARKER,
    HARNESS_MANIFEST_SCHEMA,
    MaterialProvisioningService,
} from '../src/provisioning/material/index.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };

function createTempRoot(): string {
    return mkdtempSync(join(tmpdir(), 'eso-material-test-'));
}

describe('L5.6 — Provision material bundle', () => {
    test('AC-40-1: Clean consumer root provisions complete material bundle with markers and valid hashes', async () => {
        const root = createTempRoot();
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();
            const consumer = await registry.createConsumer({
                id: 'c-clean-1',
                name: 'Clean Consumer',
                root,
                actor,
            });

            const service = new MaterialProvisioningService(store);
            const result = await service.provision(consumer.id, {
                profile: { locale: 'vi' },
                zones: ['us-east'],
            });

            assert.equal(result.consumerId, 'c-clean-1');
            assert.equal(result.root, root);
            assert.ok(result.hash && result.hash.length === 64, 'Bundle hash must be a 64-char sha256 hex');

            // 1. AGENTS.md exists and contains marker
            const agentsMdPath = join(root, 'AGENTS.md');
            assert.ok(existsSync(agentsMdPath), 'AGENTS.md must exist');
            const agentsMdContent = readFileSync(agentsMdPath, 'utf8');
            assert.ok(agentsMdContent.includes(GENERATED_MARKER), 'AGENTS.md must contain generated marker');

            // 2. agents/ and subdirectories exist
            const agentsDir = join(root, 'agents');
            assert.ok(existsSync(agentsDir), 'agents/ directory must exist');
            assert.ok(existsSync(join(agentsDir, 'rules')), 'agents/rules/ must exist');
            assert.ok(existsSync(join(agentsDir, 'skills')), 'agents/skills/ must exist');
            assert.ok(existsSync(join(agentsDir, 'subagents')), 'agents/subagents/ must exist');

            const agentsReadmePath = join(agentsDir, 'README.md');
            assert.ok(existsSync(agentsReadmePath), 'agents/README.md must exist');
            const agentsReadme = readFileSync(agentsReadmePath, 'utf8');
            assert.ok(agentsReadme.includes(GENERATED_MARKER), 'agents/README.md must contain marker');

            // 3. .harness/config.json (INV-4, D-113)
            const configPath = join(root, '.harness', 'config.json');
            assert.ok(existsSync(configPath), '.harness/config.json must exist');
            const config = JSON.parse(readFileSync(configPath, 'utf8'));
            assert.equal(config._generated, GENERATED_MARKER);
            assert.equal(config._schema, 1);
            assert.equal(config.id, 'c-clean-1');
            assert.equal(config.name, 'Clean Consumer');
            assert.deepEqual(config.profile, { locale: 'vi' });
            assert.deepEqual(config.zones, ['us-east']);
            assert.ok(config.hash, 'Config must have sha256 hash');

            // 4. .harness/manifest.json (INV-5, Plane D §3b)
            const manifestPath = join(root, '.harness', 'manifest.json');
            assert.ok(existsSync(manifestPath), '.harness/manifest.json must exist');
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            assert.equal(manifest._schema, HARNESS_MANIFEST_SCHEMA);
            assert.equal(manifest._generated, GENERATED_MARKER);
            assert.equal(manifest.consumerId, 'c-clean-1');
            assert.equal(manifest.version, 1);
            assert.deepEqual(manifest.paths, { agents: 'agents', harness: '.harness' });
            assert.deepEqual(manifest.projections, {});

            // Platform store has materialized hash updated
            const updatedConsumer = await store.getConsumer('c-clean-1');
            assert.equal(updatedConsumer?.materializedHash, result.hash);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('AC-40-2 (Idempotency): Rerun on provisioned root produces identical files and skips unchanged', async () => {
        const root = createTempRoot();
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();
            const consumer = await registry.createConsumer({
                id: 'c-idempotent',
                name: 'Idempotent Consumer',
                root,
                actor,
            });

            const service = new MaterialProvisioningService(store);
            const first = await service.provision(consumer.id);
            assert.ok(first.filesWritten.length > 0);
            assert.equal(first.skippedUnchanged.length, 0);

            // Second run
            const second = await service.provision(consumer.id);
            assert.equal(second.hash, first.hash, 'Hash must match on idempotent rerun');
            assert.equal(second.filesWritten.length, 0, 'No files should be rewritten on rerun');
            assert.ok(second.skippedUnchanged.length > 0, 'Files should be marked skippedUnchanged');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('AC-40-2 (User Protection): Fails closed without overwriting unowned user files', async () => {
        const root = createTempRoot();
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();
            const consumer = await registry.createConsumer({
                id: 'c-protect',
                name: 'Protected Consumer',
                root,
                actor,
            });

            // User pre-existing AGENTS.md without marker
            const userContent = '# Custom User AGENTS.md - DO NOT TOUCH';
            const userAgentsMd = join(root, 'AGENTS.md');
            writeFileSync(userAgentsMd, userContent, 'utf8');

            const service = new MaterialProvisioningService(store);
            await assert.rejects(
                async () => {
                    await service.provision(consumer.id);
                },
                (err: any) => {
                    return err.code === 'MATERIAL_FAILED';
                },
                'Provisioning must reject with MATERIAL_FAILED when user file has no marker'
            );

            // Assert user file remains uncorrupted
            const remaining = readFileSync(userAgentsMd, 'utf8');
            assert.equal(remaining, userContent, 'User file must remain intact and not overwritten');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('B3: Rerun without profile options preserves existing profile in config.json', async () => {
        const root = createTempRoot();
        try {
            const store = new MemoryPlatformStore();
            const registry = new RegistryService(store);
            await registry.initialize();
            const consumer = await registry.createConsumer({
                id: 'c-preserve-profile',
                name: 'Preserve Profile Consumer',
                root,
                actor,
            });

            const service = new MaterialProvisioningService(store);
            // First run with specific profile
            await service.provision(consumer.id, {
                profile: { locale: 'vi', theme: 'dark' },
                zones: ['ap-southeast-1'],
            });

            const configPath = join(root, '.harness', 'config.json');
            const initialConfig = JSON.parse(readFileSync(configPath, 'utf8'));
            assert.deepEqual(initialConfig.profile, { locale: 'vi', theme: 'dark' });

            // Second run without options.profile
            await service.provision(consumer.id);

            const preservedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
            assert.deepEqual(preservedConfig.profile, { locale: 'vi', theme: 'dark' }, 'Existing profile must not be wiped to empty object');
            assert.deepEqual(preservedConfig.zones, ['ap-southeast-1']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('INV-6 (D-123): Fails with ROOT_NOT_FOUND when consumer root is invalid or missing', async () => {
        const nonExistent = join(tmpdir(), `non-existent-root-${Date.now()}`);
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        const consumer = await registry.createConsumer({
            id: 'c-missing-root',
            name: 'Missing Root Consumer',
            root: nonExistent,
            actor,
        });

        const service = new MaterialProvisioningService(store);
        await assert.rejects(
            async () => {
                await service.provision(consumer.id);
            },
            (err: any) => {
                return err.code === 'ROOT_NOT_FOUND';
            },
            'Must fail with ROOT_NOT_FOUND when root does not exist'
        );
    });
});
