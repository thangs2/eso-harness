import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CONTROL_PLANE_API_CLIENT } from '../../../core/tokens.js';
import type { ObservationDto, RequestDetailDto, RequestReceiptSummaryDto } from '../../../../../../../libs/api-client/types.js';

type TabKey = 'waterfall' | 'topology' | 'decisions' | 'rules' | 'telemetry';

interface SystemStage {
    id: string;
    stepNumber: number;
    title: string;
    sub: string;
    status: string;
    tab: TabKey;
    details: Array<{ label: string; value: string; detail: string }>;
}

interface Stage {
    workerId: string;
    label: string;
    role: string;
    layer: string;
    scope: string;
    capabilities: string[];
    status: string;
    event: string;
    at: string;
    durationMs: number;
    errorCode: string;
}

/** B0-10 — a configured pipeline step, straight from `detail.pipeline` (never a local order). */
interface ConfiguredGraphStep {
    workerId: string;
    label: string;
    status: string;
}

/** B0-10 — one worker that actually reported a runtime event; ordered by first observation. */
interface ObservedGraphStep {
    workerId: string;
    label: string;
    outcome: string;
    event: string;
    at: string;
}

/** `missing` / `extra` win over `matches`; `reordered` = same workers, different order. */
type DivergenceKind = 'matches' | 'missing' | 'extra' | 'reordered' | 'empty';

interface RuntimeDivergence {
    kind: DivergenceKind;
    missing: string[];
    extra: string[];
    configuredCount: number;
    observedCount: number;
}

/** Only these host events prove a worker joined the runtime path; nothing else is inferred. */
const OBSERVED_WORKER_EVENTS: ReadonlySet<string> = new Set(['worker.remote.completed', 'worker.completed', 'prompt.submitted']);

const WORKER_LABEL: Record<string, string> = {
    'worker-scout': 'Scout',
    'worker-plan': 'Plan',
    'worker-build': 'Build',
    'worker-verify': 'Verify',
    'worker-audit': 'Audit',
    'worker-fixbug': 'Fixbug',
    'worker-qc': 'QC 1',
    'worker-qc-2': 'QC 2',
};

/** Pipeline v2 stage ids → the rail glyph shown next to the step number (text glyphs, no icon package). */
const STAGE_GLYPH: Record<string, string> = {
    'intake-law': '§',
    'decision-jev': '◈',
    'evidence-recon': '⌕',
    sufficiency: '◐',
    slp: '⌘',
    execution: '▸',
    seal: '⛨',
    report: '▤',
};

/** Drill tab id → glyph; the tab keeps its label and count. */
const TAB_GLYPH: Record<string, string> = {
    waterfall: '≋',
    topology: '⌗',
    decisions: '◈',
    rules: '§',
    telemetry: '◷',
};

/** P2 — the four levels ESO adjudicates. Anything else is not a verdict. */
type VerdictLevel = 'allow' | 'deny' | 'partial' | 'unknown';

/** One proof gap: what ESO could not establish, and the consequence for the reader. */
interface VerdictGap {
    code: string;
    what: string;
    consequence: string;
}

/** A reference the host cited as the rule/basis of its decision. */
interface VerdictRuleRef {
    kind: string;
    path?: string;
    line?: number;
}

interface VerdictActor {
    kind?: string;
    id?: string;
    role?: string;
    [key: string]: unknown;
}

