import type { ObservationDto, RequestDetailDto, RequestLlmCallDto, RequestReceiptSummaryDto } from '../../../../../../../../libs/api-client/types.js';

export type { ObservationDto, RequestDetailDto, RequestLlmCallDto, RequestReceiptSummaryDto };

/** Drill-pane ids. A stage may point at one of these, but a tab never selects a stage. */
export type TabKey = 'waterfall' | 'topology' | 'decisions' | 'rules' | 'telemetry';

/** P2 — the four levels ESO adjudicates. Anything else is not a verdict. */
export type VerdictLevel = 'allow' | 'deny' | 'partial' | 'unknown';

/** `missing` / `extra` win over `matches`; `reordered` = same workers, different order. */
export type DivergenceKind = 'matches' | 'missing' | 'extra' | 'reordered' | 'empty';

export interface StageDetailView {
    label: string;
    value: string;
    detail: string;
}

/** One configured pipeline step, straight from `detail.systemStages` (never a local order). */
/** The stepper only needs identity/number/title/sub/status — not the evidence details. */
export interface StepperStageView {
    id: string;
    stepNumber: number;
    title: string;
    sub: string;
    status: string;
    /** The stage found proof for its own question; `status` is presentation only. `null` = not declared. */
    evidenced?: boolean | null;
}

/** The E2E flow card: one system stage plus its evidence subcards and related tab. */
export interface PipelineStepView {
    id: string;
    stepNumber: number;
    label: string;
    status: string;
    sub: string;
    subcards: StageDetailView[];
    /** Single evidence definition: true when the stage declared no proof for this trace. */
    empty: boolean;
    /** Raw stage flag (`null` when the payload predates it) — `empty` is derived from it. */
    evidenced?: boolean | null;
    tab: TabKey;
    tabLabel: string;
}

/** One worker row from `detail.pipeline` (configured, server order). */
/** B0-10 — one configured graph node, straight from `detail.pipeline`. */
export interface ConfiguredGraphStep {
    workerId: string;
    label: string;
    status: string;
}

/** B0-10 — one worker that actually reported a runtime event; ordered by first observation. */
export interface ObservedGraphStep {
    workerId: string;
    label: string;
    outcome: string;
    event: string;
    at: string;
}

export interface RuntimeDivergence {
    kind: DivergenceKind;
    missing: string[];
    extra: string[];
    configuredCount: number;
    observedCount: number;
}

/** One proof gap: what ESO could not establish, and the consequence for the reader. */
export interface VerdictGap {
    code: string;
    what: string;
    consequence: string;
}

/** Unified gap/finding read-model across pre-turn gate, post-turn proof, and knowledge sufficiency. */
export type GapDomain = 'pre' | 'post' | 'knowledge';

export interface UnifiedGapItem {
    domain: GapDomain;
    code: string;
    what: string;
    where?: string;
    consequence: string;
}

/** Pre-turn gate summary extracted from any trace observation carrying `evidence.judgment`. */
export interface PreTurnGateView {
    level: string;
    decision: string;
    enforcement: string;
    gaps: UnifiedGapItem[];
}

/** A reference the host cited as the rule/basis of its decision. */
export interface VerdictRuleRef {
    kind: string;
    path?: string;
    line?: number;
}

export interface VerdictActor {
    kind?: string;
    id?: string;
    role?: string;
    [key: string]: unknown;
}

/** Verdict as returned on `detail.verdict` by GET /consumers/:id/requests/:requestId. */
export interface TurnVerdictView {
    level: VerdictLevel;
    basis: string;
    actor: VerdictActor | null;
    gaps: VerdictGap[];
    score: number;
    ruleRefs: VerdictRuleRef[];
    receiptId: string | null;
    computedAt: string;
}

/** P6c — one host-reported preflight signal; the fingerprint is optional even when the state is known. */
export interface HostPreflightSignal {
    state: string;
    fingerprint?: string;
}

