import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    DEFAULT_MAX_RETRIES,
    ObservationClient,
    ObservationClientError,
    buildObservationBody,
} from '../src/observation-client';
import { ObservationBuffer, resolveBufferDir } from '../src/observation-buffer';
import type { ObservationBody } from '../src/observation-client';
import type { FetchLike } from '../src/config-client';
import type { WorkerEvidence } from '../src/evidence';
import { fakeEso, makeModeBSnapshot, makeTempDir, TEST_CONSUMER, TEST_RUNTIME_KEY } from './remote-fixtures';

const evidence: WorkerEvidence = {
    outcome: 'PASS',
    exitCode: 0,
    durationMs: 1,
    model: 'auto',
    modelSource: 'runtime-default',
    tier: 'balanced',
    adapter: 'stub',
    workerId: 'worker-build',
    flowId: 'that-tinh-tran',
    hostStep: 1,
    stdoutTail: 'ok',
    stderrTail: '',
    promptRedacted: false,
    timedOut: false,
};

function body(traceId = 'p5-trace'): ObservationBody {
    return buildObservationBody({
        traceId,
        runtimeKey: TEST_RUNTIME_KEY,
        workerId: 'worker-build',
        hostStep: 1,
        event: 'worker.completed',
        outcome: 'PASS',
        evidence,
        at: new Date('2026-11-17T00:00:00.000Z'),
    });
}

function client(fetchImpl: FetchLike, bufferDir: string, overrides: Partial<ConstructorParameters<typeof ObservationClient>[0]> = {}): ObservationClient {
    return new ObservationClient({
        baseUrl: 'http://cp.test',
        consumer: TEST_CONSUMER,
        token: 'secret-host-token',
        fetchImpl,
        bufferDir,
        sleepImpl: async () => undefined,
        randomImpl: () => 0.5,
        ...overrides,
    });
}

