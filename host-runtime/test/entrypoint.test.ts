import { describe, expect, it } from 'bun:test';
import { EntrypointError, MAX_HOST_STEPS, clampMaxSteps, runEntrypoint } from '../src/entrypoint';
import type { EntrypointOptions, RunReport } from '../src/entrypoint';
import type { AdapterRequest, AdapterResult, HostAdapter } from '../src/adapters/types';
import type { ConfigSnapshot, FetchLike } from '../src/config-client';
import { makeSnapshot, TEST_CONSUMER, TEST_RUNTIME_KEY } from './fixtures';

const PROMPT = 'Implement the P3 host-runtime package: entrypoint, flow engine, Mode A adapter.';
const TOKEN = 'host-token-should-never-leak';

function stubAdapter(handler: (request: AdapterRequest) => AdapterResult): HostAdapter {
    return {
        name: 'stub',
        async run(request: AdapterRequest): Promise<AdapterResult> {
            return handler(request);
        },
    };
}

function passAdapter(): HostAdapter {
    return stubAdapter(() => ({
        adapter: 'stub',
        command: null,
        ok: true,
        exitCode: 0,
        stdout: 'work done\nOUTCOME: PASS\n',
        stderr: '',
        durationMs: 5,
        timedOut: false,
        blocked: false,
        dry: true,
    }));
}

function failureAdapter(): HostAdapter {
    return stubAdapter(() => ({
        adapter: 'stub',
        command: null,
        ok: false,
        exitCode: 1,
        stdout: 'work failed\nOUTCOME: FAIL\n',
        stderr: 'assertion failed',
        durationMs: 7,
        timedOut: false,
        blocked: false,
        dry: true,
    }));
}

interface Harness {
    fetchImpl: FetchLike;
    posts: Array<Record<string, any>>;
    snapshotGets: string[];
}

function harness(snapshot: ConfigSnapshot, options: { duplicate?: boolean } = {}): Harness {
    const posts: Array<Record<string, any>> = [];
    const snapshotGets: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('config-snapshot')) {
            snapshotGets.push(url);
            return new Response(JSON.stringify(snapshot), {
                status: 200,
                headers: { 'content-type': 'application/json', etag: snapshot.version },
            });
        }
        if (method === 'POST' && url.endsWith('/observations')) {
            const sent = JSON.parse(String(init?.body)) as Record<string, any>;
            const duplicate = Boolean(options.duplicate);
            posts.push(sent);
            return new Response(JSON.stringify({ ok: true, created: !duplicate, observation: { ...sent, receivedAt: '2026-11-17T00:00:01.000Z' } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'unexpected request' }), { status: 404 });
    };
    return { fetchImpl, posts, snapshotGets };
}

function options(harnessed: Harness, adapter: HostAdapter, overrides: Partial<EntrypointOptions> = {}): EntrypointOptions {
    return {
        baseUrl: 'http://cp.test',
        authToken: TOKEN,
        authKind: 'host',
        consumer: TEST_CONSUMER,
        runtimeKey: TEST_RUNTIME_KEY,
        prompt: PROMPT,
        flowId: 'that-tinh-tran',
        workerId: 'worker-build',
        maxSteps: 1,
        fetchImpl: harnessed.fetchImpl,
        adapterOverride: adapter,
        traceId: 'trace-p3',
        env: { PATH: '' },
        homeDir: '/nonexistent',
        log: () => undefined,
        ...overrides,
    };
}

async function expectEntrypointError(promise: Promise<unknown>, code: string): Promise<void> {
    try {
        await promise;
        throw new Error(`expected EntrypointError ${code}`);
    } catch (error) {
        expect(error instanceof EntrypointError).toBe(true);
        expect((error as EntrypointError).code).toBe(code);
    }
}

