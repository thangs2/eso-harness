import { describe, expect, it } from 'bun:test';
import { RemoteClientError, dispatchRemote, jobEndpoint } from '../src/remote/client';
import { signJob, signResult, verifyJobSignature } from '../src/remote/envelope';
import type { JobEnvelope, ResultEnvelope } from '../src/remote/envelope';
import { AGY_RUNTIME_KEY, REMOTE_SECRET, TEST_RUNTIME_KEY } from './remote-fixtures';

function makeJob(overrides: Partial<JobEnvelope> = {}): JobEnvelope {
    return {
        jobId: 'job-client-1',
        fromRuntimeKey: TEST_RUNTIME_KEY,
        toRuntimeKey: AGY_RUNTIME_KEY,
        workspaceRef: { repo: '/tmp/ws' },
        workerId: 'worker-build',
        flowId: 'that-tinh-tran',
        prompt: 'Implement the ticket on the remote host.',
        policy: { adapter: 'dry', dryRun: true },
        modelTier: 'balanced',
        evidenceRequirements: {},
        createdAt: '2026-11-17T00:00:00.000Z',
        nonce: 'nonce-client',
        ...overrides,
    };
}

function makeResult(jobId: string): ResultEnvelope {
    return {
        jobId,
        ok: true,
        outcome: 'PASS',
        evidence: {
            outcome: 'PASS',
            workerId: 'worker-build',
            adapter: 'dry',
            model: 'gemini-4-argon-medium',
            exitCode: 0,
            durationMs: 0,
            timedOut: false,
        },
        observationId: 'obs-worker-build-1-job-client-1',
        remoteRuntimeKey: AGY_RUNTIME_KEY,
        at: '2026-11-17T00:00:05.000Z',
        nonce: 'result-nonce',
    };
}

function startStub(handler: (request: Request) => Promise<Response> | Response): { url: string; stop: () => Promise<void> } {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler });
    return {
        url: `http://127.0.0.1:${server.port}`,
        stop: async () => {
            await server.stop(true);
        },
    };
}

async function expectClientCode(fn: () => Promise<unknown>, code: string): Promise<RemoteClientError> {
    try {
        await fn();
        throw new Error(`expected RemoteClientError ${code}`);
    } catch (error) {
        expect(error instanceof RemoteClientError).toBe(true);
        expect((error as RemoteClientError).code).toBe(code);
        return error as RemoteClientError;
    }
}

describe('remote dispatch client', () => {
    it('normalizes the /jobs endpoint', () => {
        expect(jobEndpoint('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788/jobs');
        expect(jobEndpoint('http://127.0.0.1:8788/')).toBe('http://127.0.0.1:8788/jobs');
        expect(jobEndpoint('http://127.0.0.1:8788/jobs')).toBe('http://127.0.0.1:8788/jobs');
        expect(jobEndpoint('https://host.example/modeb')).toBe('https://host.example/modeb/jobs');
        expect(() => jobEndpoint('ftp://host')).toThrow(RemoteClientError);
        expect(() => jobEndpoint('')).toThrow(RemoteClientError);
    });

    it('posts a signed job and verifies the signed result', async () => {
        let received: unknown = null;
        const stub = startStub(async (request) => {
            expect(new URL(request.url).pathname).toBe('/jobs');
            expect(request.method).toBe('POST');
            expect(request.headers.get('authorization')).toBe(`Bearer ${REMOTE_SECRET}`);
            received = JSON.parse(await request.text());
            const job = await verifyJobSignature(received, REMOTE_SECRET);
            const signed = await signResult(makeResult(job.jobId), REMOTE_SECRET);
            return new Response(JSON.stringify(signed), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        try {
            const job = makeJob();
            const outcome = await dispatchRemote(job, { endpoint: stub.url, secret: REMOTE_SECRET });
            expect(outcome.result.ok).toBe(true);
            expect(outcome.result.outcome).toBe('PASS');
            expect(outcome.httpStatus).toBe(200);
            expect(outcome.endpoint).toBe(`${stub.url}/jobs`);
            expect(received).not.toBe(null);
        } finally {
            await stub.stop();
        }
    });

    it('rejects a result signed with a different secret', async () => {
        const stub = startStub(async () => {
            const signed = await signResult(makeResult('job-client-1'), 'attacker-secret-999');
            return new Response(JSON.stringify(signed), { status: 200 });
        });
        try {
            await expectClientCode(() => dispatchRemote(makeJob(), { endpoint: stub.url, secret: REMOTE_SECRET }), 'REMOTE_SIGNATURE_INVALID');
        } finally {
            await stub.stop();
        }
    });

    it('maps HTTP auth failures', async () => {
        const stub = startStub(() => new Response(JSON.stringify({ code: 'AUTH_INVALID', message: 'Invalid credentials' }), { status: 401 }));
        try {
            const error = await expectClientCode(() => dispatchRemote(makeJob(), { endpoint: stub.url, secret: REMOTE_SECRET }), 'REMOTE_HTTP_ERROR');
            expect(error.status).toBe(401);
            expect(error.message).toContain('AUTH_INVALID');
        } finally {
            await stub.stop();
        }
    });

    it('times out a slow remote runtime', async () => {
        const stub = startStub(async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
            return new Response('{}', { status: 200 });
        });
        try {
            await expectClientCode(
                () => dispatchRemote(makeJob(), { endpoint: stub.url, secret: REMOTE_SECRET, timeoutMs: 80 }),
                'REMOTE_TIMEOUT',
            );
        } finally {
            await stub.stop();
        }
    });

    it('rejects a signed result for another job id', async () => {
        const stub = startStub(async () => {
            const signed = await signResult(makeResult('other-job'), REMOTE_SECRET);
            return new Response(JSON.stringify(signed), { status: 200 });
        });
        try {
            await expectClientCode(() => dispatchRemote(makeJob(), { endpoint: stub.url, secret: REMOTE_SECRET }), 'REMOTE_JOB_MISMATCH');
        } finally {
            await stub.stop();
        }
    });

    it('reports an unreachable runtime', async () => {
        await expectClientCode(
            () => dispatchRemote(makeJob(), { endpoint: 'http://127.0.0.1:1', secret: REMOTE_SECRET, timeoutMs: 2000 }),
            'REMOTE_UNREACHABLE',
        );
    });
});
