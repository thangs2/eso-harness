import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import {
    REQUEST_SPEC_REF,
    type EvidenceReceipt,
    type TurnVerdict,
    type TurnVerdictLevel,
    type TurnVerdictRuleRef,
} from '../../platform/registry/types.js';
import type { ConfigSnapshotService } from '../config-snapshot/config-snapshot.service.js';
import {
    BRAIN_TIERS,
    JEV_BANDS,
    JEV_DECISIONS,
    PREFLIGHT_STATES,
    type BrainTier,
    type DecisionDistillSignal,
    type DecisionPreflightSignal,
    type DecisionReconSignal,
    type JevBand,
    type JevDecisionKind,
    type JevMode,
    type PreflightState,
} from '../observations/event-contract.js';
import { adjudicateReported } from '../judgment/jev.service.js';
import { GENESIS_HASH, ReceiptService } from '../receipt/receipt.service.js';
import { VerdictService } from '../verdict/verdict.service.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Read-only request projection over the observation log.
 *
 * A request = one trace that contains at least one prompt.submitted observation.
 * ESO does not execute or own the turn; this service only groups immutable observations
 * into the shape the observatory UI needs.
 */

const PIPELINE = [
    ['worker-scout', 'Scout'],
    ['worker-plan', 'Plan'],
    ['worker-build', 'Build'],
    ['worker-verify', 'Verify'],
    ['worker-audit', 'Audit'],
    ['worker-qc', 'QC 1'],
    ['worker-qc-2', 'QC 2'],
    ['worker-fixbug', 'Fixbug'],
] as const;

export interface RequestEvent {
    observationId: string;
    traceId: string;
    hostId: string;
    runtimeKey: string;
    workerId: string | null;
    event: string;
    outcome: string | null;
    at: string;
    evidence: Record<string, unknown>;
}

export interface RequestPipelineStage {
    workerId: string;
    label: string;
    role: string;
    layer: string;
    scope: string;
    capabilities: string[];
    qualityBar: string[];
    status: string;
    event: string;
    at: string;
    durationMs: number;
    errorCode: string;
}

export interface RequestLlmCall {
    id: string;
    workerId: string;
    model: string;
    adapter: string;
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    estimated: boolean;
    outcome: string;
}

export interface RequestSummary {
    id: string;
    traceId: string;
    consumerId: string;
    userQuery: string;
    status: string;
    startedAt: string;
    endedAt: string;
    workers: number;
    events: number;
    inputTokens: number | null;
    outputTokens: number | null;
    model: string;
    workerId: string | null;
    hostId: string;
    hasFailures: boolean;
    conversationId: string;
    generationId: string;
    boundaryIndex: number | null;
    ide: string;
    decisionVerdict: string;
    checksPass: number;
    checksFail: number;
    callCount: number;
    toolCount: number;
    stopStatus: string;
    tokensEstimated: boolean;
}

export interface RequestCheck {
    checkId: string;
    status: 'pass' | 'warn' | 'skip';
    detail: string;
}

/**
 * P6a — host-reported signals projected from the latest `decision.recorded` row that carries any
 * of the four keys. A sub-field is `null` when that row did not report it; the service never
 * infers one signal from another event or from a sibling field.
 */
export interface RequestSignals {
    preflight: DecisionPreflightSignal | null;
    recon: DecisionReconSignal[] | null;
    brainTier: BrainTier | null;
    distill: DecisionDistillSignal | null;
}

export interface RequestReconAdapter {
    id: string;
    label: string;
    kind: string;
    source: string;
    required: boolean;
    status: 'configured' | 'observed' | 'not-captured';
    calls: number;
}

/** P8 — the eight system stages of pipeline v2, in their fixed order (matrix `28`). */
export const REQUEST_SYSTEM_STAGE_IDS = [
    'intake-law',
    'decision-jev',
    'evidence-recon',
    'sufficiency',
    'slp',
    'execution',
    'seal',
    'report',
] as const;
export type RequestSystemStageId = (typeof REQUEST_SYSTEM_STAGE_IDS)[number];

export interface RequestSystemStage {
    id: RequestSystemStageId;
    stepNumber: number;
    title: string;
    sub: string;
    status: 'ok' | 'warn' | 'info' | 'muted';
    tab: 'waterfall' | 'rules' | 'decisions' | 'telemetry';
    details: Array<{ label: string; value: string; detail: string }>;
}

export interface PromptSummary {
    id: string;
    observationId: string;
    traceId: string;
    conversationId: string;
    boundaryIndex: number | null;
    source: 'agent' | 'subagent' | 'swarm';
    sourceLabel: string;
    workerId: string;
    hostId: string;
    runtimeKey: string;
    model: string;
    tier: string;
    userQuery: string;
    promptText: string;
    inputTokens: number | null;
    outputTokens: number | null;
    tokensEstimated: boolean;
    at: string;
    status: string;
}

/**
 * P5a — receipt summary for the detail proof surface (Q5). The full digest stays on
 * GET /consumers/:id/requests/:requestId/receipt; the prefix only points at the sealed record.
 */
export interface RequestReceiptSummary {
    receiptId: string;
    /** Full sealed digest — not a secret; a third party must be able to recompute/verify it. */
    hash: string;
    hashPrefix: string;
    hmacPresent: boolean;
    chained: boolean;
    specVersion: number;
    verdictLevel: TurnVerdictLevel;
    createdAt: string;
}

/** First 12 hex chars: enough to identify the receipt, not enough to be the sealed digest. */
const RECEIPT_HASH_PREFIX_LENGTH = 12;

/** Project a stored receipt into the summary the detail route may expose. */
export function receiptSummary(receipt: EvidenceReceipt): RequestReceiptSummary {
    return {
        receiptId: receipt.receiptId,
        hash: receipt.hash,
        hashPrefix: String(receipt.hash ?? '').slice(0, RECEIPT_HASH_PREFIX_LENGTH),
        hmacPresent: typeof receipt.hmac === 'string' && receipt.hmac.length > 0,
        chained: receipt.prevHash !== GENESIS_HASH,
        specVersion: receipt.specVersion,
        verdictLevel: receipt.verdictLevel,
        createdAt: receipt.createdAt,
    };
}

/**
 * B0-9 (option C) — a reference to the normative page spec, never its prose. The values come from
 * `REQUEST_SPEC_REF` (`platform/registry/types.ts`), the one place that must stay equal to the doc's
 * `sot_doc_version`; `qc/eso-request-spec-ref.test.mjs` enforces the equality at test time.
 */
export interface RequestSpecRef {
    doc: string;
    version: string;
    section: string;
    anchor: string;
}

