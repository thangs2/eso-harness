import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { EvidenceReceipt, TurnVerdict, TurnVerdictLevel } from '../../platform/registry/types.js';
import type { ConfigSnapshotService } from '../config-snapshot/config-snapshot.service.js';
import {
    BRAIN_TIERS,
    PREFLIGHT_STATES,
    type BrainTier,
    type DecisionDistillSignal,
    type DecisionPreflightSignal,
    type DecisionReconSignal,
    type PreflightState,
} from '../observations/event-contract.js';
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

export interface RequestSystemStage {
    id: 'prompt' | 'law' | 'routing' | 'recon' | 'eso' | 'brain' | 'execution' | 'memory';
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
    /** P6b: configured pipeline vs observed worker path, so design↔runtime divergence is machine-readable. */
    graph: RequestRuntimeGraph;
}

export interface RequestRuntimeGraph {
    nodes: Array<{ id: string; kind: 'configured' | 'observed' | 'both' }>;
    edges: Array<{ from: string; to: string }>;
    matched: number;
    missing: string[];
    extra: string[];
    divergence: 'matches' | 'missing' | 'extra' | 'reordered' | 'empty';
}

/** Everything `buildRequest` can compute from observations alone; verdict, receipt and signals are appended in `get`. */
type RequestDetailBase = Omit<RequestDetail, 'verdict' | 'receipt' | 'signals' | 'graph'>;

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

    private async buildSystemStages(consumerId: string, detail: RequestDetailBase): Promise<RequestSystemStage[]> {
        const recon = detail.recon;
        const lawLayer = recon.find((item) => item.kind === 'law');
        const memoryLayer = recon.find((item) => item.kind === 'memory');
        const reconLayers = recon.filter((item) => item.kind !== 'law' && item.kind !== 'memory');
        const observedRecon = reconLayers.reduce((sum, item) => sum + item.calls, 0);
        const passChecks = detail.checks.filter((item) => item.status === 'pass').length;
        const warnChecks = detail.checks.filter((item) => item.status === 'warn').length;
        const observedStages = detail.pipeline.filter((stage) => stage.status !== 'PENDING');
        const failedStages = detail.pipeline.filter((stage) => stage.status === 'FAIL' || stage.status === 'BLOCKED');
        const calls = detail.telemetry.llmCalls.length;
        const tools = detail.telemetry.tools.length;
        const models = [...new Set(detail.telemetry.llmCalls.map((call) => call.model).filter((value) => value && value !== '—'))];
        const model = String(detail.routing['model'] || detail.request.model || '—');
        const adapter = String(detail.routing['adapter'] || detail.request.adapter || '—');
        return [
            {
                id: 'prompt', stepNumber: 1, title: 'Prompt Ingest', sub: `${detail.request.userQuery.length} chars`, status: 'ok', tab: 'waterfall',
                details: [
                    { label: 'Query', value: `${detail.request.userQuery.length} chars`, detail: `hash ${detail.request.promptHash}` },
                    { label: 'Task', value: detail.request.taskType || '—', detail: detail.request.flowId || 'no flow' },
                    { label: 'Trace', value: detail.request.traceId, detail: detail.request.hostId },
                ],
            },
            {
                id: 'law', stepNumber: 2, title: 'Law Gate', sub: lawLayer ? lawLayer.id : 'not configured', status: lawLayer ? 'ok' : 'info', tab: 'rules',
                details: [
                    { label: 'Layer', value: lawLayer?.label || 'not configured', detail: lawLayer?.id || 'no rules layer' },
                    { label: 'Source', value: lawLayer?.source || '—', detail: lawLayer?.required ? 'required' : 'optional' },
                    { label: 'Worker', value: detail.context['workerId'] ? String(detail.context['workerId']) : '—', detail: String(detail.context['role'] || 'no worker context') },
                ],
            },
            {
                id: 'routing', stepNumber: 3, title: 'L0/Jev Route', sub: `${adapter} · ${String(detail.routing['tier'] || 'tier —')}`, status: 'ok', tab: 'decisions',
                details: [
                    { label: 'Adapter', value: adapter, detail: String(detail.routing['modelSource'] || 'source —') },
                    { label: 'Model', value: model, detail: String(detail.routing['effort'] || 'default effort') },
                    { label: 'Task', value: String(detail.routing['taskType'] || '—'), detail: 'host-owned routing' },
                ],
            },
            {
                id: 'recon', stepNumber: 4, title: 'Recon Context', sub: `${reconLayers.length} configured · ${observedRecon} called`, status: observedRecon > 0 ? 'ok' : 'muted', tab: 'rules',
                details: reconLayers.slice(0, 3).map((item) => ({ label: item.label, value: item.calls ? `${item.calls} call(s)` : 'not captured', detail: item.source })),
            },
            {
                id: 'eso', stepNumber: 5, title: 'ESO Gate', sub: `${passChecks}/${detail.checks.length} checks pass`, status: warnChecks ? 'warn' : 'ok', tab: 'decisions',
                details: detail.checks.slice(0, 3).map((item) => ({ label: item.checkId, value: item.status, detail: item.detail })),
            },
            {
                id: 'brain', stepNumber: 6, title: 'Brain Tier', sub: `${calls} calls · ${models.length || 1} models`, status: 'ok', tab: 'telemetry',
                details: [
                    { label: 'Models', value: models.length ? models.join(', ') : model, detail: String(detail.routing['tier'] || '—') },
                    { label: 'Calls', value: String(calls), detail: `${detail.requestMetrics.inputTokens ?? '—'} in / ${detail.requestMetrics.outputTokens ?? '—'} out` },
                    { label: 'Estimate', value: detail.requestMetrics.tokensEstimated ? 'estimated' : 'reported', detail: 'chars/4 or agent-reported' },
                ],
            },
            {
                id: 'execution', stepNumber: 7, title: 'Execution', sub: `${calls} calls · ${tools} tools`, status: failedStages.length ? 'warn' : 'ok', tab: 'waterfall',
                details: [
                    { label: 'Workers', value: `${observedStages.length}/${detail.pipeline.length} observed`, detail: `${detail.events.length} events` },
                    { label: 'Tools', value: String(tools), detail: 'agent-reported only' },
                    { label: 'Models', value: models.length ? models.join(', ') : '—', detail: 'same host / per-worker tier' },
                ],
            },
            {
                id: 'memory', stepNumber: 8, title: 'Distill & Memory', sub: memoryLayer ? memoryLayer.id : 'pass-through', status: memoryLayer ? 'ok' : 'muted', tab: 'waterfall',
                details: [
                    { label: 'Layer', value: memoryLayer?.label || 'not configured', detail: memoryLayer?.id || 'no memory layer' },
                    { label: 'Source', value: memoryLayer?.source || '—', detail: memoryLayer?.required ? 'required' : 'optional' },
                    { label: 'Events', value: String(detail.events.length), detail: 'observations in trace' },
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
        const detail: RequestDetail = {
            ...base,
            verdict: sealed.verdict,
            receipt: receiptSummary(sealed.receipt),
            signals: signalsOf(traceEvents),
            graph: runtimeGraphOf(traceEvents, base.pipeline),
        };
        detail.recon = await this.reconAdaptersFor(consumerId, detail);
        await this.enrichPipeline(consumerId, detail);
        detail.systemStages = await this.buildSystemStages(consumerId, detail);
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