/** P6c — calls the host reported for one recon adapter. */
export interface HostReconCall {
    adapter: string;
    calls: number;
}

/** P6c — distill outcome; `lessons` is optional because the host may report only `memorySaved`. */
export interface HostDistillSignal {
    memorySaved: boolean;
    lessons?: number;
}

/** P6c — `detail.signals`; every sub-field is independently `null` when the host did not report it. */
export interface HostSignalsView {
    preflight: HostPreflightSignal | null;
    recon: HostReconCall[] | null;
    brainTier: string | null;
    distill: HostDistillSignal | null;
}

/** B0-9 — `detail.spec`: a pointer to the normative doc. The page never fetches or copies the doc. */
export interface SpecRefView {
    doc: string;
    version: string;
    section: string;
    anchor: string;
}

/** Write gate — one recorded scope decision; the guard's record, never verdict-derived. */
export interface WriteGateView {
    decisionId: string;
    allowed: boolean;
    code: string | null;
    target: string;
    at: string;
    actor: Record<string, unknown> | null;
}

/** Pipeline v2 — the backend's own tally of this request; read as sent, never recomputed. */
export interface EffectivenessView {
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
    gaps: number;
}

/** Pipeline v2 — the decision recorded at the `decision-jev` stage; never derived from the verdict. */
export interface JevView {
    mode: string;
    consent: boolean;
    confidence: number;
    band: string;
    decision: string;
    reason: string;
    expectedBand: string;
    match: boolean;
    at: string;
}

/** Header + cost card token counts; `estimated` says whether chars/4 produced them. */
export interface TokenSummaryView {
    input: number | null;
    output: number | null;
    /** Prompt tokens served from the host cache. Reported separately from `input` by the host. */
    cacheRead: number | null;
    estimated: boolean;
}

/** Q5 — the only three states the page may report for server-side verification. */
export type ReceiptVerificationState = 'verified' | 'failed' | 'unavailable';

/** Q4 — one host-reported action, with no inferred fields. */
export interface ActionEventView {
    id: string;
    tool: string;
    outcome: string;
    filesCount: number;
    readBeforeEdit: string;
    diffRef: string;
}

/** Telemetry call row, already reduced to what the table prints. */
export type RequestCheckView = RequestDetailDto['checks'][number];

/** The shared detail DTO predates P2/P6c/B0-9; those fields ride on the same payload, so they are added here. */
export type RequestDetailWithVerdict = RequestDetailDto & {
    verdict?: TurnVerdictView | null;
    signals?: HostSignalsView | null;
    spec?: SpecRefView | null;
    writeGate?: WriteGateView | null;
    effectiveness?: EffectivenessView | null;
    jev?: JevView | null;
};

/** Only these host events prove a worker joined the runtime path; nothing else is inferred. */
export const OBSERVED_WORKER_EVENTS: ReadonlySet<string> = new Set(['worker.remote.completed', 'worker.completed', 'prompt.submitted']);

export const WORKER_LABEL: Record<string, string> = {
    'worker-lead': 'Lead',
    'worker-scout': 'Scout',
    'worker-plan': 'Plan',
    'worker-build': 'Build',
    'worker-verify': 'Verify',
    'worker-audit': 'Audit',
    'worker-fixbug': 'Fixbug',
    'worker-qc': 'QC 1',
    'worker-qc-2': 'QC 2',
};

/** Drill tab id → glyph; the tab keeps its label and count. */
export const TAB_GLYPH: Record<string, string> = {
    waterfall: '≋',
    topology: '⌗',
    decisions: '◈',
    rules: '§',
    telemetry: '◷',
};

export const TAB_LABELS: Record<TabKey, string> = {
    waterfall: 'Execution & Waterfall',
    topology: 'Graphs & Topology',
    decisions: 'Verdict & gaps',
    rules: 'Rules & Context',
    telemetry: 'Telemetry & Trace',
};