/**
 * P8 — the host-reported JEV block of the latest `decision.recorded` carrying one, with ESO's
 * adjudication appended (`expectedBand`/`match`). `null` when no decision reported JEV at all —
 * B0-3 stays valid without it, so the detail never fabricates a mode or a band.
 */
export interface RequestJev {
    mode: JevMode;
    consent: boolean;
    confidence: number | null;
    band: JevBand | null;
    decision: JevDecisionKind | null;
    reason: string | null;
    expectedBand: JevBand | null;
    match: boolean;
    at: string;
}

/**
 * P8 — one-row effectiveness summary over the same detail data. No new table and no new
 * observation: every field is a count/boolean derived from the trace, the stages and the verdict.
 */
export interface RequestEffectiveness {
    stepsTotal: number;
    stepsWithEvidence: number;
    rolesAssigned: number;
    rolesObserved: number;
    workersTotal: number;
    workersObserved: number;
    failures: number;
    durationMs: number;
    writeGateChecked: boolean;
    receiptSealed: boolean;
    /** How many proof gaps the verdict carries — the codes stay on `verdict.gaps`, not here. */
    gaps: number;
}

export interface RequestDetail {
    request: {
        id: string;
        traceId: string;
        consumerId: string;
        userQuery: string;
        startedAt: string;
        endedAt: string;
        status: string;
        taskType: string;
        flowId: string;
        workerId: string | null;
        hostId: string;
        runtimeKey: string;
        model: string;
        adapter: string;
        promptHash: string;
        promptLength: number;
    };
    requestMetrics: {
        callCount: number;
        toolCount: number;
        hasFailures: boolean;
        inputTokens: number | null;
        outputTokens: number | null;
        tokensEstimated: boolean;
    };
    pipeline: RequestPipelineStage[];
    events: RequestEvent[];
    context: Record<string, unknown>;
    routing: Record<string, unknown>;
    checks: RequestCheck[];
    recon: RequestReconAdapter[];
    systemStages: RequestSystemStage[];
    telemetry: {
        llmCalls: RequestLlmCall[];
        tools: unknown[];
        files: unknown[];
    };
    /** P2: ESO's adjudication of the host claim — always present on an HTTP detail response. */
    verdict: TurnVerdict;
    /** P5a: summary of the receipt sealing that verdict (full hash is public — it must be verifiable). */
    receipt: RequestReceiptSummary;
    /** P6a: host-reported preflight/recon/brainTier/distill, or `null` when no decision reported one. */
    signals: RequestSignals | null;
    /** P8: the latest host-reported JEV block (adjudicated), or `null` when none was reported. */
    jev: RequestJev | null;
    /** P8: effectiveness of the turn, derived from this same detail — no extra storage. */
    effectiveness: RequestEffectiveness;
    /** P6b: configured pipeline vs observed worker path, so design↔runtime divergence is machine-readable. */
    graph: RequestRuntimeGraph;
    /** B0-9: normative page spec this surface is built against — a pointer, not a copy of the doc. */
    spec: RequestSpecRef;
    /**
     * Q2 — the latest recorded file-write scope decision for this turn, or `null` when the turn
     * recorded none. This is the scope guard's own record; it is never inferred from the verdict.
     */
    writeGate: RequestWriteGate | null;
}

/** Q2 — one scope decision projected for the detail page (`detail.writeGate`). */
export interface RequestWriteGate {
    decisionId: string;
    allowed: boolean;
    code: string | null;
    target: string;
    at: string;
    actor: Record<string, unknown> | null;
}

export interface RequestRuntimeGraph {
    nodes: Array<{ id: string; kind: 'configured' | 'observed' | 'both' }>;
    edges: Array<{ from: string; to: string }>;
    matched: number;
    missing: string[];
    extra: string[];
    divergence: 'matches' | 'missing' | 'extra' | 'reordered' | 'empty';
}

/** Everything `buildRequest` can compute from observations alone; verdict, receipt, signals, jev, stages and effectiveness are appended in `get`. */
type RequestDetailBase = Omit<RequestDetail, 'verdict' | 'receipt' | 'signals' | 'jev' | 'effectiveness' | 'graph' | 'spec' | 'writeGate'>;

function rowField(row: any, ...keys: string[]): any {
    for (const key of keys) {
        if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
    }
    return undefined;
}

function toEvent(row: any): RequestEvent {
    const evidence = rowField(row, 'evidence') ?? {};
    return {
        observationId: String(rowField(row, 'observation_id', 'observationId') ?? ''),
        traceId: String(rowField(row, 'trace_id', 'traceId') ?? ''),
        hostId: String(rowField(row, 'host_id', 'hostId') ?? ''),
        runtimeKey: String(rowField(row, 'runtime_key', 'runtimeKey') ?? ''),
        workerId: rowField(row, 'worker_id', 'workerId') ?? null,
        event: String(rowField(row, 'event') ?? ''),
        outcome: rowField(row, 'outcome') ?? null,
        at: (() => { const value = rowField(row, 'at') ?? rowField(row, 'received_at', 'receivedAt'); if (value instanceof Date) return value.toISOString(); return String(value ?? ''); })(),
        evidence: evidence && typeof evidence === 'object' ? evidence : {},
    };
}

function tokenOf(evidence: Record<string, unknown>): { input: number | null; output: number | null; estimated: boolean } {
    const token = evidence['tokenSummary'] as { input?: number; output?: number; estimated?: boolean } | undefined;
    if (!token) return { input: null, output: null, estimated: false };
    return {
        input: typeof token.input === 'number' ? token.input : null,
        output: typeof token.output === 'number' ? token.output : null,
        estimated: token.estimated === true,
    };
}

function statusOf(events: RequestEvent[]): string {
    if (events.some((event) => event.outcome === 'BLOCKED')) return 'blocked';
    if (events.some((event) => event.outcome === 'FAIL')) return 'failed';
    if (events.some((event) => event.outcome === 'PASS')) return 'completed';
    // prompt.submitted is a request start, not an outcome. A prompt-only turn is
    // submitted; worker events without PASS/FAIL/BLOCKED are still in progress.
    if (events.some((event) => event.event !== 'prompt.submitted')) return 'in_progress';
    return events.length > 0 ? 'submitted' : 'unknown';
}

const SIGNAL_KEYS = ['preflight', 'recon', 'brainTier', 'distill'] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** `null`/`undefined` mean "not reported"; only a real value makes the row a signal carrier. */
function reportsSignals(evidence: Record<string, unknown>): boolean {
    return SIGNAL_KEYS.some((key) => evidence[key] !== undefined && evidence[key] !== null);
}

