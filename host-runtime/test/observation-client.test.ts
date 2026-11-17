import { describe, expect, it } from 'bun:test';
import {
    ObservationClient,
    ObservationClientError,
    buildObservationBody,
    idempotencyKeyFor,
    observationIdFor,
} from '../src/observation-client';
import type { FetchLike } from '../src/config-client';
import type { WorkerEvidence } from '../src/evidence';

const evidence: WorkerEvidence = {
    outcome: 'PASS',
    exitCode: 0,
    durationMs: 3,
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

describe('observation-client', () => {
    it('derives the idempotency key and observation id from trace + worker + step', () => {
        expect(idempotencyKeyFor('trace-1', 'worker-build', 2)).toBe('trace-1:worker-build:2');
        expect(observationIdFor('trace-1', 'worker-build', 2)).toBe('obs-worker-build-2-trace-1');
        expect(idempotencyKeyFor('trace-1', null, 1)).toBe('trace-1:unknown:1');
    });

    it('keeps traces that share a prefix distinct on the observation primary key', () => {
        const first = observationIdFor('p3-dry-smoke-1', 'worker-build', 1);
        const second = observationIdFor('p3-dry-smoke-2', 'worker-build', 1);
        expect(first).toBe('obs-worker-build-1-p3-dry-smoke-1');
        expect(second).toBe('obs-worker-build-1-p3-dry-smoke-2');
        expect(first).not.toBe(second);
    });

    it('builds the observation body from evidence', () => {
        const body = buildObservationBody({
            traceId: 'trace-1',
            runtimeKey: 'cursor:cursor-agent',
            workerId: 'worker-build',
            hostStep: 2,
            event: 'worker.completed',
            outcome: 'PASS',
            evidence,
            at: new Date('2026-11-17T00:00:00.000Z'),
        });
        expect(body.hostId).toBe('cursor');
        expect(body.runtimeKey).toBe('cursor:cursor-agent');
        expect(body.workerId).toBe('worker-build');
        expect(body.at).toBe('2026-11-17T00:00:00.000Z');
        expect(body.idempotencyKey).toBe('trace-1:worker-build:2');
        expect(body.evidence).toBe(evidence);
    });

    it('appends an observation with auth and parses the created flag', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        const fetchImpl: FetchLike = async (url, init) => {
            calls.push({ url, init });
            const sent = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ ok: true, created: true, observation: { ...sent, receivedAt: 'now' } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        };
        const client = new ObservationClient({ baseUrl: 'http://cp.test/', consumer: 'testeso', token: 'tok', fetchImpl });
        const body = buildObservationBody({
            traceId: 't-1',
            runtimeKey: 'cursor:cursor-agent',
            workerId: 'worker-build',
            hostStep: 1,
            event: 'worker.completed',
            outcome: 'PASS',
            evidence,
        });
        const result = await client.append(body);
        expect(result.created).toBe(true);
        expect(result.observation.observationId).toBe(body.observationId);
        expect(calls[0].url).toBe('http://cp.test/api/v1/consumers/testeso/observations');
        expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
        expect(JSON.parse(String(calls[0].init?.body)).event).toBe('worker.completed');
    });

    it('passes through the server idempotency result (created=false)', async () => {
        const fetchImpl: FetchLike = async (_url, init) => {
            const sent = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ ok: true, created: false, observation: sent }), { status: 200 });
        };
        const client = new ObservationClient({ baseUrl: 'http://cp.test', consumer: 'testeso', fetchImpl });
        const body = buildObservationBody({
            traceId: 't-2',
            runtimeKey: 'cursor:cursor-agent',
            workerId: 'worker-build',
            hostStep: 1,
            event: 'worker.completed',
            outcome: 'PASS',
            evidence,
        });
        expect((await client.append(body)).created).toBe(false);
    });

    it('retries transient 5xx failures', async () => {
        let attempts = 0;
        const fetchImpl: FetchLike = async (_url, init) => {
            attempts += 1;
            if (attempts === 1) return new Response(JSON.stringify({ code: 'BOOM', message: 'boom' }), { status: 503 });
            const sent = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ ok: true, created: true, observation: sent }), { status: 200 });
        };
        const client = new ObservationClient({
            baseUrl: 'http://cp.test',
            consumer: 'testeso',
            fetchImpl,
            sleepImpl: async () => undefined,
        });
        const body = buildObservationBody({
            traceId: 't-3',
            runtimeKey: 'cursor:cursor-agent',
            workerId: 'worker-build',
            hostStep: 1,
            event: 'worker.completed',
            outcome: 'PASS',
            evidence,
        });
        const result = await client.append(body);
        expect(result.created).toBe(true);
        expect(attempts).toBe(2);
    });

    it('does not retry validation failures', async () => {
        let attempts = 0;
        const fetchImpl: FetchLike = async () => {
            attempts += 1;
            return new Response(JSON.stringify({ code: 'OBSERVATION_INVALID', message: 'bad' }), { status: 422 });
        };
        const client = new ObservationClient({ baseUrl: 'http://cp.test', consumer: 'testeso', fetchImpl });
        const body = buildObservationBody({
            traceId: 't-4',
            runtimeKey: 'cursor:cursor-agent',
            workerId: 'worker-build',
            hostStep: 1,
            event: 'worker.completed',
            outcome: 'PASS',
            evidence,
        });
        try {
            await client.append(body);
            throw new Error('expected append to throw');
        } catch (error) {
            expect(error instanceof ObservationClientError).toBe(true);
            expect((error as ObservationClientError).code).toBe('OBSERVATION_INVALID');
            expect((error as ObservationClientError).status).toBe(422);
        }
        expect(attempts).toBe(1);
    });

    it('reports an unreachable observatory after retries (buffering disabled)', async () => {
        let attempts = 0;
        const fetchImpl: FetchLike = async () => {
            attempts += 1;
            throw new Error('connection refused');
        };
        const client = new ObservationClient({
            baseUrl: 'http://cp.test',
            consumer: 'testeso',
            fetchImpl,
            sleepImpl: async () => undefined,
            bufferEnabled: false,
        });
        const body = buildObservationBody({
            traceId: 't-5',
            runtimeKey: 'cursor:cursor-agent',
            workerId: 'worker-build',
            hostStep: 1,
            event: 'worker.completed',
            outcome: 'PASS',
            evidence,
        });
        try {
            await client.append(body);
            throw new Error('expected append to throw');
        } catch (error) {
            expect((error as ObservationClientError).code).toBe('OBSERVATION_UNREACHABLE');
        }
        expect(attempts).toBe(4);
    });

    it('lists observations newest first', async () => {
        const fetchImpl: FetchLike = async (url) => {
            expect(url).toBe('http://cp.test/api/v1/consumers/testeso/observations?limit=5');
            return new Response(JSON.stringify({ items: [{ observationId: 'o1' }, { observationId: 'o2' }] }), { status: 200 });
        };
        const client = new ObservationClient({ baseUrl: 'http://cp.test', consumer: 'testeso', fetchImpl });
        const items = await client.list(5);
        expect(items).toHaveLength(2);
        expect(items[0].observationId).toBe('o1');
    });
});
