import { describe, expect, it } from 'bun:test';
import { startRemoteServer } from '../src/remote/server';
import type { RemoteServerOptions } from '../src/remote/server';
import { signJob, verifyResultSignature } from '../src/remote/envelope';
import type { JobEnvelope, SignedJobEnvelope } from '../src/remote/envelope';
import {
    AGY_RUNTIME_KEY,
    B_HOST_TOKEN,
    REMOTE_SECRET,
    TEST_CONSUMER,
    TEST_RUNTIME_KEY,
    fakeEso,
    initGitRepo,
    makeModeBSnapshot,
    makeTempDir,
} from './remote-fixtures';
import type { FakeEso } from './remote-fixtures';

// Keep every default cache/buffer/ledger write inside a temp dir (never ~/.eso).
const TEST_CACHE = makeTempDir('hr-server-cache-');
process.env.ESO_CONFIG_CACHE_DIR = TEST_CACHE.dir;
process.env.ESO_OBS_BUFFER_DIR = `${TEST_CACHE.dir}/observations`;

const PROMPT = 'Server test prompt that must never appear in logs or results.';

const TIERS = {
    fast: { model: 'gemini-4-argon-low', effort: 'low' },
    balanced: { model: 'gemini-4-argon-high', effort: 'high' },
    reasoning: { model: 'gemini-4-argon-high', effort: 'xhigh' },
};

interface Harness {
    url: string;
    logs: string[];
    fake: FakeEso;
    workspace: string;
    ledgerPath: string;
    stop: () => Promise<void>;
}

async function startHarness(workspace: string, overrides: Partial<RemoteServerOptions> = {}): Promise<Harness> {
    const fake = fakeEso(await makeModeBSnapshot(null, {}, { modelTiers: TIERS }));
    const logs: string[] = [];
    const ledgerPath = overrides.ledgerPath ?? `${workspace}/.modeb-ledger.json`;
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
        ledgerPath,
        log: (line) => logs.push(line),
        ...overrides,
    });
    return { url: handle.url, logs, fake, workspace, ledgerPath, stop: () => handle.stop() };
}

async function signedJob(workspaceRepo: string, overrides: Partial<JobEnvelope> = {}): Promise<SignedJobEnvelope> {
    return signJob(
        {
            jobId: 'job-server-1',
            fromRuntimeKey: TEST_RUNTIME_KEY,
            toRuntimeKey: AGY_RUNTIME_KEY,
            workspaceRef: { repo: workspaceRepo },
            workerId: 'worker-build',
            flowId: 'that-tinh-tran',
            prompt: PROMPT,
            policy: { adapter: 'dry', dryRun: true },
            modelTier: 'balanced',
            evidenceRequirements: {},
            createdAt: new Date().toISOString(),
            nonce: 'nonce-server-1',
            ...overrides,
        },
        REMOTE_SECRET,
    );
}

