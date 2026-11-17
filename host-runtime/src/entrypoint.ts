/**
 * Host runtime entrypoint — the ONE place a user prompt becomes host-side work.
 *
 *   prompt -> config snapshot (ESO, read-only) -> worker -> tier/model -> adapter -> evidence
 *          -> host-side flow step -> observation (ESO, append-only)
 *
 * ESO is never asked to run, queue, claim or advance anything, and no model is called inside ESO.
 * `--dry-run` forces the deterministic dry adapter but still writes a REAL observation: that is
 * what makes the dry integration verifiable end to end without calling a model.
 */

import { ConfigClient, findHostRuntime, splitRuntimeKey, validateSnapshotVersion } from './config-client';
import type { ConfigSnapshot, FetchLike, SnapshotFlow, SnapshotHostRuntime } from './config-client';
import { nextEdge } from './flow-engine';
import { WorkerPolicyError, selectWorker, selectWorkerById } from './worker-policy';
import type { WorkerSelection } from './worker-policy';
import { ModelUnavailableError, resolveModel } from './model-resolver';
import type { ModelResolution } from './model-resolver';
import { buildPrompt } from './prompt-builder';
import { buildBlockedEvidence, buildEvidence, eventForOutcome } from './evidence';
import type { EvidenceRedaction, Outcome, WorkerEvidence } from './evidence';
import { ObservationClient, ObservationClientError, buildObservationBody } from './observation-client';
import { DryAdapter } from './adapters/dry';
import { CursorAdapter } from './adapters/cursor';
import { AgyAdapter } from './adapters/agy';
import { DEFAULT_TIMEOUT_MS } from './adapters/types';
import type { AdapterName, AdapterRequest, HostAdapter } from './adapters/types';

/** Host-side hard cap on flow steps for one prompt (ESO has no say in this). */
export const MAX_HOST_STEPS = 20;
export const DEFAULT_MAX_STEPS = 1;

export type AuthKind = 'host' | 'operator';

export interface EntrypointOptions {
    baseUrl: string;
    authToken?: string;
    authKind?: AuthKind;
    consumer: string;
    runtimeKey: string;
    prompt: string;
    flowId?: string;
    workerId?: string;
    adapter?: AdapterName;
    model?: string;
    maxSteps?: number;
    dryRun?: boolean;
    timeoutMs?: number;
    cwd?: string;
    traceId?: string;
    fetchImpl?: FetchLike;
    sleepImpl?: (ms: number) => Promise<void>;
    /** Offline mode: config must come from the local snapshot cache. */
    offline?: boolean;
    cacheDir?: string;
    bufferDir?: string;
    /** Test seam: use this adapter instead of constructing one by name. */
    adapterOverride?: HostAdapter;
    env?: Record<string, string | undefined>;
    homeDir?: string;
    log?: (line: string) => void;
}

export interface StepReport {
    hostStep: number;
    workerId: string | null;
    adapter: string;
    model: string | null;
    modelSource?: string;
    tier?: string | null;
    effort?: string | null;
    outcome: Outcome;
    event: 'worker.completed' | 'worker.failed';
    observationId: string;
    observationCreated: boolean;
    exitCode: number | null;
    durationMs: number;
    timedOut: boolean;
    nextWorkerId: string | null;
    warning?: string;
}

export interface RunReport {
    ok: boolean;
    traceId: string;
    consumer: string;
    runtimeKey: string;
    auth: AuthKind;
    flowId: string | null;
    adapter: string;
    dryRun: boolean;
    maxSteps: number;
    snapshotVersion: string;
    snapshotVersionValid: boolean;
    steps: StepReport[];
    stoppedReason: string;
    /** Non-fatal hardening warnings (cache fallback, buffered observations, tier gaps). */
    warnings: string[];
    snapshotSource: 'network' | 'cache';
}

export type EntrypointErrorCode =
    | 'INVALID_RUNTIME_KEY'
    | 'FLOW_NOT_FOUND'
    | 'HOST_RUNTIME_NOT_FOUND'
    | 'SNAPSHOT_VERSION_MISMATCH'
    | 'ADAPTER_UNKNOWN';

export class EntrypointError extends Error {
    readonly code: EntrypointErrorCode;

