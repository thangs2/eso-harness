/**
 * BUG-47 — `/arch/ask` must answer about the consumer repo, not the control-plane cwd.
 *
 * Consumer route: `POST /api/v1/consumers/:id/arch/ask` scans `consumer.root` and returns that
 * root on the answer; citations stay relative to it. The legacy `/api/v1/arch/ask` is repo-scoped
 * backward compatibility only.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { ArchQueryService } from '../src/modules/arch-query/arch-query.service.js';

const roots: string[] = [];
const servers: any[] = [];

afterEach(async () => {
    for (const app of servers.splice(0)) await app.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'eso-bug47-'));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        const absolute = join(root, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, 'utf8');
    }
    return root;
}

const GRAPH_A = {
    'src/core.ts': 'export const core = 1;\n',
    'src/feature-a.ts': "import { core } from './core.js';\nexport const featureA = core;\n",
    'src/app-a.ts': "import { featureA } from './feature-a.js';\nexport const appA = featureA;\n",
};

const GRAPH_B = {
    'src/core.ts': 'export const core = 2;\n',
    'src/feature-b.ts': "import { core } from './core.js';\nexport const featureB = core;\n",
    'src/app-b.ts': "import { featureB } from './feature-b.js';\nexport const appB = featureB;\n",
};

async function fixture() {
    const app = await createPlatformServer({
        store: new MemoryPlatformStore(),
        auth: new AuthService({ user: 'operator', password: 'secret', token: 'token' }),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app);
    const address = app.server.address() as any;
    const base = `http://127.0.0.1:${address.port}`;
    const auth = `Basic ${Buffer.from('operator:secret').toString('base64')}`;
    const call = (path: string, init: any = {}) =>
        fetch(`${base}${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json', ...(init.headers || {}) } });
    return { call };
}

async function register(call: any, id: string, root: string): Promise<void> {
    const res = await call('/api/v1/consumers', {
        method: 'POST',
        body: JSON.stringify({ id, name: id.toUpperCase(), root }),
    });
    assert.equal(res.status, 201, `register ${id}: ${res.status} ${await res.text()}`);
}

function assertRelativeCitations(answer: any, root: string): void {
    assert.ok(Array.isArray(answer.evidence) && answer.evidence.length > 0, 'answered must carry evidence');
    for (const citation of answer.evidence) {
        assert.equal(isAbsolute(citation.file), false, `citation '${citation.file}' must be relative to the consumer root`);
        assert.equal(citation.file.startsWith(root), false, 'citation must not embed the absolute consumer root');
        assert.equal(existsSync(join(root, citation.file)), true, `${citation.file} must exist under the consumer root`);
        const line = readFileSync(join(root, citation.file), 'utf8').split(/\r?\n/)[citation.line - 1];
        assert.equal(line.trim(), String(citation.text).trim(), `${citation.file}:${citation.line} must be the cited line`);
    }
}

describe('BUG-47 — architecture answers are per consumer root', () => {
    test('same question, two consumers ⇒ different answers, relative citations, no leakage', async () => {
        const rootA = makeRoot(GRAPH_A);
        const rootB = makeRoot(GRAPH_B);
        const { call } = await fixture();
        await register(call, 'bug47-a', rootA);
        await register(call, 'bug47-b', rootB);

        const question = { kind: 'monolith', task: 'impact', module: 'src/core.ts' };
        const ask = async (id: string) => {
            const res = await call(`/api/v1/consumers/${id}/arch/ask`, { method: 'POST', body: JSON.stringify(question) });
            assert.equal(res.status, 200);
            return res.json() as any;
        };

        const answerA = await ask('bug47-a');
        const answerB = await ask('bug47-b');

        assert.equal(answerA.root, rootA);
        assert.equal(answerB.root, rootB);
        assert.notEqual(answerA.answer, answerB.answer);
        assert.deepEqual(answerA.modules, ['src/app-a.ts', 'src/feature-a.ts']);
        assert.deepEqual(answerB.modules, ['src/app-b.ts', 'src/feature-b.ts']);
        assert.equal(answerA.modules.includes('src/app-b.ts'), false, 'consumer A must not see consumer B modules');
        assert.equal(answerB.modules.includes('src/app-a.ts'), false, 'consumer B must not see consumer A modules');
        assertRelativeCitations(answerA, rootA);
        assertRelativeCitations(answerB, rootB);

        // The second round must hit each root's own cache, never the other consumer's graph.
        const againA = await ask('bug47-a');
        const againB = await ask('bug47-b');
        assert.deepEqual(againA.modules, answerA.modules);
        assert.deepEqual(againB.modules, answerB.modules);
    });

    test('module that only exists in one consumer ⇒ answered there, unknown in the other', async () => {
        const rootA = makeRoot(GRAPH_A);
        const rootB = makeRoot(GRAPH_B);
        const { call } = await fixture();
        await register(call, 'bug47-only-a', rootA);
        await register(call, 'bug47-only-b', rootB);

        const ask = async (id: string, module: string) => {
            const res = await call(`/api/v1/consumers/${id}/arch/ask`, {
                method: 'POST',
                body: JSON.stringify({ kind: 'monolith', task: 'impact', module }),
            });
            assert.equal(res.status, 200);
            return res.json() as any;
        };

        const inB = await ask('bug47-only-b', 'feature-b');
        assert.equal(inB.status, 'answered');
        assert.equal(inB.root, rootB);
        assert.match(inB.answer, /feature-b\.ts/);

        const inA = await ask('bug47-only-a', 'feature-b');
        assert.equal(inA.status, 'unknown');
        assert.equal(inA.root, rootA);
        assert.match(String(inA.reason), /not in the static import graph/);
    });

    test('unknown consumer ⇒ 404 CONSUMER_NOT_FOUND', async () => {
        const { call } = await fixture();
        const res = await call('/api/v1/consumers/bug47-missing/arch/ask', {
            method: 'POST',
            body: JSON.stringify({ kind: 'monolith', task: 'impact', module: 'src/core.ts' }),
        });
        assert.equal(res.status, 404);
        assert.equal((await res.json()).code, 'CONSUMER_NOT_FOUND');
    });

    test('legacy /api/v1/arch/ask stays repo-scoped (backward compatibility)', async () => {
        const { call } = await fixture();
        const res = await call('/api/v1/arch/ask', {
            method: 'POST',
            body: JSON.stringify({ kind: 'monolith', module: 'src/common/http/server.ts' }),
        });
        assert.equal(res.status, 200);
        const answer = await res.json() as any;
        assert.equal(answer.root, resolve(process.cwd()), 'legacy route scans the control-plane checkout');
        assert.equal(answer.status, 'answered');
    });

    test('refresh(root) re-scans that root only; a shared service keeps indexes apart', () => {
        const rootA = makeRoot(GRAPH_A);
        const rootB = makeRoot(GRAPH_B);
        const service = new ArchQueryService(rootA);

        const first = service.ask({ kind: 'monolith', task: 'impact', module: 'src/core.ts' });
        assert.deepEqual(first.modules, ['src/app-a.ts', 'src/feature-a.ts']);
        const fromB = service.ask({ kind: 'monolith', task: 'impact', module: 'src/core.ts' }, rootB);
        assert.deepEqual(fromB.modules, ['src/app-b.ts', 'src/feature-b.ts']);

        // Change A's graph: app-a no longer imports feature-a. The cached index still answers.
        writeFileSync(join(rootA, 'src/app-a.ts'), 'export const appA = 1;\n', 'utf8');
        assert.deepEqual(
            service.ask({ kind: 'monolith', task: 'impact', module: 'src/core.ts' }).modules,
            ['src/app-a.ts', 'src/feature-a.ts'],
        );

        service.refresh(rootA);
        assert.deepEqual(service.ask({ kind: 'monolith', task: 'impact', module: 'src/core.ts' }).modules, ['src/feature-a.ts']);
        // B's index is untouched by refreshing A.
        assert.deepEqual(service.ask({ kind: 'monolith', task: 'impact', module: 'src/core.ts' }, rootB).modules, [
            'src/app-b.ts',
            'src/feature-b.ts',
        ]);
    });
});
