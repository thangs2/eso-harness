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
}

/** The E2E flow card: one system stage plus its evidence subcards and related tab. */
export interface PipelineStepView {
    id: string;
    stepNumber: number;
    label: string;
    status: string;
    sub: string;
    subcards: StageDetailView[];
    empty: boolean;
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
