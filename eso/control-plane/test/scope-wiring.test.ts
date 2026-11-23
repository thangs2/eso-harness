/**
 * P6/P4 wiring — per-actor role sufficiency in the verdict + scope enforced on the worker write path.
 *
 * P4: a role whose bar evidence is insufficient must never leave a `sufficient` verdict standing,
 *     and the gap entry must name the role deficits.
 * P6: `POST /consumers/:id/scope/check` and the worker write path share ONE domain guard, so a
 *     refusal leaves no partial disk change and the route returns the same codes.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { JudgmentService } from '../src/modules/judgment/judgment.service.js';
import { WorkerPolicyService } from '../src/modules/workers/worker-policy.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function tempRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

async function consumerFixture(id: string, prefix: string): Promise<{ store: MemoryPlatformStore; root: string }> {
    const store = new MemoryPlatformStore();
    const root = tempRoot(prefix);
    const now = new Date().toISOString();
    await store.insertConsumer({
        id, name: id, root, sdlcRoot: 'sdlc', schemaName: `c_${id.replace(/[^a-z0-9]/g, '_')}`,
        status: 'ready', version: 1, storageMode: 'schema', materializedHash: null,
        createdAt: now, updatedAt: now,
    });
    return { store, root };
}

const operator = { kind: 'operator' as const, label: 'operator@test' };
const requirement = { subject: 'AC-1', source: 'work', min_basis: 'retrieved', asks: ['decision'] };
const sufficientAnswer = [{ requirement: 'AC-1', claim: 'evidence', basis: 'verified', exists: 'present' }];

function role(name: string, evidenceKind: string, minBasis: string) {
    return { name, bar: [{ evidence_kind: evidenceKind, min_basis: minBasis }] };
}

describe('P4 — per-actor role sufficiency in the verdict', () => {
    test('role evidence sufficient ⇒ verdict unchanged and role_sufficiency present', async () => {
        const { store } = await consumerFixture('judgment-role-ok', 'eso-p4-ok-');
        const service = new JudgmentService(store);
        const result = await service.evaluate('judgment-role-ok', {
            requirements: [requirement],
            answers: sufficientAnswer,
            actor: { kind: 'machine', label: 'peer@test', role: role('peer', 'test_pass', 'partial') },
            roleEvidence: [{ kind: 'test_pass', basis: 'partial' }],
            enforcement: 'enforce',
        }, operator);

        assert.equal(result.role_sufficiency?.level, 'SUFFICIENT');
        assert.deepEqual(result.role_sufficiency?.deficits, []);
        assert.equal(result.verdict.level, 'sufficient');
        assert.equal(result.decision, 'allow');
        assert.equal(result.gaps.gap_items.length, 0);
    });

    test('role evidence insufficient ⇒ never sufficient + gap names the deficits', async () => {
        const { store } = await consumerFixture('judgment-role-bad', 'eso-p4-bad-');
        const service = new JudgmentService(store);
        const result = await service.evaluate('judgment-role-bad', {
            requirements: [requirement],
            answers: sufficientAnswer,
            actor: { kind: 'machine', label: 'lead@test', role: role('lead', 'test_pass', 'strict') },
            roleEvidence: [{ kind: 'test_pass', basis: 'partial' }],
            enforcement: 'enforce',
        }, operator);

        assert.notEqual(result.verdict.level, 'sufficient');
        assert.equal(result.verdict.level, 'insufficient');
        assert.equal(result.decision, 'block');
        assert.equal(result.wouldBlock, true);

        assert.equal(result.role_sufficiency?.level, 'INSUFFICIENT');
        assert.equal(result.role_sufficiency?.deficits?.[0]?.reason, 'INSUFFICIENT_BASIS');
        assert.equal(result.role_sufficiency?.deficits?.[0]?.required_basis, 'strict');

        const rawGap = result.verdict.gaps.find((gap: any) => gap.code === 'ROLE_INSUFFICIENT');
        assert.ok(rawGap, 'a role gap entry must be present');
        assert.equal(rawGap.source, 'bar');
        assert.equal(rawGap.deficits?.[0]?.evidence_kind, 'test_pass');

        const formatted = result.gaps.gap_items.find((gap: any) => String(gap.what).startsWith('role:'));
        assert.ok(formatted, 'the formatted gap report must name the role');
        assert.match(String(formatted.where_hint), /role bar/);
    });

    test('explicit actor without role ⇒ UNKNOWN_ACTOR gap (identity is said out loud)', async () => {
        const { store } = await consumerFixture('judgment-role-missing', 'eso-p4-missing-');
        const service = new JudgmentService(store);
        const result = await service.evaluate('judgment-role-missing', {
            requirements: [requirement],
            answers: sufficientAnswer,
            actor: { kind: 'machine', label: 'unnamed@test' },
            enforcement: 'enforce',
        }, operator);

        assert.equal(result.role_sufficiency?.code, 'UNKNOWN_ACTOR');
        assert.notEqual(result.verdict.level, 'sufficient');
        assert.ok(result.verdict.gaps.some((gap: any) => gap.code === 'UNKNOWN_ACTOR'));
    });

    test('no actor ⇒ backwards compatible verdict, no role block', async () => {
        const { store } = await consumerFixture('judgment-no-actor', 'eso-p4-none-');
        const service = new JudgmentService(store);
        const result = await service.evaluate('judgment-no-actor', {
            requirements: [requirement],
            answers: sufficientAnswer,
            enforcement: 'enforce',
        }, operator);

        assert.equal(result.role_sufficiency, null);
        assert.equal(result.verdict.level, 'sufficient');
        assert.equal(result.decision, 'allow');
    });
});

describe('P6 — scope refused before the worker write touches disk', () => {
    function stubbedStore(root: string, scope: string): any {
        return {
            getConsumer: async () => ({ id: 'c-worker-scope', root, status: 'ready' }),
            knowledgeWorker: async () => ({
                id: 'worker-a', name: 'Worker A', role: 'dev', layer: 'peer',
                scope, status: 'active', verbs: ['write'], bar: [],
            }),
            recordWorkerEvent: async () => {},
        };
    }

    test('allowed target writes; refused target leaves the previous bytes untouched', async () => {
        const root = tempRoot('eso-p6-write-');
        mkdirSync(join(root, 'src'), { recursive: true });
        mkdirSync(join(root, 'nested', 'src'), { recursive: true });
        // The policy check accepts `nested/src/...` (segment match) but the domain scope `src/**`
        // does not: the write must therefore never land.
        const target = join(root, 'nested', 'src', 'escape.ts');
        writeFileSync(target, 'original', 'utf8');

        const service = new WorkerPolicyService(stubbedStore(root, 'src'));

        const allowed = await service.write('c-worker-scope', 'worker-a', { path: 'src/app.ts', content: 'export const x = 1;' });
        assert.equal(allowed.decision, 'ALLOW');
        assert.equal(allowed.written, true);
        assert.equal(readFileSync(join(root, 'src', 'app.ts'), 'utf8'), 'export const x = 1;');

        const refused = await service.write('c-worker-scope', 'worker-a', { path: 'nested/src/escape.ts', content: 'hacked' });
        assert.equal(refused.decision, 'DENY');
        assert.ok(refused.reasons.includes('BLOCKED_SCOPE'), `expected BLOCKED_SCOPE in ${refused.reasons}`);
        assert.equal(refused.code, 'BLOCKED_SCOPE');
        assert.equal(existsSync(join(root, 'nested', 'src', 'escape.ts')), true);
        assert.equal(readFileSync(target, 'utf8'), 'original', 'refusal must not change disk');
        assert.equal(existsSync(join(root, 'nested', 'src', 'escape.ts.tmp')), false);
    });
});

describe('P6 — POST /consumers/:id/scope/check returns the domain codes', () => {
    test('allowed, BLOCKED_SCOPE, EMPTY_SCOPE, DANGLING_SCOPE', async () => {
        const { store, root } = await consumerFixture('scope-route', 'eso-p6-route-');
        mkdirSync(join(root, 'src'), { recursive: true });
        mkdirSync(join(root, 'docs'), { recursive: true });

        const app = await createPlatformServer({
            store,
            auth: new AuthService({ user: 'operator', password: 'secret', token: 'token' }),
        });
        await app.listen({ port: 0, host: '127.0.0.1' });
        try {
            const address = app.server.address() as any;
            const base = `http://127.0.0.1:${address.port}`;
            const auth = `Basic ${Buffer.from('operator:secret').toString('base64')}`;
            const check = (body: unknown) => fetch(`${base}/api/v1/consumers/scope-route/scope/check`, {
                method: 'POST',
                headers: { authorization: auth, 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });

            const allowed = await check({ allowedFiles: ['src/**'], target: 'src/a.ts' });
            assert.equal(allowed.status, 200);
            assert.equal((await allowed.json()).allowed, true);

            const blocked = await check({ allowedFiles: ['src/**'], target: 'docs/a.md' });
            const blockedBody = await blocked.json();
            assert.equal(blockedBody.allowed, false);
            assert.equal(blockedBody.code, 'BLOCKED_SCOPE');

            const empty = await check({ allowedFiles: ['src/**'], target: 'src/a.ts', emptyScope: true });
            assert.equal((await empty.json()).code, 'EMPTY_SCOPE');

            const dangling = await check({ allowedFiles: ['src/**'], target: 'src/gone/a.ts' });
            assert.equal((await dangling.json()).code, 'DANGLING_SCOPE');

            const escape = await check({ allowedFiles: ['**'], target: '../outside.ts' });
            assert.equal((await escape.json()).code, 'BLOCKED_SCOPE');
        } finally {
            await app.close();
        }
    });
});