function pickPreflight(value: unknown): DecisionPreflightSignal | null {
    if (!isPlainRecord(value)) return null;
    const state = value['state'];
    if (typeof state !== 'string' || !(PREFLIGHT_STATES as readonly string[]).includes(state)) return null;
    const fingerprint = value['fingerprint'];
    return typeof fingerprint === 'string' && fingerprint.trim()
        ? { state: state as PreflightState, fingerprint }
        : { state: state as PreflightState };
}

function pickRecon(value: unknown): DecisionReconSignal[] | null {
    if (!Array.isArray(value)) return null;
    const calls: DecisionReconSignal[] = [];
    for (const entry of value) {
        if (!isPlainRecord(entry)) continue;
        const adapter = entry['adapter'];
        const count = entry['calls'];
        if (typeof adapter !== 'string' || !adapter.trim()) continue;
        if (typeof count !== 'number' || !Number.isFinite(count)) continue;
        calls.push({ adapter, calls: count });
    }
    return calls;
}

function pickBrainTier(value: unknown): BrainTier | null {
    return typeof value === 'string' && (BRAIN_TIERS as readonly string[]).includes(value) ? (value as BrainTier) : null;
}

function pickDistill(value: unknown): DecisionDistillSignal | null {
    if (!isPlainRecord(value) || typeof value['memorySaved'] !== 'boolean') return null;
    const lessons = value['lessons'];
    return typeof lessons === 'number' && Number.isInteger(lessons) && lessons >= 0
        ? { memorySaved: value['memorySaved'], lessons }
        : { memorySaved: value['memorySaved'] };
}

/**
 * Project the latest `decision.recorded` row that reports any P6a signal. Rows are already sorted
 * oldest-first by `at`. Sub-fields the winning row omitted stay `null` — an earlier row's signal is
 * not merged in, and no other event kind is consulted.
 */
function signalsOf(events: RequestEvent[]): RequestSignals | null {
    let latest: RequestEvent | undefined;
    for (const event of events) {
        if (event.event !== 'decision.recorded') continue;
        if (!reportsSignals(event.evidence)) continue;
        latest = event;
    }
    if (!latest) return null;
    return {
        preflight: pickPreflight(latest.evidence['preflight']),
        recon: pickRecon(latest.evidence['recon']),
        brainTier: pickBrainTier(latest.evidence['brainTier']),
        distill: pickDistill(latest.evidence['distill']),
    };
}

/**
 * P8 — the latest `decision.recorded` row that carries an `evidence.jev` object, adjudicated
 * against the consumer's JEV thresholds. A later decision without `jev` does not erase the
 * earlier report (the latest *carrier* wins), and nothing is inferred from `jevMode` or verdict.
 */
export function jevOf(events: RequestEvent[], consumerRoot: string): RequestJev | null {
    let latest: RequestEvent | undefined;
    for (const event of events) {
        if (event.event !== 'decision.recorded') continue;
        if (!isPlainRecord(event.evidence['jev'])) continue;
        latest = event;
    }
    if (!latest) return null;
    const reported = latest.evidence['jev'] as Record<string, unknown>;
    const adjudication = adjudicateReported(consumerRoot, reported);
    const band = reported['band'];
    const decision = reported['decision'];
    const reason = reported['reason'];
    const confidence = reported['confidence'];
    return {
        mode: adjudication.mode,
        consent: adjudication.consent,
        confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null,
        band: typeof band === 'string' && (JEV_BANDS as readonly string[]).includes(band) ? band as JevBand : null,
        decision: typeof decision === 'string' && (JEV_DECISIONS as readonly string[]).includes(decision)
            ? decision as JevDecisionKind
            : null,
        reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
        expectedBand: adjudication.expectedBand,
        match: adjudication.match,
        at: latest.at,
    };
}

/** The refs the host cited as law: a path ending in `AGENTS.md` or `CLAUDE.md`. */
const LAW_REF_PATTERN = /(?:^|[/\\])(?:agents|claude)\.md$/i;

export function lawRefsOf(verdict: TurnVerdict): TurnVerdictRuleRef[] {
    return (verdict.ruleRefs || []).filter((ref) => LAW_REF_PATTERN.test(String(ref.path || '')));
}

/** B — law evidence reported by the host hook when it actually read a law file. Weaker than a
 * decision ref: it proves the file was read, not that a decision relied on it. */
export interface LawLoadedRef { path: string; hash: string | null; at: string | null; source: string; }

