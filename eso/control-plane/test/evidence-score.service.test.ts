import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { EvidenceScoreService } from '../src/modules/evidence-score/evidence-score.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-score-'));
    roots.push(root);
    await store.insertConsumer({
        id: 'score-consumer', name: 'Score', root, sdlcRoot: 'sdlc', schemaName: 'c_score', status: 'ready', version: 1,
        storageMode: 'schema', materializedHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return new EvidenceScoreService(store);
}

describe('Phase 4 evidence score', () => {
    it('computes deterministic high score', async () => {
        const service = await fixture();
        const result = await service.score('score-consumer', {
            verdict: { level: 'sufficient', basis: 'verified' },
            provenance: { covered: 10, total: 10 },
            observations: { present: 5, required: 5 },
            requiredEvidence: { present: 2, required: 2 },
        });
        assert.equal(result.score, 100);
        assert.equal(result.band, 'high');
    });

    it('returns low score for inferred/empty evidence', async () => {
        const service = await fixture();
        const result = await service.score('score-consumer', { verdict: { basis: 'inferred' } });
        assert.equal(result.score, 12);
        assert.equal(result.band, 'low');
    });

    it('rejects invalid ratios', async () => {
        const service = await fixture();
        await assert.rejects(service.score('score-consumer', { provenance: { covered: 2, total: 1 } }), (error: any) => /provenance/.test(String(error.detail)));
    });
});
