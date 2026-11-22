/**
 * Mode B remote server (host B).
 *
 * Exposes:
 *   GET  /health   -> liveness + runtimeKey (no secrets)
 *   POST /jobs     -> bearer auth + signed job envelope -> run the worker locally (Mode A path)
 *                     -> signed result envelope
 *
 * Security posture:
 *   - bearer ESO_REMOTE_TOKEN compared constant-time, plus HMAC verification of the job;
 *   - job must target this runtime and must not originate from it;
 *   - workspace is validated before anything runs (absolute, directory, allowed root, git commit);
 *   - body size capped; prompt/tokens never logged;
 *   - B writes its observation with its own scoped ESO host token (Mode A entrypoint).
 *
 * ESO is not contacted for dispatch: it only receives observations from both hosts.
 */

import { readFileSync } from 'node:fs';

import { constantTimeEqual, createNonce, EnvelopeError, signResult, verifyJobSignature } from './envelope';
import type { JobEnvelope, ResultEnvelope, SignedResultEnvelope } from './envelope';
import { JobLedger, resolveLedgerPath } from './job-ledger';
import { validateWorkspace } from './workspace';
import { runEntrypoint } from '../entrypoint';
import type { AdapterName, HostAdapter } from '../adapters/types';
import type { FetchLike } from '../config-client';

export const DEFAULT_REMOTE_PORT = 8788;
export const DEFAULT_REMOTE_HOST = '127.0.0.1';
export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

const RUNTIME_KEY_PATTERN = /^[^:\s]+:[^:\s]+$/;

export interface RemoteServerOptions {
    runtimeKey: string;
    port: number;
    host?: string;
    /** Shared contract secret (ESO_REMOTE_TOKEN). */
    secret: string;
    esoBaseUrl: string;
    consumer: string;
    /** Host B scoped bearer token for observation writes. */
    hostToken: string;
    /** Required root allow-list (ESO_REMOTE_ALLOWED_WS); serve refuses to start when empty. */
    allowedWorkspaces?: string[];
    maxBodyBytes?: number;
    /** Reject jobs older/newer than this window and reuse of a nonce. */
    replayWindowMs?: number;
    /** Optional TLS material for production transport. */
    tls?: { key: string; cert: string };
    /** Require and verify a client certificate against this CA (mTLS). */
    mtls?: { ca: string };
    /** Reject startup when TLS is not configured, even on loopback. */
    requireTls?: boolean;
    /** ESO fetch seam for tests. */
    fetchImpl?: FetchLike;
    sleepImpl?: (ms: number) => Promise<void>;
    /** Test seam only: replace the adapter (production uses the job policy adapter). */
    adapterOverride?: HostAdapter;
    /** Persistent job ledger path (default ESO_REMOTE_LEDGER or <cacheDir>/modeb-jobs.json). */
    ledgerPath?: string;
    cacheDir?: string;
    ledger?: JobLedger;
    log?: (line: string) => void;
}

export interface RemoteServerHandle {
    runtimeKey: string;
    host: string;
    port: number;
    url: string;
    stop(): Promise<void>;
}

export interface RemoteServerDeps {
    options: RemoteServerOptions;
    log: (line: string) => void;
    ledger: JobLedger;
    nonces: Map<string, number>;
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
}

function bearerOf(request: Request): string {
    const header = (request.headers.get('authorization') ?? '').trim();
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1].trim() : '';
}

function checkAuth(request: Request, secret: string): Response | null {
    const provided = bearerOf(request);
    if (!constantTimeEqual(provided, secret)) {
        return json(401, { code: 'AUTH_INVALID', message: 'Invalid credentials' });
    }
    return null;
}

function ledgerGet(deps: RemoteServerDeps, jobId: string): SignedResultEnvelope | null {
    return deps.ledger.get(jobId);
}

function ledgerSet(deps: RemoteServerDeps, jobId: string, signed: SignedResultEnvelope): void {
    deps.ledger.set(jobId, signed);
}

