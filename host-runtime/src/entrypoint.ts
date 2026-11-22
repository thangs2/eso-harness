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
import { buildPrompt, promptFingerprint } from './prompt-builder';
import { buildBlockedEvidence, buildEvidence, eventForOutcome, parseEvidenceReport } from './evidence';
import type { EvidenceRedaction, Outcome, WorkerEvidence } from './evidence';
import { ObservationClient, ObservationClientError, buildObservationBody } from './observation-client';
import { evaluateJudgment } from './judgment-client';
import type { JudgmentGateOptions } from './judgment-client';
import { DryAdapter } from './adapters/dry';
import { CursorAdapter } from './adapters/cursor';
import { AgyAdapter } from './adapters/agy';
import { MainChatAdapter } from './adapters/main-chat';
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
    taskType?: string;
    fetchImpl?: FetchLike;
    sleepImpl?: (ms: number) => Promise<void>;
    /** Execution mode enforced against worker placement. A = local host, B = remote dispatch target. */
    executionMode?: 'A' | 'B';
    /** Offline mode: config must come from the local snapshot cache. */
    offline?: boolean;
    cacheDir?: string;
    bufferDir?: string;
    /** Optional Phase 2 pre-execution judgment gate. Shadow by default; enforce blocks. */
    judgment?: JudgmentGateOptions;
    /** Optional second host call to ask the worker to report tools/files/recon. */
    repromptEvidence?: boolean;
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
    failureKind?: 'INFRA' | 'VERDICT';
    errorCode?: string;
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
    jevMode?: string;
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
        case 'main-chat':
            return new MainChatAdapter({ env: options.env, homeDir: options.homeDir });
        default:
            throw new EntrypointError('ADAPTER_UNKNOWN', `Unknown adapter: ${name} (expected dry | cursor | agy | main-chat)`);
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
    const jevMode = snapshot.consumer?.jev?.mode === 'shadow' || snapshot.consumer?.jev?.mode === 'active' ? snapshot.consumer.jev.mode : 'off';
    const validation = await validateSnapshotVersion(snapshot);
    if (jevMode !== 'off') warnings.push(`JEV_ENGINE_NOT_IMPLEMENTED:${jevMode}`);
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
            ...(input.evidence.failureKind ? { failureKind: input.evidence.failureKind } : {}),
            ...(input.evidence.errorCode ? { errorCode: input.evidence.errorCode } : {}),
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

    const executionMode = options.executionMode ?? 'A';
    const allowedModes = Array.isArray(current.placement?.modes) && current.placement.modes.length > 0 ? current.placement.modes : ['A', 'B'];
    if (!allowedModes.includes(executionMode)) {
        steps.push(
            await blockStep({
                code: 'MODE_NOT_ALLOWED',
                message: `Worker ${current.worker.id} is not allowed in Mode ${executionMode} (allowed: ${allowedModes.join(', ')})`,
                workerId: current.worker.id,
                hostStep: 1,
                tier: current.placement?.modelTier ?? null,
            }),
        );
        return finalReport(false, 'MODE_NOT_ALLOWED');
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
            taskType: options.taskType ?? flow.taskType,
        });
        log(`[step ${hostStep}/${maxSteps}] worker=${current.worker.id} model=${resolution.model} adapter=${adapterName}`);

        // Prompt request metadata only: never the prompt body. Gated by consumer observation consent/events.
        if (snapshot.consumer?.observation?.consent === true && (snapshot.consumer.observation.events ?? []).includes('prompt.submitted')) {
            try {
                await observationClient.append({
                    observationId: `obs-prompt-${traceId}-${current.worker.id}-${hostStep}`.slice(0, 128),
                    traceId,
                    hostId: runtimeKey.split(':')[0],
                    runtimeKey,
                    workerId: current.worker.id,
                    event: 'prompt.submitted',
                    outcome: 'SUBMITTED',
                    evidence: {
                        requestHash: await promptFingerprint(options.prompt),
                        conversationId: options.env?.ESO_CONVERSATION_ID || null,
                        generationId: options.env?.ESO_GENERATION_ID || null,
                        boundaryIndex: Number(options.env?.ESO_BOUNDARY_INDEX) || null,
                        requestLength: options.prompt.length,
                        userQuery: options.prompt.slice(0, 8000),
                        promptText: prompt.slice(0, 4000),
                        promptRedacted: true,
                        workerId: current.worker.id,
                        flowId: flow.id,
                        hostStep,
                        taskType: options.taskType ?? flow.taskType ?? 'build',
                        model: resolution.model,
                        adapter: adapterName,
                        modelSource: resolution.source,
                        tier: resolution.tier,
                        effort: resolution.effort ?? null,
                        context: {
                            workerId: current.worker.id,
                            role: current.worker.role ?? null,
                            layer: current.worker.layer ?? null,
                            scope: current.worker.scope ?? null,
                            capabilities: current.worker.capabilities ?? [],
                            verbs: current.worker.verbs ?? [],
                            qualityBar: current.worker.bar ?? [],
                            escalation: current.worker.escalation ?? null,
                            instructions: (current.worker.instructions ?? '').slice(0, 1200),
                        },
                    },
                    at: new Date().toISOString(),
                    idempotencyKey: `${traceId}:${current.worker.id}:prompt:${hostStep}`,
                });
            } catch (error) {
                warnings.push('PROMPT_OBSERVATION_FAILED');
                log(`[warn] prompt observation failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (options.judgment) {
            const enforcement = options.judgment.enforcement ?? 'shadow';
            try {
                const gate = await evaluateJudgment({
                    baseUrl: options.baseUrl,
                    consumer,
                    token: options.authToken,
                    fetchImpl: options.fetchImpl,
                    options: {
                        ...options.judgment,
                        enforcement,
                        flowId: flow.id,
                        workerId: current.worker.id,
                        intent: options.prompt,
                    },
                });
                if (gate.wouldBlock) {
                    if (enforcement === 'enforce' && gate.decision === 'block') {
                        steps.push(
                            await blockStep({
                                code: 'JUDGMENT_BLOCKED',
                                message: `Judgment blocked: ${gate.level} (${gate.totalGaps} gaps)`,
                                workerId: current.worker.id,
                                hostStep,
                                tier: resolution.tier,
                            }),
                        );
                        return finalReport(false, 'JUDGMENT_BLOCKED');
                    }
                    log(`[warn] judgment shadow: ${gate.level} would block (${gate.totalGaps} gaps)`);
                }
            } catch (error) {
                if (enforcement === 'enforce') {
                    steps.push(
                        await blockStep({
                            code: 'JUDGMENT_UNAVAILABLE',
                            message: error instanceof Error ? error.message : 'judgment unavailable',
                            workerId: current.worker.id,
                            hostStep,
                            tier: resolution.tier,
                        }),
                    );
                    return finalReport(false, 'JUDGMENT_UNAVAILABLE');
                }
                log(`[warn] judgment shadow unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        const adapterRequest: AdapterRequest = {
            workerId: current.worker.id,
            model: resolution.model,
            ...(resolution.effort ? { effort: resolution.effort } : {}),
            prompt,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            cwd: options.cwd ?? snapshot.consumer.root ?? process.cwd(),
            env: options.env ?? process.env,
        };
        let result = await adapter.run(adapterRequest);
        let report = parseEvidenceReport(result.stdout);
        let reprompt: Record<string, unknown> | null = null;
        if (!report && options.repromptEvidence) {
            try {
                const retry = await adapter.run({
                    ...adapterRequest,
                    prompt: 'Report only the evidence from the step you just completed. Do not perform new work.\nEVIDENCE_JSON: {"tools":[],"files":[],"recon":[]}',
                });
                const retryReport = parseEvidenceReport(retry.stdout);
                if (retryReport) report = retryReport;
                reprompt = { used: true, exitCode: retry.exitCode, durationMs: retry.durationMs, reported: Boolean(retryReport) };
            } catch (error) {
                reprompt = { used: true, error: (error as Error)?.message || 'reprompt failed' };
            }
        }
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
            jevMode,
            blocked: result.blocked,
            reason: result.reason,
            detail: result.detail,
            timedOut: result.timedOut,
            promptChars: prompt.length,
            context: {
                workerId: current.worker.id,
                role: current.worker.role ?? null,
                layer: current.worker.layer ?? null,
                scope: current.worker.scope ?? null,
                capabilities: current.worker.capabilities ?? [],
                verbs: current.worker.verbs ?? [],
                qualityBar: current.worker.bar ?? [],
                escalation: current.worker.escalation ?? null,
                instructions: (current.worker.instructions ?? '').slice(0, 1200),
            },
            routing: {
                adapter: adapterName,
                model: resolution.model,
                modelSource: resolution.source,
                tier: resolution.tier,
                effort: resolution.effort ?? null,
                taskType: options.taskType ?? flow.taskType ?? 'build',
            },
            tools: report?.tools ?? [],
            files: report?.files ?? [],
            recon: report?.recon ?? [],
            reprompt: reprompt ?? undefined,
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
            jevMode,
        };
    }
}