function postJobs(url: string, body: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    return fetch(`${url}/jobs`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('remote server (host B)', () => {
    it('serves health without secrets', async () => {
        const temp = makeTempDir();
        const harness = await startHarness(temp.dir);
        try {
            const response = await fetch(`${harness.url}/health`);
            expect(response.status).toBe(200);
            const body = (await response.json()) as { ok: boolean; runtimeKey: string; mode: string };
            expect(body.ok).toBe(true);
            expect(body.runtimeKey).toBe(AGY_RUNTIME_KEY);
            expect(body.mode).toBe('B');
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('rejects missing or wrong bearer tokens', async () => {
        const temp = makeTempDir();
        const harness = await startHarness(temp.dir);
        try {
            const noAuth = await postJobs(harness.url, await signedJob(temp.dir));
            expect(noAuth.status).toBe(401);
            expect(((await noAuth.json()) as { code: string }).code).toBe('AUTH_INVALID');

            const wrongAuth = await postJobs(harness.url, await signedJob(temp.dir), 'wrong-token');
            expect(wrongAuth.status).toBe(401);
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('rejects a job signed with a different secret', async () => {
        const temp = makeTempDir();
        const harness = await startHarness(temp.dir);
        try {
            const forged = await signJob(
                {
                    jobId: 'job-forged',
                    fromRuntimeKey: TEST_RUNTIME_KEY,
                    toRuntimeKey: AGY_RUNTIME_KEY,
                    workspaceRef: { repo: temp.dir },
                    workerId: 'worker-build',
                    flowId: 'that-tinh-tran',
                    prompt: PROMPT,
                    policy: { adapter: 'dry', dryRun: true },
                    modelTier: 'balanced',
                    evidenceRequirements: {},
                    createdAt: new Date().toISOString(),
                    nonce: 'forged',
                },
                'attacker-secret-999',
            );
            const response = await postJobs(harness.url, forged, REMOTE_SECRET);
            expect(response.status).toBe(401);
            expect(((await response.json()) as { code: string }).code).toBe('ENVELOPE_SIGNATURE_INVALID');
            expect(harness.fake.observations).toHaveLength(0);
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('rejects a job addressed to another runtime', async () => {
        const temp = makeTempDir();
        const harness = await startHarness(temp.dir);
        try {
            const response = await postJobs(harness.url, await signedJob(temp.dir, { toRuntimeKey: 'dsh:dsh' }), REMOTE_SECRET);
            expect(response.status).toBe(422);
            expect(((await response.json()) as { code: string }).code).toBe('JOB_SCOPE_MISMATCH');
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('rejects missing and out-of-root workspaces before running anything', async () => {
        const temp = makeTempDir('host-runtime-allowed-');
        const outside = makeTempDir('host-runtime-outside-');
        const harness = await startHarness(temp.dir);
        try {
            const missing = await postJobs(harness.url, await signedJob(`${temp.dir}/nope`, { jobId: 'job-missing' }), REMOTE_SECRET);
            expect(missing.status).toBe(422);
            expect(((await missing.json()) as { code: string }).code).toBe('WORKSPACE_MISSING');

            const blocked = await postJobs(harness.url, await signedJob(outside.dir, { jobId: 'job-outside' }), REMOTE_SECRET);
            expect(blocked.status).toBe(422);
            expect(((await blocked.json()) as { code: string }).code).toBe('WORKSPACE_NOT_ALLOWED');
            expect(harness.fake.observations).toHaveLength(0);
        } finally {
            await harness.stop();
            temp.cleanup();
            outside.cleanup();
        }
    });

    it('verifies a requested git commit', async () => {
        const temp = makeTempDir('host-runtime-git-');
        const harness = await startHarness(temp.dir);
        try {
            const { commit } = await initGitRepo(temp.dir);
            const mismatch = await postJobs(
                harness.url,
                await signedJob(temp.dir, { jobId: 'job-commit-bad', workspaceRef: { repo: temp.dir, commit: 'f'.repeat(40) } }),
                REMOTE_SECRET,
            );
            expect(mismatch.status).toBe(422);
            expect(((await mismatch.json()) as { code: string }).code).toBe('WORKSPACE_COMMIT_MISMATCH');

            const match = await postJobs(
                harness.url,
                await signedJob(temp.dir, { jobId: 'job-commit-ok', workspaceRef: { repo: temp.dir, commit } }),
                REMOTE_SECRET,
            );
            expect(match.status).toBe(200);
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('runs the worker and returns a signed result with B observation', async () => {
        const temp = makeTempDir();
        const harness = await startHarness(temp.dir);
        try {
            const signedJobEnvelope = await signedJob(temp.dir);
            const response = await postJobs(harness.url, signedJobEnvelope, REMOTE_SECRET);
            expect(response.status).toBe(200);

            const payload = (await response.json()) as unknown;
            const result = await verifyResultSignature(payload, REMOTE_SECRET);
            expect(result.ok).toBe(true);
            expect(result.outcome).toBe('PASS');
            expect(result.jobId).toBe('job-server-1');
            expect(result.remoteRuntimeKey).toBe(AGY_RUNTIME_KEY);
            expect(result.observationId).not.toBe(null);
            // Host B resolved the model from the P5 modelTiers map (worker-build tier = balanced).
            expect(result.evidence.model).toBe('gemini-4-argon-high');
            expect(result.evidence.effort).toBe('high');
            expect(result.evidence.modelSource).toBe('tier');
            expect(result.evidence.errorCode).toBe(undefined);

            expect(harness.fake.observations).toHaveLength(1);
            const observation = harness.fake.observations[0];
            expect(observation.observationId).toBe(result.observationId);
            expect(observation.traceId).toBe('job-server-1');
            expect(observation.runtimeKey).toBe(AGY_RUNTIME_KEY);
            expect(observation.hostId).toBe('agy');
            expect(observation.workerId).toBe('worker-build');
            expect(observation.event).toBe('worker.completed');
            expect(observation.outcome).toBe('PASS');
            expect(observation.idempotencyKey).toBe('job-server-1:worker-build:1');

            const serialized = JSON.stringify(harness.fake.observations) + JSON.stringify(result);
            expect(serialized.includes(PROMPT)).toBe(false);
            expect(serialized.includes(REMOTE_SECRET)).toBe(false);
            expect(serialized.includes(B_HOST_TOKEN)).toBe(false);
            const logs = harness.logs.join('\n');
            expect(logs.includes(PROMPT)).toBe(false);
            expect(logs.includes(REMOTE_SECRET)).toBe(false);
            expect(logs.includes(B_HOST_TOKEN)).toBe(false);
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('replays a completed job from the persistent ledger without a second run', async () => {
        const temp = makeTempDir();
        const harness = await startHarness(temp.dir);
        try {
            const signedJobEnvelope = await signedJob(temp.dir);
            const first = await postJobs(harness.url, signedJobEnvelope, REMOTE_SECRET);
            const firstPayload = (await first.json()) as unknown;
            const second = await postJobs(harness.url, signedJobEnvelope, REMOTE_SECRET);
            const secondPayload = (await second.json()) as unknown;
            expect(second.status).toBe(200);
            expect(JSON.stringify(secondPayload)).toBe(JSON.stringify(firstPayload));
            expect(harness.fake.observations).toHaveLength(1);
            expect(harness.logs.some((line) => line.includes('replay job=job-server-1'))).toBe(true);
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('replays a job from the ledger after a server restart', async () => {
        const temp = makeTempDir();
        const first = await startHarness(temp.dir);
        const signedJobEnvelope = await signedJob(temp.dir);
        const firstResponse = await postJobs(first.url, signedJobEnvelope, REMOTE_SECRET);
        const firstPayload = await firstResponse.json();
        const ledgerPath = first.ledgerPath;
        await first.stop();

        const fake2 = fakeEso(await makeModeBSnapshot(null, {}, { modelTiers: TIERS }));
        const restarted = await startHarness(temp.dir, { ledgerPath, fetchImpl: fake2.fetchImpl });
        try {
            const replay = await postJobs(restarted.url, signedJobEnvelope, REMOTE_SECRET);
            expect(replay.status).toBe(200);
            expect(await replay.json()).toEqual(firstPayload);
            expect(fake2.observations).toHaveLength(0);
            expect(restarted.logs.some((line) => line.includes('replay job=job-server-1'))).toBe(true);
        } finally {
            await restarted.stop();
            temp.cleanup();
        }
    });

    it('validates the workspace before returning a ledger replay (R7d)', async () => {
        const temp = makeTempDir();
        const harness = await startHarness(temp.dir);
        try {
            const firstJob = await signedJob(temp.dir);
            const first = await postJobs(harness.url, firstJob, REMOTE_SECRET);
            expect(first.status).toBe(200);

            // Same jobId (already in the ledger) but the workspace is no longer valid.
            const badWorkspaceReplay = await signedJob(temp.dir, {
                workspaceRef: { repo: `${temp.dir}/gone` },
            });
            const rejected = await postJobs(harness.url, badWorkspaceReplay, REMOTE_SECRET);
            expect(rejected.status).toBe(422);
            expect(((await rejected.json()) as { code: string }).code).toBe('WORKSPACE_MISSING');

            const validReplay = await postJobs(harness.url, firstJob, REMOTE_SECRET);
            expect(validReplay.status).toBe(200);
            expect(harness.logs.some((line) => line.includes('workspace rejected'))).toBe(true);
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('rejects invalid JSON and oversized bodies', async () => {
        const temp = makeTempDir();
        const harness = await startHarness(temp.dir, { maxBodyBytes: 4000 });
        try {
            const badJson = await fetch(`${harness.url}/jobs`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${REMOTE_SECRET}` },
                body: '{not json',
            });
            expect(badJson.status).toBe(400);

            let oversizeStatus = 0;
            try {
                const oversize = await fetch(`${harness.url}/jobs`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', authorization: `Bearer ${REMOTE_SECRET}` },
                    body: JSON.stringify({ envelope: { filler: 'x'.repeat(6000) }, signature: 'a'.repeat(64) }),
                });
                oversizeStatus = oversize.status;
            } catch {
                oversizeStatus = 413; // Bun may reject the body before the handler sees it.
            }
            expect([413, 400]).toContain(oversizeStatus);
            expect(harness.fake.observations).toHaveLength(0);
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('refuses to start without a secret or host token', async () => {
        const temp = makeTempDir();
        try {
            expect(() =>
                startRemoteServer({
                    runtimeKey: AGY_RUNTIME_KEY,
                    port: 0,
                    secret: 'short',
                    esoBaseUrl: 'http://eso.test',
                    consumer: TEST_CONSUMER,
                    hostToken: B_HOST_TOKEN,
                }),
            ).toThrow();
            expect(() =>
                startRemoteServer({
                    runtimeKey: AGY_RUNTIME_KEY,
                    port: 0,
                    secret: REMOTE_SECRET,
                    esoBaseUrl: 'http://eso.test',
                    consumer: TEST_CONSUMER,
                    hostToken: '',
                }),
            ).toThrow();
            expect(() =>
                startRemoteServer({
                    runtimeKey: AGY_RUNTIME_KEY,
                    port: 0,
                    secret: REMOTE_SECRET,
                    esoBaseUrl: 'http://eso.test',
                    consumer: TEST_CONSUMER,
                    hostToken: B_HOST_TOKEN,
                }),
            ).toThrow('ESO_REMOTE_ALLOWED_WS');
        } finally {
            temp.cleanup();
        }
    });
    it('rejects expired jobs and replayed nonces', async () => {
        const temp = makeTempDir('hr-server-replay-');
        const harness = await startHarness(temp.dir);
        try {
            const expired = await signedJob(temp.dir, {
                jobId: 'job-expired',
                nonce: 'nonce-expired',
                createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            });
            const expiredResponse = await postJobs(harness.url, expired, REMOTE_SECRET);
            expect(expiredResponse.status).toBe(422);
            expect((await expiredResponse.json()).code).toBe('JOB_EXPIRED');

            const first = await signedJob(temp.dir, { jobId: 'job-nonce-a', nonce: 'nonce-shared' });
            expect((await postJobs(harness.url, first, REMOTE_SECRET)).status).toBe(200);
            const second = await signedJob(temp.dir, { jobId: 'job-nonce-b', nonce: 'nonce-shared' });
            const replayResponse = await postJobs(harness.url, second, REMOTE_SECRET);
            expect(replayResponse.status).toBe(409);
            expect((await replayResponse.json()).code).toBe('JOB_REPLAY');
        } finally {
            await harness.stop();
            temp.cleanup();
        }
    });

    it('requires TLS beyond loopback or when requireTls is set', async () => {
        const temp = makeTempDir('hr-server-tls-');
        try {
            const base: RemoteServerOptions = {
                runtimeKey: AGY_RUNTIME_KEY,
                port: 0,
                host: '0.0.0.0',
                secret: REMOTE_SECRET,
                esoBaseUrl: 'http://eso.test',
                consumer: TEST_CONSUMER,
                hostToken: B_HOST_TOKEN,
                allowedWorkspaces: [temp.dir],
            };
            expect(() => startRemoteServer(base)).toThrow(/TLS is required/);
            expect(() => startRemoteServer({ ...base, host: '127.0.0.1', requireTls: true })).toThrow(/TLS is required/);
        } finally {
            temp.cleanup();
        }
    });

    it('rejects mTLS config without server TLS material', () => {
        expect(() => startRemoteServer({
            runtimeKey: AGY_RUNTIME_KEY,
            port: 0,
            host: '127.0.0.1',
            secret: REMOTE_SECRET,
            esoBaseUrl: 'http://eso.test',
            consumer: TEST_CONSUMER,
            hostToken: B_HOST_TOKEN,
            allowedWorkspaces: ['/tmp'],
            mtls: { ca: 'ca.pem' },
        })).toThrow(/mTLS requires/);
    });

});
