import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';

class InMemoryKnowledgeStore extends MemoryPlatformStore {
    private readonly docsByConsumer = new Map<string, any[]>();

    override async replaceKnowledgeIndex(consumerId: string, payload: any): Promise<void> {
        const docs = Array.isArray(payload?.docs)
            ? payload.docs.map((d: any) => ({
                  doc_id: d.docId,
                  path: d.path,
                  content_hash: d.contentHash,
                  title: d.title ?? null,
              }))
            : [];
        this.docsByConsumer.set(consumerId, docs);
    }

    override async knowledgeDocs(consumerId: string, _query?: string, limit = 500): Promise<any[]> {
        return (this.docsByConsumer.get(consumerId) ?? []).slice(0, limit);
    }
}
import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { ArtifactLifecycleService } from '../src/modules/knowledge/artifact-lifecycle.service.js';
import { KnowledgeIndexService, listIndexableMarkdownFiles } from '../src/modules/knowledge/knowledge-index.service.js';
import { ReconciliationScannerService } from '../src/modules/knowledge/reconciliation-scanner.service.js';

const servers: any[] = [];
const roots: string[] = [];

afterEach(async () => {
    for (const app of servers.splice(0)) await app.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'eso-recon-test-'));
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

function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

function seedFixtureWorkspace(root: string): void {
    // SDLC docs covering one route, one schema, one linked spike
    mkdirSync(join(root, 'sdlc', '06.analysis', '02.ac'), { recursive: true });
    mkdirSync(join(root, 'sdlc', '07.technical', '02.data-design'), { recursive: true });
    mkdirSync(join(root, 'sdlc', '03.inception', '02.decision-log'), { recursive: true });

    const acDoc = '# API Spec\nDocuments `/api/v1/orders/list`.\n';
    writeFileSync(join(root, 'sdlc', '06.analysis', '02.ac', '01.orders.md'), acDoc);

    const ddDoc = '# Data Dictionary\nContains table `users`.\n';
    writeFileSync(join(root, 'sdlc', '07.technical', '02.data-design', '03.data-dictionary.md'), ddDoc);

    writeFileSync(
        join(root, 'sdlc', '03.inception', '02.decision-log', '01.cache.md'),
        '# Cache ADR\nReferences linked-spike.md.\n',
    );

    // Code routes: one documented (/api/v1/orders/list), noise routes (/health, /metrics), two undocumented
    mkdirSync(join(root, 'src', 'billing'), { recursive: true });
    writeFileSync(
        join(root, 'src', 'billing', 'routes.ts'),
        [
            'export function register(app: any) {',
            "  app.get('/health', () => ({ ok: true }));",
            "  app.get('/metrics', () => '');",
            "  app.get('/api/v1/orders/list', () => []);",
            "  app.post('/api/v1/billing/checkout', () => ({ ok: true }));",
            '}',
            'class BillingController {',
            "  @Delete('/api/v1/billing/refund')",
            '  refund() {}',
            '}',
        ].join('\n'),
    );

    // Ignored directory should never be scanned
    mkdirSync(join(root, 'src', 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(
        join(root, 'src', 'node_modules', 'pkg', 'index.ts'),
        "app.post('/api/v1/should-be-ignored', () => {});\n",
    );

    // Schemas: users (documented), _prisma_migrations (built-in noise), audit_logs, invoice_items, payment_records
    mkdirSync(join(root, 'db'), { recursive: true });
    writeFileSync(
        join(root, 'db', 'schema.prisma'),
        [
            'model users {',
            '  id String @id',
            '}',
            'model _prisma_migrations {',
            '  id String @id',
            '}',
            'model audit_logs {',
            '  id String @id',
            '}',
        ].join('\n'),
    );
    writeFileSync(
        join(root, 'db', 'init.sql'),
        [
            'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY);',
            'CREATE TABLE IF NOT EXISTS invoice_items (id TEXT PRIMARY KEY);',
        ].join('\n'),
    );
    writeFileSync(
        join(root, 'db', 'payment.entity.ts'),
        "@Entity('payment_records')\nexport class PaymentRecord {}\n",
    );

    // Artifacts spikes: one linked in sdlc, one unlinked
    mkdirSync(join(root, 'artifacts', 'spikes'), { recursive: true });
    writeFileSync(join(root, 'artifacts', 'spikes', 'linked-spike.md'), '# Linked\n');
    writeFileSync(join(root, 'artifacts', 'spikes', 'orphan-benchmark.md'), '# Benchmark\nLine 2\n');

    // Manifest with one valid hash and one stale hash
    mkdirSync(join(root, '.harness'), { recursive: true });
    writeFileSync(
        join(root, '.harness', 'knowledge-manifest.json'),
        JSON.stringify(
            {
                manifest_version: 1,
                documents: [
                    {
                        path: 'sdlc/06.analysis/02.ac/01.orders.md',
                        sha256: sha256(acDoc),
                    },
                    {
                        path: 'sdlc/07.technical/02.data-design/03.data-dictionary.md',
                        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
                    },
                ],
                artifacts: [],
            },
            null,
            2,
        ),
    );
}

describe('ReconciliationScannerService — Unified 3-Pillar Engine & Artifact Promotion', () => {
    test('detects GAP-A..E with canonical S8 API target, codeSnippet, noise filtering, and S1..S17 pipelineStages', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        const cid = 'recon-1';
        await store.insertConsumer(consumerRecord(cid, root));
        seedFixtureWorkspace(root);

        const scanner = new ReconciliationScannerService(store);
        const first = await scanner.scan(cid);

        assert.equal(first.consumerId, cid);
        assert.equal(first.scope, 'full');
        assert.equal(first.ignoredCount, 0);
        assert.ok(first.scannedAt);

        // Verify all 17 canonical SDLC stages S1..S17
        assert.equal(first.pipelineStages.length, 17);
        assert.equal(first.pipelineStages[0].stage, 'S1');
        assert.equal(first.pipelineStages[16].stage, 'S17');

        const s7 = first.pipelineStages.find((s) => s.stage === 'S7');
        assert.ok(s7 && s7.docCount === 1);
        const s3 = first.pipelineStages.find((s) => s.stage === 'S3');
        assert.ok(s3 && s3.status === 'missing' && s3.gapId);
        const s14 = first.pipelineStages.find((s) => s.stage === 'S14');
        assert.ok(s14 && s14.docCount > 0 && s14.status === 'drift');

        const gapA = first.gaps.filter((g) => g.type === 'GAP_A_ORPHAN_ROUTE');
        const gapB = first.gaps.filter((g) => g.type === 'GAP_B_UNFED_SCHEMA');
        const gapC = first.gaps.filter((g) => g.type === 'GAP_C_STALE_HASH');
        const gapD = first.gaps.filter((g) => g.type === 'GAP_D_UNLINKED_SPIKE');
        const gapE = first.gaps.filter((g) => g.type === 'GAP_E_MISSING_SDLC_DOC');

        // GAP-A: canonical target is sdlc/07.technical/03.api/<slug>.api.md
        assert.equal(gapA.length, 2);
        const checkoutGap = gapA.find((g) => g.symbol === 'POST /api/v1/billing/checkout');
        assert.ok(checkoutGap);
        assert.equal(checkoutGap.lines, '5-5');
        assert.ok(checkoutGap.codeSnippet && checkoutGap.codeSnippet.includes('/api/v1/billing/checkout'));
        assert.ok(checkoutGap.codeSnippet.split('\n').length <= 12);
        for (const g of gapA) {
            assert.equal(g.severity, 'critical');
            assert.equal(g.filePath, 'src/billing/routes.ts');
            assert.ok(g.suggestedTarget.startsWith('sdlc/07.technical/03.api/'));
            assert.ok(g.suggestedTarget.endsWith('.api.md'));
        }

        // GAP-B
        assert.equal(gapB.length, 3);
        assert.ok(gapB.some((g) => g.symbol === 'Schema audit_logs' && g.codeSnippet?.includes('model audit_logs')));

        // GAP-C
        assert.equal(gapC.length, 1);
        assert.equal(gapC[0].filePath, 'sdlc/07.technical/02.data-design/03.data-dictionary.md');

        // GAP-D
        assert.equal(gapD.length, 1);
        assert.equal(gapD[0].suggestedTarget, 'sdlc/03.inception/02.decision-log/orphan-benchmark.md');

        // GAP-E: S1..S13 minus covered S7 & S9 => 11 missing doc stages
        assert.equal(gapE.length, 11);
        const brdGap = gapE.find((g) => g.filePath === 'sdlc/05.requirements/01.specification/02.brd/');
        assert.ok(brdGap && brdGap.severity === 'critical' && brdGap.promptTemplate.includes('BA'));
        const problemGap = gapE.find((g) => g.filePath === 'sdlc/03.inception/00.problem/');
        assert.ok(problemGap && problemGap.severity === 'warning' && problemGap.promptTemplate.includes('PO'));

        // Deterministic IDs across rescans
        const second = await scanner.scan(cid);
        assert.deepEqual(
            second.gaps.map((g) => g.id),
            first.gaps.map((g) => g.id),
        );
    });

    test('detects GAP-F PostgreSQL index drift (unindexed, stale, ghost) and clears after syncIndex()', async () => {
        const store = new InMemoryKnowledgeStore();
        const root = tempRoot();
        const cid = 'recon-pg';
        await store.insertConsumer(consumerRecord(cid, root));
        seedFixtureWorkspace(root);

        const knowledgeIndex = new KnowledgeIndexService(store);
        const scanner = new ReconciliationScannerService(store, knowledgeIndex);

        // 1. Before indexing: all 5 indexable markdown docs (3 sdlc + 2 artifacts/spikes) are unindexed
        const before = await scanner.scan(cid);
        assert.equal(before.postgresStats.diskMarkdownCount, 5);
        assert.equal(before.postgresStats.indexedDocsCount, 0);
        assert.equal(before.postgresStats.unindexedCount, 5);
        assert.equal(before.postgresStats.staleDbCount, 0);
        assert.equal(before.postgresStats.ghostDbCount, 0);
        const unindexedGaps = before.gaps.filter((g) => g.type === 'GAP_F_INDEX_DRIFT');
        assert.equal(unindexedGaps.length, 5);
        assert.ok(unindexedGaps.every((g) => g.severity === 'warning'));

        // 2. syncIndex() indexes all docs into DB (3 sdlc + 2 artifacts/spikes = 5) and clears GAP-F
        const afterSync = await scanner.syncIndex(cid);
        assert.equal(afterSync.postgresStats.diskMarkdownCount, 5);
        assert.equal(afterSync.postgresStats.indexedDocsCount, 5);
        assert.equal(afterSync.postgresStats.unindexedCount, 0);
        assert.equal(afterSync.postgresStats.staleDbCount, 0);
        assert.equal(afterSync.postgresStats.ghostDbCount, 0);
        assert.equal(afterSync.gaps.filter((g) => g.type === 'GAP_F_INDEX_DRIFT').length, 0);

        // S7 & S9 should now be 'covered' (indexedCount === docCount)
        assert.equal(afterSync.pipelineStages.find((s) => s.stage === 'S7')?.status, 'covered');
        assert.equal(afterSync.pipelineStages.find((s) => s.stage === 'S9')?.status, 'covered');

        // 3. Mutate one doc on disk -> staleDbCount === 1 (critical)
        writeFileSync(
            join(root, 'sdlc', '06.analysis', '02.ac', '01.orders.md'),
            '# API Spec Updated\nDocuments `/api/v1/orders/list` and more.\n',
        );
        // Delete another doc on disk -> ghostDbCount === 1 (info)
        unlinkSync(join(root, 'sdlc', '03.inception', '02.decision-log', '01.cache.md'));

        const drifted = await scanner.scan(cid);
        assert.equal(drifted.postgresStats.staleDbCount, 1);
        assert.equal(drifted.postgresStats.ghostDbCount, 1);
        const pgGaps = drifted.gaps.filter((g) => g.type === 'GAP_F_INDEX_DRIFT');
        assert.ok(pgGaps.some((g) => g.severity === 'critical' && g.filePath === 'sdlc/06.analysis/02.ac/01.orders.md'));
        assert.ok(pgGaps.some((g) => g.severity === 'info' && g.filePath === 'sdlc/03.inception/02.decision-log/01.cache.md'));
    });

    test('ignoreGap persists to .harness/reconcile-ignore.json and excludes gap on subsequent scans', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        const cid = 'recon-ignore';
        await store.insertConsumer(consumerRecord(cid, root));
        seedFixtureWorkspace(root);

        const scanner = new ReconciliationScannerService(store);
        const initial = await scanner.scan(cid);
        const targetGap = initial.gaps.find((g) => g.symbol === 'POST /api/v1/billing/checkout');
        assert.ok(targetGap);

        const ignoreRes = await scanner.ignoreGap(cid, {
            gapId: targetGap.id,
            filePath: targetGap.filePath,
            symbol: targetGap.symbol,
            reason: 'Internal webhook route',
        });
        assert.equal(ignoreRes.ignored, true);
        assert.equal(ignoreRes.gapId, targetGap.id);
        assert.equal(ignoreRes.ignoredCount, 1);

        const ignoreFile = JSON.parse(readFileSync(join(root, '.harness', 'reconcile-ignore.json'), 'utf8'));
        assert.equal(ignoreFile.entries.length, 1);

        const cached = await scanner.getLastScan(cid);
        assert.equal(cached.gaps.some((g) => g.id === targetGap.id), false);

        const rescanned = await scanner.scan(cid);
        assert.equal(rescanned.gaps.some((g) => g.id === targetGap.id), false);
        assert.equal(rescanned.ignoredCount, 1);
        assert.equal(rescanned.gaps.length, initial.gaps.length - 1);
    });

    test('relockHash updates manifest SHA-256, resolves GAP-C, and blocks path traversal', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        const cid = 'recon-relock';
        await store.insertConsumer(consumerRecord(cid, root));
        seedFixtureWorkspace(root);

        const scanner = new ReconciliationScannerService(store);
        const initial = await scanner.scan(cid);
        const staleGap = initial.gaps.find((g) => g.type === 'GAP_C_STALE_HASH');
        assert.ok(staleGap);

        await assert.rejects(
            () => scanner.relockHash(cid, { gapId: staleGap.id, filePath: '../etc/passwd' }),
            (err: any) => err?.status === 400 && /safe relative path/i.test(String(err?.detail || '')),
        );
        await assert.rejects(
            () => scanner.relockHash(cid, { gapId: staleGap.id, filePath: '/etc/passwd' }),
            (err: any) => err?.status === 400 && /safe relative path/i.test(String(err?.detail || '')),
        );

        const relockRes = await scanner.relockHash(cid, {
            gapId: staleGap.id,
            filePath: staleGap.filePath,
        });
        assert.equal(relockRes.relocked, true);
        assert.equal(relockRes.sha256, sha256(readFileSync(join(root, staleGap.filePath), 'utf8')));

        const cached = await scanner.getLastScan(cid);
        assert.equal(cached.gaps.find((g) => g.id === staleGap.id)?.status, 'resolved');

        const rescanned = await scanner.scan(cid);
        assert.equal(rescanned.gaps.filter((g) => g.type === 'GAP_C_STALE_HASH').length, 0);
    });

    test('scope: git-diff restricts scan to changed/untracked files and falls back cleanly outside git', async () => {
        const store = new MemoryPlatformStore();
        const nonGitRoot = tempRoot();
        const cidNonGit = 'recon-nongit';
        await store.insertConsumer(consumerRecord(cidNonGit, nonGitRoot));
        seedFixtureWorkspace(nonGitRoot);

        const scanner = new ReconciliationScannerService(store);
        const fallback = await scanner.scan(cidNonGit, { scope: 'git-diff' });
        assert.equal(fallback.scope, 'full');
        assert.ok(fallback.gaps.length >= 7);

        const gitRoot = tempRoot();
        const cidGit = 'recon-git';
        await store.insertConsumer(consumerRecord(cidGit, gitRoot));
        seedFixtureWorkspace(gitRoot);

        execFileSync('git', ['init'], { cwd: gitRoot, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitRoot, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: gitRoot, stdio: 'ignore' });
        execFileSync('git', ['add', '.'], { cwd: gitRoot, stdio: 'ignore' });
        execFileSync('git', ['commit', '-m', 'baseline'], { cwd: gitRoot, stdio: 'ignore' });

        const cleanDiff = await scanner.scan(cidGit, { scope: 'git-diff' });
        assert.equal(cleanDiff.scope, 'git-diff');
        assert.equal(cleanDiff.gaps.length, 0);

        mkdirSync(join(gitRoot, 'src', 'newmod'), { recursive: true });
        writeFileSync(
            join(gitRoot, 'src', 'newmod', 'api.ts'),
            "app.post('/api/v1/newmod/trigger', () => ({ ok: true }));\n",
        );

        const diffScan = await scanner.scan(cidGit, { scope: 'git-diff' });
        assert.equal(diffScan.scope, 'git-diff');
        assert.equal(diffScan.gaps.length, 1);
        assert.equal(diffScan.gaps[0].symbol, 'POST /api/v1/newmod/trigger');
        assert.equal(diffScan.gaps[0].filePath, 'src/newmod/api.ts');
    });

    test('syncs gap status with proposed/approved artifacts and promotes reverse-extraction to disk + manifest', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        const cid = 'recon-2';
        await store.insertConsumer(consumerRecord(cid, root));
        seedFixtureWorkspace(root);

        const scanner = new ReconciliationScannerService(store);
        const lifecycle = new ArtifactLifecycleService(store);

        const initial = await scanner.scan(cid);
        const routeGap = initial.gaps.find(
            (g) => g.type === 'GAP_A_ORPHAN_ROUTE' && g.symbol === 'POST /api/v1/billing/checkout',
        );
        assert.ok(routeGap);

        const draftBody = '# Billing Checkout API\nEndpoint: `POST /api/v1/billing/checkout`\n';
        const staged = await lifecycle.ingest(cid, {
            title: `[Reconciled Draft] ${routeGap.symbol}`,
            origin: 'agent',
            ktState: 'proposed',
            body: draftBody,
            metadata: {
                originType: 'reverse-extraction',
                gapId: routeGap.id,
                suggestedTarget: routeGap.suggestedTarget,
            },
        });

        const afterStage = await scanner.getLastScan(cid);
        assert.equal(afterStage.gaps.find((g) => g.id === routeGap.id)?.status, 'staged_in_inbox');

        const promoted = await lifecycle.promote(cid, staged.id);
        assert.equal(promoted.ktState, 'approved');

        const targetAbs = join(root, routeGap.suggestedTarget);
        assert.equal(existsSync(targetAbs), true);
        assert.equal(readFileSync(targetAbs, 'utf8'), draftBody);

        const manifest = JSON.parse(readFileSync(join(root, '.harness', 'knowledge-manifest.json'), 'utf8'));
        const entry = manifest.artifacts.find((a: any) => a.id === staged.id);
        assert.ok(entry);
        assert.equal(entry.target_path, routeGap.suggestedTarget);
        assert.equal(entry.sha256, sha256(draftBody));

        const afterPromote = await scanner.getLastScan(cid);
        assert.equal(afterPromote.gaps.find((g) => g.id === routeGap.id)?.status, 'resolved');

        const malicious = await lifecycle.ingest(cid, {
            title: 'Bad target',
            origin: 'agent',
            ktState: 'proposed',
            body: 'pwned',
            metadata: {
                originType: 'reverse-extraction',
                suggestedTarget: '../escape.md',
            },
        });
        await lifecycle.promote(cid, malicious.id);
        assert.equal(existsSync(join(root, '..', 'escape.md')), false);
    });

    test('HTTP server: /reconciliation/scan, /gaps, /ignore, /relock, and /sync-index routes', async () => {
        const store = new InMemoryKnowledgeStore();
        const root = tempRoot();
        const cid = 'recon-http';
        await store.insertConsumer(consumerRecord(cid, root));
        seedFixtureWorkspace(root);

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
        const authHeaders = {
            authorization: 'Bearer token',
            'content-type': 'application/json',
        };

        // Unauthenticated rejected
        const unauthRes = await fetch(`${base}/api/v1/consumers/${cid}/reconciliation/gaps`);
        assert.equal(unauthRes.status, 401);

        // POST /scan
        const postRes = await fetch(`${base}/api/v1/consumers/${cid}/reconciliation/scan`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ scope: 'full' }),
        });
        assert.equal(postRes.status, 200);
        const scanBody = (await postRes.json()) as any;
        assert.equal(scanBody.consumerId, cid);
        assert.equal(scanBody.pipelineStages.length, 17);
        assert.equal(scanBody.postgresStats.unindexedCount, 5);

        // POST /sync-index
        const syncRes = await fetch(`${base}/api/v1/consumers/${cid}/reconciliation/sync-index`, {
            method: 'POST',
            headers: { authorization: 'Bearer token' },
        });
        assert.equal(syncRes.status, 200);
        const syncBody = (await syncRes.json()) as any;
        assert.equal(syncBody.postgresStats.indexedDocsCount, 5);
        assert.equal(syncBody.postgresStats.unindexedCount, 0);
        assert.equal(syncBody.gaps.filter((g: any) => g.type === 'GAP_F_INDEX_DRIFT').length, 0);

        // POST /ignore
        const routeGap = scanBody.gaps.find((g: any) => g.type === 'GAP_A_ORPHAN_ROUTE');
        const ignoreRes = await fetch(`${base}/api/v1/consumers/${cid}/reconciliation/ignore`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ gapId: routeGap.id, filePath: routeGap.filePath, symbol: routeGap.symbol }),
        });
        assert.equal(ignoreRes.status, 200);
        const ignoreBody = (await ignoreRes.json()) as any;
        assert.equal(ignoreBody.ignored, true);

        // POST /relock with path traversal -> 400
        const badRelock = await fetch(`${base}/api/v1/consumers/${cid}/reconciliation/relock`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ gapId: 'gap-test', filePath: '../outside.txt' }),
        });
        assert.equal(badRelock.status, 400);

        // Unknown consumer -> 404
        const missingRes = await fetch(`${base}/api/v1/consumers/does-not-exist/reconciliation/sync-index`, {
            method: 'POST',
            headers: { authorization: 'Bearer token' },
        });
        assert.equal(missingRes.status, 404);
    });

    test('FinESO uppercase SDLC/ layout, Bun routes, TS CREATE TABLE, *.schema.json, scratch/*.md, and 100% Disk<->PG parity', async () => {
        const store = new InMemoryKnowledgeStore();
        const root = tempRoot();
        const cid = 'fineso-layout';
        await store.insertConsumer(consumerRecord(cid, root));

        // Uppercase SDLC/ layout matching FinESO
        mkdirSync(join(root, 'SDLC', '01.inception'), { recursive: true });
        mkdirSync(join(root, 'SDLC', '02.requirements', '01.brd'), { recursive: true });
        mkdirSync(join(root, 'SDLC', '02.requirements', '02.prd'), { recursive: true });
        mkdirSync(join(root, 'SDLC', '02.requirements', '03.frd'), { recursive: true });
        mkdirSync(join(root, 'SDLC', '02.requirements', '04.srs'), { recursive: true });
        mkdirSync(join(root, 'SDLC', '03.analysis'), { recursive: true });
        mkdirSync(join(root, 'SDLC', '04.architecture'), { recursive: true });
        mkdirSync(join(root, 'SDLC', '08.wbs'), { recursive: true });
        mkdirSync(join(root, 'SDLC', '10.test'), { recursive: true });
        mkdirSync(join(root, 'documents'), { recursive: true });

        writeFileSync(join(root, 'SDLC', '01.inception', '01.vision-and-charter.md'), '# Vision & Charter\n');
        writeFileSync(join(root, 'SDLC', '01.inception', '02.pre-coding-gate.md'), '# Gate\n');
        writeFileSync(join(root, 'SDLC', '02.requirements', '01.brd', '01.brd.md'), '# BRD\n');
        writeFileSync(join(root, 'SDLC', '02.requirements', '02.prd', '01.prd.md'), '# PRD\n');
        writeFileSync(join(root, 'SDLC', '02.requirements', '03.frd', '01.frd.md'), '# FRD\n');
        writeFileSync(join(root, 'SDLC', '02.requirements', '04.srs', '01.srs.md'), '# SRS\n');
        writeFileSync(join(root, 'SDLC', '03.analysis', '01.user-stories.md'), '# US\n');
        writeFileSync(join(root, 'SDLC', '03.analysis', '02.acceptance-criteria.md'), '# AC\n');
        writeFileSync(join(root, 'SDLC', '04.architecture', '01.arch.md'), '# Arch\n');
        writeFileSync(join(root, 'SDLC', '08.wbs', '01.wbs.md'), '# WBS\n');
        writeFileSync(join(root, 'SDLC', '10.test', 'README.md'), '# Tests\n');
        writeFileSync(join(root, 'documents', 'api-notes.md'), 'Documents `/api/v1/documented-endpoint` and `documented.schema.json`.\n');

        // Bun/Web Fetch routes + test file that must be skipped
        mkdirSync(join(root, 'packages', 'fineso-server', 'src'), { recursive: true });
        mkdirSync(join(root, 'packages', 'fineso-server', 'test'), { recursive: true });
        writeFileSync(
            join(root, 'packages', 'fineso-server', 'src', 'server.ts'),
            [
                'export function handle(url: URL) {',
                "  if (url.pathname === '/api/v1/health') return 'ok';",
                "  if (url.pathname === '/api/v1/documented-endpoint') return 'ok';",
                "  if (url.pathname === '/api/v1/packs/run') return 'run';",
                "  if (url.pathname.startsWith('/api/v1/reports/')) return 'reports';",
                '}',
            ].join('\n'),
        );
        writeFileSync(
            join(root, 'packages', 'fineso-server', 'test', 'server.test.ts'),
            "if (url.pathname === '/api/v1/test-only-route') {}\n",
        );

        // CREATE TABLE inside regular .ts file + JSON schemas under **/schema/*.schema.json
        mkdirSync(join(root, 'packages', 'fineso-decision', 'src', 'jev'), { recursive: true });
        writeFileSync(
            join(root, 'packages', 'fineso-decision', 'src', 'jev', 'ledger.ts'),
            'const SQL = `CREATE TABLE IF NOT EXISTS decision_ledger (id TEXT PRIMARY KEY)`;\n',
        );
        mkdirSync(join(root, 'packages', 'fineso-core', 'schema'), { recursive: true });
        writeFileSync(join(root, 'packages', 'fineso-core', 'schema', 'evidence-pack.schema.json'), '{"type":"object"}\n');
        writeFileSync(join(root, 'packages', 'fineso-core', 'schema', 'documented.schema.json'), '{"type":"object"}\n');

        // Unlinked spike under scratch/
        mkdirSync(join(root, 'scratch'), { recursive: true });
        writeFileSync(join(root, 'scratch', 'perf-notes.md'), '# Scratch perf notes\n');

        const knowledgeIndex = new KnowledgeIndexService(store);
        const scanner = new ReconciliationScannerService(store, knowledgeIndex);

        // Sync Postgres index first -> 100% parity with listIndexableMarkdownFiles
        const synced = await scanner.syncIndex(cid);
        const expectedIndexable = listIndexableMarkdownFiles(root);
        assert.equal(synced.postgresStats.diskMarkdownCount, expectedIndexable.length);
        assert.equal(synced.postgresStats.indexedDocsCount, expectedIndexable.length);
        assert.equal(synced.postgresStats.unindexedCount, 0);
        assert.equal(synced.postgresStats.staleDbCount, 0);
        assert.equal(synced.postgresStats.ghostDbCount, 0);
        assert.equal(synced.gaps.filter((g) => g.type === 'GAP_F_INDEX_DRIFT').length, 0);

        // Uppercase SDLC/ stages S1..S7, S10, S11, S15 are all green 'covered' with true disk casing!
        for (const st of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S10', 'S11', 'S15']) {
            const stageObj = synced.pipelineStages.find((s) => s.stage === st);
            assert.ok(stageObj, `Missing stage ${st}`);
            assert.equal(stageObj.status, 'covered', `Expected ${st} to be covered, got ${stageObj.status}`);
            assert.ok(stageObj.expectedFolder.startsWith('SDLC/'), `Expected uppercase SDLC/ for ${st}, got ${stageObj.expectedFolder}`);
        }

        // GAP-A: detects Bun routes (/api/v1/packs/run, /api/v1/reports/), ignores /health, documented-endpoint, and test/
        const gapA = synced.gaps.filter((g) => g.type === 'GAP_A_ORPHAN_ROUTE');
        assert.equal(gapA.length, 2);
        assert.ok(gapA.some((g) => g.symbol === 'HTTP /api/v1/packs/run'));
        assert.ok(gapA.some((g) => g.symbol === 'HTTP /api/v1/reports/'));

        // GAP-B: detects decision_ledger from .ts and evidence-pack.schema.json (ignores documented.schema.json)
        const gapB = synced.gaps.filter((g) => g.type === 'GAP_B_UNFED_SCHEMA');
        assert.ok(gapB.some((g) => g.symbol === 'Schema decision_ledger' && g.filePath === 'packages/fineso-decision/src/jev/ledger.ts'));
        assert.ok(gapB.some((g) => g.symbol === 'Schema evidence-pack.schema.json'));
        assert.equal(gapB.some((g) => g.symbol === 'Schema documented.schema.json'), false);

        // GAP-D: detects scratch/perf-notes.md
        const gapD = synced.gaps.filter((g) => g.type === 'GAP_D_UNLINKED_SPIKE');
        assert.ok(gapD.some((g) => g.filePath === 'scratch/perf-notes.md'));
    });
});
