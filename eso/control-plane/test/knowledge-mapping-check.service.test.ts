import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { KnowledgeMappingCheckService } from '../src/modules/knowledge/knowledge-mapping-check.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-p8-'));
    roots.push(root);
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, '.harness'), { recursive: true });
    writeFileSync(join(root, 'docs', 'human.md'), '---\nrepresentation: human\n---\n# Human\nThis is the source body that must not be copied into an AI projection. It is long enough for the checker to compare normalized bodies reliably.');
    writeFileSync(join(root, 'docs', 'ai.md'), '---\nrepresentation: agent\nhuman_sot: docs/human.md\n---\n# AI\n# Human\nThis is the source body that must not be copied into an AI projection. It is long enough for the checker to compare normalized bodies reliably.');
    writeFileSync(join(root, 'docs', 'orphan.md'), '---\nrepresentation: agent\n---\n# Orphan\nNo human source.');
    writeFileSync(join(root, '.harness', 'knowledge-manifest.json'), JSON.stringify({ documents: [] }));
    await store.insertConsumer({
        id: 'p8-consumer', name: 'P8', root, sdlcRoot: 'sdlc', schemaName: 'c_p8', status: 'ready', version: 1,
        storageMode: 'schema', materializedHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return new KnowledgeMappingCheckService(store);
}

describe('Phase 5 P8 mapping checker', () => {
    it('fails copied body and missing human_sot', async () => {
        const service = await fixture();
        const result = await service.check('p8-consumer');
        assert.equal(result.status, 'fail');
        assert.equal(result.findings.some((finding) => finding.code === 'COPIED_BODY'), true);
        assert.equal(result.findings.some((finding) => finding.code === 'MISSING_HUMAN_SOT'), true);
    });
});
