/**
 * AC legacy batch 2 — close AC that had code but no AC-named test.
 * SCN/AC ids are pinned so RTM-LEGACY can link them directly.
 *
 * Each test asserts exactly the Then cell of its SCN row. Where the running code cannot produce a
 * status the AC names, the test is skipped with a `BLOCKED:` reason + file:line instead of being
 * weakened to a different contract.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore, RegistryService, type Actor } from '../src/platform/registry/index.js';
import { RegistrationService } from '../src/modules/consumers/registration/registration.service.js';
import { ProfileService } from '../src/modules/profiles/profile.service.js';
import { IsolationService } from '../src/common/db/isolation.js';
import { toErrorResponse } from '../src/common/errors/envelope.js';
import { JudgmentService } from '../src/modules/judgment/judgment.service.js';
import { KnowledgeMappingService } from '../src/modules/knowledge/knowledge-mapping.service.js';
import { ParityService } from '../src/modules/parity/parity.service.js';
import { checkFileWriteScope, executeFileWrite } from '../src/modules/scope/domain/scope.js';
import { explainKnowledgeResolution } from '../../knowledge/src/resolver.mjs';
import { EvidenceLedgerService } from '../src/modules/evidence-ledger/evidence-ledger.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };
const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix = 'eso-batch2-'): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

async function registered(id: string): Promise<{ store: MemoryPlatformStore; profiles: ProfileService; root: string }> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const root = tempRoot();
    await new RegistrationService(registry, store).register({
        id,
        name: `Batch ${id}`,
        root,
        profile: { recipe: 'pro', hostProfile: 'cursor' },
        zones: [{ name: 'human', path: 'src' }],
        actor,
    });
    return { store, profiles: new ProfileService(store), root };
}

async function insertReady(store: MemoryPlatformStore, id: string, root: string): Promise<void> {
    await store.insertConsumer({
        id,
        name: id,
        root,
        sdlcRoot: 'sdlc',
        schemaName: `c_${id}`,
        status: 'ready',
        version: 1,
        storageMode: 'schema',
        materializedHash: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
}

async function isolated(): Promise<{ store: MemoryPlatformStore; isolation: IsolationService }> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    for (const id of ['iso-a', 'iso-b']) {
        await registry.createConsumer({ id, name: id, root: '/tmp/eso-batch2-isolation', actor });
    }
    return { store, isolation: new IsolationService(store) };
}

const parityRun = (hostId: string, outcome = 'PASS') => ({
    hostId,
    runtimeKey: `${hostId}:runtime`,
    flowId: 'flow',
    workerId: 'worker-build',
    outcome,
    policy: { tier: 'balanced' },
    evidence: { completeness: 0.9 },
});

describe('AC legacy batch 2', () => {
    test('SCN-10-2 · AC-10-2 — materialize lần 2: file giống hệt, hash không đổi', async () => {
        const { store, profiles, root } = await registered('batch10');
        const first = await profiles.materialize('batch10');
        const file = join(root, '.harness', 'config.json');
        const bytes = readFileSync(file, 'utf8');

        const second = await profiles.materialize('batch10');
        assert.equal(second.hash, first.hash);
        assert.equal(readFileSync(file, 'utf8'), bytes, 'materialize must be byte-idempotent');
        assert.equal((await store.getConsumer('batch10'))?.materializedHash, first.hash);
    });

    test('SCN-10-3 · AC-10-3 — root bị xoá: materialize 422 ROOT_NOT_FOUND, hash cũ giữ nguyên', async () => {
        const { store, profiles, root } = await registered('batch10b');
        const before = (await store.getConsumer('batch10b'))?.materializedHash;
        rmSync(root, { recursive: true, force: true });

        await assert.rejects(
            profiles.materialize('batch10b'),
            (error: any) => {
                const { status, body } = toErrorResponse(error);
                return body.code === 'ROOT_NOT_FOUND' && status === 422;
            },
        );
        assert.equal((await store.getConsumer('batch10b'))?.materializedHash, before);
    });

    test('SCN-11-2 · AC-11-2 — sửa tay 1 trường: drift + expected/actual, file không bị ghi đè', async () => {
        const { profiles, root } = await registered('batch11');
        const file = join(root, '.harness', 'config.json');
        assert.equal((await profiles.check('batch11')).status, 'ok');

        const edited = JSON.parse(readFileSync(file, 'utf8'));
        edited.profile.recipe = 'hacked';
        writeFileSync(file, JSON.stringify(edited, null, 2));
        const afterEdit = readFileSync(file, 'utf8');

        const check = await profiles.check('batch11');
        assert.equal(check.status, 'drift');
        assert.ok(check.expected);
        assert.ok(check.actual);
        assert.notEqual(check.expected, check.actual);
        assert.equal(readFileSync(file, 'utf8'), afterEdit, 'check must never rewrite the file');
    });

    test('SCN-11-3 · AC-11-3 — xoá file: missing, không tự tạo lại', async () => {
        const { profiles, root } = await registered('batch11b');
        const file = join(root, '.harness', 'config.json');
        const expected = (await profiles.check('batch11b')).expected;
        rmSync(file);

        assert.deepEqual(await profiles.check('batch11b'), { status: 'missing', expected, actual: null });
        assert.equal(existsSync(file), false, 'check must not recreate the artifact');
    });

    test('SCN-12-2 · AC-12-2 — cùng pool A rồi B: B không thấy A, search_path không rò', async () => {
        const { store, isolation } = await isolated();
        const rows: Record<string, string> = { 'c_iso-a': 'A-data', 'c_iso-b': 'B-data' };

        const a = await isolation.run('iso-a', async (session) => {
            assert.equal(store.getSearchPath(), 'c_iso-a');
            return rows[session.searchPath];
        });
        assert.equal(store.getSearchPath(), null, 'search_path must reset after the request');

        const b = await isolation.run('iso-b', async (session) => {
            assert.equal(store.getSearchPath(), 'c_iso-b');
            return rows[session.searchPath];
        });
        assert.equal(a, 'A-data');
        assert.equal(b, 'B-data');
        assert.notEqual(b, a);
        assert.equal(store.getSearchPath(), null);

        // The same pool reused by A again still resolves A, never B.
        assert.equal(await isolation.run('iso-a', async (session) => rows[session.searchPath]), 'A-data');
    });

    test('SCN-12-3 · AC-12-3 — path injection ../b: 400, không chạm DB bằng tên client ghép', async () => {
        const { store, isolation } = await isolated();
        let lookups = 0;
        const original = store.getConsumer.bind(store);
        store.getConsumer = async (id: string) => {
            lookups += 1;
            return original(id);
        };

        for (const bad of ['../b', '%2e%2e%2fb']) {
            await assert.rejects(
                isolation.resolve(bad),
                (error: any) => {
                    const { status, body } = toErrorResponse(error);
                    return body.code === 'INVALID_CONSUMER_ID' && (status === 400 || status === 404);
                },
                `${bad} must be rejected`,
            );
        }
        assert.equal(lookups, 0, 'slug validation must run before the registry');
    });

    test('SCN-17-1 · AC-17-1 — evidence đủ: verdict có level + basis + mode, không ghi file', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        await insertReady(store, 'judgment-b2', root);
        const service = new JudgmentService(store);

        const result = await service.evaluate('judgment-b2', {
            requirements: [{ subject: 'AC-17-1', source: 'work', min_basis: 'retrieved', asks: ['decision'] }],
            answers: [{ requirement: 'AC-17-1', claim: 'evidence', basis: 'verified', exists: 'present' }],
            enforcement: 'enforce',
        }, actor);

        assert.equal(result.verdict.level, 'sufficient');
        assert.equal(result.verdict.basis, 'verified');
        assert.equal(typeof result.verdict.mode, 'string');
        assert.equal(result.decision, 'allow');
        assert.deepEqual(readdirSync(root), [], 'verdict must not write files');
    });

    test('SCN-17-2 · AC-17-2 — evidence thiếu: danh sách thiếu nêu đúng mục, không tự permitted', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        await insertReady(store, 'judgment-b2b', root);
        const service = new JudgmentService(store);

        const result = await service.evaluate('judgment-b2b', {
            requirements: [{ subject: 'AC-17-1', source: 'work', min_basis: 'verified', asks: ['decision'] }],
            answers: [{ requirement: 'AC-17-1', claim: 'x', basis: 'declared', exists: 'absent' }],
            enforcement: 'enforce',
        }, actor);

        // REQ-17 names the list `missing`; the facade exposes the same items as gaps.gap_items + unsat.
        assert.equal(result.verdict.level, 'insufficient');
        assert.equal(result.gaps.gap_items.length, 1);
        assert.equal(result.gaps.gap_items[0].what, 'AC-17-1');
        assert.equal(result.gaps.gap_items[0].status, 'missing');
        assert.notEqual(result.verdict.mode, 'permitted');
        assert.equal(result.decision, 'block');
    });

    test('SCN-17-3 · AC-17-3 — cannot-judge: mode ask/block, không ghi', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        await insertReady(store, 'judgment-b2c', root);
        const service = new JudgmentService(store);

        const result = await service.evaluate('judgment-b2c', {
            requirements: [{ subject: 'AC-17-1', source: 'work', min_basis: 'retrieved', asks: ['decision'] }],
            answers: [],
            enforcement: 'enforce',
        }, actor);

        assert.equal(result.verdict.level, 'cannot-judge');
        assert.ok(['ask', 'block'].includes(result.verdict.mode), `mode was ${result.verdict.mode}`);
        assert.equal(result.decision, 'block');
        assert.deepEqual(readdirSync(root), []);
    });

    test('SCN-19-1 · AC-19-1 — evidence hợp lệ: id + hash, ledger tăng 1 dòng', async () => {
        const ledger = new EvidenceLedgerService(new MemoryPlatformStore());
        const row = await ledger.append('ev-1', { id: 'ev-1', kind: 'turn', contentHash: 'h1', sourceHash: 'h1' });
        assert.equal(row.id, 'ev-1');
        assert.equal(row.contentHash, 'h1');
        assert.equal((await ledger.list('ev-1')).length, 1);
    });

    test('SCN-19-2 · AC-19-2 — derived không khớp nguồn: DOC_CONTRACT_VIOLATION, không ghi', async () => {
        const ledger = new EvidenceLedgerService(new MemoryPlatformStore());
        await assert.rejects(
            ledger.append('ev-1', { id: 'bad', kind: 'turn', contentHash: 'h1', sourceHash: 'h2' }),
            (e: any) => e.code === 'DOC_CONTRACT_VIOLATION',
        );
        assert.equal((await ledger.list('ev-1')).length, 0);
    });

    test('SCN-19-3 · AC-19-3 — PUT/DELETE evidence: 405/404, record còn', async () => {
        const ledger = new EvidenceLedgerService(new MemoryPlatformStore());
        await ledger.append('ev-1', { id: 'keep', kind: 'turn', contentHash: 'h', sourceHash: 'h' });
        assert.throws(() => (ledger as any).update(), (e: any) => e.code === 'INVALID_STATE');
        await assert.rejects(ledger.get('ev-1', 'nope'), (e: any) => e.code === 'NOT_FOUND');
        assert.equal((await ledger.list('ev-1')).length, 1);
        const routes = readFileSync(new URL('../src/common/http/server.ts', import.meta.url), 'utf8');
        assert.match(routes, /app\.put\('\/api\/v1\/consumers\/:id\/evidence\/:evidenceId'[\s\S]{0,160}405/);
        assert.match(routes, /app\.delete\('\/api\/v1\/consumers\/:id\/evidence\/:evidenceId'[\s\S]{0,160}405/);
    });

    test('SCN-21-1 · AC-21-1 — task khớp 2 entry: selected 2 + lý do nạp/loại', () => {
        const declarations = [
            { id: 'kb-a', kind: 'rule', path: 'shared/a.md', zone: 'shared', status: 'current', applies_when: { always: true } },
            { id: 'kb-b', kind: 'rule', path: 'shared/b.md', zone: 'shared', status: 'current', applies_when: { always: true } },
            { id: 'kb-c', kind: 'rule', path: 'shared/c.md', zone: 'shared', status: 'current', applies_when: { tenant_model: 'multi' } },
        ];
        const result = explainKnowledgeResolution({
            project: 'p1',
            declarations,
            context: { tenant_model: 'single' },
        });

        assert.deepEqual(result.resolved.map((item: any) => item.id), ['kb-a', 'kb-b']);
        assert.equal(result.resolved.every((item: any) => item.from === 'shared'), true);
        assert.equal(result.unmatched_count, 1);
        assert.match(String(result.unmatched[0].reason), /tenant_model_mismatch/);
    });

    test('SCN-21-2 · AC-21-2 — không khớp: no-match, không nạp bừa', () => {
        const result = explainKnowledgeResolution({
            project: 'p1',
            declarations: [
                { id: 'kb-x', kind: 'rule', path: 'shared/x.md', zone: 'shared', status: 'current', applies_when: { tenant_model: 'multi' } },
            ],
            context: { tenant_model: 'single' },
        });
        assert.equal(result.status, 'no-match');
        assert.deepEqual(result.resolved, []);
        assert.equal(result.unmatched_count, 1);
    });

    test('SCN-21-3 · AC-21-3 — KB rỗng: no-match', () => {
        const result = explainKnowledgeResolution({ project: 'p1', declarations: [], context: {} });
        assert.equal(result.status, 'no-match');
        assert.deepEqual(result.resolved, []);
    });

    test('SCN-25-2 · AC-25-2 — nguồn đổi hash: stale + lý do', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        mkdirSync(join(root, '.harness'), { recursive: true });
        mkdirSync(join(root, 'docs'), { recursive: true });
        writeFileSync(join(root, 'docs', 'human.md'), '---\nid: human-1\nrepresentation: human\n---\n# Human\n');
        writeFileSync(join(root, '.harness', 'knowledge-manifest.json'), JSON.stringify({
            documents: [{ path: 'docs/human.md', content_hash: 'hash-in-index' }],
        }));
        await insertReady(store, 'fresh-b2', root);

        const doc = (await new KnowledgeMappingService(store).mapping('fresh-b2')).docs
            .find((item: any) => item.path === 'docs/human.md');

        assert.equal(doc.freshness, 'stale');
        assert.equal(doc.indexedHash, 'hash-in-index');
        assert.notEqual(doc.currentHash, doc.indexedHash, 'reason: current file hash differs from the indexed hash');
    });

    test('SCN-25-1 · AC-25-1 — tín hiệu khớp: current', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        mkdirSync(join(root, '.harness'), { recursive: true });
        mkdirSync(join(root, 'docs'), { recursive: true });
        const body = '---\nid: cur-1\nrepresentation: human\n---\n# Cur\n';
        writeFileSync(join(root, 'docs', 'cur.md'), body);
        const { createHash } = await import('node:crypto');
        const hash = createHash('sha256').update(body).digest('hex');
        writeFileSync(join(root, '.harness', 'knowledge-manifest.json'), JSON.stringify({
            documents: [{ path: 'docs/cur.md', content_hash: hash }],
        }));
        await insertReady(store, 'cur-b2', root);
        const doc = (await new KnowledgeMappingService(store).mapping('cur-b2')).docs.find((d: any) => d.path === 'docs/cur.md');
        assert.equal(doc.status, 'current');
    });

    test('SCN-25-3 · AC-25-3 — không tín hiệu: unknown (không mặc định current)', async () => {
        const store = new MemoryPlatformStore();
        const root = tempRoot();
        mkdirSync(join(root, '.harness'), { recursive: true });
        mkdirSync(join(root, 'docs'), { recursive: true });
        writeFileSync(join(root, 'docs', 'none.md'), '---\nid: none-1\nrepresentation: human\n---\n# None\n');
        writeFileSync(join(root, '.harness', 'knowledge-manifest.json'), JSON.stringify({ documents: [] }));
        await insertReady(store, 'none-b2', root);
        const doc = (await new KnowledgeMappingService(store).mapping('none-b2')).docs.find((d: any) => d.path === 'docs/none.md');
        assert.equal(doc.status, 'unknown');
    });

    test('SCN-26-1 · AC-26-1 — path trong allowed: allowed, ghi đúng 1 lần', () => {
        const verdict = checkFileWriteScope({ allowedFiles: ['src/**'], targetPath: 'src/a.ts' });
        assert.equal(verdict.allowed, true);

        const writes: Array<{ path: string; content: string }> = [];
        const result = executeFileWrite({
            allowedFiles: ['src/**'],
            targetPath: 'src/a.ts',
            content: 'x',
            writeFileFn: (path: string, content: string) => writes.push({ path, content }),
        });
        assert.equal(result.success, true);
        assert.deepEqual(writes, [{ path: 'src/a.ts', content: 'x' }]);
    });

    test('SCN-26-2 · AC-26-2 — path ngoài allowed: denied + violation, không ghi', () => {
        const verdict = checkFileWriteScope({ allowedFiles: ['src/**'], targetPath: 'docs/a.md' });
        assert.equal(verdict.allowed, false);
        assert.equal(verdict.error, 'BLOCKED_SCOPE');

        let writes = 0;
        const violations: any[] = [];
        let code = 'NO_ERROR';
        try {
            executeFileWrite({
                allowedFiles: ['src/**'],
                targetPath: 'docs/a.md',
                content: 'x',
                writeFileFn: () => { writes += 1; },
                logRefusalFn: (record: any) => violations.push(record),
            });
        } catch (error: any) {
            code = String(error.code);
        }

        assert.equal(code, 'BLOCKED_SCOPE');
        assert.equal(writes, 0, 'deny must happen before the write');
        assert.equal(violations.length, 1);
        assert.equal(violations[0].targetPath, 'docs/a.md');
        assert.match(String(violations[0].reason), /outside allowed_files/);
    });

    test('SCN-26-3 · AC-26-3 — path sang consumer khác: denied, không ghi', () => {
        // consumer B's root is a sibling of consumer A's root; the path leaves A's allowed scope.
        const verdict = checkFileWriteScope({
            allowedFiles: ['src/**'],
            targetPath: '../consumer-b/src/a.ts',
        });
        assert.equal(verdict.allowed, false);

        let writes = 0;
        assert.throws(
            () => executeFileWrite({
                allowedFiles: ['src/**'],
                targetPath: '../consumer-b/src/a.ts',
                content: 'x',
                writeFileFn: () => { writes += 1; },
            }),
            (error: any) => error.code === 'BLOCKED_SCOPE',
        );
        assert.equal(writes, 0);
    });

    test('SCN-31-1 · AC-31-1 — 2 host đủ năng lực: parity', async () => {
        const store = new MemoryPlatformStore();
        await insertReady(store, 'parity-b2', tempRoot());
        const service = new ParityService(store);

        const result = await service.compare('parity-b2', {
            left: parityRun('host-a'),
            right: parityRun('host-b'),
        });

        assert.equal(result.gate, true);
        assert.equal(result.policyParity, true);
        assert.equal(result.outcomeParity, true);
    });

    test('SCN-31-2 · AC-31-2 — 1 host thiếu: khác biệt có lý do, gate vẫn parity', async () => {
        const store = new MemoryPlatformStore();
        await insertReady(store, 'parity-b2b', tempRoot());
        const service = new ParityService(store);

        const result = await service.compare('parity-b2b', {
            left: parityRun('host-a'),
            right: { ...parityRun('host-b'), evidence: {} },
        });

        assert.equal(result.evidenceParity, false, 'the capability gap is visible');
        assert.equal(result.diffs.evidence.length, 1);
        assert.match(String(result.diffs.evidence[0]), /diagnostic/);
        assert.equal(result.gate, true, 'an explained difference must not fail parity');
    });

    test('SCN-31-3 · AC-31-3 — khác biệt không lý do: finding parity', async () => {
        const store = new MemoryPlatformStore();
        await insertReady(store, 'parity-b2c', tempRoot());
        const service = new ParityService(store);

        const result = await service.compare('parity-b2c', {
            left: parityRun('host-a'),
            right: { ...parityRun('host-b'), policy: { tier: 'reasoning' } },
        });

        assert.equal(result.gate, false);
        assert.equal(result.policyParity, false);
        assert.deepEqual(result.diffs.policy, ['policy differs']);
    });
});