    constructor(code: EntrypointErrorCode, message: string) {
        super(message);
        this.name = 'EntrypointError';
        this.code = code;
    }
}

export function clampMaxSteps(value: number | undefined): number {
    const requested = Number.isFinite(value) ? Math.trunc(Number(value)) : DEFAULT_MAX_STEPS;
    if (!Number.isFinite(requested) || requested < 1) return DEFAULT_MAX_STEPS;
    return Math.min(requested, MAX_HOST_STEPS);
}

function createAdapter(name: string, options: { env?: Record<string, string | undefined>; homeDir?: string }): HostAdapter {
    switch (name) {
        case 'dry':
            return new DryAdapter();
        case 'cursor':
            return new CursorAdapter({ env: options.env, homeDir: options.homeDir });
        case 'agy':
            return new AgyAdapter({ env: options.env, homeDir: options.homeDir });
        default:
            throw new EntrypointError('ADAPTER_UNKNOWN', `Unknown adapter: ${name} (expected dry | cursor | agy)`);
    }
}

function selectFlow(snapshot: ConfigSnapshot, requestedFlowId?: string): SnapshotFlow {
    const flow = snapshot.flow;
    if (!flow) throw new EntrypointError('FLOW_NOT_FOUND', 'Config snapshot has no published flow');
    const requested = (requestedFlowId ?? '').trim();
    if (requested && requested !== flow.id) {
        throw new EntrypointError(
            'FLOW_NOT_FOUND',
            `Requested flow ${requested} is not the published flow in the snapshot (${flow.id})`,
        );
    }
    return flow;
}