/** Verdict as returned on `detail.verdict` by GET /consumers/:id/requests/:requestId (P2). */
interface TurnVerdictView {
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
interface HostPreflightSignal {
    state: string;
    fingerprint?: string;
}

/** P6c — calls the host reported for one recon adapter. */
interface HostReconCall {
    adapter: string;
    calls: number;
}

/** P6c — distill outcome; `lessons` is optional because the host may report only `memorySaved`. */
interface HostDistillSignal {
    memorySaved: boolean;
    lessons?: number;
}

/** P6c — `detail.signals`; every sub-field is independently `null` when the host did not report it. */
interface HostSignalsView {
    preflight: HostPreflightSignal | null;
    recon: HostReconCall[] | null;
    brainTier: string | null;
    distill: HostDistillSignal | null;
}

/** B0-9 — `detail.spec`: a pointer to the normative doc. The page never fetches or copies the doc. */
interface SpecRefView {
    doc: string;
    version: string;
    section: string;
    anchor: string;
}

/** Write gate — one recorded scope decision (`detail.writeGate`); the guard's record, never verdict-derived. */
interface WriteGateView {
    decisionId: string;
    allowed: boolean;
    code: string | null;
    target: string;
    at: string;
    actor: Record<string, unknown> | null;
}

/**
 * Pipeline v2 — `detail.effectiveness`: the backend's own tally of this request. Every field is
 * read as sent; the page never recomputes, defaults or rounds one of them.
 */
interface EffectivenessView {
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

/**
 * Pipeline v2 — `detail.jev`: the decision recorded at the `decision-jev` stage. `null` means no
 * JEV ran for this request; the page never derives one from the verdict.
 */
interface JevView {
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

/** The shared detail DTO predates P2/P6c/B0-9, the write gate and pipeline v2; those fields ride on the same payload, so they are added here. */
type RequestDetailWithVerdict = RequestDetailDto & {
    verdict?: TurnVerdictView | null;
    signals?: HostSignalsView | null;
    spec?: SpecRefView | null;
    writeGate?: WriteGateView | null;
    effectiveness?: EffectivenessView | null;
    jev?: JevView | null;
};

/**
 * Q5 — the only three states the page may report for server-side verification. It starts at
 * `unavailable`: nothing is called verified until the verify route itself said so.
 */
type ReceiptVerificationState = 'verified' | 'failed' | 'unavailable';

interface ActionEventView {
    id: string;
    tool: string;
    outcome: string;
    filesCount: number;
    readBeforeEdit: string;
    diffRef: string;
}

/** Q6 — rule-based only: each verdict level maps to exactly one next action. */
const NEXT_STEP: Record<VerdictLevel, string> = {
    deny: 'Close the gaps, then re-run',
    unknown: 'Host must emit decision.recorded for this turn',
    partial: 'Capture the missing data and re-issue the verdict',
    allow: 'No action required',
};

@Component({
    selector: 'eso-request-detail-page',
    standalone: true,
    imports: [MatButtonModule, RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="detail-page">
            @if (loading()) {
                <p class="loading-label">Loading request…</p>
            } @else if (error(); as message) {
                <section class="error-panel"><strong>Could not open request</strong><span>{{ message }}</span><a mat-stroked-button routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">← Requests</a></section>
            } @else if (prompt(); as request) {
                <nav class="detail-nav">
                    <div class="crumb"><a routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">← Requests</a><span class="crumb-sep">/</span><code>{{ shortId(request.observationId) }}</code></div>
                    <div class="detail-actions">
                        <a class="pill" routerLink="/office" [queryParams]="{ consumer: consumerId() }">Office 3D</a>
                        <a class="pill" routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">Observatory</a>
                    </div>
                </nav>

                <header class="request-hero">
                    <div class="hero-head">
                        <div class="hero-copy">
                            <p class="eyebrow">Prompt request · {{ value(request, 'flowId') }}</p>
                            <h1 class="request-query">{{ queryText() }}</h1>
                        </div>
                        <div class="badges hero-badges">
                            <span class="badge status-badge" [class.ok]="status() === 'completed'" [class.warn]="status() === 'failed'" [class.bad]="status() === 'blocked'"><span class="status-dot" aria-hidden="true"></span>{{ status() }}</span>
                            @if (verdict(); as v) { <span class="badge verdict-badge" [class]="'level-' + v.level">{{ v.level }}</span> } @else { <span class="badge muted">unknown</span> }
                            <span class="badge muted">{{ value(request, 'taskType') }}</span>
                            <span class="badge muted">{{ traceEvents().length }} events</span>
                            @if (failureKind()) { <span class="badge warn">{{ failureKind() }}</span> }
                        </div>
                    </div>
                    <p class="hero-meta">
                        <span class="meta-fact"><span class="meta-key">Started</span>{{ formatAt(request.at) }}</span>
                        <span class="meta-fact"><span class="meta-key">Duration</span>{{ duration() }}</span>
                        <span class="meta-fact"><span class="meta-key">Host</span>{{ request.hostId || '—' }}</span>
                        <span class="meta-fact"><span class="meta-key">Runtime</span>{{ request.runtimeKey || '—' }}</span>
                        <span class="meta-fact"><span class="meta-key">Model</span>{{ value(request, 'model') === '—' ? 'not captured' : value(request, 'model') }}</span>
                        <span class="meta-fact"><span class="meta-key">Actor</span>{{ heroActor() }}</span>
                    </p>
                    <details class="identity-details">
                        <summary class="identity-summary">
                            <span class="identity-title">Identity</span>
                            <code class="identity-locator" [title]="request.observationId">{{ shortId(request.observationId) }}</code>
                            <span class="identity-hint">id · hash · length · flow</span>
                            <span class="chevron" aria-hidden="true">▸</span>
                        </summary>
                        <div class="identity-body">
                            <p class="policy-note">Prompt body is captured at operator request. Content may contain sensitive data and is shown read-only.</p>
                            <dl class="identity-grid">
                                <div class="identity-cell"><dt>Request ID</dt><dd><code>{{ request.observationId }}</code> <button type="button" class="copy-path" (click)="copyRequestId(request.observationId)" [attr.aria-label]="requestIdCopied() ? 'Request id copied' : 'Copy request id'">{{ requestIdCopied() ? 'copied' : 'copy' }}</button></dd></div>
                                <div class="identity-cell"><dt>Request hash</dt><dd><code>{{ value(request, 'requestHash') }}</code></dd></div>
                                <div class="identity-cell"><dt>Request length</dt><dd>{{ value(request, 'requestLength') }} chars</dd></div>
                                <div class="identity-cell"><dt>Worker</dt><dd>{{ request.workerId || '—' }}</dd></div>
                                <div class="identity-cell"><dt>Runtime</dt><dd>{{ request.runtimeKey }}</dd></div>
                                <div class="identity-cell"><dt>Host</dt><dd>{{ request.hostId }}</dd></div>
                                <div class="identity-cell"><dt>Task type</dt><dd>{{ value(request, 'taskType') }}</dd></div>
                                <div class="identity-cell"><dt>Model / adapter</dt><dd>{{ value(request, 'model') }} · {{ value(request, 'adapter') }}</dd></div>
                                <div class="identity-cell"><dt>Flow</dt><dd>{{ value(request, 'flowId') }}</dd></div>
                            </dl>
                        </div>
                    </details>
                </header>

                <section class="glance-grid top-grid" aria-label="Request at a glance">
                    <section class="verdict-hero" [attr.data-level]="verdict()?.level || 'unknown'" aria-label="Turn verdict (Q1)">
                        <header class="verdict-hero-head">
                            <h2>Turn verdict</h2>
                            @if (verdict(); as v) { <span class="verdict-level-badge" [class]="'level-' + v.level">{{ v.level }}</span> }
                        </header>
                        @if (verdict(); as v) {
                            <div class="verdict-figures">
                                <div class="verdict-meta"><small>Score</small><strong>{{ v.score }}</strong></div>
                                <div class="verdict-meta"><small>Actor</small><span class="verdict-actor-id" [title]="actorId(v.actor)">{{ actorId(v.actor) }}</span>@if (actorRole(v.actor); as role) { <span class="verdict-actor-role">{{ role }}</span> }</div>
                                <div class="verdict-meta"><small>Computed</small><time>{{ relative(v.computedAt) }}</time></div>
                            </div>
                            <p class="verdict-basis">{{ v.basis }}</p>
                        } @else {
                            <div class="verdict-figures"><span class="verdict-level-badge level-unknown">not returned</span></div>
                            <p class="verdict-basis">The API response for this request carried no verdict.</p>
                        }
                    </section>

                    <section class="effectiveness" aria-label="Orchestration effectiveness (pipeline v2)">
                        <header class="effectiveness-head">
                            <div class="card-head-main"><span class="icon-chip effectiveness-chip" aria-hidden="true">◱</span><div><p class="eyebrow">Pipeline v2</p><h2>Orchestration effectiveness</h2></div></div>
                            <span class="badge muted">backend tally</span>
                        </header>
                        @if (effectiveness(); as e) {
                            <div class="kpi-strip">
                                <div class="kpi-tile"><span>Pipeline steps evidenced</span><strong>{{ countOrDash(e.stepsWithEvidence) }}/{{ countOrDash(e.stepsTotal) }}</strong></div>
                                <div class="kpi-tile"><span>Roles &amp; workers</span><strong>{{ countOrDash(e.rolesObserved) }}/{{ countOrDash(e.rolesAssigned) }} roles</strong><small>{{ countOrDash(e.workersObserved) }}/{{ countOrDash(e.workersTotal) }} workers</small></div>
                                <div class="kpi-tile"><span>Failures</span><strong>{{ countOrDash(e.failures) }}</strong></div>
                                <div class="kpi-tile"><span>Duration</span><strong>{{ humanDuration(e.durationMs) }}</strong></div>
                                <div class="kpi-tile"><span>Write gate checked</span><strong>{{ yesNo(e.writeGateChecked) }}</strong></div>
                                <div class="kpi-tile"><span>Receipt sealed</span><strong>{{ yesNo(e.receiptSealed) }}</strong></div>
                                <div class="kpi-tile"><span>Gaps</span><strong>{{ countOrDash(e.gaps) }}</strong></div>
                            </div>
                        } @else {
                            <p class="hint">No effectiveness data for this request</p>
                        }
                        @if (signals(); as s) {
                            <div class="host-signals" aria-label="Host signals (P6c)">
                                <header class="host-signals-head">
                                    <div class="card-head-main"><span class="icon-chip signals-chip" aria-hidden="true">◉</span><div><p class="eyebrow">Host-reported</p><h2>Host signals</h2></div></div>
                                    <span class="badge muted">not inferred by ESO</span>
                                </header>
                                <div class="signal-strip">
                                    <div class="signal-tile"><span>Preflight</span><strong>{{ preflightLabel(s.preflight) }}</strong><small>{{ preflightFingerprint(s.preflight) }}</small></div>
                                    <div class="signal-tile"><span>Recon calls</span><strong>{{ reconLabel(s.recon) }}</strong><small>calls the host reported, per adapter</small></div>
                                    <div class="signal-tile"><span>Brain tier</span><strong>{{ brainTierLabel(s.brainTier) }}</strong><small>tier the host reported</small></div>
                                    <div class="signal-tile"><span>Distill</span><strong>{{ distillLabel(s.distill) }}</strong><small>lessons the host reported</small></div>
                                </div>
                            </div>
                        } @else {
                            <p class="signals-inline" title="No host signal was reported for this turn"><span class="signals-key">Host signals:</span> not reported</p>
                        }
                    </section>

                    <section class="panel gate-card" aria-label="Write gate">
                        <header class="panel-head">
                            <div class="card-head-main"><span class="icon-chip gate-chip" aria-hidden="true">⛨</span><div><p class="eyebrow">Scope guard</p><h2>Write gate</h2></div></div>
                            <span class="gate-badge" [attr.data-state]="writeGate()?.allowed === true ? 'allowed' : writeGate() ? 'blocked' : 'none'">{{ writeGate() ? gateLabel() : 'not recorded' }}</span>
                        </header>
                        @if (writeGate(); as gate) {
                            <div class="gate-summary">
                                <span class="gate-state" [attr.data-state]="gate.allowed ? 'allowed' : 'blocked'"><span class="status-dot" aria-hidden="true"></span>{{ gate.allowed ? 'allowed' : 'blocked' }}</span>
                                @if (gate.code) { <code class="gate-code">{{ gate.code }}</code> } @else { <span class="hint">no code</span> }
                                <code class="gate-target">{{ gate.target }}</code>
                                <time>{{ relative(gate.at) }}</time>
                            </div>
                            <dl class="gate-facts">
                                <div><dt>Decision</dt><dd><code>{{ gate.decisionId }}</code></dd></div>
                                @if (writeGateActor(gate.actor); as actor) { <div><dt>Actor</dt><dd>{{ actor }}</dd></div> }
                            </dl>
                        } @else {
                            <p class="hint gate-empty">No scope decision was recorded for this turn</p>
                        }
                    </section>

                    <section class="panel tokens" aria-label="Cost">
                        <header class="panel-head"><div class="card-head-main"><span class="icon-chip tokens-chip" aria-hidden="true">◎</span><div><p class="eyebrow">Cost</p><h2>Tokens &amp; model</h2></div></div></header>
                        <div class="token-tiles">
                            <div><span>Input</span><strong>{{ tokenSummary().input ?? '—' }}</strong><small>{{ tokenSummary().estimated ? 'estimated · chars/4' : 'not captured' }}</small></div>
                            <div><span>Output</span><strong>{{ tokenSummary().output ?? '—' }}</strong><small>{{ tokenSummary().estimated ? 'estimated · chars/4' : 'not captured' }}</small></div>
                            <div><span title="LLM calls">Calls</span><strong>{{ llmCalls().length }}</strong><small>worker steps</small></div>
                            <div><span>Tools</span><strong>{{ toolCount() }}</strong><small>{{ fileCount() }} files</small></div>
                        </div>
                        <p class="hint">Estimated chars/4 · not provider-reported.</p>
                    </section>
                </section>

                <nav class="pipeline-stepper" aria-label="Pipeline stages">
                    @for (stage of systemStages(); track stage.id) {
                        <button type="button" class="pipeline-step" [class.ok]="stage.status === 'ok'" [class.bad]="stage.status === 'warn'" [class.info]="stage.status === 'info'" [class.muted]="stage.status === 'muted'" [class.active]="activeTab() === stage.tab" [attr.aria-pressed]="activeTab() === stage.tab" [title]="'Step ' + stage.stepNumber + ': ' + stage.title + ' — ' + stage.sub" (click)="activeTab.set(stage.tab)">
                            <span class="stage-icon" aria-hidden="true">{{ stageGlyph(stage.id) }}</span>
                            <span class="pipeline-step-copy">
                                <span class="pipeline-step-title">{{ stage.title }}</span>
                                <span class="pipeline-step-sub">{{ stage.sub }}</span>
                            </span>
                            <span class="step-dot" aria-hidden="true"></span>
                        </button>
                    }
                </nav>

                <section class="endflow">
                    <header class="endflow-head">
                        <div class="endflow-title"><span class="endflow-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 11-14h-8l1-6z" /></svg></span><div><p class="eyebrow">Pipeline v2 · data flow</p><h2>End-to-End Pipeline Data Flow</h2><p>Prompt ingest → worker handoff → evidence → telemetry</p></div></div>
                        <button type="button" class="ghost-btn" (click)="flowExpanded.set(!flowExpanded())">{{ flowExpanded() ? '▲ Hide' : '▼ Show flow' }}</button>
                    </header>
                    @if (flowExpanded()) {
                        <div class="endflow-body">
                            @for (step of endSteps(); track step.id; let index = $index) {
                                <div class="endflow-step" [class.is-empty]="step.empty">
                                    <div class="endflow-rail"><span class="endflow-no" [class.ok]="step.status === 'ok'" [class.bad]="step.status === 'warn'">{{ index + 1 }}</span></div>
                                    <div class="endflow-card" [class.ok]="step.status === 'ok'" [class.bad]="step.status === 'warn'" [class.info]="step.status === 'info'">
                                        <button type="button" class="endflow-card-head" (click)="toggleStep(step)" [attr.aria-expanded]="isStepOpen(step)">
                                            <span class="endflow-card-title">STEP {{ index + 1 }} · {{ step.label }}</span>
                                            @if (step.empty) { <span class="missing-tag">missing</span> }
                                            <span class="endflow-card-sub">{{ step.empty ? 'No host evidence for this step' : step.sub }}</span>
                                            <span class="badge" [class.ok]="step.status === 'ok'" [class.warn]="step.status === 'warn'">{{ step.status }}</span>
                                            <span class="chevron" aria-hidden="true">{{ isStepOpen(step) ? '▾' : '▸' }}</span>
                                        </button>
                                        @if (isStepOpen(step)) {
                                            <div class="endflow-subgrid" [class.single]="step.subcards.length === 1">
                                                @for (sub of step.subcards; track sub.label) {
                                                    <div class="endflow-sub">
                                                        <span class="sub-label">{{ sub.label }}</span>
                                                        <strong class="sub-value">{{ sub.value }}</strong>
                                                        <small class="sub-detail">{{ sub.detail }}</small>
                                                    </div>
                                                }
                                            </div>
                                        }
                                    </div>
                                </div>
                            }
                        </div>
                    }
                </section>

                <div class="tabs drill-tabs" role="tablist" aria-label="Request detail tabs">
                    @for (tab of tabs; track tab.id) {
                        <button type="button" role="tab" [attr.data-tab]="tab.id" [attr.aria-selected]="activeTab() === tab.id" [class.active]="activeTab() === tab.id" (click)="activeTab.set(tab.id)">
                            <span class="tab-icon" aria-hidden="true">{{ tabGlyph(tab.id) }}</span>
                            <span class="tab-label">{{ tab.label }}</span>
                            <span class="tab-count">{{ tabCount(tab.id) }}</span>
                        </button>
                    }
                </div>

                @if (activeTab() === 'waterfall') {
                    <section class="panel waterfall">
                        <div class="waterfall-toolbar">
                            <div class="chips"><button type="button" class="chip" [class.on]="!eventQuery()" (click)="eventQuery.set('')">All</button><button type="button" class="chip" [class.on]="eventQuery() === 'FAIL'" (click)="eventQuery.set('FAIL')">Failures</button><button type="button" class="chip" [class.on]="eventQuery() === 'prompt.submitted'" (click)="eventQuery.set('prompt.submitted')">Requests</button></div>
                            <div class="wf-summary"><span class="summary-chip">Files <strong>{{ fileCount() }}</strong></span><span class="summary-chip">Tool calls <strong>{{ toolCount() }}</strong></span><span class="summary-chip">LLM calls <strong>{{ llmCalls().length }}</strong></span></div>
                            <input class="search" [value]="eventQuery()" (input)="eventQuery.set($any($event.target).value)" placeholder="Filter event / worker…">
                        </div>
                        <div class="event-table-head" aria-hidden="true"><span>Time</span><span>Event</span><span>Worker</span><span>Outcome</span><span>Duration</span></div>
                        @for (event of waterfallEvents(); track event.observationId) {
                            <article class="event-row" [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'">
                                <div class="event-grid">
                                    <time [title]="formatAt(event.at)">{{ formatClock(event.at) }}</time>
                                    <code [title]="event.event">{{ event.event }}</code>
                                    <span class="event-worker" [title]="event.workerId || '—'">{{ workerLabel(event.workerId) }}</span>
                                    <span class="badge" [class.ok]="event.outcome === 'PASS' || event.outcome === 'COMPLETED'" [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'">{{ event.outcome || '—' }}</span>
                                    <span class="event-duration">{{ eventDuration(event) }}</span>
                                </div>
                                <details class="event-evidence" (toggle)="trackEvidence($event)"><summary>Evidence</summary><pre>{{ evidenceText(event.evidence) }}</pre></details>
                            </article>
                        } @empty {
                            <p class="hint waterfall-empty">{{ eventQuery() ? 'No events match this filter.' : 'No events recorded for this request.' }}</p>
                        }
                    </section>
                } @else if (activeTab() === 'topology') {
                    <section class="panel">
                        <header class="panel-head"><div><p class="eyebrow">Trace flow</p><h2>Worker handoff</h2></div><span class="muted">{{ traceEvents().length }} events</span></header>
                        <div class="flow-chain">
                            <div class="flow-node prompt"><strong>Prompt</strong><small>{{ request.workerId || '—' }}</small></div>
                            @for (stage of stages(); track stage.workerId) {
                                <span class="flow-arrow">→</span>
                                <div class="flow-node" [class.ok]="stage.status === 'PASS'" [class.bad]="stage.status === 'FAIL' || stage.status === 'BLOCKED'"><strong>{{ stage.label }}</strong><small>{{ stage.status }}</small></div>
                            }
                        </div>

                        <div class="runtime-compare">
                            <section class="runtime-column" aria-label="Configured pipeline">
                                <header class="runtime-column-head"><h3>Configured</h3><small>{{ configuredGraph().length }} step(s)</small></header>
                                @for (step of configuredGraph(); track step.workerId; let index = $index) {
                                    <div class="runtime-row">
                                        <span class="runtime-no">{{ index + 1 }}</span>
                                        <span class="runtime-name"><strong>{{ step.label }}</strong><small>{{ step.workerId }}</small></span>
                                        <span class="badge" [class.ok]="step.status === 'PASS'" [class.warn]="step.status === 'FAIL' || step.status === 'BLOCKED'" [class.muted]="!step.status">{{ step.status || '—' }}</span>
                                    </div>
                                } @empty {
                                    <p class="hint">No configured pipeline steps (host did not return a pipeline).</p>
                                }
                            </section>
                            <section class="runtime-column" aria-label="Observed worker path">
                                <header class="runtime-column-head"><h3>Observed</h3><small>{{ observedGraph().length }} worker(s)</small></header>
                                @for (worker of observedGraph(); track worker.workerId; let index = $index) {
                                    <div class="runtime-row">
                                        <span class="runtime-no">{{ index + 1 }}</span>
                                        <span class="runtime-name"><strong>{{ worker.label }}</strong><small>{{ worker.event }} · {{ formatAt(worker.at) }}</small></span>
                                        <span class="badge" [class.ok]="worker.outcome === 'PASS'" [class.warn]="worker.outcome === 'FAIL' || worker.outcome === 'BLOCKED'" [class.muted]="!worker.outcome || worker.outcome === '—'">{{ worker.outcome }}</span>
                                    </div>
                                } @empty {
                                    <p class="hint">No observed worker path (host did not report worker events)</p>
                                }
                            </section>
                        </div>

                        <div class="runtime-divergence" [attr.data-kind]="divergence().kind" aria-label="Configured vs observed divergence">
                            <div class="divergence-head">
                                <span class="eyebrow">Divergence</span>
                                @switch (divergence().kind) {
                                    @case ('matches') { <span class="badge ok">matches</span> }
                                    @case ('missing') { <span class="badge warn">missing</span> }
                                    @case ('extra') { <span class="badge bad">extra</span> }
                                    @case ('reordered') { <span class="badge info">reordered</span> }
                                    @default { <span class="badge muted">no data</span> }
                                }
                                <small class="hint">{{ divergence().configuredCount }} configured · {{ divergence().observedCount }} observed</small>
                            </div>
                            @if (divergence().kind === 'matches') {
                                <p class="divergence-line">matches — configured order equals observed order.</p>
                            } @else if (divergence().kind === 'empty') {
                                <p class="divergence-line">No configured or observed worker path to compare.</p>
                            } @else {
                                @if (divergence().missing.length) {
                                    <p class="divergence-line missing"><span class="divergence-key">missing</span> configured but never observed: {{ divergence().missing.join(', ') }}</p>
                                }
                                @if (divergence().extra.length) {
                                    <p class="divergence-line extra"><span class="divergence-key">extra</span> observed but not configured: {{ divergence().extra.join(', ') }}</p>
                                }
                                @if (divergence().kind === 'reordered') {
                                    <p class="divergence-line">Same workers, different order.</p>
                                }
                            }
                        </div>
                    </section>
                } @else if (activeTab() === 'decisions') {
                    <section class="panel verdict-panel">
                        <header class="panel-head"><div><p class="eyebrow">Verdict</p><h2>Verdict &amp; gaps</h2></div><span class="badge muted">ESO adjudication</span></header>
                        @if (verdict(); as v) {
                            <div class="verdict-block">
                                <h3><span class="q-no">Q1</span> Verdict</h3>
                                <div class="verdict-head">
                                    <span class="verdict-level-badge" [class]="'level-' + v.level">{{ v.level }}</span>
                                    <div class="verdict-meta"><small>Score</small><strong>{{ v.score }}</strong></div>
                                    <div class="verdict-meta"><small>Actor</small><span class="verdict-actor-id">{{ actorId(v.actor) }}</span>@if (actorRole(v.actor); as role) {<span class="verdict-actor-role">{{ role }}</span>}</div>
                                    <div class="verdict-meta"><small>Computed</small><time>{{ relative(v.computedAt) }}</time></div>
                                </div>
                                <p class="verdict-basis">{{ v.basis }}</p>
                            </div>
                            <div class="verdict-block">
                                <h3><span class="q-no">Q2</span> Why this verdict</h3>
                                <ul class="rule-refs">
                                    @for (ref of v.ruleRefs; track $index) {
                                        <li class="rule-ref"><code>{{ ruleRefLabel(ref) }}</code></li>
                                    } @empty {
                                        <li class="hint">No rule reference was recorded</li>
                                    }
                                </ul>
                                <p class="verdict-basis">{{ v.basis }}</p>
                                <p class="spec-line">
                                    @if (spec(); as ref) {
                                        <span class="spec-label">Normative:</span>
                                        <code>{{ ref.doc }}</code>
                                        <span class="spec-version">v{{ ref.version }}</span>
                                        <span class="spec-section">{{ ref.section }}</span>
                                        <button type="button" class="copy-path" (click)="copySpecPath(ref.doc)">{{ specPathCopied() ? 'copied' : 'copy path' }}</button>
                                    } @else {
                                        <span class="spec-label">Normative:</span>
                                        <span class="hint">no spec reference was returned</span>
                                    }
                                </p>
                                <p class="write-gate" aria-label="Write gate (Q2)">
                                    <span class="write-gate-label">Write gate</span>
                                    @if (writeGate(); as gate) {
                                        <span class="badge" [class.ok]="gate.allowed" [class.bad]="!gate.allowed">{{ gate.allowed ? 'allowed' : 'blocked' }}</span>
                                        @if (gate.code) { <code>{{ gate.code }}</code> } @else { <span class="hint">no code</span> }
                                        <code class="write-gate-target">{{ gate.target }}</code>
                                        <time>{{ relative(gate.at) }}</time>
                                        @if (writeGateActor(gate.actor); as actor) { <span class="write-gate-actor">{{ actor }}</span> }
                                    } @else {
                                        <span class="hint">No scope decision was recorded for this turn</span>
                                    }
                                </p>
                            </div>
                            <div class="verdict-block">
                                <h3><span class="q-no">Q3</span> Sufficiency</h3>
                                <p class="verdict-score-line">Score <strong>{{ v.score }}</strong> / 100 · {{ v.gaps.length }} gap(s)</p>
                                <ul class="gap-list">
                                    @for (gap of v.gaps; track gap.code) {
                                        <li class="gap-row"><div class="gap-head"><code>{{ gap.code }}</code> · <span>{{ gap.what }}</span></div><p class="gap-consequence">{{ gap.consequence }}</p></li>
                                    } @empty {
                                        <li class="hint">No gaps recorded</li>
                                    }
                                </ul>
                            </div>
                        } @else {
                            <p class="hint">The API response for this request carried no verdict.</p>
                        }
                        <div class="verdict-block jev-block" aria-label="JEV decision (pipeline v2)">
                            <h3><span class="q-no">JEV</span> Decision &amp; JEV</h3>
                            @if (jev(); as j) {
                                <p class="jev-line">
                                    <span class="jev-summary">JEV {{ j.mode }} · band {{ j.band }} · confidence {{ j.confidence }}</span>
                                    @if (j.match === false) {
                                        <span class="jev-mismatch">Band mismatch — reported {{ j.band }}, expected {{ j.expectedBand }}</span>
                                    }
                                </p>
                            } @else {
                                <p class="jev-line hint">No JEV decision was recorded</p>
                            }
                        </div>
                    </section>

                    <section class="panel change-panel">
                        <header class="panel-head"><div><p class="eyebrow">Action</p><h2><span class="q-no">Q4</span> What changed</h2></div><span class="badge muted">{{ actionEvents().length }} action event(s)</span></header>
                        <ul class="action-list">
                            @for (action of actionEvents(); track action.id) {
                                <li class="action-row"><strong>{{ action.tool }}</strong><span class="badge">{{ action.outcome }}</span><span>{{ action.filesCount }} file(s)</span><span>read before edit: {{ action.readBeforeEdit }}</span><code>diff: {{ action.diffRef }}</code></li>
                            } @empty {
                                <li class="hint">No action event was captured (host did not report it)</li>
                            }
                        </ul>
                    </section>

                    <section class="panel next-panel">
                        <header class="panel-head"><div><p class="eyebrow">Next</p><h2>Integrity &amp; next action</h2></div></header>
                        @if (verdict(); as v) {
                            <div class="verdict-block">
                                <h3><span class="q-no">Q5</span> Integrity</h3>
                                @if (receipt(); as r) {
                                    <p class="receipt-line">Receipt <code>{{ r.receiptId }}</code></p>
                                    <dl class="receipt-facts">
                                        <div><dt>Hash</dt><dd>@if (r.hashPrefix) { <code>{{ r.hashPrefix }}</code>… } @else { not returned }</dd></div>
                                        <div><dt>Chain</dt><dd>{{ r.chained ? 'chained' : 'genesis' }}</dd></div>
                                        <div><dt>HMAC</dt><dd>{{ r.hmacPresent ? 'HMAC present' : 'HMAC absent' }}</dd></div>
                                        <div><dt>Spec</dt><dd>v{{ r.specVersion }} · {{ r.verdictLevel }}</dd></div>
                                        <div><dt>Issued</dt><dd><time>{{ relative(r.createdAt) }}</time></dd></div>
                                    </dl>
                                    @if (receiptVerification() === 'verified') {
                                        <p class="receipt-verify" data-state="verified"><span class="badge ok">Verified · hash ok</span></p>
                                    } @else if (receiptVerification() === 'failed') {
                                        <p class="receipt-verify" data-state="failed"><span class="badge bad">Verification failed</span></p>
                                    } @else {
                                        <p class="receipt-verify" data-state="unavailable"><span class="badge muted">Verification unavailable</span></p>
                                    }
                                } @else {
                                    <p class="receipt-line">Receipt <code>{{ receiptLabel(v.receiptId) }}</code></p>
                                    @if (!v.receiptId) { <p class="hint">No receipt was issued for this turn; nothing is claimed to be signed.</p> }
                                    <p class="hint">No receipt summary was returned, so integrity cannot be checked.</p>
                                }
                            </div>
                            <div class="verdict-block">
                                <h3><span class="q-no">Q6</span> What next</h3>
                                <p class="next-step">{{ nextStep(v.level) }}</p>
                                @if (v.gaps.length) {
                                    <ul class="next-codes">@for (gap of v.gaps; track gap.code) { <li>{{ gap.code }}</li> }</ul>
                                } @else {
                                    <p class="hint">No gap codes recorded for this verdict.</p>
                                }
                            </div>
                        } @else {
                            <p class="hint">No verdict was returned, so no next step can be derived.</p>
                        }
                    </section>

                    <section class="panel">
                        <header class="panel-head"><div><p class="eyebrow">Heuristic checks — not the verdict</p><h2>Checks &amp; worker outcomes</h2></div><span class="badge muted">{{ checks().length }} checks</span></header>
                        <div class="checks">
                            @for (check of checks(); track check.checkId) {
                                <div class="check-row"><span class="check-status" [attr.data-status]="check.status">{{ check.status }}</span><strong>{{ check.checkId }}</strong><small>{{ check.detail }}</small></div>
                            }
                        </div>
                        <div class="table-wrap"><table class="telemetry-table"><thead><tr><th>#</th><th>Worker</th><th>Outcome</th><th>Event</th><th>Duration</th><th>Error code</th></tr></thead><tbody>
                            @for (stage of stages(); track stage.workerId; let index = $index) {
                                <tr><td>{{ index + 1 }}</td><td>{{ stage.label }}</td><td>{{ stage.status }}</td><td>{{ stage.event }}</td><td>{{ stage.durationMs }} ms</td><td>{{ stage.errorCode || '—' }}</td></tr>
                            }
                        </tbody></table></div>
                    </section>
                } @else if (activeTab() === 'rules') {
                    <section class="panel">
                        <header class="panel-head"><div><p class="eyebrow">Context</p><h2>Worker context &amp; routing</h2></div><span class="badge muted">read-only</span></header>
                        <h3>Recon from consumer config</h3>
                        <div class="recon-grid">
                            @for (adapter of recon(); track adapter.id) {
                                <div class="recon-card">
                                    <div><strong>{{ adapter.label }}</strong><span class="badge muted">{{ adapter.status }}</span></div>
                                    <small>{{ adapter.id }} · source {{ adapter.source }}<br>{{ adapter.required ? 'required' : 'optional' }} · {{ adapter.calls }} observed call(s)</small>
                                </div>
                            } @empty {
                                <p class="hint">Consumer config declares no recon layer.</p>
                            }
                        </div>
                        <div class="context-grid">
                            <div>
                                <h3>Worker context</h3>
                                <dl class="facts-grid">
                                    <dt>Worker</dt><dd>{{ contextValue('workerId') }}</dd>
                                    <dt>Role</dt><dd>{{ contextValue('role') }}</dd>
                                    <dt>Layer</dt><dd>{{ contextValue('layer') }}</dd>
                                    <dt>Scope</dt><dd>{{ contextValue('scope') }}</dd>
                                    <dt>Capabilities</dt><dd>{{ contextList('capabilities') }}</dd>
                                    <dt>Verbs</dt><dd>{{ contextList('verbs') }}</dd>
                                    <dt>Quality bar</dt><dd>{{ contextList('qualityBar') }}</dd>
                                    <dt>Escalation</dt><dd>{{ contextValue('escalation') }}</dd>
                                </dl>
                                <details><summary>Worker instructions</summary><pre class="raw">{{ contextValue('instructions') }}</pre></details>
                            </div>
                            <div>
                                <h3>Routing</h3>
                                <dl class="facts-grid">
                                    <dt>Adapter</dt><dd>{{ routingValue('adapter') }}</dd>
                                    <dt>Model</dt><dd>{{ routingValue('model') }}</dd>
                                    <dt>Model source</dt><dd>{{ routingValue('modelSource') }}</dd>
                                    <dt>Tier</dt><dd>{{ routingValue('tier') }}</dd>
                                    <dt>Effort</dt><dd>{{ routingValue('effort') }}</dd>
                                    <dt>Task type</dt><dd>{{ routingValue('taskType') }}</dd>
                                </dl>
                                <details><summary>Event envelope</summary><pre class="raw">{{ envelopeText() }}</pre></details>
                            </div>
                        </div>
                    </section>
                } @else if (activeTab() === 'telemetry') {
                    <section class="panel telemetry">
                        <header class="panel-head"><div><p class="eyebrow">Telemetry</p><h2>LLM calls / tools / files</h2></div><span class="badge muted">observed</span></header>
                        <div class="token-tiles">
                            <div><span>Input est.</span><strong>{{ tokenSummary().input ?? '—' }}</strong><small>chars/4</small></div>
                            <div><span>Output est.</span><strong>{{ tokenSummary().output ?? '—' }}</strong><small>chars/4</small></div>
                            <div><span>Tools</span><strong>{{ toolCount() }}</strong><small>observed</small></div>
                            <div><span>Files</span><strong>{{ fileCount() }}</strong><small>observed</small></div>
                        </div>
                        <div class="table-wrap"><table class="telemetry-table">
                            <thead><tr><th>#</th><th>Worker</th><th>Model</th><th>Adapter</th><th>Duration</th><th>In est.</th><th>Out est.</th><th>Outcome</th></tr></thead>
                            <tbody>
                                @for (call of llmCalls(); track call.id) {
                                    <tr><td>{{ $index + 1 }}</td><td>{{ workerLabel(call.workerId) }}</td><td>{{ call.model }}</td><td>{{ call.adapter }}</td><td>{{ call.durationMs ? call.durationMs + ' ms' : '—' }}</td><td>{{ call.input }}</td><td>{{ call.output }}</td><td>{{ call.outcome }}</td></tr>
                                }
                            </tbody>
                        </table></div>
                        <p class="hint">Tool/file extraction is not available in the adapter yet; cards show 0 instead of inventing data.</p>
                    </section>
                } @else {
                    <section class="panel timeline">
                        @for (stage of stages(); track stage.workerId) {
                            <div class="lane"><span>{{ stage.label }}</span><div class="lane-track"><span class="lane-event" [class.bad]="stage.status === 'FAIL' || stage.status === 'BLOCKED'">{{ stage.event }}</span></div></div>
                        }
                    </section>
                }
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .detail-page {
            --surface: #131722;
            --surface-2: #0d1118;
            --surface-3: #0f1a2b;
            --line: #253047;
            --line-soft: #1e2a3e;
            --ink: #e2e8f0;
            --muted: #8b97ab;
            --dim: #64748b;
            --brand: #5aa9ff;
            --brand-ink: #ffffff;
            --warn-ink: #e0b341;
            --ok-ink: #4ec97a;
            --danger-ink: #ff6b6b;
            --fs-h1: 1.625rem;
            --fs-h1-lg: 1.75rem;
            --fs-title: 0.875rem;
            --fs-body: 0.8125rem;
            --fs-secondary: var(--text-xs);
            --fs-badge: 0.6875rem;
            --lh: 1.35;
            display: grid;
            gap: var(--space-5);
            width: 100%;
            max-width: calc(var(--content-max) + var(--page-pad) * 2);
            margin: 0 auto;
            padding: var(--page-pad);
            box-sizing: border-box;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: var(--ink);
            font-size: var(--fs-body);
            line-height: var(--lh);
        }
        h1, h2, h3, p, dl, dd, dt, ul, li { margin: 0; }
        h2 { font-size: var(--fs-title); line-height: var(--lh); font-weight: 650; color: #f1f5f9; }
        h3 { font-size: var(--fs-body); line-height: var(--lh); font-weight: 600; color: #e2e8f0; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hint, .muted { color: var(--muted); font-size: var(--fs-secondary); }
        .detail-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
        .crumb { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; color: var(--muted); font-size: var(--fs-secondary); }
        .crumb a { color: var(--brand); text-decoration: none; }
        .crumb code { color: var(--brand); overflow-wrap: anywhere; }
        .crumb-sep { color: var(--dim); }
        .detail-actions { display: flex; gap: var(--space-2); }
        .pill { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: 62.44rem; background: var(--surface-3); color: #cbd5e1; font-size: var(--fs-secondary); line-height: 1.6; text-decoration: none; }
        .pill:hover { border-color: var(--brand); color: #ffffff; }
        .request-hero { display: grid; gap: var(--space-2); padding: var(--space-4) var(--space-5); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface); box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .hero-head { display: flex; align-items: flex-start; gap: var(--space-3); flex-wrap: wrap; }
        .hero-copy { display: grid; gap: var(--space-1); flex: 1 1 32rem; min-width: 0; }
        .hero-badges { margin-left: auto; justify-content: flex-end; }
        .request-query { margin: 0; font-size: var(--fs-h1); line-height: 1.2; font-weight: 650; letter-spacing: -.01em; color: #f1f5f9; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
        .hero-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); color: #cbd5e1; font-size: var(--fs-secondary); }
        .meta-fact { display: inline-flex; align-items: baseline; gap: var(--space-1); }
        .meta-fact + .meta-fact::before { content: '·'; margin-right: var(--space-1); color: var(--dim); }
        .meta-key { color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .badges { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
        .badge { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); line-height: 1.2; font-weight: 500; white-space: nowrap; }
        .badge.ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); background: rgba(78,201,122,.15); }
        .badge.warn { color: #fde68a; border-color: rgba(224,179,65,.45); background: rgba(224,179,65,.12); }
        .badge.bad { color: #fecaca; border-color: rgba(255,107,107,.4); background: rgba(255,107,107,.2); }
        .badge.muted { color: var(--muted); background: var(--surface-2); }
        .badge.info { color: #bae6fd; border-color: rgba(90,169,255,.4); background: rgba(90,169,255,.15); }
        .status-dot { display: inline-block; width: .4375rem; height: .4375rem; border-radius: 50%; background: currentColor; }
        .identity-details { border-top: 1px solid var(--line-soft); padding-top: var(--space-2); }
        .identity-summary { display: flex; align-items: center; gap: var(--space-2); cursor: pointer; color: var(--muted); font-size: var(--fs-secondary); list-style: none; }
        .identity-summary::-webkit-details-marker { display: none; }
        .identity-title { color: #cbd5e1; font-weight: 600; }
        .identity-locator { color: var(--brand); overflow-wrap: anywhere; }
        .identity-hint { color: var(--dim); font-size: var(--fs-badge); }
        .chevron { color: var(--muted); font-size: var(--fs-secondary); line-height: 1; }
        .identity-summary .chevron { margin-left: auto; transition: transform .15s ease; }
        .identity-details[open] .identity-summary .chevron { transform: rotate(90deg); }
        .identity-body { display: grid; gap: var(--space-2); padding-top: var(--space-2); }
        .policy-note { padding: var(--space-2); border: 1px solid var(--line-soft); border-left: 3px solid var(--warn-ink); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--fs-secondary); }
        .identity-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); }
        .identity-cell { display: grid; gap: .0625rem; min-width: 0; }
        .identity-cell dt { color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .identity-cell dd { color: #cbd5e1; font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .identity-cell code { color: var(--brand); }
        .glance-grid { display: grid; grid-template-columns: minmax(0, .95fr) minmax(0, 1.9fr) minmax(0, 1fr) minmax(0, .95fr); gap: var(--space-3); align-items: start; }
        .glance-grid > * { min-width: 0; }
        .panel { display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-accent, var(--brand)); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .panel-head h2 { margin: 0; }
        .card-head-main { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .card-head-main h2 { margin: 0; }
        .icon-chip { display: grid; place-items: center; flex: 0 0 auto; width: 1.5rem; height: 1.5rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--brand); font-size: var(--fs-secondary); line-height: 1; }
        .effectiveness-chip { border-color: rgba(90,169,255,.35); color: var(--brand); }
        .signals-chip { border-color: rgba(192,132,252,.35); color: #c084fc; }
        .gate-chip { border-color: rgba(224,179,65,.4); color: var(--warn-ink); }
        .tokens-chip { border-color: rgba(224,179,65,.35); color: var(--warn-ink); }
        .verdict-hero { --card-accent: #64748b; display: grid; align-content: start; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-accent); border-radius: var(--radius-md); background: var(--surface); min-width: 0; font-size: var(--text-sm); box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .verdict-hero[data-level='allow'] { --card-accent: var(--ok-ink); }
        .verdict-hero[data-level='partial'] { --card-accent: var(--warn-ink); }
        .verdict-hero[data-level='deny'] { --card-accent: var(--danger-ink); }
        .verdict-hero[data-level='unknown'] { --card-accent: #64748b; }
        .verdict-hero-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .verdict-figures { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: var(--space-1) var(--space-2); }
        .verdict-meta { display: grid; gap: 0; min-width: 0; }
        .verdict-meta small { color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .verdict-meta strong { color: var(--warn-ink); font-size: 1.125rem; line-height: 1.1; font-variant-numeric: tabular-nums; }
        .verdict-meta time { color: var(--ink); font-size: var(--fs-secondary); white-space: nowrap; }
        .verdict-actor-id { min-width: 0; color: var(--ink); font-size: var(--fs-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .verdict-actor-role { display: block; color: var(--dim); font-size: var(--fs-badge); }
        .verdict-basis { margin: 0; color: #cbd5e1; font-size: var(--fs-secondary); line-height: var(--lh); overflow-wrap: anywhere; }
        .verdict-level-badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid currentColor; border-radius: var(--radius-sm); font-size: var(--fs-badge); font-weight: 700; letter-spacing: .06em; line-height: 1.2; text-transform: uppercase; white-space: nowrap; }
        .level-allow { color: var(--ok-ink); background: rgba(78,201,122,.12); }
        .level-partial { color: var(--warn-ink); background: rgba(224,179,65,.12); }
        .level-deny { color: var(--danger-ink); background: rgba(255,107,107,.12); }
        .level-unknown { color: var(--muted); background: rgba(139,151,171,.12); }
        .effectiveness { --card-accent: var(--brand); display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-accent); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .effectiveness-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .kpi-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1) var(--space-3); }
        .kpi-tile { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: var(--space-2); min-width: 0; }
        .kpi-tile span { grid-column: 1; color: var(--dim); font-size: var(--fs-badge); letter-spacing: .04em; text-transform: uppercase; }
        .kpi-tile strong { grid-column: 2; color: var(--ink); font-size: var(--fs-secondary); font-weight: 650; font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
        .kpi-tile small { grid-column: 1 / -1; color: var(--dim); font-size: var(--fs-badge); overflow-wrap: anywhere; }
        .signals-inline { color: var(--muted); font-size: var(--fs-secondary); }
        .signals-key { color: #cbd5e1; font-weight: 600; }
        .host-signals { display: grid; gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line-soft); }
        .host-signals-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .signal-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
        .signal-tile { display: grid; gap: 0; min-width: 0; }
        .signal-tile span { color: var(--dim); font-size: var(--fs-badge); letter-spacing: .04em; text-transform: uppercase; }
        .signal-tile strong { color: var(--ink); font-size: var(--fs-secondary); font-weight: 600; overflow-wrap: anywhere; }
        .signal-tile small { color: var(--dim); font-size: var(--fs-badge); overflow-wrap: anywhere; }
        .gate-card { --card-accent: var(--warn-ink); }
        .gate-badge { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--muted); font-size: var(--fs-badge); letter-spacing: .06em; line-height: 1.6; text-transform: uppercase; white-space: nowrap; }
        .gate-badge[data-state='allowed'] { color: var(--ok-ink); border-color: rgba(78,201,122,.35); }
        .gate-badge[data-state='blocked'] { color: var(--danger-ink); border-color: rgba(255,107,107,.4); }
        .gate-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); padding: var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); }
        .gate-state { display: inline-flex; align-items: center; gap: var(--space-1); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .gate-state[data-state='allowed'] { color: var(--ok-ink); }
        .gate-state[data-state='blocked'] { color: var(--danger-ink); }
        .gate-code { color: var(--warn-ink); overflow-wrap: anywhere; }
        .gate-target { color: var(--brand); overflow-wrap: anywhere; }
        .gate-summary time { margin-left: auto; color: var(--dim); font-size: var(--fs-badge); }
        .gate-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: var(--space-1) var(--space-3); }
        .gate-facts div { display: grid; gap: 0; min-width: 0; }
        .gate-facts dt { color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .gate-facts dd { color: var(--ink); font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .gate-facts code { color: var(--brand); }
        .gate-empty { margin: 0; }
        .tokens { --card-accent: var(--warn-ink); }
        .token-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1) var(--space-2); }
        .token-tiles div { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: var(--space-1); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); }
        .token-tiles span { grid-column: 1; color: var(--dim); font-size: var(--fs-badge); letter-spacing: .04em; text-transform: uppercase; }
        .token-tiles strong { grid-column: 2; color: var(--warn-ink); font-size: var(--fs-body); font-variant-numeric: tabular-nums; line-height: 1.2; text-align: right; }
        .token-tiles small { grid-column: 1 / -1; color: var(--dim); font-size: var(--fs-badge); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pipeline-stepper { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; }
        .pipeline-step { position: relative; display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); align-items: center; gap: var(--space-1); min-height: 4rem; padding: var(--space-1) var(--space-2); border: 0; border-right: 1px solid var(--line-soft); background: transparent; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
        .pipeline-step:last-child { border-right: 0; }
        .pipeline-step:hover { background: var(--surface-3); }
        .pipeline-step:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .pipeline-step.active { background: var(--surface-3); box-shadow: inset 0 -2px 0 var(--brand); }
        .pipeline-step.active .stage-icon { border-color: var(--brand); color: var(--brand); background: rgba(90,169,255,.12); }
        .pipeline-step.ok { color: var(--ok-ink); }
        .pipeline-step.bad { color: var(--warn-ink); }
        .pipeline-step.info { color: var(--brand); }
        .pipeline-step.muted { color: var(--dim); }
        .stage-icon { display: grid; place-items: center; width: 1.25rem; height: 1.25rem; border: 1px solid currentColor; border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); line-height: 1; }
        .pipeline-step-copy { display: grid; gap: 0; min-width: 0; }
        .pipeline-step-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1875rem; color: #e2e8f0; font-size: var(--fs-secondary); line-height: 1.2; }
        .pipeline-step-no { color: var(--dim); font-size: var(--fs-badge); font-variant-numeric: tabular-nums; }
        .step-dot { position: absolute; top: var(--space-1); right: var(--space-2); width: .375rem; height: .375rem; border-radius: 50%; background: currentColor; }
        .pipeline-step-sub { color: var(--muted); font-size: var(--fs-badge); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .endflow { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .endflow-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line); background: var(--surface-3); }
        .endflow-title { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .endflow-icon { display: grid; place-items: center; flex: 0 0 auto; width: 1.5rem; height: 1.5rem; border: 1px solid rgba(90,169,255,.35); border-radius: var(--radius-sm); background: rgba(90,169,255,.1); color: var(--brand); }
        .endflow-icon svg { width: 1rem; height: 1rem; }
        .endflow-title h2 { margin: 0; font-size: var(--fs-title); font-weight: 650; }
        .endflow-title p { margin: 0; color: var(--muted); font-size: var(--fs-secondary); }
        .ghost-btn { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted); font: inherit; font-size: var(--fs-secondary); line-height: 1.6; cursor: pointer; white-space: nowrap; }
        .ghost-btn:hover { border-color: var(--brand); color: #ffffff; }
        .endflow-body { display: grid; gap: 0; padding: var(--space-2) var(--space-3) var(--space-3); background: var(--surface-2); }
        .endflow-step { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap: var(--space-2); align-items: start; }
        .endflow-rail { display: flex; flex-direction: column; align-items: center; padding-top: var(--space-1); }
        .endflow-no { display: grid; place-items: center; width: 1.375rem; height: 1.375rem; border: 1px solid #475569; border-radius: 50%; background: var(--surface); color: var(--muted); font-size: var(--fs-badge); font-weight: 700; }
        .endflow-no.ok { border-color: var(--ok-ink); color: var(--ok-ink); }
        .endflow-no.bad { border-color: var(--warn-ink); color: var(--warn-ink); }
        .endflow-step:not(:last-child) .endflow-rail::after { content: ''; flex: 1; width: .0625rem; margin: .1875rem 0; background: var(--line); }
        .endflow-card { min-width: 0; margin-bottom: var(--space-1); border: 1px solid var(--line); border-left: 3px solid #475569; border-radius: var(--radius-sm); background: var(--surface); }
        .endflow-card.ok { border-left-color: var(--ok-ink); }
        .endflow-card.bad { border-left-color: var(--warn-ink); }
        .endflow-card.info { border-left-color: var(--brand); }
        .endflow-card-head { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
        .endflow-card-head:hover { background: rgba(90,169,255,.05); }
        .endflow-card-head:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .endflow-card-title { flex: 0 0 auto; color: #cbd5e1; font-size: var(--fs-badge); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
        .endflow-card-sub { flex: 1 1 auto; min-width: 0; color: var(--muted); font-size: var(--fs-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .missing-tag { flex: 0 0 auto; padding: 0 var(--space-1); border: 1px solid rgba(224,179,65,.4); border-radius: var(--radius-sm); background: rgba(224,179,65,.1); color: var(--warn-ink); font-size: var(--fs-badge); letter-spacing: .06em; line-height: 1.5; text-transform: uppercase; }
        .endflow-subgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); padding: 0 var(--space-2) var(--space-2); }
        .endflow-subgrid.single { grid-template-columns: minmax(0, 1fr); }
        .endflow-sub { display: grid; gap: 0; min-width: 0; }
        .endflow-sub .sub-label { color: var(--dim); font-size: var(--fs-secondary); letter-spacing: .04em; text-transform: uppercase; }
        .endflow-sub .sub-value { color: #e2e8f0; font-size: var(--fs-body); font-weight: 600; line-height: var(--lh); overflow-wrap: anywhere; }
        .endflow-sub .sub-detail { color: var(--dim); font-size: var(--fs-secondary); line-height: var(--lh); overflow-wrap: anywhere; }
        .tabs { display: flex; width: 100%; gap: 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
        .tabs button { display: inline-flex; flex: 1 1 0; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font: inherit; font-size: var(--fs-secondary); font-weight: 600; cursor: pointer; white-space: nowrap; }
        .tabs button:hover { color: var(--ink); }
        .tabs button:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .tabs button.active { border-color: var(--brand); color: var(--brand); }
        .drill-tabs button[data-tab='waterfall'].active { border-color: var(--ok-ink); color: var(--ok-ink); }
        .drill-tabs button[data-tab='topology'].active { border-color: var(--brand); color: var(--brand); }
        .drill-tabs button[data-tab='decisions'].active { border-color: #c084fc; color: #c084fc; }
        .drill-tabs button[data-tab='rules'].active { border-color: var(--warn-ink); color: var(--warn-ink); }
        .drill-tabs button[data-tab='telemetry'].active { border-color: #818cf8; color: #818cf8; }
        .tab-icon { display: grid; place-items: center; width: 1.125rem; height: 1.125rem; border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--fs-badge); line-height: 1; }
        .tabs button.active .tab-icon { border-color: currentColor; background: rgba(90,169,255,.12); color: inherit; }
        .tabs button.active .tab-count { color: inherit; }
        .tab-label { font-size: var(--fs-secondary); }
        .tab-count { padding: .0625rem var(--space-1); border-radius: 62.44rem; background: var(--surface-2); color: var(--muted); font-size: var(--fs-badge); font-variant-numeric: tabular-nums; }
        .waterfall { --card-accent: var(--brand); gap: var(--space-1); padding: var(--space-3) var(--space-4); }
        .waterfall-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); padding-bottom: var(--space-1); border-bottom: 1px solid var(--line-soft); }
        .chips { display: flex; gap: var(--space-1); }
        .chip { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--muted); font: inherit; font-size: var(--fs-badge); line-height: 1.6; cursor: pointer; }
        .chip.on { border-color: rgba(90,169,255,.5); background: rgba(90,169,255,.12); color: var(--brand); }
        .wf-summary { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-left: auto; }
        .summary-chip { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--fs-badge); white-space: nowrap; }
        .summary-chip strong { color: #cbd5e1; font-variant-numeric: tabular-nums; }
        .search { width: 12rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--fs-secondary); line-height: 1.6; }
        .event-table-head, .event-grid { display: grid; grid-template-columns: 5.5rem minmax(0, 2fr) 7rem 6rem 4.5rem; gap: var(--space-2); align-items: center; }
        .event-table-head { padding: var(--space-1) 0; border-bottom: 1px solid var(--line); color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .event-row { padding: 0; border-bottom: 1px solid var(--line-soft); }
        .event-row:last-child { border-bottom: 0; }
        .event-grid { min-height: 1.75rem; padding: var(--space-1) 0; }
        .event-grid time { color: var(--dim); font-size: var(--fs-secondary); font-variant-numeric: tabular-nums; }
        .event-grid code { color: var(--brand); font-size: var(--fs-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .event-worker { color: #cbd5e1; font-size: var(--fs-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .event-duration { color: var(--muted); font-size: var(--fs-secondary); text-align: right; font-variant-numeric: tabular-nums; }
        .event-row.bad .event-grid code { color: var(--danger-ink); }
        .event-evidence { padding: 0 0 var(--space-1) 5.5rem; }
        .event-evidence summary { color: var(--muted); font-size: var(--fs-secondary); cursor: pointer; }
        .waterfall-empty { margin: 0; padding: var(--space-2) 0; }
        pre { max-height: 18rem; overflow: auto; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-secondary); line-height: var(--lh); white-space: pre-wrap; }
        .raw { margin: 0; }
        .table-wrap { width: 100%; overflow-x: auto; }
        .telemetry-table { width: 100%; border-collapse: collapse; font-size: var(--fs-secondary); }
        .telemetry-table th { padding: var(--space-2); border-bottom: 1px solid var(--line); background: var(--surface-3); color: var(--muted); font-size: var(--fs-badge); font-weight: 500; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
        .telemetry-table td { padding: var(--space-2); border-bottom: 1px solid var(--line); }
        .checks { display: grid; gap: var(--space-1); }
        .check-row { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); }
        .check-status { min-width: 2.5rem; color: var(--muted); font-size: var(--fs-badge); font-weight: 700; text-transform: uppercase; }
        .check-status[data-status='pass'] { color: var(--ok-ink); }
        .check-status[data-status='warn'] { color: var(--warn-ink); }
        .check-status[data-status='skip'] { color: var(--dim); }
        .check-row strong { color: #cbd5e1; font-size: var(--fs-secondary); white-space: nowrap; }
        .check-row small { color: var(--dim); font-size: var(--fs-secondary); }
        .recon-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13.75rem, 1fr)); gap: var(--space-2); }
        .recon-card { display: grid; gap: var(--space-1); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-left: 3px solid var(--brand); border-radius: var(--radius-sm); background: var(--surface-2); }
        .recon-card > div { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
        .recon-card strong { color: #e2e8f0; font-size: var(--fs-secondary); }
        .recon-card small { color: var(--dim); font-size: var(--fs-secondary); }
        .context-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
        .facts-grid { display: grid; grid-template-columns: 6.875rem minmax(0, 1fr); gap: .1875rem var(--space-3); font-size: var(--fs-secondary); }
        .facts-grid dt { color: var(--muted); }
        .facts-grid dd { min-width: 0; overflow-wrap: anywhere; }
        .flow-chain { display: flex; align-items: center; gap: var(--space-2); padding-bottom: var(--space-1); overflow-x: auto; }
        .flow-node { display: grid; gap: var(--space-1); min-width: 5.625rem; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
        .flow-node strong { font-size: var(--fs-secondary); }
        .flow-node small { color: var(--muted); font-size: var(--fs-badge); }
        .flow-node.ok { border-color: var(--ok-ink); }
        .flow-node.bad { border-color: var(--warn-ink); }
        .flow-node.prompt { border-color: var(--brand); }
        .flow-arrow { color: var(--muted); font-size: var(--fs-secondary); }
        .runtime-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
        .runtime-column { display: grid; align-content: start; gap: var(--space-2); min-width: 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
        .runtime-column-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
        .runtime-column-head h3 { margin: 0; font-size: var(--fs-secondary); }
        .runtime-column-head small { color: var(--muted); font-size: var(--fs-badge); }
        .runtime-row { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); padding: var(--space-1) 0; border-bottom: 1px solid var(--line-soft); }
        .runtime-row:last-child { border-bottom: 0; }
        .runtime-no { color: var(--muted); font-size: var(--fs-badge); text-align: right; font-variant-numeric: tabular-nums; }
        .runtime-name { display: grid; gap: 0; min-width: 0; }
        .runtime-name strong { color: var(--ink); font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .runtime-name small { color: var(--muted); font-size: var(--fs-badge); overflow-wrap: anywhere; }
        .runtime-divergence { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-sm); background: var(--surface-2); }
        .runtime-divergence[data-kind='missing'] { border-left-color: var(--warn-ink); }
        .runtime-divergence[data-kind='extra'] { border-left-color: var(--danger-ink); }
        .runtime-divergence[data-kind='matches'] { border-left-color: var(--ok-ink); }
        .divergence-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        .divergence-line { color: #cbd5e1; font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .divergence-key { color: var(--warn-ink); font-weight: 700; }
        .divergence-line.extra .divergence-key { color: var(--danger-ink); }
        .verdict-block { display: grid; gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line); }
        .verdict-block h3 { display: flex; align-items: baseline; gap: var(--space-2); font-size: var(--fs-title); }
        .q-no { color: var(--muted); font-size: var(--fs-badge); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .verdict-score-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); color: var(--muted); font-size: var(--fs-secondary); }
        .verdict-score-line strong { color: var(--ink); font-size: var(--fs-title); font-variant-numeric: tabular-nums; }
        .rule-refs, .gap-list, .action-list, .next-codes { display: grid; gap: var(--space-1); padding: 0; list-style: none; }
        .rule-ref { padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .rule-ref code { color: var(--brand); }
        .gap-row { display: grid; gap: var(--space-1); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-left: 3px solid var(--warn-ink); border-radius: var(--radius-sm); background: var(--surface-2); }
        .gap-head { color: #cbd5e1; font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .gap-head code { color: var(--warn-ink); font-weight: 700; }
        .gap-consequence { color: var(--muted); font-size: var(--fs-secondary); }
        .action-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-3); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-secondary); }
        .action-row strong { color: var(--ink); font-size: var(--fs-body); }
        .action-row code { color: var(--brand); overflow-wrap: anywhere; }
        .spec-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-secondary); }
        .spec-label { color: var(--muted); font-size: var(--fs-badge); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .spec-line code { color: var(--brand); overflow-wrap: anywhere; }
        .spec-version { color: var(--warn-ink); font-variant-numeric: tabular-nums; }
        .spec-section { color: #cbd5e1; }
        .write-gate { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--text-xs); }
        .write-gate-label { color: var(--muted); font-size: var(--fs-badge); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .write-gate code { color: var(--brand); overflow-wrap: anywhere; }
        .write-gate time, .write-gate-actor { color: var(--muted); }
        .copy-path { padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--muted); font: inherit; font-size: var(--fs-badge); line-height: 1.6; cursor: pointer; }
        .copy-path:hover { border-color: var(--brand); color: #ffffff; }
        .receipt-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); color: var(--muted); font-size: var(--fs-body); }
        .receipt-line code { color: var(--brand); overflow-wrap: anywhere; }
        .receipt-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: var(--space-1) var(--space-3); }
        .receipt-facts div { display: grid; gap: 0; min-width: 0; }
        .receipt-facts dt { color: var(--muted); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .receipt-facts dd { color: var(--ink); font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .receipt-facts code { color: var(--brand); }
        .receipt-verify { margin: 0; }
        .next-step { padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-left: 3px solid var(--brand); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font-size: var(--fs-body); }
        .next-codes { grid-auto-flow: column; justify-content: start; }
        .next-codes li { padding: 0 var(--space-2); border: 1px solid rgba(224,179,65,.4); border-radius: var(--radius-sm); background: rgba(224,179,65,.1); color: var(--warn-ink); font-size: var(--fs-badge); }
        .jev-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-3); color: #cbd5e1; font-size: var(--fs-body); overflow-wrap: anywhere; }
        .jev-summary { color: var(--ink); }
        .jev-mismatch { padding: 0 var(--space-2); border: 1px solid rgba(224,179,65,.45); border-radius: var(--radius-sm); background: rgba(224,179,65,.12); color: var(--warn-ink); font-size: var(--fs-secondary); }
        .timeline { gap: var(--space-2); }
        .lane { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: var(--space-3); align-items: center; font-size: var(--fs-secondary); }
        .lane-track { padding: var(--space-2); border-bottom: 1px dashed var(--line); }
        .lane-event { display: inline-block; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: 62.44rem; font-size: var(--fs-badge); }
        .lane-event.bad { color: var(--warn-ink); border-color: var(--warn-ink); }
        .loading-label { color: var(--muted); }
        .error-panel { display: grid; gap: var(--space-2); padding: var(--space-5); border: 1px solid var(--line); border-radius: var(--radius-md); color: var(--muted); }
        .error-panel strong { color: var(--ink); }
        @media (max-width: 74.9375rem) {
            .glance-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .pipeline-stepper { grid-template-columns: repeat(8, minmax(9rem, 1fr)); overflow-x: auto; }
            .identity-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .effectiveness .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .signal-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 62.5rem) { .top-grid { grid-template-columns: 1fr; } .runtime-compare { grid-template-columns: 1fr; } }
        @media (min-width: 75rem) { .request-query { font-size: var(--fs-h1-lg); } }
        @media (max-width: 47.9375rem) {
            .glance-grid { grid-template-columns: minmax(0, 1fr); }
            .identity-grid { grid-template-columns: minmax(0, 1fr); }
            .context-grid { grid-template-columns: minmax(0, 1fr); }
            .endflow-subgrid { grid-template-columns: minmax(0, 1fr); }
            .event-table-head, .event-grid { grid-template-columns: 4.5rem minmax(0, 1fr) 5rem 4.5rem; }
            .event-table-head span:nth-child(4), .event-grid .badge { display: none; }
            .event-table-head span:nth-child(3), .event-grid .event-worker { display: none; }
        }
    `],
})
export class RequestDetailPage implements OnInit {
    private readonly api = inject(CONTROL_PLANE_API_CLIENT, { optional: true });
    private readonly route = inject(ActivatedRoute);
    /** V2 telemetry: one in-memory session id per page load, never persisted. */
    private readonly uiSession = crypto.randomUUID();
    /** Guards against double-load races (route + query subscriptions) re-verifying or overwriting. */
    private loadSeq = 0;

    readonly loading = signal(true);
    readonly error = signal('');
    readonly consumerId = signal('');
    readonly detail = signal<RequestDetailWithVerdict | null>(null);
    readonly activeTab = signal<TabKey>('waterfall');
    readonly tabs = [
        { id: 'waterfall' as const, label: 'Execution & Waterfall' },
        { id: 'topology' as const, label: 'Graphs & Topology' },
        { id: 'decisions' as const, label: 'Verdict & gaps' },
        { id: 'rules' as const, label: 'Rules & Context' },
        { id: 'telemetry' as const, label: 'Telemetry & Trace' },
    ];
    readonly flowExpanded = signal(true);
    /** Per-step disclosure override; empty steps start collapsed to a single line. */
    readonly stepOpen = signal<Record<string, boolean>>({});
    readonly eventQuery = signal('');
    readonly requestId = signal(decodeURIComponent(this.route.snapshot.paramMap.get('requestId') || ''));

    readonly prompt = computed<ObservationDto | null>(() => {
        const d = this.detail();
        if (!d) return null;
        return {
            observationId: d.request.id,
            traceId: d.request.traceId,
            hostId: d.request.hostId,
            runtimeKey: d.request.runtimeKey,
            workerId: d.request.workerId,
            event: 'prompt.submitted',
            outcome: d.request.status,
            evidence: {
                userQuery: d.request.userQuery,
                requestHash: d.request.promptHash,
                requestLength: d.request.promptLength,
                taskType: d.request.taskType,
                flowId: d.request.flowId,
                model: d.request.model,
                adapter: d.request.adapter,
            },
            at: d.request.startedAt,
            receivedAt: d.request.endedAt,
        };
    });
    readonly traceEvents = computed<ObservationDto[]>(() => {
        const d = this.detail();
        if (!d) return [];
        return d.events.map((event) => ({
            observationId: event.observationId,
            traceId: event.traceId,
            hostId: event.hostId,
            runtimeKey: event.runtimeKey,
            workerId: event.workerId,
            event: event.event,
            outcome: event.outcome,
            evidence: event.evidence,
            at: event.at,
            receivedAt: event.at,
        }));
    });
    readonly systemStages = computed<SystemStage[]>(() => (this.detail()?.systemStages ?? []).map((stage) => ({
        id: stage.id,
        stepNumber: stage.stepNumber,
        title: stage.title,
        sub: stage.sub,
        status: stage.status,
        tab: stage.tab as TabKey,
        details: stage.details,
    })));
    readonly stages = computed<Stage[]>(() => (this.detail()?.pipeline ?? []).map((stage) => ({
        workerId: stage.workerId,
        label: stage.label,
        role: stage.role,
        layer: stage.layer,
        scope: stage.scope,
        capabilities: stage.capabilities,
        status: stage.status,
        event: stage.event,
        at: stage.at,
        durationMs: stage.durationMs,
        errorCode: stage.errorCode,
    })));

    /** B0-10 — the configured path is exactly `detail.pipeline`, in the server's order. */
    readonly configuredGraph = computed<ConfiguredGraphStep[]>(() => (this.detail()?.pipeline ?? []).map((step) => ({
        workerId: step.workerId,
        label: step.label,
        status: step.status,
    })));

    /** B0-10 — the observed path is built from reported events only: first event per worker, in order. */
    readonly observedGraph = computed<ObservedGraphStep[]>(() => {
        const path: ObservedGraphStep[] = [];
        const seen = new Set<string>();
        for (const event of this.detail()?.events ?? []) {
            if (!OBSERVED_WORKER_EVENTS.has(event.event)) continue;
            const workerId = (event.workerId ?? '').trim();
            if (!workerId || seen.has(workerId)) continue;
            seen.add(workerId);
            path.push({
                workerId,
                label: this.workerLabel(workerId),
                outcome: event.outcome || '—',
                event: event.event,
                at: event.at,
            });
        }
        return path;
    });

    /** B0-10 — set + order comparison; `missing`/`extra` are named, `matches` needs identical order. */
    readonly divergence = computed<RuntimeDivergence>(() => {
        const configured = this.configuredGraph().map((step) => step.workerId);
        const observed = this.observedGraph().map((step) => step.workerId);
        if (!configured.length && !observed.length) {
            return { kind: 'empty', missing: [], extra: [], configuredCount: 0, observedCount: 0 };
        }
        const configuredSet = new Set(configured);
        const observedSet = new Set(observed);
        const missing = configured.filter((workerId) => !observedSet.has(workerId));
        const extra = observed.filter((workerId) => !configuredSet.has(workerId));
        const orderMatches = !missing.length && !extra.length && configured.length === observed.length && configured.every((workerId, index) => workerId === observed[index]);
        const kind: DivergenceKind = missing.length ? 'missing' : extra.length ? 'extra' : orderMatches ? 'matches' : 'reordered';
        return { kind, missing, extra, configuredCount: configured.length, observedCount: observed.length };
    });
    readonly status = computed(() => this.detail()?.request.status || 'unknown');
    readonly failureKind = computed(() => {
        for (const event of this.traceEvents()) {
            const value = (event.evidence as Record<string, unknown> | null)?.['failureKind'];
            if (value) return String(value);
        }
        return '';
    });
    readonly duration = computed(() => {
        const d = this.detail();
        if (!d) return '—';
        const ms = Math.max(0, new Date(d.request.endedAt).getTime() - new Date(d.request.startedAt).getTime());
        return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 60000 ? 1 : 0)} s`;
    });
    readonly queryText = computed(() => {
        const value = this.detail()?.request.userQuery;
        return value && value.trim() ? value.trim() : 'Prompt body was not captured for this legacy request.';
    });
    readonly endedAt = computed(() => {
        const value = this.detail()?.request.endedAt;
        return value ? this.formatAt(value) : '—';
    });
    readonly tokenSummary = computed(() => {
        const metrics = this.detail()?.requestMetrics;
        return { input: metrics?.inputTokens ?? null, output: metrics?.outputTokens ?? null, estimated: metrics?.tokensEstimated === true };
    });
    readonly llmCalls = computed(() => (this.detail()?.telemetry.llmCalls ?? []).map((call) => ({
        id: call.id,
        workerId: call.workerId,
        model: call.model,
        adapter: call.adapter,
        durationMs: call.durationMs,
        input: call.inputTokens ?? '—',
        output: call.outputTokens ?? '—',
        outcome: call.outcome,
    })));
    readonly toolCount = computed(() => this.detail()?.telemetry.tools.length ?? 0);
    readonly fileCount = computed(() => this.detail()?.telemetry.files.length ?? 0);

    /** P2 — ESO's adjudication of this turn; never derived from prompt text or worker status. */
    readonly verdict = computed<TurnVerdictView | null>(() => this.detail()?.verdict ?? null);

    /** P6c — host-reported signals; `null` means the host reported nothing for this turn. */
    readonly signals = computed<HostSignalsView | null>(() => this.detail()?.signals ?? null);

    /** Pipeline v2 — the backend tally; `null` means this payload predates or omits the field. */
    readonly effectiveness = computed<EffectivenessView | null>(() => this.detail()?.effectiveness ?? null);

    /** Pipeline v2 — the JEV decision recorded for this turn; never derived from the verdict. */
    readonly jev = computed<JevView | null>(() => this.detail()?.jev ?? null);

    /** Write gate — the latest recorded scope decision; `null` means no decision was recorded for this turn. */
    readonly writeGate = computed<WriteGateView | null>(() => this.detail()?.writeGate ?? null);

    /** B0-9 — the normative doc reference; a pointer only, never the doc's prose. */
    readonly spec = computed<SpecRefView | null>(() => this.detail()?.spec ?? null);

    /** B0-9 — feedback for the copy affordance; only set after the clipboard actually accepted the path. */
    readonly specPathCopied = signal(false);

    /** Header copy affordance — same honesty rule: only "copied" after the clipboard accepted the id. */
    readonly requestIdCopied = signal(false);

    /** P5a — receipt summary for Q5; absent on payloads that predate the field, never fabricated. */
    readonly receipt = computed<RequestReceiptSummaryDto | null>(() => this.detail()?.receipt ?? null);

    /** Q5 — starts "unavailable"; only the server verify route can move it to verified/failed. */
    readonly receiptVerification = signal<ReceiptVerificationState>('unavailable');

    /** Q4 — only the events the host actually reported as actions, with no inferred fields. */
    readonly actionEvents = computed<ActionEventView[]>(() => (this.detail()?.events ?? [])
        .filter((event) => event.event === 'action.recorded')
        .map((event) => {
            const evidence = (event.evidence ?? {}) as Record<string, unknown>;
            const files = Array.isArray(evidence['files']) ? evidence['files'].map(String) : [];
            const readBeforeEdit = evidence['readBeforeEdit'];
            const diffRef = evidence['diffRef'];
            const tool = typeof evidence['tool'] === 'string' ? evidence['tool'].trim() : '';
            const outcome = typeof evidence['outcome'] === 'string' ? evidence['outcome'].trim() : '';
            return {
                id: event.observationId,
                tool: tool || 'tool not recorded',
                outcome: outcome || 'outcome not recorded',
                filesCount: files.length,
                readBeforeEdit: readBeforeEdit === true ? 'yes' : readBeforeEdit === false ? 'no' : 'not captured',
                diffRef: typeof diffRef === 'string' && diffRef.trim() ? diffRef.trim() : 'not captured',
            };
        }));

    ngOnInit(): void {
        this.trackSurface('surface.request.open');
        // BUG-30: the id must be observed, not frozen at first render.
        this.route.paramMap.subscribe((params) => {
            const next = decodeURIComponent(params.get('requestId') || '');
            if (next === this.requestId()) return;
            this.requestId.set(next);
            void this.load();
        });
        this.route.queryParamMap.subscribe((query) => {
            const next = query.get('consumer') || 'fineso';
            if (next === this.consumerId()) return;
            this.consumerId.set(next);
            void this.load();
        });
        void this.load();
    }

    /** V2 telemetry — fire-and-forget; a beacon failure must never block or surface in the UI. */
    private trackSurface(surface: string): void {
        if (!this.api) return;
        const consumerId = this.consumerId() || this.route.snapshot.queryParamMap.get('consumer') || null;
        void this.api.postUiEvent({ surface, consumerId, session: this.uiSession }).catch(() => undefined);
    }

    /** V2 raw proxy — expanding the raw evidence JSON is the "raw log" signal. */
    private trackEvidence(event: Event): void {
        if (!(event.target as HTMLDetailsElement)?.open) return;
        if (!this.api) return;
        void this.api.postUiEvent({ surface: 'raw.evidence.expand', consumerId: this.consumerId() || null, session: this.uiSession }).catch(() => undefined);
    }

    private async load(): Promise<void> {
        const seq = ++this.loadSeq;
        if (!this.api) { this.error.set('API client unavailable'); this.loading.set(false); return; }
        const query = this.route.snapshot.queryParamMap;
        this.consumerId.set(query.get('consumer') || 'fineso');
        // Q5 — a new load invalidates the previous verdict; nothing is claimed verified until re-checked.
        this.receiptVerification.set('unavailable');
        this.specPathCopied.set(false);
        this.requestIdCopied.set(false);
        let loaded: RequestDetailWithVerdict | null = null;
        try {
            loaded = await this.api.getRequestDetail(this.consumerId(), this.requestId());
            if (seq !== this.loadSeq) return;
            this.detail.set(loaded);
        } catch (error) {
            if (seq !== this.loadSeq) return;
            this.error.set((error as { detail?: string; message?: string })?.detail || (error as Error)?.message || 'Unable to load request');
        } finally {
            if (seq === this.loadSeq) this.loading.set(false);
        }
        const receiptId = loaded?.receipt?.receiptId ?? loaded?.verdict?.receiptId ?? '';
        if (receiptId) await this.verifyReceipt(seq, receiptId);
    }

    /** Q5 — one verify per loaded request; a failed call is "unavailable", never "verified". */
    private async verifyReceipt(seq: number, receiptId: string): Promise<void> {
        if (!this.api) return;
        try {
            const result = await this.api.verifyReceipt(this.consumerId(), receiptId);
            if (seq !== this.loadSeq) return;
            this.receiptVerification.set(result.ok && result.hashMatches ? 'verified' : 'failed');
        } catch {
            if (seq !== this.loadSeq) return;
            this.receiptVerification.set('unavailable');
        }
    }

    selectStage(stage: Stage): void {
        this.activeTab.set('waterfall');
    }

    /**
     * E2E flow — the same 8 stages, but the header already carries prompt identity and the
     * verdict actor, so step 1 keeps only its law evidence. A step whose remaining subcards are
     * all absent is flagged `empty` and renders one line until the reader expands it.
     */
    readonly endSteps = computed(() => this.systemStages().map((stage) => {
        const lawValue = stage.details.find((detail) => detail.label === 'Law')?.value ?? 'not captured';
        const subcards = stage.id === 'intake-law'
            ? stage.details.filter((detail) => detail.label === 'Law')
            : stage.details;
        return {
            id: stage.id,
            label: stage.title,
            status: stage.status,
            sub: stage.id === 'intake-law' ? (this.missingValue(lawValue) ? 'law not captured' : lawValue) : stage.sub,
            subcards,
            empty: subcards.length === 0 || subcards.every((detail) => this.missingValue(detail.value)),
        };
    }));

    /** Disclosure state for one E2E step: non-empty steps start open, empty steps start collapsed. */
    isStepOpen(step: { id: string; empty: boolean }): boolean {
        const override = this.stepOpen()[step.id];
        return override === undefined ? !step.empty : override;
    }

    toggleStep(step: { id: string; empty: boolean }): void {
        const next = !this.isStepOpen(step);
        this.stepOpen.update((map) => ({ ...map, [step.id]: next }));
    }

    /** A value the API actually did not report — never a judgement about the step. */
    private missingValue(value: string): boolean {
        const text = (value || '').trim().toLowerCase();
        return !text || text === '—' || text === 'not captured' || text === 'not reported' || text === 'not recorded' || text === 'unknown';
    }

    /** Waterfall duration — host-reported ms when present, otherwise the observed span, never a guess. */
    eventDuration(event: ObservationDto): string {
        const evidence = (event.evidence as Record<string, unknown> | null) ?? {};
        const reported = evidence['durationMs'];
        if (typeof reported === 'number' && Number.isFinite(reported)) return this.humanDuration(reported);
        const span = new Date(event.receivedAt).getTime() - new Date(event.at).getTime();
        return Number.isFinite(span) && span > 0 ? this.humanDuration(span) : '—';
    }

    /** Waterfall time column — clock only; the full timestamp stays in the tooltip. */
    formatClock(value: string): string {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    }
    readonly waterfallEvents = computed(() => {
        const query = this.eventQuery().trim().toLowerCase();
        if (!query) return this.traceEvents();
        return this.traceEvents().filter((event) => [event.event, event.workerId, event.outcome, String((event.evidence as Record<string, unknown> | null)?.['errorCode'] || '')].some((value) => String(value || '').toLowerCase().includes(query)));
    });

    tabCount(tab: TabKey): number {
        if (tab === 'waterfall') return this.traceEvents().length;
        if (tab === 'topology') return this.stages().filter((stage) => stage.status !== 'PENDING').length;
        if (tab === 'decisions') return this.checks().length;
        if (tab === 'rules') return 1;
        return this.llmCalls().length;
    }

    readonly checks = computed(() => this.detail()?.checks ?? []);
    readonly recon = computed(() => this.detail()?.recon ?? []);
    contextValue(key: string): string {
        const value = this.detail()?.context?.[key];
        return value === undefined || value === null || value === '' ? '—' : String(value);
    }
    contextList(key: string): string {
        const value = this.detail()?.context?.[key];
        return Array.isArray(value) ? value.map(String).join(', ') || 'none' : this.contextValue(key);
    }
    routingValue(key: string): string {
        const value = this.detail()?.routing?.[key];
        return value === undefined || value === null || value === '' ? '—' : String(value);
    }

    value(event: ObservationDto, key: string): string {
        const evidence = (event.evidence as Record<string, unknown> | null) ?? {};
        const item = evidence[key];
        return item === undefined || item === null || item === '' ? '—' : String(item);
    }

    workerLabel(id: string | null | undefined): string {
        return WORKER_LABEL[id || ''] || id || 'unknown';
    }

    /** Q1 actor — only an honest id is shown; a missing actor is named, never guessed. */
    actorId(actor: VerdictActor | null): string {
        const id = actor && typeof actor['id'] === 'string' ? actor['id'].trim() : '';
        return id || 'unknown actor';
    }

    /** Q1 role — omitted in the template when the host did not report one. */
    actorRole(actor: VerdictActor | null): string {
        const role = actor && typeof actor['role'] === 'string' ? actor['role'].trim() : '';
        return role || '';
    }

    /** Q2 write gate — the scope actor is free-form JSON; show only what it actually says. */
    writeGateActor(actor: Record<string, unknown> | null): string {
        if (!actor) return '';
        const id = typeof actor['id'] === 'string' ? actor['id'].trim() : '';
        const label = typeof actor['label'] === 'string' ? actor['label'].trim() : '';
        const kind = typeof actor['kind'] === 'string' ? actor['kind'].trim() : '';
        return [id || label, kind].filter(Boolean).join(' · ');
    }

    /** Q2 — `kind / path:line`, degrading honestly when path or line was not cited. */
    ruleRefLabel(ref: VerdictRuleRef): string {
        const kind = ref.kind || 'rule ref';
        if (!ref.path) return kind;
        return ref.line ? `${kind} / ${ref.path}:${ref.line}` : `${kind} / ${ref.path}`;
    }

    /** Q5 — a null receipt is a fact about P4, not a hash to invent. */
    receiptLabel(receiptId: string | null): string {
        return receiptId && receiptId.trim() ? receiptId : 'Not issued yet';
    }

    /** P6c — the preflight state the host reported; a missing signal is "not captured", not a default. */
    preflightLabel(preflight: HostPreflightSignal | null): string {
        const state = typeof preflight?.state === 'string' ? preflight.state.trim() : '';
        return state || 'not captured';
    }

    /** P6c — the fingerprint is a separate optional field; its absence never blocks the state line. */
    preflightFingerprint(preflight: HostPreflightSignal | null): string {
        const fingerprint = typeof preflight?.fingerprint === 'string' ? preflight.fingerprint.trim() : '';
        return fingerprint || 'fingerprint not captured';
    }

    /** P6c — total calls per adapter, exactly as reported; no calls reported ⇒ "not captured". */
    reconLabel(recon: HostReconCall[] | null): string {
        if (!recon || !recon.length) return 'not captured';
        return recon.map((call) => `${call.adapter} ${call.calls}`).join(' · ');
    }

    /** P6c — the brain tier the host reported; this page has no fallback tier of its own. */
    brainTierLabel(tier: string | null): string {
        const value = typeof tier === 'string' ? tier.trim() : '';
        return value || 'not captured';
    }

    /** P6c — distill outcome from `memorySaved` plus optional lesson count; nothing is inferred. */
    distillLabel(distill: HostDistillSignal | null): string {
        if (!distill) return 'not captured';
        const saved = distill.memorySaved ? 'memory saved' : 'memory not saved';
        return typeof distill.lessons === 'number' ? `${saved} · ${distill.lessons} lesson(s)` : saved;
    }

    /**
     * B0-9 — copy the normative doc path. A denied/unavailable clipboard produces no feedback:
     * the button never claims "copied" unless the clipboard accepted the write.
     */
    copySpecPath(path: string): void {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (!clipboard || typeof clipboard.writeText !== 'function') return;
        void clipboard.writeText(path).then(
            () => this.specPathCopied.set(true),
            () => this.specPathCopied.set(false)
        );
    }

    /** Header — copies the full request id; a rejected clipboard leaves the button at "copy". */
    copyRequestId(id: string): void {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (!clipboard || typeof clipboard.writeText !== 'function') return;
        void clipboard.writeText(id).then(
            () => this.requestIdCopied.set(true),
            () => this.requestIdCopied.set(false)
        );
    }

    /** Header — a locator, not a new id: the full value stays in the tooltip and metadata block. */
    shortId(value: string | null | undefined): string {
        const id = typeof value === 'string' ? value.trim() : '';
        if (!id) return '—';
        return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
    }

    /** Header — the verdict's actor, or the same honest "unknown actor" Q1 uses when none was recorded. */
    heroActor(): string {
        return this.actorId(this.verdict()?.actor ?? null);
    }

    /** Stepper — glyph per v2 stage id; an id outside the known set gets no invented icon. */
    stageGlyph(id: string): string {
        return STAGE_GLYPH[id] ?? '·';
    }

    /** Tabs — glyph per drill tab; the label remains the primary text. */
    tabGlyph(id: TabKey): string {
        return TAB_GLYPH[id] ?? '·';
    }

    /** Write-gate card — presence is reported, never assumed. */
    gateLabel(): string {
        const gate = this.writeGate();
        return gate ? (gate.allowed ? 'allowed' : 'blocked') : 'not recorded';
    }

    /** Q6 — the only mapping the page is allowed to make: level ⇒ next action. */
    nextStep(level: VerdictLevel): string {
        return NEXT_STEP[level];
    }

    /** Q1 — computedAt as a relative time, matching the requests list convention. */
    relative(value: string): string {
        if (!value) return 'not reported';
        const ms = Date.now() - new Date(value).getTime();
        if (Number.isNaN(ms)) return value;
        const minutes = Math.floor(ms / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return days < 30 ? `${days}d ago` : this.formatAt(value);
    }

    formatAt(value: string): string {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
    }

    evidenceText(value: unknown): string {
        try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }

    envelopeText(): string {
        const event = this.prompt();
        if (!event) return '{}';
        const evidence = (event.evidence as Record<string, unknown> | null) ?? {};
        return JSON.stringify({
            event_id: event.observationId,
            trace_id: event.traceId,
            span_id: `${event.traceId}:${event.workerId || 'unknown'}:${evidence['hostStep'] ?? 1}`,
            parent_span_id: null,
            worker_id: event.workerId,
            host_binding_id: event.runtimeKey,
            type: event.event,
            at: event.at,
            decision: evidence['decision'] ?? 'not recorded',
            payload: evidence,
        }, null, 2);
    }

    /** Pipeline v2 — a counter is shown only when the API actually sent a finite number. */
    countOrDash(value: number | null | undefined): string {
        return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
    }

    /** Pipeline v2 — booleans read as plain words; an absent flag is "—", never a green badge. */
    yesNo(value: boolean | null | undefined): string {
        return value === true ? 'yes' : value === false ? 'no' : '—';
    }

    /** Pipeline v2 — `durationMs` humanised; nothing is invented when the backend sent no duration. */
    humanDuration(ms: number | null | undefined): string {
        if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
        const total = Math.max(0, ms);
        if (total < 1000) return `${total} ms`;
        const seconds = total / 1000;
        if (seconds < 60) return `${seconds.toFixed(1)} s`;
        const minutes = Math.floor(seconds / 60);
        const rest = Math.round(seconds % 60);
        return `${minutes}m ${rest}s`;
    }
}
