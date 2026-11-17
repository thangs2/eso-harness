import { describe, expect, it } from 'bun:test';
import { DispatchError, runDispatch } from '../src/remote/dispatch';
import type { DispatchOptions } from '../src/remote/dispatch';
import { startRemoteServer } from '../src/remote/server';
import type { RemoteServerOptions } from '../src/remote/server';
import type { ConfigSnapshot, FetchLike } from '../src/config-client';
import {
    AGY_RUNTIME_KEY,
    A_HOST_TOKEN,
    B_HOST_TOKEN,
    REMOTE_SECRET,
    TEST_CONSUMER,
    TEST_RUNTIME_KEY,
    fakeEso,
    makeModeBSnapshot,
    makeTempDir,
} from './remote-fixtures';
import type { FakeEso } from './remote-fixtures';

// Keep every default cache/buffer/ledger write inside a temp dir (never ~/.eso).
const TEST_CACHE = makeTempDir('hr-dispatch-cache-');
process.env.ESO_CONFIG_CACHE_DIR = TEST_CACHE.dir;
process.env.ESO_OBS_BUFFER_DIR = `${TEST_CACHE.dir}/observations`;

const PROMPT = 'Mode B dispatch prompt that must never be stored on host A.';
const TRACE = 'p4-unit-dry';

const TIERS = {
    fast: { model: 'gemini-4-argon-low', effort: 'low' },
    balanced: { model: 'gemini-4-argon-high', effort: 'high' },
    reasoning: { model: 'gemini-4-argon-high', effort: 'xhigh' },
};

interface E2E {
    fake: FakeEso;
    snapshot: ConfigSnapshot;
    remoteUrl: string;
    logs: string[];
    stop: () => Promise<void>;
}

/** Start host B (real remote server) and publish a snapshot whose agy runtime points at it. */
async function startE2E(workspace: string, options: { snapshotOverrides?: Record<string, unknown>; bOptions?: Partial<RemoteServerOptions> } = {}): Promise<E2E> {
    const fake = fakeEso(await makeModeBSnapshot(null));
    const logs: string[] = [];
    const handle = startRemoteServer({
        runtimeKey: AGY_RUNTIME_KEY,
        port: 0,
        host: '127.0.0.1',
        secret: REMOTE_SECRET,
        esoBaseUrl: 'http://eso.test',
        consumer: TEST_CONSUMER,
        hostToken: B_HOST_TOKEN,
        allowedWorkspaces: [workspace],
        fetchImpl: fake.fetchImpl,
        sleepImpl: async () => undefined,
        ledgerPath: `${workspace}/.modeb-ledger.json`,
        log: (line) => logs.push(line),
        ...options.bOptions,
    });
    const snapshot = await makeModeBSnapshot(handle.url, (options.snapshotOverrides ?? {}) as never, { modelTiers: TIERS });
    fake.setSnapshot(snapshot);
    return { fake, snapshot, remoteUrl: handle.url, logs, stop: () => handle.stop() };
}

function dispatchOptions(e2e: E2E, workspace: string, overrides: Partial<DispatchOptions> = {}): DispatchOptions {
    return {
        baseUrl: 'http://eso.test',
        authToken: A_HOST_TOKEN,
        authKind: 'host',
        consumer: TEST_CONSUMER,
        fromRuntimeKey: TEST_RUNTIME_KEY,
        toRuntimeKey: AGY_RUNTIME_KEY,
        prompt: PROMPT,
        flowId: 'that-tinh-tran',
        workerId: 'worker-build',
        adapter: 'dry',
        dryRun: true,
        remoteToken: REMOTE_SECRET,
        workspaceRepo: workspace,
        traceId: TRACE,
        fetchImpl: e2e.fake.fetchImpl,
        sleepImpl: async () => undefined,
        log: (line) => e2e.logs.push(line),
        ...overrides,
    };
}

async function expectDispatchCode(promise: Promise<unknown>, code: string): Promise<DispatchError> {
    try {
        await promise;
        throw new Error(`expected DispatchError ${code}`);
    } catch (error) {
        expect(error instanceof DispatchError).toBe(true);
        expect((error as DispatchError).code).toBe(code);
        return error as DispatchError;
    }
}

