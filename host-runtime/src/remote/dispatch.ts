/**
 * Mode B dispatch orchestration (host A side).
 *
 *   snapshot (ESO, read-only) -> worker/placement check -> remote runtime + remoteUrl
 *   -> signed job envelope -> remote host B -> signed result -> local observation
 *      (event worker.remote.completed / worker.remote.failed, evidence.remoteObservationId)
 *
 * ESO never dispatches, queues or runs anything: A and B each append their own observations.
 */

import { ConfigClient, ConfigClientError, findHostRuntime, splitRuntimeKey, validateSnapshotVersion } from '../config-client';
import type { ConfigSnapshot, FetchLike, SnapshotFlow } from '../config-client';
import { entryWorkerId } from '../flow-engine';
import { FALLBACK_WORKER_ID, findPlacement, findWorker, placementAllows } from '../worker-policy';
import { ObservationClient, ObservationClientError } from '../observation-client';
import { dispatchRemote, RemoteClientError } from './client';
import { createNonce, EnvelopeError } from './envelope';
import type { JobEnvelope, RemoteOutcome, ResultEnvelope, WorkspaceRef } from './envelope';
import type { AuthKind } from '../entrypoint';
import type { AdapterName } from '../adapters/types';

export const DEFAULT_DISPATCH_TIMEOUT_MS = 15 * 60 * 1000;

export type DispatchErrorCode =
    | 'INVALID_RUNTIME_KEY'
    | 'SNAPSHOT_VERSION_MISMATCH'
    | 'SNAPSHOT_CACHE_MISSING'
    | 'SNAPSHOT_CACHE_INVALID'
    | 'SNAPSHOT_CACHE_SCOPE_MISMATCH'
    | 'SNAPSHOT_CACHE_STALE'
    | 'FLOW_NOT_FOUND'
    | 'WORKER_NOT_FOUND'
    | 'WORKER_NOT_PLACED'
    | 'REMOTE_RUNTIME_NOT_FOUND'
    | 'REMOTE_URL_MISSING'
    | 'REMOTE_URL_INVALID'
    | 'WORKSPACE_REF_MISSING'
    | 'DISPATCH_FAILED';

export class DispatchError extends Error {
    readonly code: DispatchErrorCode;
    readonly detail?: string;
    readonly localObservationId: string | null;

    constructor(code: DispatchErrorCode, message: string, detail?: string, localObservationId: string | null = null) {
        super(message);
        this.name = 'DispatchError';
        this.code = code;
        this.detail = detail;
        this.localObservationId = localObservationId;
    }
}

export interface DispatchOptions {
    baseUrl: string;
    authToken?: string;
    authKind?: AuthKind;
    consumer: string;
    fromRuntimeKey: string;
    toRuntimeKey: string;
    prompt: string;
    flowId?: string;
    workerId?: string;
    adapter?: AdapterName;
    dryRun?: boolean;
    model?: string;
    maxSteps?: number;
    timeoutMs?: number;
    remoteTimeoutMs?: number;
    /** Overrides snapshot `remoteUrl` (P4 ESO config may not be live yet). */
    remoteUrl?: string;
    remoteToken: string;
    workspaceRepo?: string;
    workspaceBranch?: string;
    workspaceCommit?: string;
    traceId?: string;
    /** ESO fetch seam (snapshot + observations). */
    fetchImpl?: FetchLike;
    /** Remote transport fetch seam (defaults to the real fetch). */
    remoteFetchImpl?: FetchLike;
    remoteTls?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean };
    sleepImpl?: (ms: number) => Promise<void>;
    /** Offline mode: config must come from the local snapshot cache. */
    offline?: boolean;
    cacheDir?: string;
    bufferDir?: string;
    log?: (line: string) => void;
}

export interface DispatchReport {
    ok: boolean;
    jobId: string;
    fromRuntimeKey: string;
    toRuntimeKey: string;
    remoteUrl: string;
    remoteHttpStatus: number;
    outcome: RemoteOutcome;
    remoteObservationId: string | null;
    localObservationId: string | null;
    localObservationCreated: boolean;
    workerId: string;
    flowId: string;
    snapshotVersion: string;
    snapshotVersionValid: boolean;
    snapshotSource: 'network' | 'cache';
    /** Model resolved by host B (tier map / default / explicit). */
    model: string | null;
    modelSource: string | null;
    effort: string | null;
    tier: string | null;
    transportDurationMs: number;
    durationMs: number;
    /** Non-fatal hardening warnings (cache fallback, buffered observations, tier gaps). */
    warnings: string[];
}

function fail(code: DispatchErrorCode, message: string, detail?: string): never {
    throw new DispatchError(code, message, detail);
}