function resultFromReport(
    job: JobEnvelope,
    runtimeKey: string,
    report: Awaited<ReturnType<typeof runEntrypoint>>,
): ResultEnvelope {
    const step = report.steps[report.steps.length - 1];
    const outcome = step?.outcome ?? (report.ok ? 'PASS' : 'BLOCKED');
    const evidence: ResultEnvelope['evidence'] = {
        outcome,
        workerId: step?.workerId ?? job.workerId,
        adapter: step?.adapter ?? job.policy.adapter,
        model: step?.model ?? null,
        modelSource: step?.modelSource,
        tier: step?.tier ?? null,
        exitCode: step?.exitCode ?? null,
        durationMs: step?.durationMs ?? 0,
        timedOut: step?.timedOut ?? false,
    };
    if (step?.failureKind) evidence.failureKind = step.failureKind;
    if (step?.errorCode) evidence.errorCode = step.errorCode;
    if (step?.effort) evidence.effort = step.effort;
    if (step?.warning) evidence.errorCode = step.warning;
    return {
        jobId: job.jobId,
        ok: report.ok && outcome === 'PASS',
        outcome,
        evidence,
        observationId: step?.observationId ?? null,
        remoteRuntimeKey: runtimeKey,
        at: new Date().toISOString(),
        nonce: createNonce(),
    };
}

async function handleJob(request: Request, deps: RemoteServerDeps): Promise<Response> {
    const { options, log } = deps;
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

    const authFailure = checkAuth(request, options.secret);
    if (authFailure) return authFailure;

    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
        return json(413, { code: 'BODY_TOO_LARGE', message: `job body exceeds ${maxBodyBytes} bytes` });
    }

    let text: string;
    try {
        text = await request.text();
    } catch {
        return json(400, { code: 'JOB_INVALID', message: 'cannot read request body' });
    }
    if (text.length > maxBodyBytes) {
        return json(413, { code: 'BODY_TOO_LARGE', message: `job body exceeds ${maxBodyBytes} bytes` });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        return json(400, { code: 'JOB_INVALID', message: 'job body is not valid JSON' });
    }

    let job: JobEnvelope;
    try {
        job = await verifyJobSignature(payload, options.secret);
    } catch (error) {
        if (error instanceof EnvelopeError) {
            const status = error.code === 'ENVELOPE_SIGNATURE_INVALID' ? 401 : 422;
            return json(status, { code: error.code, message: error.message });
        }
        throw error;
    }

    if (job.toRuntimeKey !== options.runtimeKey) {
        return json(422, {
            code: 'JOB_SCOPE_MISMATCH',
            message: `job targets ${job.toRuntimeKey}, this runtime is ${options.runtimeKey}`,
        });
    }

    // Workspace policy is enforced even for a ledger replay: a cached result is only returned
    // for a workspace that still passes validation (R7d).
    const workspace = await validateWorkspace(job.workspaceRef, {
        allowedRoots: options.allowedWorkspaces ?? [],
        env: process.env,
    });
    if (!workspace.ok || !workspace.realpath) {
        log(`[remote] job=${job.jobId} workspace rejected: ${workspace.code ?? 'WORKSPACE_INVALID'}`);
        return json(422, {
            code: workspace.code ?? 'WORKSPACE_INVALID',
            message: workspace.reason ?? 'workspace is invalid',
        });
    }

    const cached = ledgerGet(deps, job.jobId);
    if (cached) {
        log(`[remote] replay job=${job.jobId} (ledger result)`);
        return json(200, cached);
    }

    const replayWindowMs = options.replayWindowMs ?? 5 * 60_000;
    const createdAt = Date.parse(String((job as any).createdAt ?? ''));
    if (!Number.isFinite(createdAt) || Math.abs(Date.now() - createdAt) > replayWindowMs) {
        return json(422, { code: 'JOB_EXPIRED', message: 'job timestamp is outside the replay window' });
    }
    const now = Date.now();
    for (const [nonce, seenAt] of deps.nonces) if (now - seenAt > replayWindowMs) deps.nonces.delete(nonce);
    if (deps.nonces.has(job.nonce)) {
        return json(409, { code: 'JOB_REPLAY', message: 'job nonce already used' });
    }
    deps.nonces.set(job.nonce, now);

    log(
        `[remote] job=${job.jobId} from=${job.fromRuntimeKey} worker=${job.workerId} ` +
            `workspace=${workspace.realpath} adapter=${job.policy.adapter}${job.policy.dryRun ? ' dry-run' : ''}`,
    );

    let report: Awaited<ReturnType<typeof runEntrypoint>>;
    try {
        report = await runEntrypoint({
            baseUrl: options.esoBaseUrl,
            authToken: options.hostToken,
            authKind: 'host',
            consumer: options.consumer,
            runtimeKey: options.runtimeKey,
            prompt: job.prompt,
            flowId: job.flowId,
            workerId: job.workerId,
            adapter: job.policy.adapter as AdapterName,
            dryRun: job.policy.dryRun,
            model: job.policy.model,
            maxSteps: job.policy.maxSteps ?? 1,
            timeoutMs: job.policy.timeoutMs,
            cwd: workspace.realpath,
            traceId: job.traceId ?? job.jobId,
            taskType: job.taskType,
            executionMode: 'B',
            fetchImpl: options.fetchImpl,
            sleepImpl: options.sleepImpl,
            adapterOverride: options.adapterOverride,
            log: (line) => log(`[remote] ${line}`),
        });
    } catch (error) {
        const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'REMOTE_RUN_FAILED';
        log(`[remote] job=${job.jobId} run failed: ${code}`);
        return json(502, { code, message: 'remote run failed' });
    }

    const result = resultFromReport(job, options.runtimeKey, report);
    const signed = await signResult(result, options.secret);
    ledgerSet(deps, job.jobId, signed);
    log(`[remote] job=${job.jobId} outcome=${result.outcome} observation=${result.observationId ?? 'none'}`);
    return json(200, signed);
}