describe('Mode B dispatch (A -> B, in-process E2E)', () => {
    it('dispatches a dry job and writes both observations', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        try {
            const report = await runDispatch(dispatchOptions(e2e, workspace.dir));
            expect(report.ok).toBe(true);
            expect(report.outcome).toBe('PASS');
            expect(report.jobId).toBe(TRACE);
            expect(report.fromRuntimeKey).toBe(TEST_RUNTIME_KEY);
            expect(report.toRuntimeKey).toBe(AGY_RUNTIME_KEY);
            expect(report.workerId).toBe('worker-build');
            expect(report.flowId).toBe('that-tinh-tran');
            expect(report.snapshotVersionValid).toBe(true);
            expect(report.snapshotSource).toBe('network');
            // Host B resolved worker-build (balanced) from the P5 modelTiers map.
            expect(report.model).toBe('gemini-4-argon-high');
            expect(report.modelSource).toBe('tier');
            expect(report.effort).toBe('high');
            expect(report.tier).toBe('balanced');
            expect(report.warnings).toEqual([]);
            expect(report.remoteObservationId).not.toBe(null);
            expect(report.localObservationId).toBe(`obs-remote-cursor-cursor-agent-agy-agy-${TRACE}`);
            expect(report.localObservationCreated).toBe(true);

            // Host B observation then host A wrap-up observation.
            expect(e2e.fake.observations).toHaveLength(2);
            const remote = e2e.fake.observations.find((row) => row.runtimeKey === AGY_RUNTIME_KEY);
            const local = e2e.fake.observations.find((row) => row.runtimeKey === TEST_RUNTIME_KEY);
            if (!remote || !local) throw new Error('expected both observations');

            expect(remote.observationId).toBe(report.remoteObservationId);
            expect(remote.traceId).toBe(TRACE);
            expect(remote.event).toBe('worker.completed');
            expect(remote.outcome).toBe('PASS');
            expect(remote.idempotencyKey).toBe(`${TRACE}:worker-build:1`);

            expect(local.event).toBe('worker.remote.completed');
            expect(local.outcome).toBe('PASS');
            expect(local.evidence.remoteObservationId).toBe(remote.observationId);
            expect(local.evidence.remoteRuntimeKey).toBe(AGY_RUNTIME_KEY);
            expect(local.evidence.remoteJobId).toBe(TRACE);
            expect(local.evidence.adapter).toBe('dry');
            expect(local.evidence.model).toBe('gemini-4-argon-high');
            expect(local.evidence.effort).toBe('high');
            expect(local.evidence.tier).toBe('balanced');
            expect(local.idempotencyKey).toBe(`${TRACE}:remote:${TEST_RUNTIME_KEY}->${AGY_RUNTIME_KEY}`);

            const stored = JSON.stringify(e2e.fake.observations);
            expect(stored.includes(PROMPT)).toBe(false);
            expect(stored.includes(REMOTE_SECRET)).toBe(false);
            expect(stored.includes(A_HOST_TOKEN)).toBe(false);
            expect(stored.includes(B_HOST_TOKEN)).toBe(false);
            expect(e2e.logs.join('\n').includes(PROMPT)).toBe(false);
            expect(e2e.logs.join('\n').includes(REMOTE_SECRET)).toBe(false);
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('replays the same job idempotently (no duplicate B run or observations)', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        try {
            const first = await runDispatch(dispatchOptions(e2e, workspace.dir));
            const second = await runDispatch(dispatchOptions(e2e, workspace.dir));
            expect(second.localObservationCreated).toBe(false);
            expect(second.remoteObservationId).toBe(first.remoteObservationId);
            expect(second.localObservationId).toBe(first.localObservationId);
            expect(e2e.fake.observations).toHaveLength(2);
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('requires the worker to be placed on the target runtime', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir, {
            snapshotOverrides: {
                workerPlacement: [{ workerId: 'worker-build', allowedHosts: [TEST_RUNTIME_KEY], modelTier: 'balanced' }],
            },
        });
        try {
            const error = await expectDispatchCode(runDispatch(dispatchOptions(e2e, workspace.dir)), 'WORKER_NOT_PLACED');
            expect(error.message).toContain(AGY_RUNTIME_KEY);
            expect(e2e.fake.observations).toHaveLength(0);
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('requires a remoteUrl or --remote-url override', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir, { snapshotOverrides: { hosts: (await makeModeBSnapshot(null)).hosts } });
        try {
            // Snapshot hosts were replaced with remoteUrl:null copies.
            const published = await makeModeBSnapshot(null);
            e2e.fake.setSnapshot(published);
            await expectDispatchCode(runDispatch(dispatchOptions(e2e, workspace.dir)), 'REMOTE_URL_MISSING');
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('rejects an invalid remoteUrl', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        try {
            await expectDispatchCode(runDispatch(dispatchOptions(e2e, workspace.dir, { remoteUrl: 'ftp://127.0.0.1:8788' })), 'REMOTE_URL_INVALID');
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('rejects an unregistered target runtime', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir, {
            snapshotOverrides: {
                workerPlacement: [{ workerId: 'worker-build', allowedHosts: ['dsh:dsh'], modelTier: 'balanced' }],
            },
        });
        try {
            await expectDispatchCode(
                runDispatch(dispatchOptions(e2e, workspace.dir, { toRuntimeKey: 'dsh:dsh' })),
                'REMOTE_RUNTIME_NOT_FOUND',
            );
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('rejects an unknown worker', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        try {
            await expectDispatchCode(runDispatch(dispatchOptions(e2e, workspace.dir, { workerId: 'worker-nope' })), 'WORKER_NOT_FOUND');
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('rejects a tampered snapshot version', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        try {
            e2e.fake.setSnapshot({ ...e2e.snapshot, version: 'f'.repeat(64) });
            await expectDispatchCode(runDispatch(dispatchOptions(e2e, workspace.dir)), 'SNAPSHOT_VERSION_MISMATCH');
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('dispatches from the offline config cache and buffers the local observation', async () => {
        const workspace = makeTempDir();
        const cache = makeTempDir('hr-dispatch-cache-');
        const e2e = await startE2E(workspace.dir);
        const shared = { cacheDir: cache.dir, bufferDir: `${cache.dir}/observations` };
        try {
            const online = await runDispatch(dispatchOptions(e2e, workspace.dir, { ...shared }));
            expect(online.ok).toBe(true);
            expect(online.snapshotSource).toBe('network');

            const downFetch: FetchLike = async () => {
                throw new Error('control plane down');
            };
            const offline = await runDispatch(
                dispatchOptions(e2e, workspace.dir, {
                    ...shared,
                    offline: true,
                    fetchImpl: downFetch,
                    traceId: 'p4-unit-offline',
                }),
            );
            expect(offline.ok).toBe(true);
            expect(offline.snapshotSource).toBe('cache');
            expect(offline.warnings.some((entry) => entry.startsWith('SNAPSHOT_CACHE_USED:ageMs='))).toBe(true);
            expect(offline.warnings.some((entry) => entry.startsWith('OBSERVATIONS_BUFFERED:'))).toBe(true);
            expect(offline.localObservationCreated).toBe(false);
            // Host B still wrote its observation through its own (working) ESO connection.
            expect(e2e.fake.observations.filter((row) => row.traceId === 'p4-unit-offline')).toHaveLength(1);
        } finally {
            await e2e.stop();
            workspace.cleanup();
            cache.cleanup();
        }
    });

    it('reports MODEL_TIER_NOT_MAPPED when the target runtime has no tier map', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        try {
            const noTierSnapshot = await makeModeBSnapshot(e2e.remoteUrl);
            e2e.fake.setSnapshot(noTierSnapshot);
            const report = await runDispatch(dispatchOptions(e2e, workspace.dir, { traceId: 'p4-unit-notier' }));
            expect(report.ok).toBe(true);
            expect(report.modelSource).toBe('runtime-default');
            expect(report.warnings).toContain('MODEL_TIER_NOT_MAPPED');
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('rejects self-dispatch and a missing remote secret', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        try {
            await expectDispatchCode(
                runDispatch(dispatchOptions(e2e, workspace.dir, { toRuntimeKey: TEST_RUNTIME_KEY })),
                'INVALID_RUNTIME_KEY',
            );
            await expectDispatchCode(
                runDispatch(dispatchOptions(e2e, workspace.dir, { remoteToken: 'short' })),
                'DISPATCH_FAILED',
            );
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('records a failed local observation when the remote runtime is unreachable', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        const dead = startRemoteServer({
            runtimeKey: AGY_RUNTIME_KEY,
            port: 0,
            host: '127.0.0.1',
            secret: REMOTE_SECRET,
            esoBaseUrl: 'http://eso.test',
            consumer: TEST_CONSUMER,
            hostToken: B_HOST_TOKEN,
            allowedWorkspaces: [workspace.dir],
            fetchImpl: e2e.fake.fetchImpl,
            sleepImpl: async () => undefined,
            log: () => undefined,
        });
        const deadUrl = dead.url;
        await dead.stop();
        try {
            const error = await expectDispatchCode(
                runDispatch(dispatchOptions(e2e, workspace.dir, { remoteUrl: deadUrl, remoteTimeoutMs: 2000 })),
                'DISPATCH_FAILED',
            );
            expect(error.detail).toBe('REMOTE_UNREACHABLE');
            expect(e2e.fake.observations).toHaveLength(1);
            const local = e2e.fake.observations[0];
            expect(local.runtimeKey).toBe(TEST_RUNTIME_KEY);
            expect(local.event).toBe('worker.remote.failed');
            expect(local.outcome).toBe('BLOCKED');
            expect(local.evidence.errorCode).toBe('REMOTE_UNREACHABLE');
            expect(error.localObservationId).toBe(local.observationId);
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });

    it('propagates a remote workspace rejection as a failed dispatch', async () => {
        const workspace = makeTempDir();
        const e2e = await startE2E(workspace.dir);
        try {
            const error = await expectDispatchCode(
                runDispatch(dispatchOptions(e2e, `${workspace.dir}/does-not-exist`)),
                'DISPATCH_FAILED',
            );
            expect(error.detail).toBe('WORKSPACE_MISSING');
            const failedLocal = e2e.fake.observations.find((row) => row.event === 'worker.remote.failed');
            expect(failedLocal).toBeDefined();
        } finally {
            await e2e.stop();
            workspace.cleanup();
        }
    });
});
