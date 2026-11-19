import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GraphImpactService } from '../src/modules/graph/application/services/graph-impact.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

async function store() {
    const memory = new MemoryPlatformStore();
    await memory.insertConsumer({
        id: 'graph-consumer', name: 'Graph', root: '/tmp/graph', sdlcRoot: 'sdlc', schemaName: 'c_graph',
        status: 'ready', version: 1, storageMode: 'schema', materializedHash: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return memory;
}

function scopedWith(handler: (sql: string) => any[]) {
    return {
        async withConsumer(_id: string, fn: (session: any) => Promise<any>) {
            return fn({ query: async (sql: string) => handler(sql) });
        },
    } as any;
}

describe('Phase 3 graph impact service', () => {
    it('returns unknown, never absent, when graph tables are missing', async () => {
        const memory = await store();
        const service = new GraphImpactService(memory, scopedWith(() => { throw new Error('relation "completeness" does not exist'); }));
        const result = await service.impact('graph-consumer', { target: 'src/foo.ts' });
        assert.equal(result.status, 'unknown');
        assert.equal(result.reason, 'GRAPH_NOT_BUILT');
        assert.deepEqual(result.nodes, []);
    });

    it('returns unknown with coverage below floor', async () => {
        const memory = await store();
        const service = new GraphImpactService(memory, scopedWith((sql) => sql.includes('completeness') ? [{ value: 0.4 }] : []));
        const result = await service.impact('graph-consumer', { target: 'src/foo.ts' });
        assert.equal(result.status, 'unknown');
        assert.equal(result.reason, 'LOW_COVERAGE');
        assert.equal(result.coverage, 0.4);
    });

    it('returns ready impact with depth/fanout and provenance-ready edge rows', async () => {
        const memory = await store();
        const service = new GraphImpactService(memory, scopedWith((sql) => {
            if (sql.includes('completeness')) return [{ value: 0.95 }];
            if (sql.includes('FROM graph_node') && sql.includes('node_key = $3')) return [{ node_id: 'n1', kind: 'module', node_key: 'src/foo.ts', path: 'src/foo.ts' }];
            if (sql.includes('WITH RECURSIVE')) return [{ edge_id: 'e1', from_node_id: 'n2', to_node_id: 'n1', kind: 'references', depth: 1 }];
            if (sql.includes('node_id = ANY')) return [{ node_id: 'n1', kind: 'module', node_key: 'src/foo.ts', path: 'src/foo.ts' }, { node_id: 'n2', kind: 'module', node_key: 'src/bar.ts', path: 'src/bar.ts' }];
            return [];
        }));
        const result = await service.impact('graph-consumer', { target: 'src/foo.ts', depth: 2 });
        assert.equal(result.status, 'ready');
        assert.equal(result.edges.length, 1);
        assert.equal(result.nodes.length, 2);
        assert.equal(result.capped, false);
    });

    it('rejects cross-project scope', async () => {
        const memory = await store();
        const service = new GraphImpactService(memory, scopedWith(() => []));
        await assert.rejects(service.impact('graph-consumer', { target: 'x', project: 'other' }), (error: any) => /project/.test(error.detail));
    });
});
