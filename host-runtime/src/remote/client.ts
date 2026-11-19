/**
 * Mode B dispatch client (host A side): POST a signed job to a remote runtime and verify the
 * signed result. Transport only — orchestration (snapshot, placement, observations) lives in
 * `dispatch.ts`.
 */

import type { FetchLike } from '../config-client';
import { EnvelopeError, signJob, verifyResultSignature } from './envelope';
import type { JobEnvelope, ResultEnvelope, SignedResultEnvelope } from './envelope';

export type RemoteClientErrorCode =
    | 'REMOTE_UNREACHABLE'
    | 'REMOTE_TIMEOUT'
    | 'REMOTE_HTTP_ERROR'
    | 'REMOTE_ENVELOPE_INVALID'
    | 'REMOTE_SIGNATURE_INVALID'
    | 'REMOTE_JOB_MISMATCH';

export class RemoteClientError extends Error {
    readonly code: RemoteClientErrorCode;
    readonly status: number;
    readonly detail?: string;
    /** Error code returned by the remote runtime (for example WORKSPACE_MISSING). */
    readonly serverCode?: string;

    constructor(code: RemoteClientErrorCode, message: string, status = 0, detail?: string, serverCode?: string) {
        super(message);
        this.name = 'RemoteClientError';
        this.code = code;
        this.status = status;
        this.detail = detail;
        this.serverCode = serverCode;
    }
}

export const DEFAULT_REMOTE_TIMEOUT_MS = 15 * 60 * 1000;

export interface DispatchRemoteOptions {
    endpoint: string;
    secret: string;
    timeoutMs?: number;
    fetchImpl?: FetchLike;
    /** Client TLS material for mTLS (Bun fetch `tls` option). */
    tls?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean };
}

export interface DispatchRemoteOutcome {
    job: JobEnvelope;
    result: ResultEnvelope;
    signed: SignedResultEnvelope;
    endpoint: string;
    httpStatus: number;
    durationMs: number;
}

/** endpoint may be `http://host:port` or already end in `/jobs`. */
export function jobEndpoint(endpoint: string): string {
    const raw = (endpoint ?? '').trim();
    if (!raw) throw new RemoteClientError('REMOTE_UNREACHABLE', 'remote endpoint is empty');
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new RemoteClientError('REMOTE_UNREACHABLE', `remote endpoint is not a valid URL: ${raw}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new RemoteClientError('REMOTE_UNREACHABLE', `remote endpoint must be http(s): ${url.protocol}`);
    }
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/jobs') ? path : `${path}/jobs`;
    url.search = '';
    url.hash = '';
    return url.toString();
}

function errorFromResponse(status: number, text: string): RemoteClientError {
    let code = `HTTP_${status}`;
    let message = `remote runtime returned HTTP ${status}`;
    let detail: string | undefined;
    try {
        const body = JSON.parse(text) as { code?: string; message?: string; detail?: string };
        if (body?.code) code = body.code;
        if (body?.message) message = body.message;
        detail = body?.detail;
    } catch {
        if (text) detail = text.slice(0, 300);
    }
    return new RemoteClientError('REMOTE_HTTP_ERROR', `${code}: ${message}`, status, detail, code);
}

export async function dispatchRemote(job: JobEnvelope, options: DispatchRemoteOptions): Promise<DispatchRemoteOutcome> {
    const endpoint = jobEndpoint(options.endpoint);
    const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
    const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS);
    const signedJob = await signJob(job, options.secret);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
        response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authorization: `Bearer ${options.secret.trim()}`,
            },
            body: JSON.stringify(signedJob),
            signal: controller.signal,
            ...(options.tls ? { tls: options.tls } : {}),
        } as any);
    } catch (error) {
        if (controller.signal.aborted) {
            throw new RemoteClientError('REMOTE_TIMEOUT', `remote runtime timed out after ${timeoutMs} ms`);
        }
        throw new RemoteClientError(
            'REMOTE_UNREACHABLE',
            `cannot reach remote runtime at ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
        clearTimeout(timer);
    }

    const text = await response.text();
    const durationMs = Date.now() - startedAt;
    if (!response.ok) throw errorFromResponse(response.status, text);

    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new RemoteClientError('REMOTE_ENVELOPE_INVALID', 'remote result is not valid JSON', response.status);
    }

    let result: ResultEnvelope;
    try {
        result = await verifyResultSignature(payload, options.secret);
    } catch (error) {
        if (error instanceof EnvelopeError) {
            const code = error.code === 'ENVELOPE_SIGNATURE_INVALID' ? 'REMOTE_SIGNATURE_INVALID' : 'REMOTE_ENVELOPE_INVALID';
            throw new RemoteClientError(code, `remote result envelope is not trusted: ${error.message}`, response.status);
        }
        throw error;
    }

    if (result.jobId !== job.jobId) {
        throw new RemoteClientError(
            'REMOTE_JOB_MISMATCH',
            `remote result jobId ${result.jobId} does not match dispatched job ${job.jobId}`,
            response.status,
        );
    }

    return {
        job,
        result,
        signed: payload as SignedResultEnvelope,
        endpoint,
        httpStatus: response.status,
        durationMs,
    };
}
