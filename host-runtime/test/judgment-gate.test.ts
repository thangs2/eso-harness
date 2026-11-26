import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runEntrypoint } from '../src/entrypoint';
import { parseArgs } from '../src/cli';

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
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
    const observations: any[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
        if (url.includes('config-snapshot')) return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'content-type': 'application/json', etag: snapshot.version } });
        if (url.endsWith('/sufficiency')) return new Response(JSON.stringify(verdict), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.endsWith('/observations')) {
            if (typeof init?.body === 'string') observations.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ ok: true, created: true, observation: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
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
    return { options, called, observations, cleanup: () => rmSync(cache, { recursive: true, force: true }) };
}

describe('host judgment gate', () => {
    it('blocks before adapter when enforce verdict blocks and records evidence.judgment', async () => {
        const gapItems = [{ what: 'AC-1', exists: 'unknown', status: 'unknown' }];
        const { options, called, observations, cleanup } = await setup({
            verdict: { level: 'cannot-judge', mode: 'block' },
            decision: 'block',
            wouldBlock: true,
            enforcement: 'enforce',
            gaps: { total_gaps: 1, gap_items: gapItems },
        });
        const report = await runEntrypoint(options as any);
        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('JUDGMENT_BLOCKED');
        expect(called.value).toBe(false);
        expect(observations.length).toBeGreaterThanOrEqual(1);
        const blockedObs = observations.find((obs) => obs.evidence?.reason === 'JUDGMENT_BLOCKED');
        expect(blockedObs).toBeDefined();
        expect(blockedObs.evidence.judgment).toEqual({
            level: 'cannot-judge',
            wouldBlock: true,
            decision: 'block',
            enforcement: 'enforce',
            gaps: gapItems,
        });
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

    it('invokes judgment without explicit requirements and emits evidence.packet for verified local files', async () => {
        const snapshot = await makeSnapshot();
        const cache = mkdtempSync(join(tmpdir(), 'hr-judgment-packet-'));
        const workdir = mkdtempSync(join(tmpdir(), 'hr-judgment-cwd-'));
        const agentsBody = '# AGENTS law\n';
        const artifactBody = 'export const ok = true;\n';
        writeFileSync(join(workdir, 'AGENTS.md'), agentsBody, 'utf8');
        writeFileSync(join(workdir, 'artifact.ts'), artifactBody, 'utf8');

        const expectedAgentsHash = await sha256Hex(agentsBody);
        const expectedArtifactHash = await sha256Hex(artifactBody);

        const judgmentRequests: any[] = [];
        const observations: any[] = [];
        const fetchImpl: FetchLike = async (url, init) => {
            if (url.includes('config-snapshot')) {
                return new Response(JSON.stringify(snapshot), {
                    status: 200,
                    headers: { 'content-type': 'application/json', etag: snapshot.version },
                });
            }
            if (url.endsWith('/sufficiency')) {
                if (typeof init?.body === 'string') judgmentRequests.push(JSON.parse(init.body));
                return new Response(
                    JSON.stringify({
                        verdict: { level: 'sufficient', mode: 'do' },
                        decision: 'allow',
                        wouldBlock: false,
                        enforcement: 'enforce',
                        gaps: { total_gaps: 0, gap_items: [] },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (url.endsWith('/observations')) {
                const sent = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
                observations.push(sent);
                return new Response(
                    JSON.stringify({ ok: true, created: true, observation: { observationId: sent.observationId } }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            return new Response('{}', { status: 404 });
        };

        const reportingAdapter: HostAdapter = {
            name: 'stub',
            async run(): Promise<AdapterResult> {
                return {
                    adapter: 'stub',
                    command: null,
                    ok: true,
                    exitCode: 0,
                    stdout: 'EVIDENCE_JSON: {"tools":[],"files":[{"path":"artifact.ts","action":"edit"},{"path":"ghost.ts","action":"edit"}],"recon":[]}\nOUTCOME: PASS\n',
                    stderr: '',
                    durationMs: 1,
                    timedOut: false,
                    blocked: false,
                    dry: true,
                };
            },
        };

        try {
            const report = await runEntrypoint({
                baseUrl: 'http://cp.test',
                authToken: 'token',
                authKind: 'host',
                consumer: TEST_CONSUMER,
                runtimeKey: TEST_RUNTIME_KEY,
                prompt: 'do work',
                flowId: 'that-tinh-tran',
                workerId: 'worker-build',
                maxSteps: 1,
                cwd: workdir,
                fetchImpl,
                adapterOverride: reportingAdapter,
                traceId: 'trace-packet',
                env: { PATH: '' },
                homeDir: '/nonexistent',
                log: () => undefined,
                sleepImpl: async () => undefined,
                cacheDir: cache,
                bufferDir: join(cache, 'observations'),
                judgment: { enforcement: 'enforce' },
            });

            expect(report.ok).toBe(true);
            expect(judgmentRequests).toHaveLength(1);
            // requirements must be omitted so control-plane derives them from worker bar + KB
            expect('requirements' in judgmentRequests[0]).toBe(false);
            expect(judgmentRequests[0].answers).toEqual([
                {
                    requirement: 'AGENTS.md',
                    claim: 'AGENTS.md',
                    basis: 'verified',
                    exists: 'present',
                    provider: 'host-runtime:fs-hash',
                    hash: expectedAgentsHash,
                },
            ]);

            const packetObs = observations.find((obs) => obs.event === 'evidence.packet');
            expect(packetObs).toBeDefined();
            expect(packetObs.traceId).toBe('trace-packet');
            expect(typeof packetObs.evidence.hash).toBe('string');
            expect(packetObs.evidence.hash).toHaveLength(64);
            expect(packetObs.evidence.items).toEqual([
                { id: 'AGENTS.md', kind: 'file', hash: expectedAgentsHash },
                { id: 'artifact.ts', kind: 'file', hash: expectedArtifactHash },
            ]);
            // Missing file ghost.ts must NOT be included in evidence.packet
            expect(packetObs.evidence.items.some((item: any) => item.id === 'ghost.ts')).toBe(false);
        } finally {
            rmSync(cache, { recursive: true, force: true });
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    it('parses --judgment-enforcement without --judgment-requirements (Bug #1)', () => {
        const shadow = parseArgs([
            'run',
            '--consumer', TEST_CONSUMER,
            '--runtime-key', TEST_RUNTIME_KEY,
            '--prompt', 'inspect repo',
            '--host-token', 'tok-123',
            '--judgment-enforcement', 'shadow',
        ]);
        expect(shadow.command).toBe('run');
        expect((shadow.options as any).judgment).toEqual({ enforcement: 'shadow' });

        const enforce = parseArgs([
            'run',
            '--consumer', TEST_CONSUMER,
            '--runtime-key', TEST_RUNTIME_KEY,
            '--prompt', 'inspect repo',
            '--host-token', 'tok-123',
            '--judgment-enforcement', 'enforce',
        ]);
        expect((enforce.options as any).judgment).toEqual({ enforcement: 'enforce' });
    });

    it('emits full ESO contract observations (evidence.packet, action.recorded, decision.recorded, evidence.judgment) in shadow mode (Bugs #2 & #3)', async () => {
        const snapshot = await makeSnapshot();
        const cache = mkdtempSync(join(tmpdir(), 'hr-judgment-shadow-'));
        const workdir = mkdtempSync(join(tmpdir(), 'hr-judgment-shadow-cwd-'));
        const agentsBody = '# Shadow Law\n';
        const readmeBody = '# Repo Readme\n';
        writeFileSync(join(workdir, 'AGENTS.md'), agentsBody, 'utf8');
        writeFileSync(join(workdir, 'README.md'), readmeBody, 'utf8');

        const observations: any[] = [];
        const gapItems = [{ what: 'AC-1', exists: 'unknown', status: 'unknown' }];
        const fetchImpl: FetchLike = async (url, init) => {
            if (url.includes('config-snapshot')) {
                return new Response(JSON.stringify(snapshot), {
                    status: 200,
                    headers: { 'content-type': 'application/json', etag: snapshot.version },
                });
            }
            if (url.endsWith('/sufficiency')) {
                return new Response(
                    JSON.stringify({
                        verdict: { level: 'cannot-judge', mode: 'block' },
                        decision: 'block',
                        wouldBlock: true,
                        enforcement: 'shadow',
                        gaps: { total_gaps: 1, gap_items: gapItems },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (url.endsWith('/observations')) {
                const sent = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
                observations.push(sent);
                return new Response(
                    JSON.stringify({ ok: true, created: true, observation: { observationId: sent.observationId } }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            return new Response('{}', { status: 404 });
        };

        const citingAdapter: HostAdapter = {
            name: 'agy',
            async run(): Promise<AdapterResult> {
                return {
                    adapter: 'agy',
                    command: null,
                    ok: true,
                    exitCode: 0,
                    stdout: `Reviewed [README.md](file://${join(workdir, 'README.md')}#L1) and \`AGENTS.md\`.\nOUTCOME: PASS\n`,
                    stderr: '',
                    durationMs: 12,
                    timedOut: false,
                    blocked: false,
                    dry: false,
                };
            },
        };

        try {
            const report = await runEntrypoint({
                baseUrl: 'http://cp.test',
                authToken: 'token',
                authKind: 'host',
                consumer: TEST_CONSUMER,
                runtimeKey: TEST_RUNTIME_KEY,
                prompt: 'summarize repo',
                flowId: 'that-tinh-tran',
                workerId: 'worker-build',
                maxSteps: 1,
                cwd: workdir,
                fetchImpl,
                adapterOverride: citingAdapter,
                traceId: 'trace-shadow-full',
                env: { PATH: '' },
                homeDir: '/nonexistent',
                log: () => undefined,
                sleepImpl: async () => undefined,
                cacheDir: cache,
                bufferDir: join(cache, 'observations'),
                judgment: { enforcement: 'shadow' },
            });

            expect(report.ok).toBe(true);
            const workerObs = observations.find((obs) => obs.event === 'worker.completed');
            const packetObs = observations.find((obs) => obs.event === 'evidence.packet');
            const actionObs = observations.find((obs) => obs.event === 'action.recorded');
            const decisionObs = observations.find((obs) => obs.event === 'decision.recorded');

            expect(workerObs).toBeDefined();
            expect(workerObs.evidence.judgment).toEqual({
                level: 'cannot-judge',
                wouldBlock: true,
                decision: 'block',
                enforcement: 'shadow',
                gaps: gapItems,
            });

            expect(packetObs).toBeDefined();
            expect(packetObs.evidence.items.map((item: any) => item.id).sort()).toEqual(['AGENTS.md', 'README.md']);
            expect(packetObs.evidence.actor).toMatchObject({ kind: 'host', id: 'worker-build' });

            expect(actionObs).toBeDefined();
            expect(actionObs.evidence.tool).toBe('agy');
            expect(actionObs.evidence.outcome).toBe('PASS');
            expect(actionObs.evidence.files.sort()).toEqual(['AGENTS.md', 'README.md']);
            expect(actionObs.evidence.actor).toMatchObject({ kind: 'host', id: 'worker-build' });

            expect(decisionObs).toBeDefined();
            expect(decisionObs.evidence.winner).toBe('worker-build');
            expect(decisionObs.evidence.verdict).toBe('partial');
            expect(typeof decisionObs.evidence.basis).toBe('string');
            expect(decisionObs.evidence.basis).toContain('cannot-judge');
            expect(decisionObs.evidence.actor).toMatchObject({ kind: 'host', id: 'worker-build' });
            expect(decisionObs.evidence.judgment).toEqual({
                level: 'cannot-judge',
                wouldBlock: true,
                decision: 'block',
                enforcement: 'shadow',
                gaps: gapItems,
            });
            expect(decisionObs.evidence.gaps).toEqual([
                {
                    code: 'JUDGMENT_GAP_UNKNOWN',
                    what: 'AC-1',
                    consequence: 'pre-turn judgment cannot-judge (exists=unknown)',
                },
            ]);
        } finally {
            rmSync(cache, { recursive: true, force: true });
            rmSync(workdir, { recursive: true, force: true });
        }
    });
});