describe('entrypoint (dry integration, fake control plane)', () => {
    it('does snapshot -> worker -> model -> adapter -> evidence -> observation', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        const report = await runEntrypoint(options(harnessed, passAdapter()));

        expect(report.ok).toBe(true);
        expect(report.stoppedReason).toBe('max-steps');
        expect(report.snapshotVersionValid).toBe(true);
        expect(report.flowId).toBe('that-tinh-tran');
        expect(report.auth).toBe('host');
        expect(report.steps).toHaveLength(1);

        expect(harnessed.snapshotGets).toHaveLength(1);
        expect(harnessed.snapshotGets[0]).toContain('runtimeKey=cursor%3Acursor-agent');
        expect(harnessed.posts).toHaveLength(1);

        const post = harnessed.posts[0];
        expect(post.traceId).toBe('trace-p3');
        expect(post.hostId).toBe('cursor');
        expect(post.runtimeKey).toBe(TEST_RUNTIME_KEY);
        expect(post.workerId).toBe('worker-build');
        expect(post.event).toBe('worker.completed');
        expect(post.outcome).toBe('PASS');
        expect(post.idempotencyKey).toBe('trace-p3:worker-build:1');
        expect(post.evidence.model).toBe('auto');
        expect(post.evidence.modelSource).toBe('runtime-default');
        expect(post.evidence.adapter).toBe('stub');
        expect(post.evidence.promptRedacted).toBe(false);

        // No prompt body, no token, no ESO run/claim vocabulary in the observation.
        const serialized = JSON.stringify(post);
        expect(serialized.includes(PROMPT)).toBe(false);
        expect(serialized.includes(TOKEN)).toBe(false);
        expect('runId' in post).toBe(false);
        expect('claim' in post).toBe(false);
    });

    it('walks the flow host-side until it ends', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        const report = await runEntrypoint(options(harnessed, passAdapter(), { maxSteps: 2 }));

        expect(report.ok).toBe(true);
        // worker-verify has no PASS edge in the fixture, so the host stops at flow-end.
        expect(report.stoppedReason).toBe('flow-end');
        expect(report.steps.map((step) => step.workerId)).toEqual(['worker-build', 'worker-verify']);
        expect(harnessed.posts.map((post) => post.idempotencyKey)).toEqual([
            'trace-p3:worker-build:1',
            'trace-p3:worker-verify:2',
        ]);
        expect(harnessed.posts[1].event).toBe('worker.completed');
    });

    it('reports FAIL and stops at the failing worker', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        const report = await runEntrypoint(options(harnessed, failureAdapter(), { maxSteps: 3 }));

        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('FAIL');
        expect(report.steps).toHaveLength(1);
        expect(harnessed.posts).toHaveLength(1);
        expect(harnessed.posts[0].event).toBe('worker.failed');
        expect(harnessed.posts[0].outcome).toBe('FAIL');
        expect(harnessed.posts[0].evidence.exitCode).toBe(1);
    });

    it('records a blocked adapter as BLOCKED evidence', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        const blocked = stubAdapter(() => ({
            adapter: 'cursor',
            command: null,
            ok: false,
            exitCode: null,
            stdout: '',
            stderr: '',
            durationMs: 0,
            timedOut: false,
            blocked: true,
            dry: false,
            reason: 'ADAPTER_UNAVAILABLE',
            detail: 'cursor-agent not found',
        }));
        const report = await runEntrypoint(options(harnessed, blocked));
        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('BLOCKED');
        expect(harnessed.posts[0].outcome).toBe('BLOCKED');
        expect(harnessed.posts[0].event).toBe('worker.failed');
        expect(harnessed.posts[0].evidence.reason).toBe('ADAPTER_UNAVAILABLE');
    });

    it('blocks with MODEL_UNAVAILABLE when the runtime has no default model', async () => {
        const snapshot = await makeSnapshot({
            hosts: [
                {
                    hostId: 'cursor',
                    hostType: 'cursor',
                    label: 'cursor',
                    runtimes: [
                        {
                            hostId: 'cursor',
                            runtimeId: 'cursor-agent',
                            runtimeKey: TEST_RUNTIME_KEY,
                            runtimeKind: 'cli',
                            models: ['auto'],
                            defaultModel: null,
                        },
                    ],
                },
            ],
        });
        const harnessed = harness(snapshot);
        let adapterCalls = 0;
        const adapter = stubAdapter(() => {
            adapterCalls += 1;
            throw new Error('adapter must not run');
        });
        const report = await runEntrypoint(options(harnessed, adapter, { model: undefined }));

        expect(adapterCalls).toBe(0);
        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('MODEL_UNAVAILABLE');
        expect(harnessed.posts).toHaveLength(1);
        expect(harnessed.posts[0].outcome).toBe('BLOCKED');
        expect(harnessed.posts[0].event).toBe('worker.failed');
        expect(harnessed.posts[0].evidence.reason).toBe('MODEL_UNAVAILABLE');
    });

    it('blocks with WORKER_NOT_FOUND for an unknown explicit worker', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        const report = await runEntrypoint(options(harnessed, passAdapter(), { workerId: 'worker-nope' }));
        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('WORKER_NOT_FOUND');
        expect(harnessed.posts[0].outcome).toBe('BLOCKED');
    });

    it('blocks with WORKER_NOT_PLACED when placement excludes this runtime', async () => {
        const snapshot = await makeSnapshot({
            workerPlacement: [{ workerId: 'worker-build', allowedHosts: ['agy:agy'], modelTier: 'balanced' }],
        });
        const harnessed = harness(snapshot);
        const report = await runEntrypoint(options(harnessed, passAdapter()));
        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('WORKER_NOT_PLACED');
        expect(harnessed.posts[0].outcome).toBe('BLOCKED');
    });

    it('marks replayed steps as existing observations', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot, { duplicate: true });
        const report = await runEntrypoint(options(harnessed, passAdapter()));
        expect(report.steps[0].observationCreated).toBe(false);
        expect(report.ok).toBe(true);
    });

    it('forces the dry adapter under --dry-run even if --adapter cursor was requested', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        const report = await runEntrypoint(
            options(harnessed, passAdapter(), { dryRun: true, adapter: 'cursor', adapterOverride: undefined }),
        );
        expect(report.adapter).toBe('dry');
        expect(report.dryRun).toBe(true);
        expect(harnessed.posts).toHaveLength(1);
        expect(harnessed.posts[0].evidence.adapter).toBe('dry');
    });

    it('fails closed on snapshot version mismatch', async () => {
        const snapshot = await makeSnapshot();
        snapshot.version = 'f'.repeat(64);
        const harnessed = harness(snapshot);
        await expectEntrypointError(runEntrypoint(options(harnessed, passAdapter())), 'SNAPSHOT_VERSION_MISMATCH');
        expect(harnessed.posts).toHaveLength(0);
    });

    it('rejects an invalid runtime key before touching ESO', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        await expectEntrypointError(runEntrypoint(options(harnessed, passAdapter(), { runtimeKey: 'cursor' })), 'INVALID_RUNTIME_KEY');
    });

    it('rejects an unregistered runtime', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        await expectEntrypointError(
            runEntrypoint(options(harnessed, passAdapter(), { runtimeKey: 'agy:agy' })),
            'HOST_RUNTIME_NOT_FOUND',
        );
    });

    it('rejects a flow id that is not the published flow', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        await expectEntrypointError(runEntrypoint(options(harnessed, passAdapter(), { flowId: 'other-flow' })), 'FLOW_NOT_FOUND');
    });

    it('clamps max-steps host-side', () => {
        expect(clampMaxSteps(0)).toBe(1);
        expect(clampMaxSteps(undefined)).toBe(1);
        expect(clampMaxSteps(3)).toBe(3);
        expect(clampMaxSteps(MAX_HOST_STEPS + 50)).toBe(MAX_HOST_STEPS);
    });

    it('exposes a typed report shape', async () => {
        const snapshot = await makeSnapshot();
        const harnessed = harness(snapshot);
        const report: RunReport = await runEntrypoint(options(harnessed, passAdapter()));
        expect(report.traceId).toBe('trace-p3');
        expect(typeof report.snapshotVersion).toBe('string');
        expect(report.steps[0].observationId.startsWith('obs-')).toBe(true);
    });
});
