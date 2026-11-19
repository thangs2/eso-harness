import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { KnowledgeMappingService } from '../src/modules/knowledge/knowledge-mapping.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-mapping-'));
    roots.push(root);
    mkdirSync(join(root, '.harness'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'human.md'), '---\nid: human-1\nrepresentation: human\n---\n# Human\n');
    writeFileSync(join(root, 'docs', 'ai.md'), '---\nid: ai-1\nrepresentation: agent\nhuman_sot: docs/human.md\n---\n# AI\n');
    writeFileSync(join(root, '.harness', 'knowledge-manifest.json'), JSON.stringify({ documents: [
        { path: 'docs/human.md', content_hash: 'stale' },
        { path: 'docs/ai.md', content_hash: 'stale' },
    ] }));
    await store.insertConsumer({
        id: 'mapping-consumer', name: 'Mapping', root, sdlcRoot: 'sdlc', schemaName: 'c_mapping', status: 'ready', version: 1,
        storageMode: 'schema', materializedHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return new KnowledgeMappingService(store);
}

describe('Phase 3 knowledge mapping/freshness', () => {
    it('maps HUMAN source to AI projection and detects stale files', async () => {
        const service = await fixture();
        const result = await service.mapping('mapping-consumer');
        assert.equal(result.summary.human, 1);
        assert.equal(result.summary.agent, 1);
        assert.equal(result.summary.stale, 2);
        assert.equal(result.summary.unindexed, 0);
        assert.equal(result.projections.length, 1);
        assert.equal(result.projections[0].humanPath, 'docs/human.md');
        assert.equal(result.projections[0].freshness, 'stale');
    });

    it('marks files stale when manifest hash differs', async () => {
        const service = await fixture();
        const result = await service.mapping('mapping-consumer');
        assert.equal(result.docs.every((doc) => doc.freshness === 'stale'), true);
    });
});