/** Q6 — rule-based only: each verdict level maps to exactly one next action. */
export const NEXT_STEP: Record<VerdictLevel, string> = {
    deny: 'Close the gaps, then re-run',
    unknown: 'Host must emit decision.recorded for this turn',
    partial: 'Capture the missing data and re-issue the verdict',
    allow: 'No action required',
};

export function workerLabel(id: string | null | undefined): string {
    return WORKER_LABEL[id || ''] || id || 'unknown';
}

/** A value the API actually did not report — never a judgement about the step. */
export function missingValue(value: string): boolean {
    const text = (value || '').trim().toLowerCase();
    return !text || text === '—' || text === 'not captured' || text === 'not reported' || text === 'not recorded' || text === 'unknown';
}

export function formatAt(value: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

/** Q1 — computedAt as a relative time, matching the requests list convention. */
export function relativeTime(value: string): string {
    if (!value) return 'not reported';
    const ms = Date.now() - new Date(value).getTime();
    if (Number.isNaN(ms)) return value;
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days < 30 ? `${days}d ago` : formatAt(value);
}

/** Q1 actor — only an honest id is shown; a missing actor is named, never guessed. */
export function actorIdOf(actor: VerdictActor | null): string {
    const id = actor && typeof actor['id'] === 'string' ? actor['id'].trim() : '';
    return id || 'unknown actor';
}

/** Q2 write gate — the scope actor is free-form JSON; show only what it actually says. */
export function writeGateActorOf(actor: Record<string, unknown> | null): string {
    if (!actor) return '';
    const id = typeof actor['id'] === 'string' ? actor['id'].trim() : '';
    const label = typeof actor['label'] === 'string' ? actor['label'].trim() : '';
    const kind = typeof actor['kind'] === 'string' ? actor['kind'].trim() : '';
    return [id || label, kind].filter(Boolean).join(' · ');
}

/** Header — a locator, not a new id: the full value stays in the tooltip and metadata block. */
export function shortIdOf(value: string | null | undefined): string {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id) return '—';
    return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/**
 * One worker's share of the turn's token usage.
 *
 * The Cost card used to show only a trace-wide sum, which hides the per-worker burn that matters when
 * several workers run. Every worker that joined the path gets a row: a worker with no reported usage
 * keeps its row with `input`/`output` = null ("not captured"), because a missing measurement is not zero
 * and ESO never estimates it.
 *
 * Precedence per worker: `telemetry.llmCalls` usage → `evidence.tokenSummary` on its events → nothing.
 * The first is the host's own call record; the second is what it wrote on the event.
 */
export interface WorkerTokenUsageView {
    workerId: string;
    label: string;
    model: string;
    input: number | null;
    output: number | null;
    /** Prompt tokens this worker read from the cache; null when it was not reported. */
    cacheRead: number | null;
    /**
     * The prompt as the worker actually paid for it: uncached input plus cache reads. The host reports
     * these apart, and cache reads often dwarf the uncached part (measured 19,539 vs 3,434), so summing
     * them is the only honest "how big was the prompt" figure. Null when neither was reported.
     */
    promptTotal: number | null;
    calls: number;
    estimated: boolean;
    /** Sum of this worker's reported input+output; null when neither was reported. */
    total: number | null;
}

/** A worker linked to prompt body by id, tolerating hosts that nest it under `evidence`. */
function eventWorkerId(event: Record<string, any>): string {
    const evidence = isRecord(event['evidence']) ? event['evidence'] : {};
    return String(event['workerId'] || evidence['workerId'] || evidence['role'] || '').trim();
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Two shapes reach this card and they spell the fields differently: a host call record
 * (`inputTokens`/`outputTokens`) and an event `tokenSummary` (`input`/`output`). Accept both, or the
 * event-only fallback silently reports "not captured" for usage the host did send.
 */
function usageOf(source: Record<string, any> | null): { input: number | null; output: number | null; cacheRead: number | null; estimated: boolean } {
    if (!source) return { input: null, output: null, cacheRead: null, estimated: false };
    const pick = (...keys: string[]): number | null => {
        for (const key of keys) if (typeof source[key] === 'number') return source[key] as number;
        return null;
    };
    return {
        input: pick('inputTokens', 'input'),
        output: pick('outputTokens', 'output'),
        cacheRead: pick('cacheReadTokens', 'cacheRead'),
        estimated: source['estimated'] === true,
    };
}

/**
 * Per-worker usage, ordered by prompt body's first observation of that worker (stable, not by size).
 * Returns an empty array when the payload exposes no worker or no usage at all.
 */
export function workerTokenUsage(
    events: ReadonlyArray<Record<string, any>>,
    llmCalls: ReadonlyArray<Record<string, any>>,
): WorkerTokenUsageView[] {
    const order: string[] = [];
    const remember = (id: string): void => {
        if (id && !order.includes(id)) order.push(id);
    };
    for (const event of events || []) remember(eventWorkerId(event));
    for (const call of llmCalls || []) remember(String(call['workerId'] || '').trim());

    return order.map((workerId) => {
        const calls = (llmCalls || []).filter((call) => String(call['workerId'] || '').trim() === workerId);
        const eventWithUsage = (events || []).find((event) => {
            const evidence = isRecord(event['evidence']) ? event['evidence'] : {};
            return eventWorkerId(event) === workerId && isRecord(evidence['tokenSummary']);
        });
        const eventModel = eventWithUsage && isRecord(eventWithUsage['evidence']) ? eventWithUsage['evidence']['model'] : '';

        // Host call records win; the event's own tokenSummary is the fallback. A worker that reported
        // neither keeps null — the row still renders, marked "not captured".
        let input: number | null = null;
        let output: number | null = null;
        let cacheRead: number | null = null;
        let estimated = false;
        if (calls.length) {
            let anyReported = false;
            for (const call of calls) {
                const usage = usageOf(call);
                if (usage.input === null && usage.output === null && usage.cacheRead === null) continue;
                anyReported = true;
                input = usage.input === null ? input : (input ?? 0) + usage.input;
                output = usage.output === null ? output : (output ?? 0) + usage.output;
                cacheRead = usage.cacheRead === null ? cacheRead : (cacheRead ?? 0) + usage.cacheRead;
                estimated = estimated || usage.estimated;
            }
            if (!anyReported) {
                input = null;
                output = null;
                cacheRead = null;
            }
        } else if (eventWithUsage) {
            const usage = usageOf(eventWithUsage['evidence']['tokenSummary'] as Record<string, any>);
            input = usage.input;
            output = usage.output;
            cacheRead = usage.cacheRead;
            estimated = usage.estimated;
        }
        // No call record and no tokenSummary could still mean the host put usage on another event of
        // the same worker; fall back to any event carrying one before declaring "not captured".
        if (input === null && output === null && cacheRead === null && calls.length === 0 && !eventWithUsage) {
            const fallback = (events || []).find((event) => {
                const evidence = isRecord(event['evidence']) ? event['evidence'] : {};
                return eventWorkerId(event) === workerId && isRecord(evidence['tokenSummary']);
            });
            if (fallback) {
                const usage = usageOf(fallback['evidence']['tokenSummary'] as Record<string, any>);
                input = usage.input;
                output = usage.output;
                cacheRead = usage.cacheRead;
                estimated = usage.estimated;
            }
        }

        return {
            workerId,
            label: workerLabel(workerId),
            model: String(calls[0]?.['model'] || eventModel || '').trim(),
            input,
            output,
            cacheRead,
            promptTotal: input === null && cacheRead === null ? null : (input ?? 0) + (cacheRead ?? 0),
            calls: calls.length,
            estimated,
            total: input === null && output === null ? null : (input ?? 0) + (output ?? 0),
        };
    });
}