describe('observation retry + buffer', () => {
    it('retries 5xx with exponential backoff and then succeeds', async () => {
        const temp = makeTempDir('hr-obs-');
        const delays: number[] = [];
        let attempts = 0;
        const fetchImpl: FetchLike = async (_url, init) => {
            attempts += 1;
            if (attempts < 3) return new Response('{"code":"BOOM","message":"boom"}', { status: 503 });
            const sent = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ ok: true, created: true, observation: sent }), { status: 200 });
        };
        try {
            const result = await client(fetchImpl, temp.dir, {
                sleepImpl: async (ms) => {
                    delays.push(ms);
                },
            }).append(body());
            expect(result.created).toBe(true);
            expect(attempts).toBe(3);
            expect(delays).toHaveLength(2);
            expect(delays[0]).toBe(250); // base 250, jitter factor 1
            expect(delays[1]).toBe(500); // exponential x2
        } finally {
            temp.cleanup();
        }
    });

    it('retries 429', async () => {
        const temp = makeTempDir('hr-obs-');
        let attempts = 0;
        const fetchImpl: FetchLike = async (_url, init) => {
            attempts += 1;
            if (attempts === 1) return new Response('{"code":"RATE_LIMIT","message":"slow down"}', { status: 429 });
            const sent = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ ok: true, created: true, observation: sent }), { status: 200 });
        };
        try {
            expect((await client(fetchImpl, temp.dir).append(body())).created).toBe(true);
            expect(attempts).toBe(2);
        } finally {
            temp.cleanup();
        }
    });

    it('does not retry 4xx validation/auth failures', async () => {
        const temp = makeTempDir('hr-obs-');
        let attempts = 0;
        const fetchImpl: FetchLike = async () => {
            attempts += 1;
            return new Response('{"code":"OBSERVATION_INVALID","message":"bad"}', { status: 422 });
        };
        try {
            try {
                await client(fetchImpl, temp.dir).append(body());
                throw new Error('expected append to throw');
            } catch (error) {
                expect(error instanceof ObservationClientError).toBe(true);
                expect((error as ObservationClientError).code).toBe('OBSERVATION_INVALID');
                expect((error as ObservationClientError).buffered).toBe(false);
            }
            expect(attempts).toBe(1);
        } finally {
            temp.cleanup();
        }
    });

    it('buffers the envelope after all retries and reports it', async () => {
        const temp = makeTempDir('hr-obs-');
        let attempts = 0;
        const fetchImpl: FetchLike = async () => {
            attempts += 1;
            throw new Error('connection refused');
        };
        try {
            const clientUnderTest = client(fetchImpl, temp.dir);
            const sentBody = body();
            try {
                await clientUnderTest.append(sentBody);
                throw new Error('expected buffered failure');
            } catch (error) {
                expect(error instanceof ObservationClientError).toBe(true);
                const buffered = error as ObservationClientError;
                expect(buffered.code).toBe('OBSERVATION_BUFFERED');
                expect(buffered.buffered).toBe(true);
                expect(buffered.observationId).toBe(sentBody.observationId);
            }
            expect(attempts).toBe(DEFAULT_MAX_RETRIES + 1);
            const file = clientUnderTest.bufferPath();
            expect(existsSync(file)).toBe(true);
            const lines = readFileSync(file, 'utf8').trim().split('\n');
            expect(lines).toHaveLength(1);
            const stored = JSON.parse(lines[0]) as ObservationBody;
            expect(stored.idempotencyKey).toBe(sentBody.idempotencyKey);
            expect(stored.observationId).toBe(sentBody.observationId);
            // No prompt body, no token in the buffer.
            const text = readFileSync(file, 'utf8');
            expect(text.includes('secret-host-token')).toBe(false);
            expect(text.includes('Implement the ticket')).toBe(false);
            expect(clientUnderTest.bufferedCount()).toBe(1);
        } finally {
            temp.cleanup();
        }
    });

    it('does not buffer when buffering is disabled', async () => {
        const temp = makeTempDir('hr-obs-');
        const fetchImpl: FetchLike = async () => {
            throw new Error('offline');
        };
        try {
            const clientUnderTest = client(fetchImpl, temp.dir, { bufferEnabled: false, maxRetries: 0 });
            try {
                await clientUnderTest.append(body());
                throw new Error('expected failure');
            } catch (error) {
                expect((error as ObservationClientError).buffered).toBe(false);
            }
            expect(clientUnderTest.bufferedCount()).toBe(0);
        } finally {
            temp.cleanup();
        }
    });

    it('flushes buffered observations idempotently', async () => {
        const temp = makeTempDir('hr-obs-');
        const bufferDir = join(temp.dir, 'buffers');
        try {
            const failing: FetchLike = async () => {
                throw new Error('offline');
            };
            const buffering = client(failing, bufferDir, { maxRetries: 0 });
            await buffering.append(body('p5-flush-a')).catch(() => undefined);
            await buffering.append(body('p5-flush-b')).catch(() => undefined);
            expect(buffering.bufferedCount()).toBe(2);

            const snapshot = await makeModeBSnapshot(null);
            const fake = fakeEso(snapshot);
            const replaying = client(fake.fetchImpl, bufferDir);
            const first = await replaying.flushBuffer();
            expect(first).toEqual({ flushed: 2, remaining: 0 });
            expect(replaying.bufferedCount()).toBe(0);
            expect(fake.observations).toHaveLength(2);

            // Replaying again is a no-op, and posting the same bodies again dedupes server-side.
            const second = await replaying.flushBuffer();
            expect(second).toEqual({ flushed: 0, remaining: 0 });
            expect(fake.observations).toHaveLength(2);
        } finally {
            temp.cleanup();
        }
    });

    it('keeps observations that still cannot be flushed', async () => {
        const temp = makeTempDir('hr-obs-');
        try {
            const failing: FetchLike = async () => {
                throw new Error('offline');
            };
            const buffering = client(failing, temp.dir, { maxRetries: 0 });
            await buffering.append(body('p5-keep-a')).catch(() => undefined);
            await buffering.append(body('p5-keep-b')).catch(() => undefined);
            const flushed = await buffering.flushBuffer();
            expect(flushed).toEqual({ flushed: 0, remaining: 2 });
            expect(buffering.bufferedCount()).toBe(2);
        } finally {
            temp.cleanup();
        }
    });

    it('keeps buffer files per consumer and resolves the buffer dir', () => {
        const temp = makeTempDir('hr-obs-');
        try {
            const first = new ObservationBuffer(temp.dir, 'testeso');
            const second = new ObservationBuffer(temp.dir, 'other');
            expect(first.filePath).not.toBe(second.filePath);
            expect(resolveBufferDir('/tmp/explicit', '/tmp/cache', {})).toBe('/tmp/explicit');
            expect(resolveBufferDir(undefined, '/tmp/cache', { ESO_OBS_BUFFER_DIR: '/tmp/env-buf' })).toBe('/tmp/env-buf');
            expect(resolveBufferDir(undefined, '/tmp/cache', {})).toBe(join('/tmp/cache', 'observations'));
        } finally {
            temp.cleanup();
        }
    });
});