export async function runEntrypoint(options: EntrypointOptions): Promise<RunReport> {
    const log = options.log ?? (() => undefined);
    const traceId = (options.traceId ?? crypto.randomUUID()).trim();
    if (!traceId) throw new EntrypointError('INVALID_RUNTIME_KEY', 'traceId must not be empty');

    try {
        splitRuntimeKey(options.runtimeKey);
    } catch (error) {
        throw new EntrypointError('INVALID_RUNTIME_KEY', error instanceof Error ? error.message : String(error));
    }

    const consumer = options.consumer;
    const runtimeKey = options.runtimeKey;
    const maxSteps = clampMaxSteps(options.maxSteps);
    const dryRun = Boolean(options.dryRun);
    const adapterName = options.adapterOverride
        ? String(options.adapterOverride.name)
        : dryRun
            ? 'dry'
            : (options.adapter ?? 'dry');
    const authKind: AuthKind = options.authKind ?? 'operator';

    const configClient = new ConfigClient({
        baseUrl: options.baseUrl,
        consumer,
        runtimeKey,
        token: options.authToken,
        fetchImpl: options.fetchImpl,
        cacheDir: options.cacheDir,
        offline: options.offline,
    });
    const observationClient = new ObservationClient({
        baseUrl: options.baseUrl,
        consumer,
        token: options.authToken,
        fetchImpl: options.fetchImpl,
        sleepImpl: options.sleepImpl,
        cacheDir: options.cacheDir,
        bufferDir: options.bufferDir,
    });

    const warnings: string[] = [];

    // Best-effort replay of observations buffered by earlier offline runs.
    try {
        const flushed = await observationClient.flushBuffer();
        if (flushed.flushed > 0) {
            warnings.push(`OBSERVATIONS_FLUSHED:${flushed.flushed}`);
            log(`[info] flushed ${flushed.flushed} buffered observation(s)`);
        }
        if (flushed.remaining > 0) {
            warnings.push(`OBSERVATIONS_FLUSH_REMAINING:${flushed.remaining}`);
        }
    } catch {
        warnings.push('OBSERVATIONS_FLUSH_FAILED');
    }

    const snapshot = await configClient.getSnapshot();
    const validation = await validateSnapshotVersion(snapshot);
    if (!validation.ok) {
        throw new EntrypointError(
            'SNAPSHOT_VERSION_MISMATCH',
            `Config snapshot failed validation: ${validation.reason ?? 'unknown'} (expected ${validation.expected || 'n/a'}, got ${validation.actual || 'n/a'})`,
        );
    }

    if (configClient.lastSource === 'cache') {
        const age = configClient.lastCacheAgeMs ?? 0;
        warnings.push(`SNAPSHOT_CACHE_USED:ageMs=${age}`);
        log(`[warn] SNAPSHOT_CACHE_USED ageMs=${age} (control plane unavailable; using last valid snapshot)`);
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

    if (validation.canonicalization === 'eso-date-collapse') {
        log('[info] snapshot version validated with ESO date-collapse canonicalization (host lastHeartbeat Date hashed as {})');
    }

    const flow = selectFlow(snapshot, options.flowId);
    if (!flow.nodes?.length) {
        throw new EntrypointError('FLOW_NOT_FOUND', `Flow ${flow.id} has no worker nodes`);
    }

    const runtime: SnapshotHostRuntime | null = findHostRuntime(snapshot, runtimeKey);
    if (!runtime) {
        throw new EntrypointError('HOST_RUNTIME_NOT_FOUND', `Runtime ${runtimeKey} is not registered in the config snapshot`);
    }

    const adapter = options.adapterOverride
        ?? createAdapter(adapterName, { env: options.env, homeDir: options.homeDir });
    const redaction: EvidenceRedaction = { prompt: options.prompt, secrets: options.authToken ? [options.authToken] : [] };

    const steps: StepReport[] = [];
    let stoppedReason = 'flow-end';
    let ok = true;

    const appendStep = async (input: {
        workerId: string | null;
        hostStep: number;
        evidence: WorkerEvidence;
        nextWorkerId?: string | null;
        warning?: string;
    }): Promise<StepReport> => {
        const outcome = input.evidence.outcome;
        const event = eventForOutcome(outcome);
        const body = buildObservationBody({
            traceId,
            runtimeKey,
            workerId: input.workerId,
            hostStep: input.hostStep,
            event,
            outcome,
            evidence: input.evidence,
        });
        let written: { created: boolean; observation: { observationId: string } } | null = null;
        let buffered = false;
        try {
            written = await observationClient.append(body);
        } catch (error) {
            if (error instanceof ObservationClientError && error.buffered) {
                buffered = true;
                warnings.push(`OBSERVATIONS_BUFFERED:${body.observationId}`);
                log(`[warn] OBSERVATIONS_BUFFERED observation=${body.observationId} (will replay later)`);
            } else {
                throw error;
            }
        }
        const step: StepReport = {
            hostStep: input.hostStep,
            workerId: input.workerId,
            adapter: input.evidence.adapter,
            model: input.evidence.model,
            modelSource: input.evidence.modelSource,
            tier: input.evidence.tier,
            outcome,
            event,
            observationId: written?.observation.observationId ?? body.observationId,
            observationCreated: written?.created ?? false,
            exitCode: input.evidence.exitCode,
            durationMs: input.evidence.durationMs,
            timedOut: input.evidence.timedOut,
            nextWorkerId: input.nextWorkerId ?? null,
        };
        if (input.evidence.effort) step.effort = input.evidence.effort;
        if (input.warning) step.warning = input.warning;
        if (buffered) step.warning = step.warning ? `${step.warning},OBSERVATIONS_BUFFERED` : 'OBSERVATIONS_BUFFERED';
        log(
            `[step ${input.hostStep}] worker=${input.workerId ?? 'n/a'} outcome=${outcome} ` +
                `observation=${step.observationId}${written && !written.created ? ' (existing)' : ''}`,
        );
        return step;
    };

    const blockStep = async (input: {
        code: string;
        message: string;
        workerId: string | null;
        hostStep: number;
        model?: string | null;
        tier?: string | null;
    }): Promise<StepReport> => {
        const evidence = buildBlockedEvidence({
            adapter: adapterName,
            model: input.model ?? null,
            tier: input.tier ?? null,
            workerId: input.workerId,
            flowId: flow.id,
            hostStep: input.hostStep,
            reason: input.code,
            detail: input.message,
            redaction,
        });
        return appendStep({ workerId: input.workerId, hostStep: input.hostStep, evidence });
    };

    let current: WorkerSelection;
    try {
        current = selectWorker(snapshot, runtimeKey, options.workerId);
    } catch (error) {
        if (error instanceof WorkerPolicyError) {
            steps.push(
                await blockStep({
                    code: error.code,
                    message: error.message,
                    workerId: options.workerId ?? null,
                    hostStep: 1,
                    tier: null,
                }),
            );
            return finalReport(false, error.code);
        }
        throw error;
    }

    for (let hostStep = 1; hostStep <= maxSteps; hostStep += 1) {
        let resolution: ModelResolution;
        try {
            resolution = resolveModel({
                explicitModel: options.model,
                runtime,
                placement: current.placement,
                runtimeKey,
            });
        } catch (error) {
            if (error instanceof ModelUnavailableError) {
                steps.push(
                    await blockStep({
                        code: error.code,
                        message: error.message,
                        workerId: current.worker.id,
                        hostStep,
                        tier: error.tier,
                    }),
                );
                return finalReport(false, error.code);
            }
            throw error;
        }

        if (resolution.warning) log(`[warn] ${resolution.warning}: worker=${current.worker.id} model=${resolution.model}`);
        if (dryRun && options.adapter && options.adapter !== 'dry') {
            log(`[warn] --dry-run overrides --adapter ${options.adapter} with the deterministic dry adapter`);
        }

        const prompt = buildPrompt({
            consumerId: consumer,
            runtimeKey,
            flow,
            worker: current.worker,
            placement: current.placement,
            model: resolution.model,
            adapter: adapterName,
            userPrompt: options.prompt,
            hostStep,
            maxSteps,
        });
        log(`[step ${hostStep}/${maxSteps}] worker=${current.worker.id} model=${resolution.model} adapter=${adapterName}`);

        const adapterRequest: AdapterRequest = {
            workerId: current.worker.id,
            model: resolution.model,
            ...(resolution.effort ? { effort: resolution.effort } : {}),
            prompt,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            cwd: options.cwd ?? snapshot.consumer.root ?? process.cwd(),
            env: options.env ?? process.env,
        };
        const result = await adapter.run(adapterRequest);

        const evidence = buildEvidence({
            adapter: result.adapter,
            model: resolution.model,
            modelSource: resolution.source,
            tier: resolution.tier,
            effort: resolution.effort,
            workerId: current.worker.id,
            flowId: flow.id,
            hostStep,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdout: result.stdout,
            stderr: result.stderr,
            blocked: result.blocked,
            reason: result.reason,
            detail: result.detail,
            timedOut: result.timedOut,
            redaction,
        });

        const edge = evidence.outcome === 'PASS' ? nextEdge(flow, current.worker.id, evidence.outcome) : null;
        let nextWorkerId: string | null = null;
        let nextSelection: WorkerSelection | null = null;
        if (edge && hostStep < maxSteps) {
            try {
                nextSelection = selectWorkerById(snapshot, runtimeKey, edge.to);
                nextWorkerId = edge.to;
            } catch (error) {
                if (!(error instanceof WorkerPolicyError)) throw error;
                nextWorkerId = edge.to;
            }
        }

        const step = await appendStep({
            workerId: current.worker.id,
            hostStep,
            evidence,
            nextWorkerId: nextSelection ? edge?.to ?? null : null,
            warning: resolution.warning,
        });
        steps.push(step);

        if (evidence.outcome !== 'PASS') {
            ok = false;
            stoppedReason = evidence.outcome;
            break;
        }
        if (!edge) {
            stoppedReason = 'flow-end';
            break;
        }
        if (hostStep >= maxSteps) {
            stoppedReason = 'max-steps';
            break;
        }
        if (!nextSelection) {
            steps.push(
                await blockStep({
                    code: 'WORKER_NOT_PLACED',
                    message: `Flow edge ${current.worker.id} --${evidence.outcome}--> ${edge.to} cannot be placed on runtime ${runtimeKey}`,
                    workerId: edge.to,
                    hostStep: hostStep + 1,
                }),
            );
            ok = false;
            stoppedReason = 'next-worker-unavailable';
            break;
        }
        current = nextSelection;
    }

    return finalReport(ok, stoppedReason);

    function finalReport(reportOk: boolean, reason: string): RunReport {
        return {
            ok: reportOk,
            traceId,
            consumer,
            runtimeKey,
            auth: authKind,
            flowId: flow.id,
            adapter: adapterName,
            dryRun,
            maxSteps,
            snapshotVersion: snapshot.version,
            snapshotVersionValid: validation.ok,
            steps,
            stoppedReason: reason,
            warnings,
            snapshotSource: configClient.lastSource === 'cache' ? 'cache' : 'network',
        };
    }
}
