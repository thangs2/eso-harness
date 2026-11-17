/**
 * Observation client — the ONLY write this host runtime performs against ESO.
 *
 * ESO is an observatory: the host appends immutable observations describing what happened on the
 * host. There is no run/step/claim state and no request to execute anything.
 *
 * Hardening (P5):
 *   - network / 5xx / 429 are retried up to 3 times with exponential backoff + jitter;
 *   - other 4xx are final (auth/validation problems are not transient);
 *   - a final retryable failure appends the observation envelope to a local JSONL buffer instead
 *     of losing evidence; the server-side idempotency key makes replay safe;
 *   - `flushBuffer()` replays buffered observations (idempotent, best effort).
 */

import type { FetchLike } from './config-client';
import type { WorkerEvidence } from './evidence';
import { ObservationBuffer, resolveBufferDir } from './observation-buffer';
import { resolveCacheDir } from './offline-cache';

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
    /** True when the write failed but the observation was persisted to the local buffer. */
    readonly buffered: boolean;
    /** Observation id kept for reporting when buffered. */
    readonly observationId?: string;

    constructor(
        code: string,
        message: string,
        status = 0,
        detail?: string,
        options: { buffered?: boolean; observationId?: string } = {},
    ) {
        super(message);
        this.name = 'ObservationClientError';
        this.code = code;
        this.status = status;
        this.detail = detail;
        this.buffered = options.buffered === true;
        if (options.observationId) this.observationId = options.observationId;
    }
}

export interface ObservationClientOptions {
    baseUrl: string;
    consumer: string;
    token?: string;
    fetchImpl?: FetchLike;
    sleepImpl?: (ms: number) => Promise<void>;
    /** Extra retries after the first attempt (default 3). */
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    randomImpl?: () => number;
    /** Buffer on final retryable failure (default true). */
    bufferEnabled?: boolean;
    /** Explicit buffer dir (default ESO_OBS_BUFFER_DIR or <cacheDir>/observations). */
    bufferDir?: string;
    cacheDir?: string;
}

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_DELAY_MS = 250;
export const DEFAULT_MAX_DELAY_MS = 5_000;
export const DEFAULT_JITTER_RATIO = 0.3;

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Idempotency key derived from trace + worker + host step (server dedupes on it). */
export function idempotencyKeyFor(traceId: string, workerId: string | null, hostStep: number): string {
    return `${traceId}:${workerId ?? 'unknown'}:${hostStep}`;
}

/** Deterministic observation id; a retried POST of the same step is the same observation. */
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

interface ParsedObservationSuccess {
    ok: true;
    result: ObservationWriteResult;
}

function parseObservationSuccess(text: string): ParsedObservationSuccess | { ok: false; reason: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'not valid JSON' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, reason: 'body is not an object' };
    }
    const record = parsed as { created?: unknown; observation?: unknown };
    if (typeof record.created !== 'boolean') {
        return { ok: false, reason: 'created boolean is missing' };
    }
    const observation = record.observation as ObservationRecord | undefined;
    if (!observation || typeof observation !== 'object' || typeof observation.observationId !== 'string' || !observation.observationId.trim()) {
        return { ok: false, reason: 'observation.observationId is missing' };
    }
    return { ok: true, result: { created: record.created, observation } };
}

export interface FlushResult {
    flushed: number;
    remaining: number;
    /** True when another flush owns the buffer (this call did nothing). */
    skipped?: boolean;
}

export class ObservationClient {
    private readonly baseUrl: string;
    private readonly consumer: string;
    private readonly token?: string;
    private readonly fetchImpl: FetchLike;
    private readonly sleepImpl: (ms: number) => Promise<void>;
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly jitterRatio: number;
    private readonly randomImpl: () => number;
    private readonly bufferEnabled: boolean;
    private readonly buffer: ObservationBuffer;

    constructor(options: ObservationClientOptions) {
        this.baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
        this.consumer = options.consumer;
        this.token = options.token;
        this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
        this.sleepImpl = options.sleepImpl ?? defaultSleep;
        this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
        this.baseDelayMs = Math.max(1, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
        this.maxDelayMs = Math.max(this.baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
        this.jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? DEFAULT_JITTER_RATIO));
        this.randomImpl = options.randomImpl ?? (() => Math.random());
        this.bufferEnabled = options.bufferEnabled !== false;
        this.buffer = new ObservationBuffer(
            resolveBufferDir(options.bufferDir, options.cacheDir ?? resolveCacheDir()),
            options.consumer,
        );
    }

