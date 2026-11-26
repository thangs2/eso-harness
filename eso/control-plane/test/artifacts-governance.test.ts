import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore, SqlitePlatformStore } from '../src/platform/registry/store.js';
import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { ArtifactLifecycleService } from '../src/modules/knowledge/artifact-lifecycle.service.js';
import { KnowledgeIndexService } from '../src/modules/knowledge/knowledge-index.service.js';

const servers: any[] = [];
const roots: string[] = [];

afterEach(async () => {
    for (const app of servers.splice(0)) await app.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'eso-art-test-'));
    roots.push(root);
    return root;
}

function consumerRecord(id: string, root: string) {
    const now = new Date().toISOString();
    return {
        id,
        name: id,
        root,
        sdlcRoot: null,
        schemaName: `c_${id}`,
        status: 'ready' as const,
        version: 1,
        storageMode: 'schema' as const,
        materializedHash: null,
        createdAt: now,
        updatedAt: now,
    };
}

describe('Slice 1 & Slice 2 — Artifacts & Knowledge Governance', () => {
    test('store: SQLite consumer_artifacts table handles save, get, list with filter, and updateState', async () => {
        const store = new SqlitePlatformStore();
        const cid = 'c1';

        const artifact = await store.saveArtifact({
            id: 'art-1',
            consumerId: cid,
            title: 'Design Spec',
            origin: 'agent',
            custodian: 'staging',
            ktState: 'proposed',
            liveness: 'living',
            derivedFrom: ['doc-1'],
            contentType: 'text/markdown',
            body: '# Design Spec Content',
            metadata: { author: 'worker-1' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        assert.equal(artifact.id, 'art-1');
        assert.equal(artifact.ktState, 'proposed');

        const fetched = await store.getArtifact(cid, 'art-1');
        assert.ok(fetched);
        assert.equal(fetched.title, 'Design Spec');
        assert.deepEqual(fetched.derivedFrom, ['doc-1']);
        assert.equal(fetched.metadata.author, 'worker-1');

        await store.saveArtifact({
            id: 'art-2',
            consumerId: cid,
            title: 'Host Rules',
            origin: 'host',
            custodian: 'host-local',
            ktState: 'raw',
            liveness: 'frozen',
            derivedFrom: [],
            contentType: 'text/plain',
            body: 'rule 1',
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        const listAll = await store.listArtifacts(cid);
        assert.equal(listAll.length, 2);

        const listHost = await store.listArtifacts(cid, { origin: 'host' });
        assert.equal(listHost.length, 1);
        assert.equal(listHost[0].id, 'art-2');

        const listProposed = await store.listArtifacts(cid, { ktState: 'proposed' });
        assert.equal(listProposed.length, 1);
        assert.equal(listProposed[0].id, 'art-1');

        const updated = await store.updateArtifactState(cid, 'art-1', 'approved');
        assert.ok(updated);
        assert.equal(updated.ktState, 'approved');

        const listApproved = await store.listArtifacts(cid, { ktState: 'approved' });
        assert.equal(listApproved.length, 1);
        assert.equal(listApproved[0].id, 'art-1');

        const summary = await store.knowledgeSummary(cid);
        assert.equal(summary.artifacts, 1);
    });

    test('lifecycle service: ingest, list, get, and promote update manifest', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        const cid = 'c2';
        await store.insertConsumer(consumerRecord(cid, root));

        // Create an existing knowledge-manifest.json in .harness
        mkdirSync(join(root, '.harness'), { recursive: true });
        writeFileSync(
            join(root, '.harness', 'knowledge-manifest.json'),
            JSON.stringify({ manifest_version: 1, consumer_id: cid, documents: [], artifacts: [] }, null, 2)
        );

        const service = new ArtifactLifecycleService(store);

        const ingested = await service.ingest(cid, {
            title: 'Refactor Proposal',
            origin: 'agent',
            body: 'Proposal description',
            metadata: { tag: 'refactor' },
        });

        assert.ok(ingested.id.startsWith('art-'));
        assert.equal(ingested.title, 'Refactor Proposal');
        assert.equal(ingested.ktState, 'proposed');

        const listed = await service.list(cid);
        assert.equal(listed.length, 1);

        const promoted = await service.promote(cid, ingested.id);
        assert.equal(promoted.ktState, 'approved');

        // Verify manifest was updated
        const manifest = JSON.parse(readFileSync(join(root, '.harness', 'knowledge-manifest.json'), 'utf8'));
        assert.equal(manifest.artifacts.length, 1);
        assert.equal(manifest.artifacts[0].id, ingested.id);
        assert.equal(manifest.artifacts[0].kt_state, 'approved');
    });

    test('knowledge index service: includes approved artifacts in summary and manifest', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        const cid = 'c3';
        await store.insertConsumer(consumerRecord(cid, root));

        // Create a doc in root
        writeFileSync(join(root, 'readme.md'), '# Readme\nThis is a doc.');

        // Save one approved and one proposed artifact
        await store.saveArtifact({
            id: 'art-appr',
            consumerId: cid,
            title: 'Approved Guide',
            origin: 'agent',
            custodian: 'staging',
            ktState: 'approved',
            liveness: 'living',
            derivedFrom: [],
            contentType: 'text/markdown',
            body: '# Approved Guide',
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        await store.saveArtifact({
            id: 'art-prop',
            consumerId: cid,
            title: 'Proposed Guide',
            origin: 'agent',
            custodian: 'staging',
            ktState: 'proposed',
            liveness: 'living',
            derivedFrom: [],
            contentType: 'text/markdown',
            body: '# Proposed Guide',
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        const indexer = new KnowledgeIndexService(store);
        const result = await indexer.index(cid);

        assert.equal(result.artifacts, 1);

        // Verify knowledge-manifest.json has approved artifact
        const manifest = JSON.parse(readFileSync(join(root, '.harness', 'knowledge-manifest.json'), 'utf8'));
        assert.equal(manifest.artifacts.length, 1);
        assert.equal(manifest.artifacts[0].id, 'art-appr');
    });

    test('HTTP server: endpoints ingest, list, promote, and get artifact', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        const cid = 'c4';
        await store.insertConsumer(consumerRecord(cid, root));

        const auth = new AuthService({
            user: 'operator',
            password: 'secret',
            token: 'token',
        });

        const app = await createPlatformServer({ store, auth });
        await app.listen({ port: 0, host: '127.0.0.1' });
        servers.push(app);
        const address = app.server.address() as any;
        const base = `http://127.0.0.1:${address.port}`;
        const headers = {
            'content-type': 'application/json',
            authorization: 'Bearer token',
        };

        // 1. Ingest
        const ingestRes = await fetch(`${base}/api/v1/consumers/${cid}/artifacts`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                title: 'Architecture Review',
                origin: 'agent',
                custodian: 'staging',
                body: 'Review text',
                metadata: { priority: 'high' },
            }),
        });

        assert.equal(ingestRes.status, 201);
        const ingested = await ingestRes.json() as any;
        assert.equal(ingested.title, 'Architecture Review');
        assert.equal(ingested.ktState, 'proposed');
        const artId = ingested.id;

        // 2. List
        const listRes = await fetch(`${base}/api/v1/consumers/${cid}/artifacts?ktState=proposed`, {
            method: 'GET',
            headers,
        });
        assert.equal(listRes.status, 200);
        const listBody = await listRes.json() as any[];
        assert.equal(listBody.length, 1);
        assert.equal(listBody[0].id, artId);

        // 3. Get single
        const getRes = await fetch(`${base}/api/v1/consumers/${cid}/artifacts/${artId}`, {
            method: 'GET',
            headers,
        });
        assert.equal(getRes.status, 200);
        const singleBody = await getRes.json() as any;
        assert.equal(singleBody.id, artId);

        // 4. Promote
        const promoteRes = await fetch(`${base}/api/v1/consumers/${cid}/artifacts/${artId}/promote`, {
            method: 'POST',
            headers: { authorization: 'Bearer token' },
        });
        assert.equal(promoteRes.status, 200);
        const promotedBody = await promoteRes.json() as any;
        assert.equal(promotedBody.ktState, 'approved');

        // 5. Get non-existent
        const notFoundRes = await fetch(`${base}/api/v1/consumers/${cid}/artifacts/non-existent`, {
            method: 'GET',
            headers,
        });
        assert.equal(notFoundRes.status, 404);
    });
});
