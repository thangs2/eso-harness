/**
 * AC legacy batch 4a — F-14 inventory (US-22) + F-15 content sufficiency (US-23).
 * SCN/AC ids are pinned so RTM-LEGACY can link them directly.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { SufficiencyService } from '../src/modules/sufficiency/sufficiency.service.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { AuthService } from '../src/common/auth/auth.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface FixtureOptions {
    docs: Record<string, string>;
    template?: unknown;
    id?: string;
}

async function fixture(options: FixtureOptions) {
    const store = new MemoryPlatformStore();
    const id = options.id ?? 'b4a-consumer';
    const root = mkdtempSync(join(tmpdir(), 'eso-batch4a-'));
    roots.push(root);
    mkdirSync(join(root, '.harness'), { recursive: true });
    for (const [path, content] of Object.entries(options.docs)) {
        const absolute = join(root, path);
        mkdirSync(join(absolute, '..'), { recursive: true });
        writeFileSync(absolute, content);
    }
    if (options.template !== undefined) {
        writeFileSync(join(root, '.harness', 'knowledge-template.json'), JSON.stringify(options.template));
    }
    const now = new Date().toISOString();
    await store.insertConsumer({
        id,
        name: 'Batch 4a',
        root,
        sdlcRoot: 'sdlc',
        schemaName: `c_${id.replace(/-/g, '_')}`,
        status: 'ready',
        version: 1,
        storageMode: 'schema',
        materializedHash: null,
        createdAt: now,
        updatedAt: now,
    });
    const inventory = new InventoryService(store);
    return { store, root, id, inventory, sufficiency: new SufficiencyService(store, inventory) };
}

const TEMPLATE = { kinds: [{ kind: 'frd', owner: 'a-01' }, { kind: 'us', owner: 'a-04' }] };

function doc(header: Record<string, string>, body: string): string {
    const lines = Object.entries(header).map(([key, value]) => `${key}: ${value}`).join('\n');
    return `---\n${lines}\n---\n${body}\n`;
}

describe('AC legacy batch 4a — inventory + content sufficiency', () => {
    test('SCN-22-1 · AC-22-1 — mỗi kind có instance: inventory đếm đủ và route trả cùng kết quả', async () => {
        const fx = await fixture({
            template: TEMPLATE,
            docs: {
                'docs/frd.md': doc({ kind: 'frd', id: 'frd-1' }, '# FRD\nRequirements for the retrieval capability.'),
                'docs/us.md': doc({ kind: 'us', id: 'us-1' }, '# US\nAs an operator I want an inventory.'),
            },
        });
        const result = await fx.inventory.inventory(fx.id);
        assert.equal(result.kinds.length, 2);
        assert.deepEqual(result.kinds.map((row) => [row.kind, row.instanceCount, row.status]), [
            ['frd', 1, 'present'],
            ['us', 1, 'present'],
        ]);
        assert.equal(result.summary.instances, 2);
        assert.deepEqual(result.findings, []);

        const app = await createPlatformServer({
            store: fx.store,
            auth: new AuthService({ user: 'operator', password: 'secret', token: 'token' }),
        });
        try {
            // `app.inject` (light-my-request) stalls under Bun, so bind an ephemeral port.
            await app.listen({ port: 0, host: '127.0.0.1' });
            const address = app.server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            const response = await fetch(`http://127.0.0.1:${port}/api/v1/consumers/${fx.id}/knowledge/inventory`, {
                headers: { authorization: `Basic ${Buffer.from('operator:secret').toString('base64')}` },
            });
            assert.equal(response.status, 200);
            const body = await response.json() as any;
            assert.equal(body.consumerId, fx.id);
            assert.deepEqual(body.kinds.map((row: any) => row.kind), ['frd', 'us']);
            assert.deepEqual(body.findings, []);
        } finally {
            await app.close();
        }
    });

    test('SCN-22-2 · AC-22-2 — kind bắt buộc thiếu ⇒ MISSING_KIND', async () => {
        const fx = await fixture({
            template: { kinds: [{ kind: 'frd', owner: 'a-01' }, { kind: 'ac', owner: 'a-02' }] },
            docs: { 'docs/frd.md': doc({ kind: 'frd' }, '# FRD\nOnly the FRD exists.') },
        });
        const result = await fx.inventory.inventory(fx.id);
        const missing = result.findings.filter((finding) => finding.code === 'MISSING_KIND');
        assert.equal(missing.length, 1);
        assert.equal(missing[0].kind, 'ac');
        assert.equal(missing[0].path, null);
        assert.equal(missing[0].severity, 'error');
        assert.equal(result.kinds.find((row) => row.kind === 'ac')?.status, 'missing');
        assert.equal(result.summary.missingKinds, 1);
    });

    test('SCN-22-3 · AC-22-3 — artifact mồ côi ⇒ finding mồ côi', async () => {
        const fx = await fixture({
            template: { kinds: [{ kind: 'frd', owner: 'a-01' }] },
            docs: {
                'docs/frd.md': doc({ kind: 'frd' }, '# FRD\nMapped artifact.'),
                'docs/notes/orphan.md': doc({ type: 'architecture-note' }, '# Note\nThis kind is not in the template.'),
            },
        });
        const result = await fx.inventory.inventory(fx.id);
        const orphans = result.findings.filter((finding) => finding.code === 'ORPHAN_ARTIFACT');
        assert.equal(orphans.length, 1);
        assert.equal(orphans[0].path, 'docs/notes/orphan.md');
        assert.equal(orphans[0].kind, 'architecture-note');
        assert.deepEqual(result.orphans.map((orphan) => orphan.path), ['docs/notes/orphan.md']);
        assert.equal(result.summary.orphanArtifacts, 1);
    });

    test('SCN-23-1 · AC-23-1 — 2 bản gần trùng ⇒ NEAR_DUPLICATE + copies', async () => {
        const shared = 'The knowledge index stores one section per heading and rebuilds edges from source_of_truth and human_sot pointers. '
            + 'The retrieval path combines full text search with graph expansion and vector ranking before the result is trimmed to the requested limit. '
            + 'Every document carries a content hash so freshness can be compared without rereading the whole knowledge base.';
        const fx = await fixture({
            template: { kinds: [{ kind: 'frd', owner: 'a-01' }] },
            docs: {
                'docs/a.md': doc({ kind: 'frd', id: 'frd-a' }, `# A\n${shared}`),
                'docs/b.md': doc({ kind: 'frd', id: 'frd-b' }, `# B\n${shared} A final sentence adds a short note about ranking weights.`),
            },
        });
        const result = await fx.sufficiency.check(fx.id);
        const duplicates = result.findings.filter((finding) => finding.code === 'NEAR_DUPLICATE');
        assert.equal(duplicates.length, 1);
        assert.equal(duplicates[0].copies?.length, 2);
        assert.deepEqual(duplicates[0].copies?.map((copy) => copy.path), ['docs/a.md', 'docs/b.md']);
        assert.equal(duplicates[0].kind, 'frd');
        assert.equal(result.blockMerge, true);
    });

    test('SCN-23-2 · AC-23-2 — 2 bản mâu thuẫn ⇒ CONTENT_CONTRADICTS kèm trích dẫn', async () => {
        const fx = await fixture({
            template: { kinds: [{ kind: 'frd', owner: 'a-01' }] },
            docs: {
                'docs/rotate.md': doc({ kind: 'frd', id: 'frd-rotate' }, '# Rotation\nThe API token is rotated by the operator every thirty days.'),
                'docs/keep.md': doc({ kind: 'frd', id: 'frd-keep' }, '# Rotation\nThe API token is not rotated by the operator every thirty days.'),
            },
        });
        const result = await fx.sufficiency.check(fx.id);
        const contradictions = result.findings.filter((finding) => finding.code === 'CONTENT_CONTRADICTS');
        assert.equal(contradictions.length, 1);
        const quotes = contradictions[0].quotes ?? [];
        assert.deepEqual(quotes.map((quote) => quote.path), ['docs/rotate.md', 'docs/keep.md']);
        assert.match(quotes[0].statement, /is rotated/);
        assert.match(quotes[1].statement, /not rotated/);
        assert.equal(contradictions[0].severity, 'error');
    });

    test('SCN-23-3 · AC-23-3 — finding không hậu quả ⇒ bị loại', async () => {
        const fx = await fixture({
            template: { kinds: [{ kind: 'frd', owner: 'a-01' }] },
            docs: {
                'docs/frd.md': doc({ kind: 'frd', id: 'frd-1' }, '# FRD\nThe only artifact in the knowledge base.\nThe operator reads it before the gate runs.'),
            },
        });
        const result = await fx.sufficiency.check(fx.id, {
            upstreamFindings: [
                { code: 'STALE', kind: 'frd', reason: 'indexed hash differs from the current file' },
                {
                    code: 'STALE',
                    kind: 'frd',
                    reason: 'indexed hash differs from the current file',
                    consequence: 'a stale artifact can pass the gate as if it were current',
                    severity: 'warning',
                },
            ],
        });
        assert.equal(result.summary.dropped, 1);
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].code, 'STALE');
        assert.equal(result.findings[0].consequence, 'a stale artifact can pass the gate as if it were current');
    });
});
