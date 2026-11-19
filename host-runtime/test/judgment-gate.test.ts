import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runEntrypoint } from '../src/entrypoint';
import type { AdapterRequest, AdapterResult, HostAdapter } from '../src/adapters/types';
import type { ConfigSnapshot, FetchLike } from '../src/config-client';
import { makeSnapshot, TEST_CONSUMER, TEST_RUNTIME_KEY } from './fixtures';

function adapter(called: { value: boolean }): HostAdapter {
    return {
        name: 'stub',
        async run(_request: AdapterRequest): Promise<AdapterResult> {
            called.value = true;
            return {
                adapter: 'stub', command: null, ok: true, exitCode: 0,
                stdout: 'OUTCOME: PASS\n', stderr: '', durationMs: 1, timedOut: false, blocked: false, dry: true,
            };
        },
    };
}

async function setup(verdict: any) {
    const snapshot = await makeSnapshot();
    const cache = mkdtempSync(join(tmpdir(), 'hr-judgment-'));
    const called = { value: false };
    const fetchImpl: FetchLike = async (url, init) => {
        if (url.includes('config-snapshot')) return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'content-type': 'application/json', etag: snapshot.version } });
        if (url.endsWith('/sufficiency')) return new Response(JSON.stringify(verdict), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.endsWith('/observations')) return new Response(JSON.stringify({ ok: true, created: true, observation: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response('{}', { status: 404 });
    };
    const options = {
        baseUrl: 'http://cp.test', authToken: 'token', authKind: 'host' as const,
        consumer: TEST_CONSUMER, runtimeKey: TEST_RUNTIME_KEY, prompt: 'do work',
        flowId: 'that-tinh-tran', workerId: 'worker-build', maxSteps: 1,
        fetchImpl, adapterOverride: adapter(called), traceId: 'trace-judgment',
        env: { PATH: '' }, homeDir: '/nonexistent', log: () => undefined,
        sleepImpl: async () => undefined, cacheDir: cache, bufferDir: join(cache, 'observations'),
        judgment: { requirements: [{ subject: 'AC-1', source: 'work', min_basis: 'retrieved' }], enforcement: 'enforce' as const },
    };
    return { options, called, cleanup: () => rmSync(cache, { recursive: true, force: true }) };
}

describe('host judgment gate', () => {
    it('blocks before adapter when enforce verdict blocks', async () => {
        const { options, called, cleanup } = await setup({ verdict: { level: 'cannot-judge', mode: 'block' }, decision: 'block', wouldBlock: true, enforcement: 'enforce', gaps: { total_gaps: 1 } });
        const report = await runEntrypoint(options as any);
        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('JUDGMENT_BLOCKED');
        expect(called.value).toBe(false);
        cleanup();
    });

    it('runs adapter when verdict is sufficient', async () => {
        const { options, called, cleanup } = await setup({ verdict: { level: 'sufficient', mode: 'do' }, decision: 'allow', wouldBlock: false, enforcement: 'enforce', gaps: { total_gaps: 0 } });
        const report = await runEntrypoint(options as any);
        expect(report.ok).toBe(true);
        expect(called.value).toBe(true);
        cleanup();
    });

    it('fail-closed when judgment endpoint fails in enforce mode', async () => {
        const { options, called, cleanup } = await setup({});
        options.fetchImpl = async (url, init) => {
            if (url.includes('config-snapshot')) return new Response(JSON.stringify(await makeSnapshot()), { status: 200, headers: { 'content-type': 'application/json' } });
            return new Response('{}', { status: 500 });
        };
        const report = await runEntrypoint(options as any);
        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('JUDGMENT_UNAVAILABLE');
        expect(called.value).toBe(false);
        cleanup();
    });
});
