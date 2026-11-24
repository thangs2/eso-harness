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

/** The shared detail DTO predates P2/P6c/B0-9 and the write gate; those fields ride on the same payload, so they are added here. */
type RequestDetailWithVerdict = RequestDetailDto & {
    verdict?: TurnVerdictView | null;
    signals?: HostSignalsView | null;
    spec?: SpecRefView | null;
    writeGate?: WriteGateView | null;
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
                    <div class="crumb"><a routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">← Requests</a><span>/</span><code>{{ request.traceId }}</code></div>
                    <div class="detail-actions">
                        <a class="pill" routerLink="/office" [queryParams]="{ consumer: consumerId() }">Office 3D</a>
                        <a class="pill" routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">Observatory</a>
                    </div>
                </nav>

                <header class="request-hero">
                    <h1 class="request-query">{{ queryText() }}</h1>
                    <div class="badges">
                        <span class="badge" [class.ok]="status() === 'completed'" [class.warn]="status() === 'failed'" [class.bad]="status() === 'blocked'">{{ status() }}</span>
                        <span class="badge muted">{{ value(request, 'taskType') }}</span>
                        <span class="badge muted">{{ traceEvents().length }} events</span>
                        @if (failureKind()) { <span class="badge warn">{{ failureKind() }}</span> }
                    </div>
                    <p class="subtitle">{{ workerLabel(request.workerId) }} · prompt request · {{ value(request, 'flowId') }} · host {{ request.hostId }}</p>
                    <div class="facts">
                        <span><small>Started</small>{{ formatAt(request.at) }}</span>
                        <span><small>Duration</small>{{ duration() }}</span>
                        <span><small>Model</small>{{ value(request, 'model') }}</span>
                    </div>
                </header>

                <section class="verdict-hero" [attr.data-level]="verdict()?.level || 'unknown'" aria-label="Turn verdict (Q1)">
                    @if (verdict(); as v) {
                        <div class="verdict-head">
                            <span class="verdict-level-badge" [class]="'level-' + v.level">{{ v.level }}</span>
                            <div class="verdict-meta"><small>Score</small><strong>{{ v.score }}</strong></div>
                            <div class="verdict-meta"><small>Actor</small><span class="verdict-actor-id">{{ actorId(v.actor) }}</span>@if (actorRole(v.actor); as role) {<span class="verdict-actor-role">{{ role }}</span>}</div>
                            <div class="verdict-meta"><small>Computed</small><time>{{ relative(v.computedAt) }}</time></div>
                        </div>
                        <p class="verdict-basis">{{ v.basis }}</p>
                    } @else {
                        <div class="verdict-head"><span class="verdict-level-badge level-unknown">not returned</span></div>
                        <p class="verdict-basis">The API response for this request carried no verdict.</p>
                    }
                </section>

                <nav class="pipeline-stepper" aria-label="Pipeline stages">
                    @for (stage of systemStages(); track stage.id) {
                        <button type="button" class="pipeline-step" [class.ok]="stage.status === 'ok'" [class.bad]="stage.status === 'warn'" [class.info]="stage.status === 'info'" [class.muted]="stage.status === 'muted'" (click)="activeTab.set(stage.tab)">
                            <span class="pipeline-step-no">{{ stage.stepNumber }}</span>
                            <span class="pipeline-step-copy"><strong>{{ stage.title }}</strong><small>{{ stage.sub }}</small></span>
                        </button>
                    }
                </nav>

                <section class="host-signals" aria-label="Host signals (P6c)">
                    <header class="host-signals-head">
                        <div><p class="eyebrow">Host-reported</p><h2>Host signals</h2></div>
                        <span class="badge muted">not inferred by ESO</span>
                    </header>
                    @if (signals(); as s) {
                        <div class="signal-strip">
                            <div class="signal-tile"><span>Preflight</span><strong>{{ preflightLabel(s.preflight) }}</strong><small>{{ preflightFingerprint(s.preflight) }}</small></div>
                            <div class="signal-tile"><span>Recon calls</span><strong>{{ reconLabel(s.recon) }}</strong><small>calls the host reported, per adapter</small></div>
                            <div class="signal-tile"><span>Brain tier</span><strong>{{ brainTierLabel(s.brainTier) }}</strong><small>tier the host reported</small></div>
                            <div class="signal-tile"><span>Distill</span><strong>{{ distillLabel(s.distill) }}</strong><small>lessons the host reported</small></div>
                        </div>
                    } @else {
                        <p class="hint">No host signal was reported for this turn</p>
                    }
                </section>

                <section class="endflow">
                    <header class="endflow-head">
                        <div class="endflow-title"><span class="endflow-icon">⚡</span><div><h2>End-to-End Pipeline Data Flow</h2><p>Prompt ingest → worker handoff → evidence → telemetry</p></div></div>
                        <button type="button" class="ghost-btn" (click)="flowExpanded.set(!flowExpanded())">{{ flowExpanded() ? '▲ Hide' : '▼ Show flow' }}</button>
                    </header>
                    @if (flowExpanded()) {
                        <div class="endflow-body">
                            @for (step of endSteps(); track step.id; let index = $index) {
                                <div class="endflow-step">
                                    <div class="endflow-rail"><span class="endflow-no" [class.ok]="step.status === 'PASS'" [class.bad]="step.status === 'FAIL' || step.status === 'BLOCKED'">{{ index + 1 }}</span></div>
                                    <div class="endflow-card" [class.ok]="step.status === 'ok'" [class.bad]="step.status === 'warn'" [class.info]="step.status === 'info'">
                                        <div class="endflow-card-head"><strong>STEP {{ index + 1 }} · {{ step.label }}</strong><span class="badge" [class.ok]="step.status === 'ok'" [class.warn]="step.status === 'warn'">{{ step.status }}</span></div>
                                        <div class="endflow-subgrid">
                                            @for (sub of step.subcards; track sub.label) {
                                                <div class="endflow-sub"><span>{{ sub.label }}</span><strong>{{ sub.value }}</strong><small>{{ sub.detail }}</small></div>
                                            }
                                        </div>
                                    </div>
                                </div>
                            }
                        </div>
                    }
                </section>

                <div class="top-grid">
                    <section class="panel request-info">
                        <header class="panel-head"><div><p class="eyebrow">Prompt request</p><h2>Request metadata</h2></div><span class="badge">read-only</span></header>
                        <div class="policy-note">Prompt body is captured at operator request. Content may contain sensitive data and is shown read-only.</div>
                        <dl class="facts-grid">
                            <dt>Request ID</dt><dd><code>{{ request.observationId }}</code></dd>
                            <dt>Request hash</dt><dd><code>{{ value(request, 'requestHash') }}</code></dd>
                            <dt>Request length</dt><dd>{{ value(request, 'requestLength') }} chars</dd>
                            <dt>Worker</dt><dd>{{ request.workerId || '—' }}</dd>
                            <dt>Runtime</dt><dd>{{ request.runtimeKey }}</dd>
                            <dt>Host</dt><dd>{{ request.hostId }}</dd>
                            <dt>Task type</dt><dd>{{ value(request, 'taskType') }}</dd>
                            <dt>Model / adapter</dt><dd>{{ value(request, 'model') }} · {{ value(request, 'adapter') }}</dd>
                            <dt>Flow</dt><dd>{{ value(request, 'flowId') }}</dd>
                        </dl>
                    </section>

                    <section class="panel tokens">
                        <header class="panel-head"><div><p class="eyebrow">Cost</p><h2>Tokens &amp; model</h2></div><span class="badge muted">not reported</span></header>
                        <div class="token-tiles">
                            <div><span>Input</span><strong>{{ tokenSummary().input ?? '—' }}</strong><small>{{ tokenSummary().estimated ? 'estimated · chars/4' : 'not captured' }}</small></div>
                            <div><span>Output</span><strong>{{ tokenSummary().output ?? '—' }}</strong><small>{{ tokenSummary().estimated ? 'estimated · chars/4' : 'not captured' }}</small></div>
                            <div><span>LLM calls</span><strong>{{ llmCalls().length }}</strong><small>observed worker steps</small></div>
                            <div><span>Tools</span><strong>{{ toolCount() }}</strong><small>{{ fileCount() }} files</small></div>
                        </div>
                        <p class="hint">Tokens are estimated as chars/4 by the host, not provider-reported usage.</p>
                    </section>
                </div>

                <div class="tabs" role="tablist">
                    @for (tab of tabs; track tab.id) {
                        <button type="button" role="tab" [attr.aria-selected]="activeTab() === tab.id" [class.active]="activeTab() === tab.id" (click)="activeTab.set(tab.id)">
                            {{ tab.label }}
                            <span class="tab-count">{{ tabCount(tab.id) }}</span>
                        </button>
                    }
                </div>

                @if (activeTab() === 'waterfall') {
                    <section class="waterfall-wrap">
                        <div class="panel waterfall">
                            <div class="waterfall-toolbar"><div class="chips"><button type="button" class="chip" [class.on]="!eventQuery()" (click)="eventQuery.set('')">All</button><button type="button" class="chip" [class.on]="eventQuery() === 'FAIL'" (click)="eventQuery.set('FAIL')">Failures</button><button type="button" class="chip" [class.on]="eventQuery() === 'prompt.submitted'" (click)="eventQuery.set('prompt.submitted')">Requests</button></div><input class="search" [value]="eventQuery()" (input)="eventQuery.set($any($event.target).value)" placeholder="Filter event / worker…"></div>
                            @for (event of waterfallEvents(); track event.observationId; let index = $index) {
                                <article class="event-row" [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'">
                                    <span class="event-index">#{{ index + 1 }}</span>
                                    <div class="event-main">
                                        <div class="event-title"><code>{{ event.event }}</code><span class="badge">{{ event.outcome || '—' }}</span><span class="muted">{{ event.workerId || '—' }}</span><time>{{ formatAt(event.at) }}</time></div>
                                        <small>{{ event.runtimeKey }} · {{ event.hostId }}</small>
                                        <details (toggle)="trackEvidence($event)"><summary>Evidence</summary><pre>{{ evidenceText(event.evidence) }}</pre></details>
                                    </div>
                                </article>
                            }
                        </div>
                        <aside class="diag">
                            <section class="panel mini"><header class="panel-head"><h2>Files touched</h2><span class="badge muted">{{ fileCount() }}</span></header><p class="hint">No agent-reported file operations in this request.</p></section>
                            <section class="panel mini"><header class="panel-head"><h2>Tool calls</h2><span class="badge muted">{{ toolCount() }}</span></header><p class="hint">No agent-reported tool calls in this request.</p></section>
                            <section class="panel mini"><header class="panel-head"><h2>LLM calls</h2><span class="badge muted">{{ llmCalls().length }}</span></header>
                                <ul class="call-list">@for (call of llmCalls(); track call.id) { <li><span>{{ workerLabel(call.workerId) }}</span><code>{{ call.model }}</code><small>{{ call.durationMs ? call.durationMs + ' ms' : 'duration not reported' }} · {{ call.input }} in / {{ call.output }} out</small></li> }</ul>
                            </section>
                        </aside>
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
                        <table class="telemetry-table"><thead><tr><th>#</th><th>Worker</th><th>Outcome</th><th>Event</th><th>Duration</th><th>Error code</th></tr></thead><tbody>
                            @for (stage of stages(); track stage.workerId; let index = $index) {
                                <tr><td>{{ index + 1 }}</td><td>{{ stage.label }}</td><td>{{ stage.status }}</td><td>{{ stage.event }}</td><td>{{ stage.durationMs }} ms</td><td>{{ stage.errorCode || '—' }}</td></tr>
                            }
                        </tbody></table>
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
                        <table class="telemetry-table">
                            <thead><tr><th>#</th><th>Worker</th><th>Model</th><th>Adapter</th><th>Duration</th><th>In est.</th><th>Out est.</th><th>Outcome</th></tr></thead>
                            <tbody>
                                @for (call of llmCalls(); track call.id) {
                                    <tr><td>{{ $index + 1 }}</td><td>{{ workerLabel(call.workerId) }}</td><td>{{ call.model }}</td><td>{{ call.adapter }}</td><td>{{ call.durationMs ? call.durationMs + ' ms' : '—' }}</td><td>{{ call.input }}</td><td>{{ call.output }}</td><td>{{ call.outcome }}</td></tr>
                                }
                            </tbody>
                        </table>
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
            --line: #253047;
            --ink: #e2e8f0;
            --muted: #8b97ab;
            --brand: #5aa9ff;
            --brand-ink: #ffffff;
            --warn-ink: #e0b341;
            --ok-ink: #4ec97a;
            --danger-ink: #ff6b6b;
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
        }
        .detail-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
        .detail-actions { display: flex; gap: var(--space-2); }
        .pill { padding: var(--space-1) 0.5625rem; border: 1px solid #253047; border-radius: 62.44rem; background: #0f1a2b; color: #cbd5e1; font-size: .625rem; text-decoration: none; }
        .pill:hover { border-color: #5aa9ff; color: #fff; }
        .request-hero { display: grid; gap: var(--space-4); padding-bottom: var(--space-4); border-bottom: 1px solid var(--line); }
        .title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-4); }
        .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: var(--text-xs); margin: 0 0 var(--space-1); }
        h1 { margin: 0 0 var(--space-3); font-size: var(--text-xl); line-height: var(--text-2xl); font-weight: 600; color: #f1f5f9; }
        .subtitle { color: var(--muted); margin: 0; }
        .badges { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: flex-start; }
        .badge { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); border: 1px solid #253047; background: #131722; color: #cbd5e1; font-size: var(--text-xs); line-height: var(--text-xs); font-weight: 500; text-transform: none; letter-spacing: normal; }
        .badge.ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); background: rgba(78,201,122,.15); }
        .badge.warn { color: #fde68a; border-color: rgba(224,179,65,.45); background: rgba(224,179,65,.12); }
        .badge.bad { color: #fecaca; border-color: rgba(255,107,107,.4); background: rgba(255,107,107,.2); }
        .badge.muted { color: #8b97ab; background: #0d1118; }
        .badge.info { color: #bae6fd; border-color: rgba(90,169,255,.4); background: rgba(90,169,255,.15); }
        .facts { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
        .facts span { position: relative; padding-left: var(--space-4); } .facts span:first-child { padding-left: 0; }
        .facts span + span::before { content: ''; position: absolute; left: 0; top: 0.25rem; bottom: 0.25rem; width: 0.0625rem; background: #253047; }
        .facts span { display: inline-flex; align-items: baseline; gap: var(--space-2); font-size: var(--text-xs); color: #cbd5e1; }
        .facts small { color: #64748b; font-size: .625rem; text-transform: uppercase; letter-spacing: .08em; }
        .pipeline-stepper { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(6.875rem, 1fr); align-items: stretch; gap: 0; overflow-x: auto; padding: 0; border: 1px solid #253047; border-radius: var(--radius-md); background: #131722; }
        .pipeline-step { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: 0.5625rem var(--space-2); border: 0; border-right: 1px solid #1e2a3e; background: transparent; color: #8b97ab; font: inherit; text-align: left; cursor: pointer; }
        .pipeline-step:last-child { border-right: 0; }
        .pipeline-step:hover { background: #162235; }
        .pipeline-step.active { background: transparent; box-shadow: inset 0 -2px 0 #5aa9ff; }
        .pipeline-step.active .pipeline-step-no { border-color: #5aa9ff; background: rgba(90,169,255,.12); color: #5aa9ff; }
        .pipeline-step.ok { color: #4ec97a; } .pipeline-step.bad { color: #e0b341; } .pipeline-step.info { color: #5aa9ff; } .pipeline-step.muted { color: #64748b; }
        .pipeline-step-no { display: grid; place-items: center; flex: 0 0 auto; width: 1.375rem; height: 1.375rem; border: 1px solid currentColor; border-radius: 50%; font-size: .5625rem; }
        .pipeline-step-copy { display: grid; gap: .0625rem; min-width: 0; overflow: hidden; }
        .pipeline-step strong { display: block; font-size: .625rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pipeline-step small { display: block; max-width: 100%; font-size: .5rem; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .flow-panel, .panel { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-accent, var(--brand)); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .flow-panel { --card-accent: #4ec97a; }
        .request-info { --card-accent: #5aa9ff; }
        .tokens { --card-accent: #5aa9ff; }
        .waterfall { --card-accent: #5aa9ff; }
        .telemetry { --card-accent: #c084fc; }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
        .panel-head h2 { margin: 0; font-size: var(--text-md); }
        .flow-chain { display: flex; align-items: center; gap: var(--space-2); overflow-x: auto; padding-bottom: var(--space-1); }
        .flow-node { display: grid; gap: var(--space-1); min-width: 5.625rem; padding: var(--space-2); border: 1px solid #253047; border-radius: var(--radius-sm); background: #0d1118; }
        .flow-node strong { font-size: .625rem; } .flow-node small { color: var(--muted); font-size: .5625rem; }
        .flow-node.ok { border-color: #4ec97a; } .flow-node.bad { border-color: #e0b341; }
        .flow-node.prompt { border-color: var(--brand); }
        .flow-arrow { color: var(--muted); font-size: var(--text-xs); }
        .runtime-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
        .runtime-column { display: grid; align-content: start; gap: var(--space-2); min-width: 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
        .runtime-column-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
        .runtime-column-head h3 { margin: 0; font-size: var(--text-sm); }
        .runtime-column-head small { color: var(--muted); font-size: var(--text-xs); }
        .runtime-row { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid #1e2a3e; }
        .runtime-row:last-child { border-bottom: 0; }
        .runtime-no { color: var(--muted); font-size: .5625rem; text-align: right; font-variant-numeric: tabular-nums; }
        .runtime-name { display: grid; gap: .0625rem; min-width: 0; }
        .runtime-name strong { color: var(--ink); font-size: var(--text-xs); overflow-wrap: anywhere; }
        .runtime-name small { color: var(--muted); font-size: .5625rem; overflow-wrap: anywhere; }
        .runtime-divergence { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-sm); background: var(--surface-2); }
        .runtime-divergence[data-kind='missing'] { border-left-color: var(--warn-ink); }
        .runtime-divergence[data-kind='extra'] { border-left-color: var(--danger-ink); }
        .runtime-divergence[data-kind='matches'] { border-left-color: var(--ok-ink); }
        .divergence-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        .divergence-line { margin: 0; color: #cbd5e1; font-size: var(--text-xs); overflow-wrap: anywhere; }
        .divergence-key { color: var(--warn-ink); font-weight: 700; }
        .divergence-line.extra .divergence-key { color: var(--danger-ink); }
        .top-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); align-items: stretch; }
        .endflow { border: 1px solid #253047; border-radius: var(--radius-md); background: #131722; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .endflow-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid #253047; background: #0f1a2b; }
        .endflow-title { display: flex; align-items: center; gap: var(--space-3); }
        .endflow-icon { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border: 1px solid rgba(90,169,255,.35); border-radius: var(--radius-sm); background: rgba(90,169,255,.1); color: #5aa9ff; }
        .endflow-title h2 { margin: 0; font-size: var(--text-xs); font-weight: 700; letter-spacing: .02em; }
        .endflow-title p { margin: var(--space-1) 0 0; color: #8b97ab; font-size: .625rem; }
        .ghost-btn { padding: 0.3125rem var(--space-2); border: 1px solid #253047; border-radius: var(--radius-sm); background: #131722; color: #8b97ab; font: inherit; font-size: .625rem; cursor: pointer; }
        .endflow-body { display: grid; gap: 0; padding: var(--space-4); background: #0a0e17; }
        .endflow-step { display: grid; grid-template-columns: 1.75rem minmax(0, 1fr); gap: var(--space-3); }
        .endflow-rail { display: flex; flex-direction: column; align-items: center; }
        .endflow-no { display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border: 1px solid #475569; border-radius: 50%; background: #131722; color: #8b97ab; font-size: .5625rem; font-weight: 700; }
        .endflow-no.ok { border-color: #4ec97a; color: #4ec97a; } .endflow-no.bad { border-color: #e0b341; color: #e0b341; }
        .endflow-step:not(:last-child) .endflow-rail::after { content: ''; flex: 1; width: 0.0625rem; margin: 0.1875rem 0; background: linear-gradient(#253047, #253047); }
        .endflow-card { margin-bottom: var(--space-2); padding: 0.5625rem 0.6875rem; border: 1px solid #253047; border-left: 3px solid #475569; border-radius: var(--radius-sm); background: #131722; }
        .endflow-card.ok { border-left-color: #4ec97a; } .endflow-card.bad { border-left-color: #e0b341; } .endflow-card.info { border-left-color: #5aa9ff; }
        .endflow-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
        .endflow-card-head strong { font-size: .625rem; text-transform: uppercase; letter-spacing: .06em; color: #cbd5e1; }
        .endflow-subgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin-top: var(--space-2); }
        .endflow-sub { display: grid; gap: .0625rem; padding: var(--space-2) var(--space-3); border: 1px solid #1e2a3e; border-radius: var(--radius-sm); background: #0d1118; }
        .endflow-sub span { color: #64748b; font-size: .5625rem; text-transform: uppercase; letter-spacing: .06em; }
        .endflow-sub strong { color: #cbd5e1; font-size: .625rem; overflow-wrap: anywhere; }
        .endflow-sub small { color: #64748b; font-size: .5625rem; overflow-wrap: anywhere; }
        .waterfall-wrap { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(17.5rem, .35fr); gap: var(--space-4); align-items: start; }
        .waterfall-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-1); }
        .chips { display: flex; gap: var(--space-1); }
        .chip { padding: var(--space-1) var(--space-2); border: 1px solid #253047; border-radius: var(--radius-sm); background: #0f1a2b; color: #8b97ab; font: inherit; font-size: .5625rem; cursor: pointer; }
        .chip.on { border-color: rgba(90,169,255,.5); background: rgba(90,169,255,.12); color: #5aa9ff; }
        .search { width: 13.75rem; padding: 0.3125rem var(--space-2); border: 1px solid #253047; border-radius: var(--radius-sm); background: #0d1118; color: #e2e8f0; font: inherit; font-size: .625rem; }
        .diag { display: grid; gap: var(--space-3); }
        .mini { padding: var(--space-3); }
        .mini h2 { font-size: .6875rem; margin: 0; }
        .call-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3125rem; }
        .call-list li { display: grid; gap: .0625rem; padding: 0.3125rem 0; border-bottom: 1px solid #253047; }
        .call-list span { font-size: .625rem; color: #cbd5e1; } .call-list code { font-size: .5625rem; color: #5aa9ff; } .call-list small { color: #64748b; font-size: .5625rem; }
        .tab-count { margin-left: var(--space-2); padding: .0625rem 0.3125rem; border-radius: 62.44rem; background: #0d1118; color: #8b97ab; font-size: .5625rem; }
        .policy-note { padding: var(--space-3); border: 1px solid #253047; border-left: 3px solid #e0b341; border-radius: var(--radius-sm); background: #0d1118; color: #8b97ab; font-size: var(--text-xs); }
        .facts-grid { display: grid; grid-template-columns: 6.875rem minmax(0, 1fr); gap: 0.3125rem var(--space-3); margin: 0; font-size: var(--text-xs); }
        .facts-grid dt { color: var(--muted); } .facts-grid dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
        .token-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
        .token-tiles div { display: grid; gap: .0625rem; padding: var(--space-3); border: 1px solid #253047; border-radius: var(--radius-sm); background: #0d1118; }
        .token-tiles span { color: var(--muted); font-size: .5625rem; text-transform: uppercase; }
        .token-tiles strong { font-size: var(--text-xl); color: #e0b341; font-variant-numeric: tabular-nums; }
        .token-tiles small { color: var(--muted); font-size: .5625rem; }
        .hint, .muted { color: var(--muted); font-size: var(--text-xs); }
        .tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid #253047; overflow-x: auto; }
        .tabs button { padding: var(--space-2) var(--space-3); border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font: inherit; font-size: var(--text-xs); font-weight: 600; cursor: pointer; white-space: nowrap; }
        .tabs button.active { border-color: #5aa9ff; color: #5aa9ff; }
        .waterfall { gap: var(--space-1); }
        .event-row { display: flex; gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
        .event-index { color: var(--muted); font-size: .625rem; width: 1.375rem; text-align: right; }
        .event-main { display: grid; gap: var(--space-1); min-width: 0; flex: 1; }
        .event-title { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .event-title code { color: var(--brand); }
        .event-title time { margin-left: auto; color: var(--muted); font-size: .5625rem; }
        .event-main small { color: var(--muted); font-size: .625rem; }
        details summary { cursor: pointer; color: var(--muted); font-size: .625rem; }
        pre { max-height: 18.75rem; overflow: auto; padding: var(--space-3); border: 1px solid #253047; border-radius: var(--radius-sm); background: #0d1118; color: #cbd5e1; font-size: .6875rem; white-space: pre-wrap; }
        .raw { margin: 0; }
        .telemetry-table { width: 100%; border-collapse: collapse; font-size: var(--text-xs); }
        .telemetry-table th { text-align: left; background: #0f1a2b; color: #8b97ab; font-weight: 500; padding: var(--space-2); border-bottom: 1px solid #253047; text-transform: uppercase; letter-spacing: .05em; font-size: .625rem; }
        .telemetry-table td { padding: var(--space-2); border-bottom: 1px solid var(--line); }
        .checks { display: grid; gap: var(--space-1); margin-bottom: var(--space-3); }
        .check-row { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-2) var(--space-2); border: 1px solid #1e2a3e; border-radius: var(--radius-sm); background: #0d1118; font-size: .625rem; }
        .check-status { min-width: 2.5rem; text-transform: uppercase; font-size: .5625rem; font-weight: 700; color: #8b97ab; }
        .check-status[data-status='pass'] { color: #4ec97a; } .check-status[data-status='warn'] { color: #e0b341; } .check-status[data-status='skip'] { color: #64748b; }
        .check-row strong { color: #cbd5e1; font-size: .625rem; white-space: nowrap; }
        .check-row small { color: #64748b; }
        .recon-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13.75rem, 1fr)); gap: var(--space-2); margin-bottom: var(--space-4); }
        .recon-card { display: grid; gap: var(--space-1); padding: 0.5625rem var(--space-3); border: 1px solid #1e2a3e; border-left: 3px solid #5aa9ff; border-radius: var(--radius-sm); background: #0d1118; }
        .recon-card > div { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
        .recon-card strong { color: #e2e8f0; font-size: .6875rem; }
        .recon-card small { color: #64748b; font-size: .5625rem; }
        .context-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
        .context-grid h3 { margin-top: 0; }
        .timeline { gap: var(--space-2); }
        .lane { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: var(--space-3); align-items: center; font-size: var(--text-xs); }
        .lane-track { padding: var(--space-2); border-bottom: 1px dashed var(--line); }
        .lane-event { display: inline-block; padding: 0.1875rem 0.4375rem; border: 1px solid var(--line); border-radius: 62.44rem; font-size: .625rem; }
        .lane-event.bad { color: var(--warn-ink, #d97706); border-color: var(--warn-ink, #d97706); }
        .loading-label { color: var(--muted); }
        .error-panel { display: grid; gap: var(--space-2); padding: var(--space-5); border: 1px solid var(--line); border-radius: var(--radius-md); color: var(--muted); }
        .error-panel strong { color: var(--ink); }
        .verdict-hero { --card-accent: #64748b; display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-accent); border-radius: var(--radius-md); background: var(--surface); box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .verdict-hero[data-level='allow'] { --card-accent: var(--ok-ink); }
        .verdict-hero[data-level='partial'] { --card-accent: var(--warn-ink); }
        .verdict-hero[data-level='deny'] { --card-accent: var(--danger-ink); }
        .verdict-hero[data-level='unknown'] { --card-accent: #64748b; }
        .verdict-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3) var(--space-5); }
        .verdict-level-badge { display: inline-flex; align-items: center; padding: var(--space-1) var(--space-3); border: 1px solid currentColor; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .level-allow { color: var(--ok-ink); background: rgba(78,201,122,.12); }
        .level-partial { color: var(--warn-ink); background: rgba(224,179,65,.12); }
        .level-deny { color: var(--danger-ink); background: rgba(255,107,107,.12); }
        .level-unknown { color: var(--muted); background: rgba(139,151,171,.12); }
        .verdict-meta { display: grid; gap: .0625rem; min-width: 0; }
        .verdict-meta small { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em; }
        .verdict-meta strong { color: var(--warn-ink); font-size: var(--text-xl); font-variant-numeric: tabular-nums; line-height: 1; }
        .verdict-meta time, .verdict-actor-id { color: var(--ink); font-size: var(--text-sm); overflow-wrap: anywhere; }
        .verdict-actor-role { color: var(--muted); font-size: var(--text-xs); }
        .verdict-basis { margin: 0; color: #cbd5e1; font-size: var(--text-sm); line-height: 1.5; overflow-wrap: anywhere; }
        .spec-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border: 1px solid #1e2a3e; border-radius: var(--radius-sm); background: #0d1118; color: #cbd5e1; font-size: var(--text-xs); }
        .spec-label { color: var(--muted); font-size: .5625rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .spec-line code { color: var(--brand); overflow-wrap: anywhere; }
        .spec-version { color: var(--warn-ink); font-variant-numeric: tabular-nums; }
        .spec-section { color: #cbd5e1; }
        .write-gate { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border: 1px solid #1e2a3e; border-radius: var(--radius-sm); background: #0d1118; color: #cbd5e1; font-size: var(--text-xs); }
        .write-gate-label { color: var(--muted); font-size: .5625rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .write-gate code { color: var(--brand); overflow-wrap: anywhere; }
        .write-gate time, .write-gate-actor { color: var(--muted); }
        .copy-path { padding: var(--space-1) var(--space-2); border: 1px solid #253047; border-radius: var(--radius-sm); background: #131722; color: #8b97ab; font: inherit; font-size: .5625rem; cursor: pointer; }
        .copy-path:hover { background: #162235; color: #e2e8f0; }
        .host-signals { display: grid; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid #c084fc; border-radius: var(--radius-md); background: var(--surface); box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .host-signals-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
        .host-signals-head h2 { margin: 0; font-size: var(--text-md); }
        .signal-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-2); }
        .signal-tile { display: grid; gap: .0625rem; padding: var(--space-2) var(--space-3); border: 1px solid #1e2a3e; border-radius: var(--radius-sm); background: #0d1118; }
        .signal-tile span { color: #64748b; font-size: .5625rem; letter-spacing: .06em; text-transform: uppercase; }
        .signal-tile strong { color: #e2e8f0; font-size: var(--text-sm); font-weight: 600; overflow-wrap: anywhere; }
        .signal-tile small { color: #64748b; font-size: .5625rem; overflow-wrap: anywhere; }
        .verdict-block { display: grid; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--line); }
        .verdict-block h3 { display: flex; align-items: baseline; gap: var(--space-2); margin: 0; font-size: var(--text-md); }
        .q-no { color: var(--muted); font-size: var(--text-xs); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .verdict-score-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); margin: 0; color: var(--muted); font-size: var(--text-xs); }
        .verdict-score-line strong { color: var(--ink); font-size: var(--text-md); font-variant-numeric: tabular-nums; }
        .rule-refs, .gap-list, .action-list, .next-codes { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
        .rule-ref { padding: var(--space-2) var(--space-3); border: 1px solid #1e2a3e; border-radius: var(--radius-sm); background: #0d1118; font-size: var(--text-xs); overflow-wrap: anywhere; }
        .rule-ref code { color: var(--brand); }
        .gap-row { display: grid; gap: var(--space-1); padding: var(--space-2) var(--space-3); border: 1px solid #1e2a3e; border-left: 3px solid var(--warn-ink); border-radius: var(--radius-sm); background: #0d1118; }
        .gap-head { color: #cbd5e1; font-size: var(--text-xs); overflow-wrap: anywhere; }
        .gap-head code { color: var(--warn-ink); font-weight: 700; }
        .gap-consequence { margin: 0; color: var(--muted); font-size: var(--text-xs); }
        .action-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid #1e2a3e; border-radius: var(--radius-sm); background: #0d1118; color: #cbd5e1; font-size: var(--text-xs); }
        .action-row strong { color: var(--ink); font-size: var(--text-sm); }
        .action-row code { color: var(--brand); overflow-wrap: anywhere; }
        .receipt-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); margin: 0; font-size: var(--text-sm); color: var(--muted); }
        .receipt-line code { color: var(--brand); overflow-wrap: anywhere; }
        .receipt-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-2) var(--space-4); margin: 0; }
        .receipt-facts div { display: grid; gap: var(--space-1); min-width: 0; }
        .receipt-facts dt { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .receipt-facts dd { margin: 0; color: var(--ink); font-size: var(--text-sm); overflow-wrap: anywhere; }
        .receipt-facts code { color: var(--brand); }
        .receipt-verify { margin: 0; }
        .next-step { margin: 0; padding: var(--space-3); border: 1px solid #1e2a3e; border-left: 3px solid var(--brand); border-radius: var(--radius-sm); background: #0d1118; color: var(--ink); font-size: var(--text-sm); }
        .next-codes { grid-auto-flow: column; justify-content: start; }
        .next-codes li { padding: var(--space-1) var(--space-2); border: 1px solid rgba(224,179,65,.4); border-radius: var(--radius-sm); background: rgba(224,179,65,.1); color: var(--warn-ink); font-size: var(--text-xs); }
        @media (max-width: 62.5rem) { .top-grid { grid-template-columns: 1fr; } .runtime-compare { grid-template-columns: 1fr; } .title-row { flex-direction: column; } }
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

    /** Write gate — the latest recorded scope decision; `null` means no decision was recorded for this turn. */
    readonly writeGate = computed<WriteGateView | null>(() => this.detail()?.writeGate ?? null);

    /** B0-9 — the normative doc reference; a pointer only, never the doc's prose. */
    readonly spec = computed<SpecRefView | null>(() => this.detail()?.spec ?? null);

    /** B0-9 — feedback for the copy affordance; only set after the clipboard actually accepted the path. */
    readonly specPathCopied = signal(false);

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

    readonly endSteps = computed(() => this.systemStages().map((stage) => ({
        id: stage.id,
        label: stage.title,
        status: stage.status,
        sub: stage.sub,
        subcards: stage.details,
    })));
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
}