function readTlsMaterial(fileOrPem: string): string {
    const value = String(fileOrPem ?? '');
    if (value.includes('-----BEGIN')) return value;
    return readFileSync(value, 'utf8');
}

export function startRemoteServer(options: RemoteServerOptions): RemoteServerHandle {
    if (!RUNTIME_KEY_PATTERN.test(options.runtimeKey ?? '')) {
        throw new Error(`serve --runtime-key must be hostId:runtimeId, got: ${options.runtimeKey}`);
    }
    if (!options.hostToken) throw new Error('ESO_HOST_TOKEN (host B scoped token) is required for serve');
    if (!options.secret || options.secret.trim().length < 8) {
        throw new Error('ESO_REMOTE_TOKEN is required for serve (min 8 characters)');
    }
    if (!options.allowedWorkspaces || options.allowedWorkspaces.length === 0) {
        throw new Error('ESO_REMOTE_ALLOWED_WS is required for serve (at least one allowed workspace root)');
    }

    const host = options.host ?? DEFAULT_REMOTE_HOST;
    const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
    if ((options.requireTls || !loopback) && !options.tls) {
        throw new Error('TLS is required for Mode B when listening beyond loopback (pass --tls-key and --tls-cert)');
    }
    const tls = options.tls
        ? {
            key: readTlsMaterial(options.tls.key),
            cert: readTlsMaterial(options.tls.cert),
            ...(options.mtls ? { ca: readTlsMaterial(options.mtls.ca), requestCert: true, rejectUnauthorized: true } : {}),
        }
        : undefined;
    if (options.mtls && !options.tls) throw new Error('mTLS requires --tls-key and --tls-cert');
    const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const ledger = options.ledger
        ?? new JobLedger({
            filePath: options.ledgerPath ?? resolveLedgerPath(undefined, options.cacheDir),
            nowImpl: undefined,
        });
    const deps: RemoteServerDeps = {
        options: { ...options, host },
        log,
        ledger,
        nonces: new Map(),
    };

    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const server = Bun.serve({
        port: options.port,
        hostname: host,
        ...(tls ? { tls } : {}),
        maxRequestBodySize: maxBodyBytes,
        fetch: async (request: Request): Promise<Response> => {
            try {
                const url = new URL(request.url);
                if (url.pathname === '/health') {
                    if (request.method !== 'GET') {
                        return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'use GET /health' });
                    }
                    return json(200, { ok: true, mode: 'B', runtimeKey: options.runtimeKey });
                }
                if (url.pathname === '/jobs') {
                    if (request.method !== 'POST') {
                        return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'use POST /jobs' });
                    }
                    return await handleJob(request, deps);
                }
                return json(404, { code: 'NOT_FOUND', message: 'unknown endpoint' });
            } catch (error) {
                log(`[remote] request failed: ${error instanceof Error ? error.name : 'unknown'}`);
                return json(500, { code: 'REMOTE_INTERNAL', message: 'remote runtime failed' });
            }
        },
    });

    const port = server.port;
    const url = `${tls ? 'https' : 'http'}://${host}:${port}`;
    log(
        `[remote] serve runtimeKey=${options.runtimeKey} url=${url} ` +
            `allowedWorkspaces=${(options.allowedWorkspaces ?? []).join(',') || '(any)'} ledger=${ledger.filePath}`,
    );

    return {
        runtimeKey: options.runtimeKey,
        host,
        port,
        url,
        async stop(): Promise<void> {
            await server.stop(true);
        },
    };
}
