/**
 * P3 — progressive disclosure for knowledge retrieval.
 *
 * Tiers: `index` (pointer only), `summary` (bounded body prefix) and `body` (current behaviour).
 * A single `budgetTokens` shapes every tier; 1 token ≈ 4 chars.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { KnowledgeRetrievalService } from '../src/modules/knowledge/knowledge-retrieval.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
const servers: any[] = [];

afterEach(async () => {
    for (const app of servers.splice(0)) await app.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function consumerRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'eso-p3-'));
    roots.push(root);
    mkdirSync(join(root, 'docs'), { recursive: true });
    return root;
}

class StubStore extends MemoryPlatformStore {
    constructor(private readonly root: string, private readonly docs: any[]) {
        super();
    }

    async getConsumer(id: string): Promise<any> {
        return {
            id,
            name: id,
            root: this.root,
            sdlcRoot: null,
            schemaName: `c_${id.replace(/-/g, '_')}`,
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }

    async knowledgeFtsSearch(): Promise<any[]> {
        return this.docs.map((doc) => ({ ...doc }));
    }

    async knowledgeGraphCandidates(): Promise<any[]> {
        return [];
    }

    async knowledgeVectorCount(): Promise<number> {
        return 0;
    }

    async knowledgeVectorSearch(): Promise<any[]> {
        return [];
    }
}

const LONG_BODY = `${'A'.repeat(500)}${'B'.repeat(500)}`;

function documents(): any[] {
    return [
        { doc_id: 'doc-a', path: 'docs/a.md', type: 'doc', status: 'DRAFT', title: 'Alpha', body: LONG_BODY },
        { doc_id: 'doc-b', path: 'docs/b.md', type: 'doc', status: 'DRAFT', title: 'Beta', body: 'B'.repeat(100) },
    ];
}

function serviceFor(docs: any[] = documents()): { service: KnowledgeRetrievalService; root: string } {
    const root = consumerRoot();
    for (const doc of docs) writeFileSync(join(root, doc.path), doc.body ?? '', 'utf8');
    return { service: new KnowledgeRetrievalService(new StubStore(root, docs)), root };
}

describe('P3 progressive disclosure — index tier', () => {
    test('index returns ids, titles, applies_when and score; never a body', async () => {
        const { service } = serviceFor();
        const result = await service.retrieve('tier-consumer', 'alpha', { tier: 'index' });

        assert.equal(result.tier, 'index');
        assert.equal(result.truncated, false);
        assert.equal(result.results.length, 2);
        const first = result.results[0];
        assert.equal(first.docId, 'doc-a');
        assert.equal(first.title, 'Alpha');
        assert.deepEqual(first.applies_when, {});
        assert.equal(typeof first.score, 'number');
        assert.equal('body' in first, false);
        assert.equal('summary' in first, false);
        assert.equal('doc' in first, false);
        assert.equal(JSON.stringify(result.results).includes('AAAA'), false);
    });
});

describe('P3 progressive disclosure — summary tier', () => {
    test('summary truncates body and marks item + response truncated', async () => {
        const { service } = serviceFor();
        const result = await service.retrieve('tier-consumer', 'alpha', { tier: 'summary' });

        assert.equal(result.tier, 'summary');
        assert.equal(result.truncated, true);
        assert.equal(result.results[0].docId, 'doc-a');
        assert.equal(result.results[0].summary, 'A'.repeat(400));
        assert.equal(result.results[0].truncated, true);
        assert.equal(result.results[1].summary.length, 100);
        assert.equal(result.results[1].truncated, false);
    });

    test('summary reads the body from the consumer file when the hit has no inline body', async () => {
        const docs = [{ doc_id: 'doc-a', path: 'docs/a.md', type: 'doc', status: 'DRAFT', title: 'Alpha' }];
        const root = consumerRoot();
        writeFileSync(join(root, 'docs', 'a.md'), `---\ntitle: Alpha\n---\n${LONG_BODY}`, 'utf8');
        const service = new KnowledgeRetrievalService(new StubStore(root, docs));

        const result = await service.retrieve('tier-consumer', 'alpha', { tier: 'summary' });
        assert.equal(result.results[0].summary, 'A'.repeat(400));
        assert.equal(result.results[0].truncated, true);
    });
});

describe('P3 progressive disclosure — body tier and budget', () => {
    test('body tier is unchanged from current retrieval', async () => {
        const { service } = serviceFor();
        const implicit = await service.retrieve('tier-consumer', 'alpha');
        const explicit = await service.retrieve('tier-consumer', 'alpha', { tier: 'body' });

        assert.equal(implicit.tier, 'body');
        assert.equal(explicit.tier, 'body');
        assert.deepEqual(explicit.results, implicit.results);
        assert.equal(implicit.results[0].doc.body, LONG_BODY);
        assert.equal(implicit.results[0].doc.path, 'docs/a.md');
        assert.equal('summary' in implicit.results[0], false);
    });

    test('summary budget is respected across results', async () => {
        const { service } = serviceFor();
        const result = await service.retrieve('tier-consumer', 'alpha', { tier: 'summary', budgetTokens: 10 });

        assert.equal(result.budgetTokens, 10);
        assert.equal(result.truncated, true);
        const total = result.results.reduce((sum: number, item: any) => sum + item.summary.length, 0);
        assert.equal(total <= 40, true);
        assert.equal(total, 40);
        assert.equal(result.results[0].summary.length, 40);
        assert.equal(result.results[1].summary, '');
    });

    test('body budget truncates body deterministically', async () => {
        const { service } = serviceFor();
        const result = await service.retrieve('tier-consumer', 'alpha', { tier: 'body', budgetTokens: 10 });

        assert.equal(result.truncated, true);
        assert.equal(result.results[0].doc.body, 'A'.repeat(40));
        assert.equal(result.results[0].truncated, true);
        const total = result.results.reduce((sum: number, item: any) => sum + String(item.doc.body ?? '').length, 0);
        assert.equal(total <= 40, true);
    });

    test('index budget drops results deterministically', async () => {
        const { service } = serviceFor();
        const result = await service.retrieve('tier-consumer', 'alpha', { tier: 'index', budgetTokens: 1 });

        assert.equal(result.budgetTokens, 1);
        assert.equal(result.truncated, true);
        assert.equal(result.results.length, 0);
    });
});

describe('P3 progressive disclosure — applies_when and validation', () => {
    test('applies_when filters candidates before ranking', async () => {
        const docs = [
            { doc_id: 'doc-a', path: 'docs/a.md', type: 'doc', status: 'DRAFT', title: 'Alpha', applies_when: { paths: ['src/**'] } },
            { doc_id: 'doc-b', path: 'docs/b.md', type: 'doc', status: 'DRAFT', title: 'Beta', applies_when: { tenant_model: 'single' } },
            { doc_id: 'doc-c', path: 'docs/c.md', type: 'doc', status: 'DRAFT', title: 'Gamma' },
        ];
        const { service } = serviceFor(docs);
        const result = await service.retrieve('tier-consumer', 'doc', {
            tier: 'index',
            context: { paths: ['src/a.ts'] },
        });

        assert.deepEqual(result.results.map((item: any) => item.docId), ['doc-a', 'doc-c']);
        assert.deepEqual(result.results[0].applies_when, { paths: ['src/**'] });
    });

    test('unknown tier ⇒ INVALID_STATE 422', async () => {
        const { service } = serviceFor();
        await assert.rejects(
            () => service.retrieve('tier-consumer', 'alpha', { tier: 'everything' }),
            (error: any) => error.code === 'INVALID_STATE' && error.status === 422,
        );
    });

    test('negative budget ⇒ INVALID_STATE 422', async () => {
        const { service } = serviceFor();
        await assert.rejects(
            () => service.retrieve('tier-consumer', 'alpha', { budgetTokens: -1 }),
            (error: any) => error.code === 'INVALID_STATE' && error.status === 422,
        );
    });
});

describe('P3 progressive disclosure — HTTP route', () => {
    test('existing retrieve/search routes expose tier + budget and map unknown tier to 422', async () => {
        const root = consumerRoot();
        for (const doc of documents()) writeFileSync(join(root, doc.path), doc.body ?? '', 'utf8');
        const store = new StubStore(root, documents());
        const app = await createPlatformServer({
            store,
            auth: new AuthService({ user: 'operator', password: 'secret', token: 'token' }),
        });
        await app.listen({ port: 0, host: '127.0.0.1' });
        servers.push(app);
        const address = app.server.address() as any;
        const base = `http://127.0.0.1:${address.port}`;
        const auth = `Basic ${Buffer.from('operator:secret').toString('base64')}`;
        const call = (path: string, init: any = {}) =>
            fetch(`${base}${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json', ...(init.headers || {}) } });

        const index = await call('/api/v1/consumers/tier-consumer/knowledge/retrieve', {
            method: 'POST',
            body: JSON.stringify({ query: 'alpha', tier: 'index' }),
        });
        assert.equal(index.status, 200);
        const indexBody = await index.json();
        assert.equal(indexBody.tier, 'index');
        assert.equal('body' in indexBody.results[0], false);

        const bad = await call('/api/v1/consumers/tier-consumer/knowledge/retrieve', {
            method: 'POST',
            body: JSON.stringify({ query: 'alpha', tier: 'everything' }),
        });
        assert.equal(bad.status, 422);
        assert.equal((await bad.json()).code, 'INVALID_STATE');

        const search = await call('/api/v1/consumers/tier-consumer/knowledge/search?q=alpha&tier=summary&budgetTokens=10');
        assert.equal(search.status, 200);
        const searchBody = await search.json();
        assert.equal(searchBody.tier, 'summary');
        assert.equal(searchBody.budgetTokens, 10);
        assert.equal(searchBody.truncated, true);
    });
});
