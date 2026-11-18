import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { HarnessMigrationService } from '../src/modules/consumers/migration/harness-migration.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture(id = 'migration-consumer') {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-migration-'));
    roots.push(root);
    await store.insertConsumer({
        id, name: id, root, sdlcRoot: 'sdlc', schemaName: `c_${id}`, status: 'ready', version: 1,
        storageMode: 'schema', materializedHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const write = (path: string, content = 'content\n') => {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
    };
    write('.cursor/rules/alpha.mdc', 'alpha rule\n');
    write('.agents/rules/beta.md', 'beta rule\n');
    write('.cursor/rules/core.mdc', 'legacy core\n');
    write('agents/rules/core.md', 'eso core\n');
    write('.cursor/skills/recon/SKILL.md', 'recon skill\n');
    write('.cursor/agents/scout-runtime.md', 'scout agent\n');
    write('.cursor/agents/README.md', 'legacy readme\n');
    write('.cursor/hooks/guard.py', 'print(1)\n');
    return { store, root, service: new HarnessMigrationService(store) };
}

describe('harness migration pipeline', () => {
    it('previews rules/skills/agents/hooks without writing', async () => {
        const { service, root } = await fixture();
        const preview = await service.preview('migration-consumer');
        assert.equal(preview.detected, true);
        assert.equal(preview.entries.some((entry) => entry.source === '.cursor/rules/alpha.mdc'), true);
        assert.equal(preview.entries.some((entry) => entry.source === '.agents/rules/beta.md'), true);
        const core = preview.entries.find((entry) => entry.target === 'agents/rules/core.md');
        assert.equal(core?.status, 'conflict');
        assert.equal(preview.totals.rules.conflict, 1);
        assert.equal(preview.entries.some((entry) => entry.target === 'agents/subagents/README.md'), false);
        assert.equal(existsSync(join(root, 'agents/rules/alpha.md')), false);
        const firstHash = preview.planHash;
        writeFileSync(join(root, '.cursor/rules/alpha.mdc'), 'alpha rule changed\n');
        const changed = await service.preview('migration-consumer');
        assert.notEqual(changed.planHash, firstHash);
    });

    it('applies new files after resolving conflicts and writes a manifest', async () => {
        const { service, root } = await fixture();
        const preview = await service.preview('migration-consumer');
        const conflict = preview.entries.find((entry) => entry.status === 'conflict')!;
        await service.resolveConflict('migration-consumer', conflict.id, 'keep-eso', { kind: 'operator' });
        const result = await service.apply('migration-consumer', { kind: 'operator', label: 'operator@test' });
        assert.equal(existsSync(join(root, 'agents/rules/alpha.md')), true);
        assert.equal(existsSync(join(root, 'agents/rules/beta.md')), true);
        assert.equal(existsSync(join(root, 'agents/skills/recon/SKILL.md')), true);
        assert.equal(existsSync(join(root, 'agents/subagents/scout-runtime.md')), true);
        assert.equal(existsSync(join(root, 'agents/hooks/guard.py')), true);
        assert.equal(readFileSync(join(root, 'agents/rules/core.md'), 'utf8'), 'eso core\n');
        assert.equal(result.skipped.some((entry) => entry.target === 'agents/rules/core.md'), true);
        assert.equal(existsSync(join(root, '.cursor/rules/alpha.mdc')), true);
        assert.equal(existsSync(join(root, '.agents/rules/alpha.md')), true);
        assert.equal(existsSync(join(root, '.cursor/skills/recon/SKILL.md')), true);
        assert.equal(existsSync(join(root, '.cursor/agents/scout-runtime.md')), true);
        assert.equal(existsSync(join(root, '.cursor/hooks/guard.py')), true);
        const manifest = JSON.parse(readFileSync(join(root, '.harness/migration-manifest.json'), 'utf8'));
        assert.equal(manifest.consumerId, 'migration-consumer');
        assert.equal(manifest.planHash, result.planHash);
        assert.equal(manifest.skipped.length, 1);
        assert.ok(manifest.projected.length > 0);
        // migration leaves legacy source in place for the separate verified cleanup step
        assert.equal(existsSync(join(root, '.cursor/rules/alpha.mdc')), true);
    });
});

    it('blocks apply until conflicts are resolved; keep-eso records a decision', async () => {
        const { service } = await fixture();
        const preview = await service.preview('migration-consumer');
        const conflict = preview.entries.find((entry) => entry.status === 'conflict')!;
        await assert.rejects(service.apply('migration-consumer', { kind: 'operator' }), (error: any) => /Resolve migration conflicts/.test(String(error.detail)));
        const resolved = await service.resolveConflict('migration-consumer', conflict.id, 'keep-eso', { kind: 'operator', label: 'operator@test' });
        assert.equal(resolved.preview.totals.rules.conflict, 0);
        assert.equal(resolved.preview.totals.rules.resolved, 1);
        const result = await service.apply('migration-consumer', { kind: 'operator' });
        assert.equal(result.applied.length > 0, true);
    });

    it('adopt-legacy backs up the canonical target and copies the source', async () => {
        const { store, root, service } = await fixture();
        const preview = await service.preview('migration-consumer');
        const conflict = preview.entries.find((entry) => entry.target === 'agents/rules/core.md')!;
        const result = await service.resolveConflict('migration-consumer', conflict.id, 'adopt-legacy', { kind: 'operator' });
        assert.equal(readFileSync(join(root, 'agents/rules/core.md'), 'utf8'), 'legacy core\n');
        assert.equal(result.backupPath?.startsWith('.harness/archive/migration-conflicts/'), true);
        assert.equal(existsSync(join(root, result.backupPath!)), true);
        assert.equal((await service.preview('migration-consumer')).totals.rules.conflict, 0);
    });

    it('invalidates a resolution when the source changes', async () => {
        const { root, service } = await fixture();
        const preview = await service.preview('migration-consumer');
        const conflict = preview.entries.find((entry) => entry.status === 'conflict')!;
        await service.resolveConflict('migration-consumer', conflict.id, 'keep-eso', { kind: 'operator' });
        writeFileSync(join(root, '.cursor/rules/core.mdc'), 'legacy core changed\n');
        const after = await service.preview('migration-consumer');
        assert.equal(after.entries.find((entry) => entry.id === conflict.id)?.status, 'conflict');
    });
