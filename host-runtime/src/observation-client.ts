/**
 * Observation client — the ONLY write this host runtime performs against ESO.
 *
 * ESO is an observatory: the host appends immutable observations describing what happened on the
 * host. There is no run/step/claim state and no request to execute anything.
 *
 * POST /api/v1/consumers/:id/observations
 *   body {observationId, traceId, hostId, runtimeKey, workerId?, event, outcome?, evidence?, at?, idempotencyKey?}
 * Idempotency is server-side on `idempotencyKey`; retries are therefore safe.
 */

import type { FetchLike } from './config-client';
import type { WorkerEvidence } from './evidence';

export interface ObservationBody {
    observationId: string;
    traceId: string;
    hostId: string;
    runtimeKey: string;
    workerId?: string;
    event: string;
    outcome?: string;
    evidence?: WorkerEvidence | Record<string, unknown>;
    at?: string;
    idempotencyKey: string;
}

export interface ObservationRecord {
    observationId: string;
    traceId: string;
    hostId: string;
    runtimeKey: string;
    workerId: string | null;
    event: string;
    outcome: string | null;
    evidence: Record<string, unknown>;
    at: string | null;
    idempotencyKey: string;
    receivedAt?: string | null;
}

export interface ObservationWriteResult {
    created: boolean;
    observation: ObservationRecord;
}

export class ObservationClientError extends Error {
    readonly code: string;
    readonly status: number;
    readonly detail?: string;

    constructor(code: string, message: string, status = 0, detail?: string) {
        super(message);
        this.name = 'ObservationClientError';
        this.code = code;
        this.status = status;
        this.detail = detail;
    }
}

export interface ObservationClientOptions {
    baseUrl: string;
    consumer: string;
    token?: string;
    fetchImpl?: FetchLike;
    sleepImpl?: (ms: number) => Promise<void>;
    maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 250;

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Idempotency key derived from trace + worker + host step (server dedupes on it). */
export function idempotencyKeyFor(traceId: string, workerId: string | null, hostStep: number): string {
    return `${traceId}:${workerId ?? 'unknown'}:${hostStep}`;
}

/**
 * Deterministic observation id; a retried POST of the same step is the same observation.
 * The whole trace id is kept: truncating it collided on the control plane's primary key for traces
 * that share a prefix (e.g. p3-dry-smoke-1 / p3-dry-smoke-2).
 */
export function observationIdFor(traceId: string, workerId: string | null, hostStep: number): string {
    const trace = (traceId || 'notrace').replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 120);
    const worker = (workerId ?? 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
    return `obs-${worker}-${hostStep}-${trace}`;
}

function errorFromResponse(status: number, text: string): ObservationClientError {
    let code = `HTTP_${status}`;
    let message = `Observation request failed with HTTP ${status}`;
    let detail: string | undefined;
    try {
        const body = JSON.parse(text) as { code?: string; message?: string; detail?: string };
        if (body?.code) code = body.code;
        if (body?.message) message = body.message;
        detail = body?.detail;
    } catch {
        if (text) detail = text.slice(0, 500);
    }
    return new ObservationClientError(code, message, status, detail);
}

export class ObservationClient {
    private readonly baseUrl: string;
    private readonly consumer: string;
    private readonly token?: string;
    private readonly fetchImpl: FetchLike;
    private readonly sleepImpl: (ms: number) => Promise<void>;
    private readonly maxAttempts: number;

    constructor(options: ObservationClientOptions) {
        this.baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
        this.consumer = options.consumer;
        this.token = options.token;
        this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
        this.sleepImpl = options.sleepImpl ?? defaultSleep;
        this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    }

    observationsUrl(limit?: number): string {
        const base = `${this.baseUrl}/api/v1/consumers/${encodeURIComponent(this.consumer)}/observations`;
        return typeof limit === 'number' ? `${base}?limit=${limit}` : base;
    }

    private headers(): Record<string, string> {
        const headers: Record<string, string> = {
            accept: 'application/json',
            'content-type': 'application/json',
        };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        return headers;
    }

    /** Append one observation. Safe to retry: same idempotency key returns the existing row. */
    async append(body: ObservationBody): Promise<ObservationWriteResult> {
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            let response: Response;
            try {
                response = await this.fetchImpl(this.observationsUrl(), {
                    method: 'POST',
                    headers: this.headers(),
                    body: JSON.stringify(body),
                });
            } catch (error) {
                lastError = error;
                if (attempt < this.maxAttempts) {
                    await this.sleepImpl(RETRY_DELAY_MS * attempt);
                    continue;
                }
                throw new ObservationClientError(
                    'OBSERVATION_UNREACHABLE',
                    `Cannot reach ESO at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            const text = await response.text();
            if (response.ok) {
                let parsed: { created?: boolean; observation?: ObservationRecord };
                try {
                    parsed = JSON.parse(text) as { created?: boolean; observation?: ObservationRecord };
                } catch {
                    throw new ObservationClientError(
                        'OBSERVATION_INVALID_RESPONSE',
                        'Observation response is not valid JSON',
                        response.status,
                    );
                }
                if (!parsed?.observation) {
                    throw new ObservationClientError(
                        'OBSERVATION_INVALID_RESPONSE',
                        'Observation response is missing the observation record',
                        response.status,
                    );
                }
                return { created: parsed.created !== false, observation: parsed.observation };
            }

            // Retry only transient server failures; auth/validation failures are final.
            if (response.status >= 500 && attempt < this.maxAttempts) {
                lastError = new ObservationClientError('OBSERVATION_FAILED', `HTTP ${response.status}`, response.status, text);
                await this.sleepImpl(RETRY_DELAY_MS * attempt);
                continue;
            }
            throw errorFromResponse(response.status, text);
        }

        throw lastError instanceof Error
            ? lastError
            : new ObservationClientError('OBSERVATION_FAILED', 'Observation write failed');
    }

    /** Read observations back (newest first) — used by the CLI verify/self-check command. */
    async list(limit = 100): Promise<ObservationRecord[]> {
        let response: Response;
        try {
            response = await this.fetchImpl(this.observationsUrl(limit), { method: 'GET', headers: this.headers() });
        } catch (error) {
            throw new ObservationClientError(
                'OBSERVATION_UNREACHABLE',
                `Cannot reach ESO at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        const text = await response.text();
        if (!response.ok) throw errorFromResponse(response.status, text);
        try {
            const parsed = JSON.parse(text) as { items?: ObservationRecord[] };
            return parsed.items ?? [];
        } catch {
            throw new ObservationClientError('OBSERVATION_INVALID_RESPONSE', 'Observation list is not valid JSON', response.status);
        }
    }
}

export function buildObservationBody(input: {
    traceId: string;
    runtimeKey: string;
    workerId: string | null;
    hostStep: number;
    event: string;
    outcome: string;
    evidence: WorkerEvidence;
    at?: Date;
}): ObservationBody {
    const hostId = input.runtimeKey.split(':')[0];
    const body: ObservationBody = {
        observationId: observationIdFor(input.traceId, input.workerId, input.hostStep),
        traceId: input.traceId,
        hostId,
        runtimeKey: input.runtimeKey,
        event: input.event,
        outcome: input.outcome,
        evidence: input.evidence,
        at: (input.at ?? new Date()).toISOString(),
        idempotencyKey: idempotencyKeyFor(input.traceId, input.workerId, input.hostStep),
    };
    if (input.workerId) body.workerId = input.workerId;
    return body;
}