    observationsUrl(limit?: number): string {
        const base = `${this.baseUrl}/api/v1/consumers/${encodeURIComponent(this.consumer)}/observations`;
        return typeof limit === 'number' ? `${base}?limit=${limit}` : base;
    }

    bufferPath(): string {
        return this.buffer.filePath;
    }

    bufferedCount(): number {
        return this.buffer.count();
    }

    private headers(): Record<string, string> {
        const headers: Record<string, string> = {
            accept: 'application/json',
            'content-type': 'application/json',
        };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        return headers;
    }

    /** Exponential backoff with bounded multiplicative jitter. */
    private delayForRetry(retry: number): number {
        const exponential = Math.min(this.baseDelayMs * 2 ** (retry - 1), this.maxDelayMs);
        const jitter = 1 + (this.randomImpl() * 2 - 1) * this.jitterRatio;
        return Math.max(1, Math.round(exponential * jitter));
    }

    private bufferObservation(body: ObservationBody): string {
        const appended = this.buffer.append(body);
        return appended.path;
    }

    /**
     * Append one observation. Safe to retry: same idempotency key returns the existing row.
     * On a final retryable failure the envelope is buffered locally and the error is marked
     * `buffered: true` (unless buffering is disabled, e.g. while flushing).
     */
    async append(
        body: ObservationBody,
        options: { bufferOnFailure?: boolean } = {},
    ): Promise<ObservationWriteResult> {
        const bufferOnFailure = options.bufferOnFailure ?? this.bufferEnabled;
        const attempts = this.maxRetries + 1;
        let lastRetryableError: ObservationClientError | null = null;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            let response: Response;
            try {
                response = await this.fetchImpl(this.observationsUrl(), {
                    method: 'POST',
                    headers: this.headers(),
                    body: JSON.stringify(body),
                });
            } catch (error) {
                lastRetryableError = new ObservationClientError(
                    'OBSERVATION_UNREACHABLE',
                    `Cannot reach ESO at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
                );
                if (attempt < attempts) {
                    await this.sleepImpl(this.delayForRetry(attempt));
                    continue;
                }
                break;
            }

            const text = await response.text();
            if (response.ok) {
                const parsedResult = parseObservationSuccess(text);
                if (parsedResult.ok) return parsedResult.result;
                // Malformed 2xx is treated as transient: retry, then buffer instead of losing it.
                lastRetryableError = new ObservationClientError(
                    'OBSERVATION_INVALID_RESPONSE',
                    `Observation response is malformed: ${parsedResult.reason}`,
                    response.status,
                );
                if (attempt < attempts) {
                    await this.sleepImpl(this.delayForRetry(attempt));
                    continue;
                }
                break;
            }

            // Retry only transient failures: network (above), 5xx and 429.
            const retryable = response.status >= 500 || response.status === 429;
            if (!retryable) throw errorFromResponse(response.status, text);
            lastRetryableError = errorFromResponse(response.status, text);
            if (attempt < attempts) {
                await this.sleepImpl(this.delayForRetry(attempt));
                continue;
            }
            break;
        }

        const failure = lastRetryableError ?? new ObservationClientError('OBSERVATION_FAILED', 'Observation write failed');
        if (bufferOnFailure) {
            try {
                this.bufferObservation(body);
                throw new ObservationClientError(
                    'OBSERVATION_BUFFERED',
                    `observation buffered locally after ${attempts} attempt(s): ${failure.message}`,
                    failure.status,
                    this.bufferPath(),
                    { buffered: true, observationId: body.observationId },
                );
            } catch (bufferError) {
                if (bufferError instanceof ObservationClientError && bufferError.code === 'OBSERVATION_BUFFERED') throw bufferError;
                // Buffer write failed: report the original failure.
            }
        }
        throw failure;
    }

    /**
     * Replay buffered observations (oldest first). Idempotent on the server key.
     * A flush claims the buffer atomically; a concurrent flush skips instead of double-posting.
     */
    async flushBuffer(): Promise<FlushResult> {
        const claim = this.buffer.claim();
        if (!claim.claimed) {
            return { flushed: 0, remaining: this.buffer.pending().length, skipped: true };
        }

        const remaining: ObservationBody[] = [];
        let flushed = 0;
        try {
            for (const body of claim.bodies) {
                try {
                    await this.append(body, { bufferOnFailure: false });
                    flushed += 1;
                } catch {
                    remaining.push(body);
                }
            }
            this.buffer.finish(remaining);
        } catch (error) {
            this.buffer.restore();
            throw error;
        }
        return { flushed, remaining: remaining.length };
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