export function lawLoadedOf(events: ReadonlyArray<RequestEvent>): LawLoadedRef[] {
    const refs: LawLoadedRef[] = [];
    const seen = new Set<string>();
    for (const event of events) {
        if (event.event !== 'law.loaded') continue;
        const evidence = event.evidence || {};
        const path = String(evidence['path'] || '').trim();
        if (!path || !LAW_REF_PATTERN.test(path)) continue;
        const key = `${path}|${String(evidence['hash'] || '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({
            path,
            hash: typeof evidence['hash'] === 'string' ? evidence['hash'] : null,
            at: typeof evidence['at'] === 'string' ? evidence['at'] : null,
            source: typeof evidence['source'] === 'string' ? evidence['source'] : 'host',
        });
    }
    return refs;
}

function durationMsOf(request: RequestDetailBase['request']): number {
    const start = Date.parse(request.startedAt);
    const end = Date.parse(request.endedAt);
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

/**
 * P8 — effectiveness from the detail that was just assembled. `stepsWithEvidence` counts stages
 * that found a real value (`ok`/`warn`); `muted`/`info` stages are the ones that reported
 * `not captured`, so they must not inflate the count.
 */
export function effectivenessOf(detail: RequestDetail, events: RequestEvent[]): RequestEffectiveness {
    const observed = detail.pipeline.filter((stage) => stage.status !== 'PENDING');
    const rolesObserved = new Set(observed.map((stage) => stage.role).filter(Boolean));
    const rolesAssigned = new Set(detail.pipeline.map((stage) => stage.role).filter(Boolean));
    return {
        stepsTotal: detail.systemStages.length,
        stepsWithEvidence: detail.systemStages.filter((stage) => stage.status === 'ok' || stage.status === 'warn').length,
        rolesAssigned: rolesAssigned.size,
        rolesObserved: rolesObserved.size,
        workersTotal: detail.pipeline.length,
        workersObserved: observed.length,
        failures: events.filter((event) => event.outcome === 'FAIL' || event.outcome === 'BLOCKED').length,
        durationMs: durationMsOf(detail.request),
        writeGateChecked: detail.writeGate !== null,
        receiptSealed: Boolean(detail.receipt?.receiptId && detail.receipt?.hashPrefix),
        gaps: (detail.verdict.gaps || []).length,
    };
}

function runtimeGraphOf(events: RequestEvent[], pipeline: RequestDetailBase['pipeline']): RequestRuntimeGraph {
    const configured = [...new Set(pipeline.map((stage) => stage.workerId).filter(Boolean))];
    const workerEvents = new Set(['prompt.submitted', 'worker.completed', 'worker.remote.completed', 'worker.failed', 'worker.remote.failed']);
    const observed = [...new Set(
        events
            .filter((event) => workerEvents.has(event.event) && event.workerId)
            .sort((left, right) => left.at.localeCompare(right.at))
            .map((event) => String(event.workerId)),
    )];
    const missing = configured.filter((id) => !observed.includes(id));
    const extra = observed.filter((id) => !configured.includes(id));
    const matched = configured.filter((id) => observed.includes(id)).length;
    const orderSame = configured.length > 0 && configured.every((id, index) => observed[index] === id);
    const divergence: RequestRuntimeGraph['divergence'] = observed.length === 0
        ? 'empty'
        : missing.length === 0 && extra.length === 0 && orderSame
            ? 'matches'
            : missing.length > 0
                ? 'missing'
                : extra.length > 0
                    ? 'extra'
                    : 'reordered';
    const ids = [...new Set([...configured, ...observed])];
    return {
        nodes: ids.map((id) => ({
            id,
            kind: configured.includes(id) && observed.includes(id) ? 'both' : configured.includes(id) ? 'configured' : 'observed',
        })),
        edges: observed.slice(1).map((id, index) => ({ from: observed[index], to: id })),
        matched,
        missing,
        extra,
        divergence,
    };
}

function buildRequest(consumerId: string, events: RequestEvent[]): RequestDetailBase | null {
    const prompt = events.find((event) => event.event === 'prompt.submitted');
    if (!prompt) return null;
    const startedAt = events[0]?.at || prompt.at;
    const endedAt = events[events.length - 1]?.at || prompt.at;
    const evidence = prompt.evidence;
    const userQuery = typeof evidence['userQuery'] === 'string' ? evidence['userQuery'] : '';
    const workerEvents = (() => {
        const unique = new Map<string, RequestEvent>();
        for (const event of events) {
            if (!event.workerId || event.event === 'prompt.submitted') continue;
            const hostStep = event.evidence['hostStep'];
            const key = `${event.workerId}:${hostStep ?? event.event}`;
            // A remote worker may emit both a local and a remote completion for the same step.
            // Remote rows omit hostStep, so collapse them onto the worker's existing local row.
            const remoteKey = event.event === 'worker.remote.completed'
                ? [...unique.keys()].find((item) => item.startsWith(`${event.workerId}:`))
                : undefined;
            const targetKey = remoteKey || key;
            const current = unique.get(targetKey);
            if (!current || event.event === 'worker.remote.completed') unique.set(targetKey, event);
        }
        return [...unique.values()];
    })();
    const byWorker = new Map<string, RequestEvent[]>();
    for (const event of workerEvents) {
        const key = event.workerId || '';
        if (!byWorker.has(key)) byWorker.set(key, []);
        byWorker.get(key)!.push(event);
    }
    const pipeline: RequestPipelineStage[] = PIPELINE.map(([workerId, label]) => {
        const rows = byWorker.get(workerId) || [];
        const last = rows[rows.length - 1];
        const first = rows[0];
        return {
            workerId,
            label,
            role: '',
            layer: '',
            scope: '',
            capabilities: [],
            qualityBar: [],
            status: last?.outcome || 'PENDING',
            event: last?.event || '—',
            at: last?.at || '',
            durationMs: rows.length
                ? Math.max(0, new Date(last?.at || 0).getTime() - new Date(first?.at || 0).getTime()) || Number((last?.evidence as Record<string, unknown> | undefined)?.['durationMs']) || 0
                : 0,
            errorCode: String((last?.evidence as Record<string, unknown> | undefined)?.['errorCode'] || ''),
        };
    });
    let inputTokens = 0;
    let outputTokens = 0;
    let estimated = false;
    const llmCalls: RequestLlmCall[] = workerEvents.map((event) => {
        const token = tokenOf(event.evidence);
        if (token.input !== null) inputTokens += token.input;
        if (token.output !== null) outputTokens += token.output;
        estimated = estimated || token.estimated;
        return {
            id: event.observationId,
            workerId: event.workerId || '',
            model: String(event.evidence['model'] || '—'),
            adapter: String(event.evidence['adapter'] || '—'),
            durationMs: Number(event.evidence['durationMs']) || 0,
            inputTokens: token.input,
            outputTokens: token.output,
            estimated: token.estimated,
            outcome: event.outcome || '—',
        };
    });
    const tools = workerEvents.flatMap((event) => Array.isArray(event.evidence['tools']) ? event.evidence['tools'] as unknown[] : []);
    const files = workerEvents.flatMap((event) => Array.isArray(event.evidence['files']) ? event.evidence['files'] as unknown[] : []);
    const context = (evidence['context'] as Record<string, unknown> | undefined) || (((workerEvents.find((event) => event.evidence['context'])?.['evidence'] as Record<string, unknown> | undefined)?.['context'] as Record<string, unknown> | undefined)) || {};
    const routing = ((workerEvents.find((event) => event.evidence['routing'])?.['evidence'] as Record<string, unknown> | undefined)?.['routing'] as Record<string, unknown> | undefined)
        || { adapter: evidence['adapter'] ?? '—', model: evidence['model'] ?? '—', tier: evidence['tier'] ?? null, effort: evidence['effort'] ?? null, taskType: evidence['taskType'] ?? '' };
    const status = statusOf(events);
    const checks: RequestCheck[] = [
        { checkId: 'prompt-captured', status: userQuery ? 'pass' : 'warn', detail: userQuery ? `${userQuery.length} chars captured` : 'prompt body not captured for this legacy request' },
        { checkId: 'worker-events', status: workerEvents.length > 0 ? 'pass' : 'warn', detail: `${workerEvents.length} worker event(s)` },
        { checkId: 'outcome-contract', status: events.filter((event) => event.event !== 'prompt.submitted').every((event) => ['PASS', 'FAIL', 'BLOCKED', null].includes(event.outcome)) ? 'pass' : 'warn', detail: 'OUTCOME: PASS|FAIL|BLOCKED on every worker event' },
        { checkId: 'error-classification', status: events.some((event) => event.evidence['failureKind'] === 'INFRA') ? 'warn' : 'pass', detail: events.some((event) => event.evidence['failureKind'] === 'INFRA') ? 'infra failure observed' : 'no infra failure observed' },
        { checkId: 'token-report', status: estimated ? 'warn' : 'skip', detail: estimated ? 'chars/4 estimate, not provider usage' : 'no token measurement' },
        { checkId: 'tool-file-capture', status: tools.length || files.length ? 'pass' : 'skip', detail: tools.length || files.length ? `${tools.length} tools / ${files.length} files` : 'adapter does not expose tool/file operations' },
    ];
    return {
        request: {
            id: prompt.traceId,
            traceId: prompt.traceId,
            consumerId,
            userQuery,
            startedAt,
            endedAt,
            status,
            taskType: String(evidence['taskType'] || ''),
            flowId: String(evidence['flowId'] || ''),
            workerId: prompt.workerId,
            hostId: prompt.hostId,
            runtimeKey: prompt.runtimeKey,
            model: String(evidence['model'] || '—'),
            adapter: String(evidence['adapter'] || '—'),
            promptHash: String(evidence['requestHash'] || '—'),
            promptLength: Number(evidence['requestLength']) || 0,
        },
        requestMetrics: {
            callCount: llmCalls.length,
            toolCount: tools.length,
            hasFailures: status === 'failed' || status === 'blocked',
            inputTokens: inputTokens || null,
            outputTokens: outputTokens || null,
            tokensEstimated: estimated,
        },
        context,
        routing,
        checks,
        recon: [],
        systemStages: [],
        pipeline,
        events: [...events.filter((event) => event.event === 'prompt.submitted'), ...workerEvents].sort((left, right) => left.at.localeCompare(right.at)),
        telemetry: { llmCalls, tools, files },
    };
}

export class RequestService {
    private readonly verdict: VerdictService;
    private readonly receipt: ReceiptService;

    constructor(
        private readonly store: PlatformStore,
        private readonly configSnapshot?: ConfigSnapshotService,
        verdict?: VerdictService,
        receipt?: ReceiptService
    ) {
        this.verdict = verdict ?? new VerdictService(store);
        this.receipt = receipt ?? new ReceiptService(store, this.verdict);
    }

    private async rows(consumerId: string, limit = 2000): Promise<RequestEvent[]> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        const rows = await this.store.listObservations(id, limit);
        return rows.map(toEvent).sort((left, right) => String(left.at).localeCompare(String(right.at)));
    }

    private async readJson(path: string): Promise<any | null> {
        try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
    }

    private async reconAdaptersFor(consumerId: string, detail: RequestDetailBase): Promise<RequestReconAdapter[]> {
        if (!this.configSnapshot) return [];
        try {
            const snapshot = await this.configSnapshot.get(consumerId) as any;
            const root = String(snapshot?.consumer?.root || '');
            const bindings = snapshot?.hostBindings || [];
            const binding = bindings.find((item: any) => item.hostId === detail.request.hostId) || bindings[0] || {};
            const adapters: RequestReconAdapter[] = [];
            const seen = new Set<string>();
            const add = (id: string, label: string, kind: string, source: string, required = false) => {
                const key = id.toLowerCase();
                if (!id || seen.has(key)) return;
                seen.add(key);
                const calls = detail.events.reduce((sum, event) => {
                    const reported = event.evidence['recon'];
                    if (!Array.isArray(reported)) return sum;
                    return sum + reported.reduce((count: number, item: any) => {
                        const name = String(item?.adapter || item?.id || '').toLowerCase();
                        return name && (name === key || name.includes(key) || key.includes(name)) ? count + (Number(item?.calls) || 1) : count;
                    }, 0);
                }, 0);
                adapters.push({ id, label, kind, source, required, status: calls > 0 ? 'observed' : 'not-captured', calls });
            };
            if (root) {
                const integrations = await this.readJson(resolve(root, '.harness/integrations.json'));
                if (integrations && typeof integrations === 'object') {
                    for (const [kind, value] of Object.entries(integrations)) {
                        const row = value as Record<string, unknown>;
                        const adapterId = String(row?.adapterId || '');
                        const mode = String(row?.mode || '');
                        if (!adapterId || adapterId === 'off' || mode === 'off') continue;
                        add(adapterId, `${kind} · ${adapterId}`, kind, '.harness/integrations.json', kind === 'law' || kind === 'code' || kind === 'memory');
                    }
                }
                const mcpSource = String(binding?.mcpConfigSource || '.cursor/mcp.json');
                const mcp = await this.readJson(resolve(root, mcpSource));
                for (const name of Object.keys(mcp?.mcpServers || {})) add(name, name, 'mcp', mcpSource);
            }
            return adapters;
        } catch {
            return [];
        }
    }

    /**
     * P8 / matrix 28 — the eight stages of pipeline v2, in fixed order 1..8.
     *
     * Every stage reads one source and says `not captured` when that source reported nothing:
     * stage 2 reads `detail.jev`, stage 3 `signals.recon`, stage 4 the verdict, stage 5 the
     * pipeline, stage 6 `action.recorded` + `writeGate`, stage 7 receipt/spec/distill, stage 8
     * the six readiness questions. No stage is ticked green because another stage looked fine.
     */
    private async buildSystemStages(
        consumerId: string,
        detail: RequestDetail,
        events: RequestEvent[]
    ): Promise<RequestSystemStage[]> {
        const verdict = detail.verdict;
        const jev = detail.jev;
        const recon = detail.signals?.recon ?? null;
        const reconCalls = recon ? recon.reduce((sum, item) => sum + item.calls, 0) : 0;
        const lawRefs = lawRefsOf(verdict);
        const lawLoaded = lawLoadedOf(events);
        const decisions = events.filter((event) => event.event === 'decision.recorded');
        const decision = decisions[decisions.length - 1];
        const winner = typeof decision?.evidence['winner'] === 'string' ? String(decision.evidence['winner']) : null;
        const basis = typeof decision?.evidence['basis'] === 'string' ? String(decision.evidence['basis']) : null;
        const roleNames = [...new Set(detail.pipeline.map((stage) => stage.role).filter(Boolean))];
        const observedWorkers = detail.pipeline.filter((stage) => stage.status !== 'PENDING');
        const actions = events.filter((event) => event.event === 'action.recorded');
        const actionTools = actions.map((event) => String(event.evidence['tool'] || '')).filter(Boolean);
        const writeGate = detail.writeGate;
        const gate = writeGate ? (writeGate.allowed ? 'allowed' : 'blocked') : 'none';
        const receipt = detail.receipt;
        const spec = detail.spec;
        const distill = detail.signals?.distill ?? null;
        const gaps = verdict.gaps;
        const models = [...new Set(detail.telemetry.llmCalls.map((call) => call.model).filter((value) => value && value !== '—'))];
        // Q1–Q6 readiness: six data-driven booleans, never a judgement about the turn's quality.
        const questions = {
            Q1: detail.events.length > 0,
            Q2: Boolean(decision),
            Q3: Boolean(recon && reconCalls > 0),
            Q4: gaps.length === 0,
            Q5: Boolean(receipt?.hashPrefix),
            Q6: Boolean(spec?.doc),
        };
        const answered = Object.values(questions).filter(Boolean).length;
        const missing = Object.entries(questions).filter(([, ready]) => !ready).map(([key]) => key);
        return [
            {
                id: 'intake-law', stepNumber: 1, title: 'Intake & Law Gate',
                sub: `${detail.request.userQuery.length} chars · ${lawRefs.length ? `${lawRefs.length} law ref(s)` : lawLoaded.length ? `${lawLoaded.length} law loaded` : 'law not captured'}`,
                status: lawRefs.length ? 'ok' : 'info', tab: 'rules',
                details: [
                    { label: 'Prompt', value: `${detail.request.userQuery.length} chars`, detail: `hash ${detail.request.promptHash}` },
                    {
                        label: 'Actor',
                        value: verdict.actor && typeof verdict.actor['id'] === 'string' ? String(verdict.actor['id']) : 'not captured',
                        detail: verdict.actor && typeof verdict.actor['role'] === 'string' ? String(verdict.actor['role']) : 'no actor role on the claim',
                    },
                    {
                        label: 'Law',
                        value: lawRefs.length
                            ? lawRefs.slice(0, 2).map((ref) => ref.path || ref.kind).join(', ')
                            : lawLoaded.length ? lawLoaded.slice(0, 2).map((ref) => ref.path).join(', ') : 'not captured',
                        detail: lawRefs.length
                            ? 'decision.recorded.refs — the host decision references this law'
                            : lawLoaded.length
                                ? 'law.loaded — the host read this file; no decision claim attached'
                                : 'LAW_MISSING — no decision ref and no law.loaded observation',
                    },
                ],
            },
            {
                id: 'decision-jev', stepNumber: 2, title: 'Decision & JEV',
                sub: jev
                    ? `${winner ?? 'not captured'} · ${jev.mode} · ${jev.band ?? 'band not reported'} · confidence ${jev.confidence ?? 'not captured'}`
                    : `${winner ?? 'not captured'} · JEV not reported`,
                status: jev ? (jev.match ? 'ok' : 'warn') : 'info', tab: 'decisions',
                details: [
                    { label: 'Decision', value: winner ?? 'not captured', detail: basis ?? 'no basis recorded by host' },
                    {
                        label: 'JEV',
                        value: jev ? `${jev.mode} · ${jev.band ?? 'band not reported'}` : 'not reported',
                        detail: jev
                            ? `confidence ${jev.confidence ?? 'not captured'} · decision ${jev.decision ?? 'not captured'}`
                            : 'no decision.recorded carried evidence.jev',
                    },
                    {
                        label: 'Band check',
                        value: jev ? (jev.match ? 'match' : 'mismatch') : 'not reported',
                        detail: jev ? `expected ${jev.expectedBand ?? 'not computable'}` : 'no expected band',
                    },
                ],
            },
            {
                id: 'evidence-recon', stepNumber: 3, title: 'Evidence Recon',
                sub: recon ? `${recon.length} adapter(s) · ${reconCalls} call(s)` : 'not captured',
                status: recon && reconCalls > 0 ? 'ok' : 'muted', tab: 'rules',
                details: recon && recon.length
                    ? recon.slice(0, 3).map((item) => ({ label: item.adapter, value: `${item.calls} call(s)`, detail: 'signals.recon' }))
                    : [{ label: 'Recon', value: 'not captured', detail: 'no evidence.recon on decision.recorded' }],
            },
            {
                id: 'sufficiency', stepNumber: 4, title: 'Sufficiency Gate',
                sub: `score ${verdict.score} · ${gaps.length} gap(s)`,
                status: gaps.length ? 'warn' : 'ok', tab: 'decisions',
                details: [
                    { label: 'Level', value: verdict.level, detail: 'ESO adjudication of the host claim' },
                    { label: 'Score', value: String(verdict.score), detail: '100 − 25 × proof gap' },
                    {
                        label: 'Gaps',
                        value: gaps.length ? gaps.map((gap) => gap.code).join(', ') : 'none',
                        detail: gaps[0]?.consequence ?? 'no proof gap recorded',
                    },
                ],
            },
            {
                // SLP replaces the legacy brain tier (flash/pro): who does what is a role assignment,
                // not a model-routing decision. The stage reports the assigned roles, not a tier claim.
                id: 'slp', stepNumber: 5, title: 'SLP Orchestration',
                sub: `${roleNames.length} role(s) · ${observedWorkers.length}/${detail.pipeline.length} worker(s)`,
                status: roleNames.length >= 3 ? 'ok' : 'info', tab: 'telemetry',
                details: [
                    { label: 'Roles', value: roleNames.length ? roleNames.slice(0, 3).join(', ') : 'not captured', detail: 'config worker.role assignment' },
                    { label: 'Workers', value: `${observedWorkers.length}/${detail.pipeline.length} observed`, detail: `${detail.events.length} event(s) in trace` },
                    {
                        label: 'Lead',
                        value: detail.context['role'] ? String(detail.context['role']) : 'not captured',
                        detail: detail.context['workerId'] ? String(detail.context['workerId']) : 'no worker context',
                    },
                ],
            },
            {
                id: 'execution', stepNumber: 6, title: 'Execution & Write Gate',
                sub: `${actions.length} action(s) · write gate ${gate}`,
                status: writeGate && !writeGate.allowed ? 'warn' : actions.length ? 'ok' : 'info', tab: 'waterfall',
                details: [
                    {
                        label: 'Actions',
                        value: actions.length ? `${actions.length} recorded` : 'not captured',
                        detail: actionTools.length ? actionTools.slice(0, 3).join(', ') : 'no action.recorded tool in trace',
                    },
                    {
                        label: 'Write gate',
                        value: gate,
                        detail: writeGate ? `${writeGate.target} · ${writeGate.code ?? 'no refusal code'}` : 'no scope decision for this trace',
                    },
                    {
                        label: 'Tools',
                        value: `${detail.telemetry.tools.length} tool(s) · ${models.length} model(s)`,
                        detail: `${detail.telemetry.files.length} file(s) · host-reported`,
                    },
                ],
            },
            {
                id: 'seal', stepNumber: 7, title: 'Seal & Distill',
                sub: `${receipt.hashPrefix} · ${receipt.chained ? 'chained' : 'genesis'}`,
                status: receipt.hashPrefix ? 'ok' : 'warn', tab: 'telemetry',
                details: [
                    { label: 'Receipt', value: receipt.hashPrefix || 'not captured', detail: receipt.chained ? 'prev hash linked' : 'genesis (no predecessor)' },
                    { label: 'Spec', value: `${spec.doc} v${spec.version}`, detail: spec.section },
                    {
                        label: 'Distill',
                        value: distill
                            ? distill.memorySaved
                                ? `saved${typeof distill.lessons === 'number' ? ` · ${distill.lessons} lesson(s)` : ''}`
                                : 'not saved'
                            : 'not captured',
                        detail: distill ? 'signals.distill' : 'no evidence.distill on decision.recorded',
                    },
                ],
            },
            {
                id: 'report', stepNumber: 8, title: 'Report & Audit',
                sub: `${answered}/6 questions ready`,
                status: answered === 6 ? 'ok' : 'warn', tab: 'decisions',
                details: [
                    {
                        label: 'Answered',
                        value: `${answered}/6`,
                        detail: missing.length ? `missing ${missing.join(', ')}` : 'all six questions answered',
                    },
                    {
                        label: 'Verdict · receipt · spec',
                        value: `${verdict ? 'present' : 'missing'} · ${receipt ? 'present' : 'missing'} · ${spec ? 'present' : 'missing'}`,
                        detail: 'presence only, never inferred',
                    },
                    {
                        label: 'Gaps',
                        value: gaps.length ? gaps.map((gap) => gap.code).join(', ') : 'none',
                        detail: gaps[0]?.consequence ?? 'no proof gap recorded',
                    },
                ],
            },
        ];
    }

    async list(consumerId: string, limit = 200): Promise<{ items: RequestSummary[] }> {
        const events = await this.rows(consumerId);
        const byTrace = new Map<string, RequestEvent[]>();
        for (const event of events) {
            if (!byTrace.has(event.traceId)) byTrace.set(event.traceId, []);
            byTrace.get(event.traceId)!.push(event);
        }
        const items: RequestSummary[] = [];
        for (const [traceId, traceEvents] of byTrace) {
            const detail = buildRequest(consumerId, traceEvents);
            if (!detail) continue;
            items.push({
                id: traceId,
                traceId,
                consumerId,
                userQuery: detail.request.userQuery,
                status: detail.request.status,
                startedAt: detail.request.startedAt,
                endedAt: detail.request.endedAt,
                workers: new Set(traceEvents.map((event) => event.workerId).filter(Boolean)).size,
                events: detail.events.length,
                inputTokens: detail.requestMetrics.inputTokens,
                outputTokens: detail.requestMetrics.outputTokens,
                model: detail.request.model,
                workerId: detail.request.workerId,
                hostId: detail.request.hostId,
                hasFailures: detail.requestMetrics.hasFailures,
                conversationId: String(detail.events.find((event) => event.event === 'prompt.submitted')?.evidence['conversationId'] || traceId),
                generationId: String(detail.events.find((event) => event.event === 'prompt.submitted')?.evidence['generationId'] || traceId),
                boundaryIndex: Number(detail.events.find((event) => event.event === 'prompt.submitted')?.evidence['boundaryIndex']) || null,
                ide: /agy|antigravity/i.test(detail.request.hostId) ? 'antigravity' : /cursor/i.test(detail.request.hostId) ? 'cursor' : 'unknown',
                decisionVerdict: String(detail.events.find((event) => event.event === 'prompt.submitted')?.evidence['decisionVerdict'] || '—'),
                checksPass: detail.checks.filter((check) => check.status === 'pass').length,
                checksFail: detail.checks.filter((check) => check.status === 'warn').length,
                callCount: detail.requestMetrics.callCount,
                toolCount: detail.requestMetrics.toolCount,
                stopStatus: '',
                tokensEstimated: detail.requestMetrics.tokensEstimated,
            });
        }
        // Newest first: the latest ticket is the one an operator needs at the top.
        return { items: items.sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt))).slice(0, Math.max(1, limit)) };
    }

    private async enrichPipeline(consumerId: string, detail: RequestDetailBase): Promise<void> {
        if (!this.configSnapshot) return;
        try {
            const snapshot = await this.configSnapshot.get(consumerId) as any;
            const workers = new Map<string, any>((snapshot?.workers || []).map((worker: any) => [worker.id, worker]));
            for (const stage of detail.pipeline) {
                const worker = workers.get(stage.workerId);
                if (!worker) continue;
                stage.role = String(worker.role || '');
                stage.layer = String(worker.layer || '');
                stage.scope = String(worker.scope || '');
                stage.capabilities = Array.isArray(worker.capabilities) ? worker.capabilities.map(String) : [];
                stage.qualityBar = Array.isArray(worker.bar) ? worker.bar.map(String) : [];
            }
        } catch {
            // config snapshot is optional for legacy consumers
        }
    }

    async listPrompts(consumerId: string, limit = 500): Promise<{ items: PromptSummary[] }> {
        const events = await this.rows(consumerId);
        const prompts = events.filter((event) => event.event === 'prompt.submitted');
        const completion = new Map<string, RequestEvent>();
        for (const event of events) {
            if (event.event === 'worker.completed' || event.event === 'worker.failed') {
                completion.set(`${event.traceId}:${event.workerId}`, event);
            }
        }
        const byTrace = new Map<string, RequestEvent[]>();
        for (const event of prompts) {
            if (!byTrace.has(event.traceId)) byTrace.set(event.traceId, []);
            byTrace.get(event.traceId)!.push(event);
        }
        const items: PromptSummary[] = [];
        for (const [traceId, rows] of byTrace) {
            const first = rows[0];
            for (const [index, event] of rows.entries()) {
                const evidence = event.evidence;
                const child = index > 0;
                const workerId = event.workerId || '';
                const declaredKind = String(evidence['subagentKind'] || '');
                const source = child ? (declaredKind === 'swarm' ? 'swarm' : 'subagent') : 'agent';
                const sourcePrefix = source === 'swarm' ? 'swarm' : 'subagent';
                const completionEvent = completion.get(`${traceId}:${workerId}`);
                const token = (completionEvent?.evidence as Record<string, unknown> | undefined)?.['tokenSummary'] as { input?: number; output?: number; estimated?: boolean } | undefined;
                items.push({
                    id: child ? `${sourcePrefix}-${workerId}:${traceId}` : `agent:${traceId}`,
                    observationId: event.observationId,
                    traceId,
                    conversationId: String(evidence['conversationId'] || traceId),
                    boundaryIndex: Number(evidence['boundaryIndex']) || null,
                    source,
                    sourceLabel: child ? `${sourcePrefix}-${workerId.replace(/^worker-/, '')}` : 'agent',
                    workerId,
                    hostId: event.hostId,
                    runtimeKey: event.runtimeKey,
                    model: String(evidence['model'] || '—'),
                    tier: String(evidence['tier'] || '—'),
                    userQuery: String(evidence['userQuery'] || ''),
                    promptText: String(evidence['promptText'] || evidence['userQuery'] || ''),
                    inputTokens: typeof token?.input === 'number' ? token.input : null,
                    outputTokens: typeof token?.output === 'number' ? token.output : null,
                    tokensEstimated: token?.estimated === true,
                    at: event.at,
                    status: completionEvent?.outcome || String(first.outcome || 'SUBMITTED'),
                });
            }
        }
        return { items: items.sort((left, right) => String(right.at).localeCompare(String(left.at))).slice(0, Math.max(1, limit)) };
    }

    async get(consumerId: string, requestId: string): Promise<RequestDetail> {
        const decoded = decodeURIComponent(requestId);
        const events = await this.rows(consumerId);
        let traceEvents = events.filter((event) => event.traceId === decoded);
        if (traceEvents.length === 0) {
            const byObservation = events.find((event) => event.observationId === decoded);
            if (byObservation) traceEvents = events.filter((event) => event.traceId === byObservation.traceId);
        }
        const base = buildRequest(consumerId, traceEvents);
        if (!base) throw new PlatformError('NOT_FOUND', `Request not found: ${decoded}`);
        // P2/P4/P5a — the detail is the proof surface: every detail response carries ESO's verdict,
        // the id of the receipt that seals it, and a summary of that receipt (never its full hash).
        const sealed = await this.sealed(consumerId, base.request.traceId);
        // Q2 — the latest scope decision is read from the guard's own append-only record. The
        // verdict and the gate are independent claims; neither is derived from the other.
        const decisions = await this.store.listScopeDecisionsByTrace(consumerId, base.request.traceId);
        const latest = decisions[0] ?? null;
        // P8 — JEV is adjudicated against the consumer's own thresholds, so the reported band is
        // checked against what those thresholds imply for the reported confidence.
        const consumer = await this.store.getConsumer(assertConsumerId(consumerId));
        const jev = jevOf(traceEvents, consumer?.root || '');
        const detail: RequestDetail = {
            ...base,
            verdict: sealed.verdict,
            receipt: receiptSummary(sealed.receipt),
            signals: signalsOf(traceEvents),
            jev,
            graph: runtimeGraphOf(traceEvents, base.pipeline),
            // B0-9 — a constant pointer, identical for every request; see REQUEST_SPEC_REF.
            spec: REQUEST_SPEC_REF,
            writeGate: latest
                ? {
                    decisionId: latest.decisionId,
                    allowed: latest.allowed,
                    code: latest.code,
                    target: latest.target,
                    at: latest.at,
                    actor: latest.actor,
                }
                : null,
            // Filled below, once every stage has read its own data source.
            effectiveness: {
                stepsTotal: 0,
                stepsWithEvidence: 0,
                rolesAssigned: 0,
                rolesObserved: 0,
                workersTotal: 0,
                workersObserved: 0,
                failures: 0,
                durationMs: 0,
                writeGateChecked: false,
                receiptSealed: false,
                gaps: 0,
            },
        };
        // A reported band that contradicts the expected one is a check on the request, never a
        // rewrite of the verdict: ESO records what it could not reconcile and keeps the claim.
        if (detail.jev && !detail.jev.match) {
            detail.checks.push({
                checkId: 'JEV_BAND_MISMATCH',
                status: 'warn',
                detail: `reported band ${detail.jev.band ?? 'none'} but confidence ${detail.jev.confidence ?? 'none'} expects ${detail.jev.expectedBand ?? 'none'}`,
            });
        }
        detail.recon = await this.reconAdaptersFor(consumerId, detail);
        await this.enrichPipeline(consumerId, detail);
        detail.systemStages = await this.buildSystemStages(consumerId, detail, traceEvents);
        detail.effectiveness = effectivenessOf(detail, traceEvents);
        return detail;
    }

    /**
     * P2 — verdict for one request. Resolves the request id exactly like `get` (trace id or
     * observation id) so the route and the detail block always describe the same turn.
     */
    async getVerdict(consumerId: string, requestId: string): Promise<TurnVerdict> {
        const traceId = await this.resolveTraceId(consumerId, requestId);
        return this.adjudicated(consumerId, traceId);
    }

    /**
     * P4 — the sealed receipt of one request (issue-or-get). The route accepts the same request id
     * forms as the detail/verdict routes.
     */
    async getReceipt(consumerId: string, requestId: string): Promise<EvidenceReceipt> {
        const traceId = await this.resolveTraceId(consumerId, requestId);
        return this.receipt.issue(consumerId, traceId);
    }

    /** The stored verdict plus the id of the receipt that seals it (`verdict.receiptId`). */
    private async adjudicated(consumerId: string, traceId: string): Promise<TurnVerdict> {
        return (await this.sealed(consumerId, traceId)).verdict;
    }

    /**
     * Issue-or-get the receipt once per request and reuse it for both the verdict link and the
     * detail summary, so `detail.receipt.receiptId` and `detail.verdict.receiptId` cannot diverge.
     */
    private async sealed(
        consumerId: string,
        traceId: string
    ): Promise<{ receipt: EvidenceReceipt; verdict: TurnVerdict }> {
        const receipt = await this.receipt.issue(consumerId, traceId);
        const verdict = await this.verdict.ensureVerdict(consumerId, traceId);
        return { receipt, verdict: { ...verdict, receiptId: receipt.receiptId } };
    }

    private async resolveTraceId(consumerId: string, requestId: string): Promise<string> {
        const decoded = decodeURIComponent(requestId);
        const events = await this.rows(consumerId);
        let traceId = events.find((event) => event.traceId === decoded && event.event === 'prompt.submitted')?.traceId ?? '';
        if (!traceId) {
            const byObservation = events.find((event) => event.observationId === decoded);
            traceId = byObservation
                ? events.find((event) => event.traceId === byObservation.traceId && event.event === 'prompt.submitted')?.traceId ?? ''
                : '';
        }
        if (!traceId) throw new PlatformError('NOT_FOUND', `Request not found: ${decoded}`);
        return traceId;
    }
}