function selectFlow(snapshot: ConfigSnapshot, requestedFlowId?: string): SnapshotFlow {
    const flow = snapshot.flow;
    if (!flow) fail('FLOW_NOT_FOUND', 'config snapshot has no published flow');
    const requested = (requestedFlowId ?? '').trim();
    if (requested && requested !== flow.id) {
        fail('FLOW_NOT_FOUND', `requested flow ${requested} is not the published flow (${flow.id})`);
    }
    return flow;
}

function selectRemoteWorkerId(snapshot: ConfigSnapshot, flow: SnapshotFlow, requested?: string): string {
    const explicit = (requested ?? '').trim();
    const workerId = explicit || entryWorkerId(flow) || FALLBACK_WORKER_ID;
    const worker = findWorker(snapshot, workerId);
    if (!worker) fail('WORKER_NOT_FOUND', `worker not found in config snapshot: ${workerId}`);
    if (worker.status && worker.status !== 'active') {
        fail('WORKER_NOT_FOUND', `worker ${workerId} is not active (status=${worker.status})`);
    }
    return workerId;
}

function validateRemoteUrl(value: string | null | undefined): string {
    const raw = (value ?? '').trim();
    if (!raw) fail('REMOTE_URL_MISSING', 'no remoteUrl: pass --remote-url or register it on the target host runtime');
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        fail('REMOTE_URL_INVALID', `remoteUrl is not a valid URL: ${raw}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        fail('REMOTE_URL_INVALID', `remoteUrl must be http(s): ${url.protocol}`);
    }
    return raw.replace(/\/+$/, '');
}

function sanitizeIdPart(value: string): string {
    return (value || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function remoteObservationIdFor(fromRuntimeKey: string, toRuntimeKey: string, jobId: string): string {
    return `obs-remote-${sanitizeIdPart(fromRuntimeKey)}-${sanitizeIdPart(toRuntimeKey)}-${sanitizeIdPart(jobId)}`;
}

function remoteIdempotencyKeyFor(fromRuntimeKey: string, toRuntimeKey: string, jobId: string): string {
    return `${jobId}:remote:${fromRuntimeKey}->${toRuntimeKey}`;
}

function hostIdOf(runtimeKey: string): string {
    try {
        return splitRuntimeKey(runtimeKey).hostId;
    } catch {
        return runtimeKey.split(':')[0] ?? runtimeKey;
    }
}

interface LocalObservationInput {
    fromRuntimeKey: string;
    toRuntimeKey: string;
    jobId: string;
    workerId: string;
    outcome: RemoteOutcome;
    event: string;
    evidence: Record<string, unknown>;
}

async function writeLocalObservation(
    client: ObservationClient,
    input: LocalObservationInput,
): Promise<{ observationId: string; created: boolean }> {
    const written = await client.append({
        observationId: remoteObservationIdFor(input.fromRuntimeKey, input.toRuntimeKey, input.jobId),
        traceId: input.jobId,
        hostId: hostIdOf(input.fromRuntimeKey),
        runtimeKey: input.fromRuntimeKey,
        workerId: input.workerId,
        event: input.event,
        outcome: input.outcome,
        evidence: input.evidence,
        at: new Date().toISOString(),
        idempotencyKey: remoteIdempotencyKeyFor(input.fromRuntimeKey, input.toRuntimeKey, input.jobId),
    });
    return { observationId: written.observation.observationId, created: written.created };
}

export async function runDispatch(options: DispatchOptions): Promise<DispatchReport> {
    const log = options.log ?? (() => undefined);
    const startedAt = Date.now();

    try {
        splitRuntimeKey(options.fromRuntimeKey);
        splitRuntimeKey(options.toRuntimeKey);
    } catch (error) {
        fail('INVALID_RUNTIME_KEY', error instanceof Error ? error.message : String(error));
    }
    if (options.fromRuntimeKey === options.toRuntimeKey) {
        fail('INVALID_RUNTIME_KEY', 'fromRuntimeKey and toRuntimeKey must differ');
    }
    if (!options.remoteToken || options.remoteToken.trim().length < 8) {
        fail('DISPATCH_FAILED', 'ESO_REMOTE_TOKEN is required for Mode B dispatch (min 8 characters)');
    }

    const configClient = new ConfigClient({
        baseUrl: options.baseUrl,
        consumer: options.consumer,
        runtimeKey: options.fromRuntimeKey,
        token: options.authToken,
        fetchImpl: options.fetchImpl,
        cacheDir: options.cacheDir,
        offline: options.offline,
    });
    const observationClient = new ObservationClient({
        baseUrl: options.baseUrl,
        consumer: options.consumer,
        token: options.authToken,
        fetchImpl: options.fetchImpl,
        sleepImpl: options.sleepImpl,
        cacheDir: options.cacheDir,
        bufferDir: options.bufferDir,
    });
    const warnings: string[] = [];

    try {
        const flushed = await observationClient.flushBuffer();
        if (flushed.flushed > 0) warnings.push(`OBSERVATIONS_FLUSHED:${flushed.flushed}`);
        if (flushed.remaining > 0) warnings.push(`OBSERVATIONS_FLUSH_REMAINING:${flushed.remaining}`);
    } catch {
        warnings.push('OBSERVATIONS_FLUSH_FAILED');
    }

    let snapshot: ConfigSnapshot;
    try {
        snapshot = await configClient.getSnapshot();
    } catch (error) {
        if (error instanceof ConfigClientError && error.code.startsWith('SNAPSHOT_CACHE_')) {
            fail(error.code as DispatchErrorCode, error.message);
        }
        fail('DISPATCH_FAILED', `cannot read config snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
    const validation = await validateSnapshotVersion(snapshot);
    if (!validation.ok) {
        fail('SNAPSHOT_VERSION_MISMATCH', `config snapshot failed validation: ${validation.reason ?? 'unknown'}`);
    }
    if (configClient.lastSource === 'cache') {
        warnings.push(`SNAPSHOT_CACHE_USED:ageMs=${configClient.lastCacheAgeMs ?? 0}`);
        log(`[warn] SNAPSHOT_CACHE_USED ageMs=${configClient.lastCacheAgeMs ?? 0} (using cached config snapshot)`);
    }
    // Never refresh the offline cache from a cache-derived snapshot: that would reset its age
    // and let stale configuration be accepted forever while ESO is unreachable.
    if (configClient.lastSource === 'network') {
        try {
            configClient.saveSnapshot(snapshot);
        } catch {
            warnings.push('SNAPSHOT_CACHE_WRITE_FAILED');
        }
    }

    const flow = selectFlow(snapshot, options.flowId);
    const workerId = selectRemoteWorkerId(snapshot, flow, options.workerId);

    const placement = findPlacement(snapshot, workerId);
    if (!placement) fail('WORKER_NOT_PLACED', `no host placement configured for worker: ${workerId}`);
    if (!placementAllows(placement, options.toRuntimeKey)) {
        fail(
            'WORKER_NOT_PLACED',
            `worker ${workerId} is not placed on target runtime ${options.toRuntimeKey} ` +
                `(allowed: ${(placement.allowedHosts ?? []).join(', ') || 'none'})`,
        );
    }

    const toRuntime = findHostRuntime(snapshot, options.toRuntimeKey);
    if (!toRuntime) fail('REMOTE_RUNTIME_NOT_FOUND', `target runtime ${options.toRuntimeKey} is not registered in the snapshot`);

    const remoteUrl = validateRemoteUrl(options.remoteUrl ?? toRuntime.remoteUrl ?? null);

    const workspaceRepo = (options.workspaceRepo ?? snapshot.consumer.root ?? '').trim();
    if (!workspaceRepo) fail('WORKSPACE_REF_MISSING', 'no workspace repo: pass --workspace-repo (consumer.root is empty)');
    const workspaceRef: WorkspaceRef = { repo: workspaceRepo };
    if (options.workspaceBranch) workspaceRef.branch = options.workspaceBranch;
    if (options.workspaceCommit) workspaceRef.commit = options.workspaceCommit;

    const jobId = (options.traceId ?? crypto.randomUUID()).trim();
    if (!jobId) fail('INVALID_RUNTIME_KEY', 'traceId/jobId must not be empty');

    const job: JobEnvelope = {
        jobId,
        fromRuntimeKey: options.fromRuntimeKey,
        toRuntimeKey: options.toRuntimeKey,
        workspaceRef,
        workerId,
        flowId: flow.id,
        prompt: options.prompt,
        policy: {
            adapter: options.adapter ?? 'dry',
            dryRun: Boolean(options.dryRun),
            ...(options.model ? { model: options.model } : {}),
            ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
            ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        },
        modelTier: placement.modelTier ?? 'unspecified',
        evidenceRequirements: {},
        createdAt: new Date().toISOString(),
        nonce: createNonce(),
    };

    log(
        `[dispatch] job=${jobId} ${options.fromRuntimeKey} -> ${options.toRuntimeKey} worker=${workerId} ` +
            `adapter=${job.policy.adapter}${job.policy.dryRun ? ' dry-run' : ''} remote=${remoteUrl}`,
    );

    let dispatched: Awaited<ReturnType<typeof dispatchRemote>>;
    try {
        dispatched = await dispatchRemote(job, {
            endpoint: remoteUrl,
            secret: options.remoteToken,
            timeoutMs: options.remoteTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS,
            fetchImpl: options.remoteFetchImpl,
            tls: options.remoteTls,
        });
    } catch (error) {
        const code = error instanceof RemoteClientError || error instanceof EnvelopeError ? error.code : 'DISPATCH_FAILED';
        const detail = error instanceof RemoteClientError ? (error.serverCode ?? error.code) : code;
        const message = error instanceof Error ? error.message : String(error);
        log(`[dispatch] job=${jobId} failed: ${code}`);
        let localObservationId: string | null = null;
        try {
            const written = await writeLocalObservation(observationClient, {
                fromRuntimeKey: options.fromRuntimeKey,
                toRuntimeKey: options.toRuntimeKey,
                jobId,
                workerId,
                outcome: 'BLOCKED',
                event: 'worker.remote.failed',
                evidence: {
                    outcome: 'BLOCKED',
                    remoteRuntimeKey: options.toRuntimeKey,
                    remoteJobId: jobId,
                    workerId,
                    adapter: job.policy.adapter,
                    errorCode: code,
                    errorMessage: message.slice(0, 500),
                },
            });
            localObservationId = written.observationId;
        } catch (observationError) {
            if (observationError instanceof ObservationClientError && observationError.buffered) {
                localObservationId = observationError.observationId ?? null;
                warnings.push(`OBSERVATIONS_BUFFERED:${localObservationId ?? jobId}`);
            }
            // Observation write failed too: the dispatch error is still the primary failure.
        }
        throw new DispatchError('DISPATCH_FAILED', message, detail, localObservationId);
    }

    const { result, httpStatus, durationMs: transportDurationMs } = dispatched;
    if (result.remoteRuntimeKey !== options.toRuntimeKey) {
        fail(
            'DISPATCH_FAILED',
            `remote result came from ${result.remoteRuntimeKey}, expected ${options.toRuntimeKey}`,
        );
    }

    const ok = result.ok && result.outcome === 'PASS';
    const event = ok ? 'worker.remote.completed' : 'worker.remote.failed';
    let localObservationId: string | null = null;
    let localObservationCreated = false;
    try {
        const written = await writeLocalObservation(observationClient, {
            fromRuntimeKey: options.fromRuntimeKey,
            toRuntimeKey: options.toRuntimeKey,
            jobId,
            workerId,
            outcome: result.outcome,
            event,
            evidence: {
                outcome: result.outcome,
                remoteRuntimeKey: result.remoteRuntimeKey,
                remoteObservationId: result.observationId,
                remoteJobId: result.jobId,
                workerId: result.evidence.workerId,
                adapter: result.evidence.adapter,
                model: result.evidence.model,
                ...(result.evidence.modelSource ? { modelSource: result.evidence.modelSource } : {}),
                ...(result.evidence.tier !== undefined ? { tier: result.evidence.tier } : {}),
                ...(result.evidence.effort ? { effort: result.evidence.effort } : {}),
                exitCode: result.evidence.exitCode,
                durationMs: result.evidence.durationMs,
                timedOut: result.evidence.timedOut ?? false,
                transportDurationMs,
                ...(result.evidence.errorCode ? { reason: result.evidence.errorCode } : {}),
            },
        });
        localObservationId = written.observationId;
        localObservationCreated = written.created;
    } catch (error) {
        if (error instanceof ObservationClientError && error.buffered) {
            localObservationId = error.observationId ?? null;
            localObservationCreated = false;
            warnings.push(`OBSERVATIONS_BUFFERED:${localObservationId ?? jobId}`);
            log(`[warn] OBSERVATIONS_BUFFERED local observation ${localObservationId ?? jobId}`);
        } else {
            fail(
                'DISPATCH_FAILED',
                `remote job ${jobId} finished (${result.outcome}) but the local observation could not be written: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    const remoteWarning = result.evidence.errorCode;
    if (remoteWarning && !warnings.includes(remoteWarning)) warnings.push(remoteWarning);

    log(`[dispatch] job=${jobId} outcome=${result.outcome} remoteObservation=${result.observationId ?? 'none'} localObservation=${localObservationId ?? 'none'}`);

    return {
        ok,
        jobId,
        fromRuntimeKey: options.fromRuntimeKey,
        toRuntimeKey: options.toRuntimeKey,
        remoteUrl,
        remoteHttpStatus: httpStatus,
        outcome: result.outcome,
        remoteObservationId: result.observationId,
        localObservationId,
        localObservationCreated,
        workerId,
        flowId: flow.id,
        snapshotVersion: snapshot.version,
        snapshotVersionValid: validation.ok,
        snapshotSource: configClient.lastSource === 'cache' ? 'cache' : 'network',
        model: result.evidence.model,
        modelSource: result.evidence.modelSource ?? null,
        effort: result.evidence.effort ?? null,
        tier: result.evidence.tier ?? null,
        transportDurationMs,
        durationMs: Date.now() - startedAt,
        warnings,
    };
}
