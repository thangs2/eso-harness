import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { VerdictGuideComponent } from './verdict-guide.component.js';
import {
    relativeTime,
    writeGateActorOf,
    type EffectivenessView,
    type HostDistillSignal,
    type HostPreflightSignal,
    type HostReconCall,
    type HostSignalsView,
    type TokenSummaryView,
    type TurnVerdictView,
    type WorkerTokenUsageView,
    type VerdictActor,
    type WriteGateView,
} from '../request-detail.models.js';

/**
 * Executive Summary & Diagnostics (4-Card Architecture)
 * High-level orchestration diagnostics: Adjudication, Runtime Health, Scope Guard & Resource Economics.
 */
@Component({
    selector: 'eso-executive-diagnostics',
    standalone: true,
    imports: [VerdictGuideComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="exec-wrapper" aria-label="Executive Summary and System Diagnostics">
            <header class="exec-header">
                <div class="exec-badge-row">
                    <span class="exec-pill-accent">Executive Telemetry</span>
                    <span class="exec-pill-sub">Executive Summary &amp; Diagnostics</span>
                </div>
                <div class="exec-header-content">
                    <h2 class="exec-title">Executive Summary &amp; Diagnostics</h2>
                    <p class="exec-desc">Tầng chẩn đoán điều hành cấp cao: Tổng hợp phán quyết, độ tin cậy điều phối, ranh giới an toàn và kinh tế tài nguyên — độc lập và không trùng lặp thông tin với 8 steps Pipeline Flow.</p>
                </div>
            </header>

            <div class="exec-grid">
                <!-- CARD 1: Executive Adjudication & Verdict Deduction -->
                <section class="exec-card exec-card-verdict" [attr.data-level]="verdict()?.level || 'unknown'">
                    <header class="card-head">
                        <div class="head-left">
                            <span class="exec-icon-chip verdict-accent" aria-hidden="true">◈</span>
                            <div>
                                <p class="card-eyebrow">Executive Adjudication</p>
                                <h3 class="card-title">Turn Verdict &amp; Deduction</h3>
                            </div>
                        </div>
                        <div class="head-right">
                            <button type="button" class="exec-action-btn" (click)="guide.open()">Verdict Guide</button>
                            @if (verdict(); as v) {
                                <span class="exec-level-badge" [class]="'level-' + v.level">{{ v.level }}</span>
                            }
                        </div>
                    </header>

                    @if (verdict(); as v) {
                        <div class="verdict-primary-row">
                            <div class="score-display">
                                <span class="score-num">{{ v.score }}</span>
                                <span class="score-denom">/ 100</span>
                            </div>
                            <div class="score-info">
                                <div class="score-track-wrap">
                                    <div class="score-track" aria-hidden="true">
                                        <span class="score-fill" [attr.data-level]="v.level" [style.width.%]="v.score"></span>
                                    </div>
                                </div>
                                <span class="score-status-desc">{{ levelMeaning(v) }}</span>
                            </div>
                        </div>

                        <!-- Deduction Ledger -->
                        <div class="deduction-ledger" aria-label="Score calculation arithmetic">
                            <div class="ledger-item baseline">
                                <span class="ledger-tag">Baseline</span>
                                <span class="ledger-val">100</span>
                                <span class="ledger-desc">All 4 canonical trace proofs present</span>
                            </div>
                            @for (gap of v.gaps.slice(0, 4); track gap.code + ':' + $index) {
                                <div class="ledger-item penalty">
                                    <span class="ledger-tag">−25</span>
                                    <span class="ledger-val monospace">{{ gap.code }}</span>
                                    <span class="ledger-desc">{{ gap.what }}</span>
                                </div>
                            }
                            @if (v.gaps.length > 4) {
                                <div class="ledger-item more">
                                    <span class="ledger-tag">…</span>
                                    <span class="ledger-val">+{{ v.gaps.length - 4 }} gaps</span>
                                    <span class="ledger-desc">Additional judgment findings recorded</span>
                                </div>
                            }
                            <div class="ledger-item final">
                                <span class="ledger-tag">Net</span>
                                <span class="ledger-val">{{ v.score }}</span>
                                <span class="ledger-desc">Final proof-anchored evidence score</span>
                            </div>
                        </div>

                        <div class="exec-meta-grid">
                            <div class="meta-item">
                                <span class="meta-label">Actor Identity</span>
                                <strong class="meta-val">{{ actorLine(v.actor) }}</strong>
                            </div>
                            <div class="meta-item">
                                <span class="meta-label">Adjudication Basis</span>
                                <strong class="meta-val monospace">{{ v.basis || 'decision.recorded' }}</strong>
                            </div>
                            <div class="meta-item">
                                <span class="meta-label">Evaluated</span>
                                <strong class="meta-val">{{ relative(v.computedAt) }}</strong>
                            </div>
                        </div>
                    } @else {
                        <p class="empty-hint">No verdict data recorded for this turn.</p>
                    }
                </section>

                <!-- CARD 2: Orchestration Health & Reliability Diagnostics -->
                <section class="exec-card exec-card-health">
                    <header class="card-head">
                        <div class="head-left">
                            <span class="exec-icon-chip health-accent" aria-hidden="true">◱</span>
                            <div>
                                <p class="card-eyebrow">Runtime Diagnostics</p>
                                <h3 class="card-title">Orchestration Health &amp; Speed</h3>
                            </div>
                        </div>
                        <div class="head-right">
                            <span class="exec-pill-status">Deterministic Telemetry</span>
                        </div>
                    </header>

                    @if (effectiveness(); as e) {
                        <!-- Health Progress -->
                        <div class="health-summary-row">
                            <div class="health-metric">
                                <span class="health-label">Stage Proof Coverage</span>
                                <div class="health-val-row">
                                    <strong class="health-big">{{ countOrDash(e.stepsWithEvidence) }} / {{ countOrDash(e.stepsTotal) }}</strong>
                                    <span class="health-pct">({{ stageCoveragePct(e) }}%)</span>
                                </div>
                                <div class="mini-bar-track">
                                    <span class="mini-bar-fill" [style.width.%]="stageCoveragePct(e)"></span>
                                </div>
                            </div>
                            <div class="health-metric">
                                <span class="health-label">Turn Latency</span>
                                <strong class="health-big latency">{{ humanDuration(e.durationMs) }}</strong>
                                <span class="health-sub">Lifecycle execution time</span>
                            </div>
                        </div>

                        <div class="exec-tiles-row">
                            <div class="exec-tile">
                                <span class="tile-label">Workers Active</span>
                                <strong class="tile-val">{{ countOrDash(e.workersObserved) }} / {{ countOrDash(e.workersTotal) }}</strong>
                                <span class="tile-sub">{{ countOrDash(e.rolesObserved) }} / {{ countOrDash(e.rolesAssigned) }} roles</span>
                            </div>
                            <div class="exec-tile">
                                <span class="tile-label">Runtime Failures</span>
                                <strong class="tile-val" [class.danger]="e.failures > 0">{{ countOrDash(e.failures) }}</strong>
                                <span class="tile-sub">{{ e.failures === 0 ? 'Zero faults' : 'Exceptions observed' }}</span>
                            </div>
                            <div class="exec-tile">
                                <span class="tile-label">Integrity Seal</span>
                                <strong class="tile-val" [class.ok]="e.receiptSealed">{{ e.receiptSealed ? 'HMAC Chained' : 'Genesis / Unsealed' }}</strong>
                                <span class="tile-sub">Cryptographic chain</span>
                            </div>
                        </div>

                        <!-- Authentic Host Signals Strip -->
                        @if (signals(); as s) {
                            <div class="host-signals-block">
                                <span class="signals-block-title">Authentic Host Signals</span>
                                <div class="signals-compact-grid">
                                    <div class="signal-compact-item">
                                        <span class="sig-key">Preflight</span>
                                        <span class="sig-val">{{ preflightLabel(s.preflight) }}</span>
                                    </div>
                                    <div class="signal-compact-item">
                                        <span class="sig-key">Recon</span>
                                        <span class="sig-val">{{ reconLabel(s.recon) }}</span>
                                    </div>
                                    <div class="signal-compact-item">
                                        <span class="sig-key">Distill</span>
                                        <span class="sig-val">{{ distillLabel(s.distill) }}</span>
                                    </div>
                                    <div class="signal-compact-item">
                                        <span class="sig-key">Brain Tier</span>
                                        <span class="sig-val">{{ brainTierLabel(s.brainTier) }}</span>
                                    </div>
                                </div>
                            </div>
                        }
                    } @else {
                        <p class="empty-hint">No effectiveness telemetry recorded for this request.</p>
                    }
                </section>

                <!-- CARD 3: Workspace Scope & Sandbox Guard -->
                <section class="exec-card exec-card-scope">
                    <header class="card-head">
                        <div class="head-left">
                            <span class="exec-icon-chip scope-accent" aria-hidden="true">⛨</span>
                            <div>
                                <p class="card-eyebrow">Security &amp; Isolation</p>
                                <h3 class="card-title">Workspace Scope &amp; Write Guard</h3>
                            </div>
                        </div>
                        <div class="head-right">
                            @if (writeGate()) {
                                <button type="button" class="exec-action-btn" (click)="copyGate()">{{ gateCopied() ? 'Copied' : 'Copy Proof' }}</button>
                            }
                        </div>
                    </header>

                    @if (writeGate(); as gate) {
                        <div class="scope-status-box" [attr.data-state]="gate.allowed ? 'allowed' : 'blocked'">
                            <div class="scope-status-head">
                                <span class="status-indicator-dot" aria-hidden="true"></span>
                                <strong class="scope-status-title">{{ gate.allowed ? 'WRITE GATE AUTHORIZED' : 'SCOPE MUTATION BLOCKED' }}</strong>
                            </div>
                            <p class="scope-status-desc">{{ gateMeaning(gate) }}</p>
                            @if (gate.target) {
                                <div class="scope-target-row">
                                    <span class="target-label">Target:</span>
                                    <code class="target-code monospace">{{ gate.target }}</code>
                                </div>
                            }
                        </div>

                        <div class="scope-details-list">
                            <div class="scope-detail-item">
                                <span class="sd-label">Decision Ref:</span>
                                <span class="sd-val monospace">{{ gate.decisionId }}</span>
                            </div>
                            <div class="scope-detail-item">
                                <span class="sd-label">Actor Auth:</span>
                                <span class="sd-val">{{ writeGateActor(gate.actor) || 'Host Default' }}</span>
                            </div>
                            @if (gate.code) {
                                <div class="scope-detail-item">
                                    <span class="sd-label">Security Code:</span>
                                    <span class="sd-val monospace warn">{{ gate.code }} ({{ gateCodeMeaning(gate.code) }})</span>
                                </div>
                            }
                        </div>
                    } @else {
                        <div class="scope-status-box read-only">
                            <div class="scope-status-head">
                                <span class="status-indicator-dot neutral" aria-hidden="true"></span>
                                <strong class="scope-status-title">READ-ONLY TURN · SCOPE UNRECORDED</strong>
                            </div>
                            <p class="scope-status-desc">Turn executed without recorded write events. No write gate decision was issued; read-only invariant maintained.</p>
                        </div>
                    }

                    <!-- Sandbox Invariants Triad -->
                    <div class="sandbox-triad">
                        <span class="triad-header">Enforcement Invariants:</span>
                        <div class="triad-items">
                            <div class="triad-item">
                                <span class="triad-check" aria-hidden="true">✓</span>
                                <span>Root Containment (inside consumer workspace)</span>
                            </div>
                            <div class="triad-item">
                                <span class="triad-check" aria-hidden="true">✓</span>
                                <span>Slice Locked (explicit in <code>allowed_files</code>)</span>
                            </div>
                            <div class="triad-item">
                                <span class="triad-check" aria-hidden="true">✓</span>
                                <span>Path Invariant (target directory exists)</span>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- CARD 4: Resource Economics & Multi-Model Allocation -->
                <section class="exec-card exec-card-cost">
                    <header class="card-head">
                        <div class="head-left">
                            <span class="exec-icon-chip cost-accent" aria-hidden="true">◎</span>
                            <div>
                                <p class="card-eyebrow">Resource Economics</p>
                                <h3 class="card-title">Token Burn &amp; Model Allocation</h3>
                            </div>
                        </div>
                        <div class="head-right">
                            <button type="button" class="exec-action-btn" (click)="copyTokens()">{{ tokenCopied() ? 'Copied' : 'Copy Metrics' }}</button>
                        </div>
                    </header>

                    <div class="cost-headline-block">
                        <div class="cost-headline-val">
                            <span class="cost-label">Total Prompt Burn</span>
                            <strong class="cost-big">{{ tokenText(promptTotal()) }}</strong>
                            <span class="cost-sub">{{ tokens().estimated ? 'Chars/4 estimate' : 'Provider reported usage' }}</span>
                        </div>
                        <div class="cost-aux-stats">
                            <div class="aux-stat">
                                <span class="aux-label">Net Input</span>
                                <strong class="aux-val">{{ tokenText(tokens().input) }}</strong>
                            </div>
                            <div class="aux-stat">
                                <span class="aux-label">Cache Read</span>
                                <strong class="aux-val" [class.cached]="tokens().cacheRead != null">{{ tokenText(tokens().cacheRead) }}</strong>
                            </div>
                            <div class="aux-stat">
                                <span class="aux-label">Output Generated</span>
                                <strong class="aux-val">{{ tokenText(tokens().output) }}</strong>
                            </div>
                        </div>
                    </div>

                    <!-- Split Proportion Bar -->
                    @if (hasTokenRatio()) {
                        <div class="cost-gauge-wrap">
                            <div class="cost-gauge-bar" aria-hidden="true">
                                <span class="gauge-fresh" [style.width.%]="gaugePercent(tokens().input)"></span>
                                <span class="gauge-cache" [style.width.%]="gaugePercent(tokens().cacheRead)"></span>
                            </div>
                            <div class="gauge-legend">
                                <span class="legend-item"><span class="dot fresh" aria-hidden="true"></span>Fresh Net: {{ gaugePercent(tokens().input) }}%</span>
                                <span class="legend-item"><span class="dot cache" aria-hidden="true"></span>Cache Hit: {{ gaugePercent(tokens().cacheRead) }}%</span>
                            </div>
                        </div>
                    }

                    <!-- Per Worker & Multi-Model Table -->
                    <div class="worker-usage">
                        <p class="worker-usage-title">
                            Per worker
                            <span class="worker-usage-count">{{ workers().length }} active worker{{ workers().length === 1 ? '' : 's' }}@if (uniqueModels().length) { · {{ uniqueModels().length }} model{{ uniqueModels().length === 1 ? '' : 's' }} }</span>
                        </p>
                        @if (workers().length) {
                            <table class="worker-table">
                                <colgroup>
                                    <col class="col-worker" />
                                    <col class="col-model" />
                                    <col class="col-num" />
                                    <col class="col-num" />
                                    <col class="col-num" />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th scope="col">Worker</th>
                                        <th scope="col">Model</th>
                                        <th scope="col" class="num">Net input</th>
                                        <th scope="col" class="num">Cache read</th>
                                        <th scope="col" class="num">Output</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (worker of workers(); track worker.workerId) {
                                        <tr>
                                            <th scope="row" class="worker-name" [title]="worker.workerId + (worker.model ? ' · ' + worker.model : '')">
                                                <div class="worker-title-wrap">
                                                    <span class="worker-label-bold">{{ worker.label }}</span>
                                                    @if (worker.label.toLowerCase() !== worker.workerId.toLowerCase()) {
                                                        <small class="worker-id-tag">{{ worker.workerId }}</small>
                                                    }
                                                </div>
                                            </th>
                                            <td class="worker-model-cell">
                                                <span class="worker-model-badge" [class.unreported]="missingValue(worker.model)" [title]="worker.model || 'model not captured'">
                                                    {{ worker.model || '—' }}
                                                </span>
                                            </td>
                                            <td class="num" [class.missing]="worker.input === null">{{ worker.input === null ? 'not captured' : tokenText(worker.input) }}</td>
                                            <td class="num" [class.missing]="worker.cacheRead === null" [class.cached-highlight]="worker.cacheRead !== null">{{ worker.cacheRead === null ? 'not captured' : tokenText(worker.cacheRead) }}</td>
                                            <td class="num" [class.missing]="worker.output === null">{{ worker.output === null ? 'not captured' : tokenText(worker.output) }}</td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        } @else {
                            <p class="empty-hint">Single-turn host execution (no subagent workers active).</p>
                        }
                    </div>

                    <div class="cost-footer-meta">
                        <span><strong>{{ llmCallCount() }}</strong> LLM calls</span>
                        <span><strong>{{ toolCount() }}</strong> tools invoked</span>
                        <span><strong>{{ fileCount() }}</strong> files accessed</span>
                    </div>
                </section>
            </div>
        </section>

        <eso-verdict-guide #guide [verdict]="verdict()" />
    `,
    styles: [`
        :host { display: block; --brand: #38bdf8; --muted: #94a3b8; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --warn-ink: #fbbf24; --ok-ink: #34d399; --danger-ink: #f87171; --fs-title: .875rem; --fs-body: .8125rem; --fs-label: .6875rem; --lh: 1.45; }
        h2, h3, p { margin: 0; }
        .monospace { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

        .exec-wrapper { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-4); padding: var(--space-4); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: var(--radius-md); background: rgba(15, 23, 42, 0.4); box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.5); }
        .exec-header { display: flex; flex-direction: column; gap: var(--space-2); padding-bottom: var(--space-3); border-bottom: 1px solid var(--line-soft); }
        .exec-badge-row { display: flex; align-items: center; gap: var(--space-2); }
        .exec-pill-accent { display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: 999px; background: linear-gradient(90deg, #38bdf8, #818cf8); color: #0f172a; font-size: var(--fs-label); font-weight: 750; letter-spacing: 0.06em; text-transform: uppercase; }
        .exec-pill-sub { color: var(--dim); font-size: var(--fs-label); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        .exec-title { color: #f8fafc; font-size: 1.125rem; font-weight: 700; line-height: 1.3; }
        .exec-desc { color: var(--muted); font-size: var(--fs-body); line-height: 1.45; }

        .exec-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); align-items: stretch; }
        .exec-card { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; padding: var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-border-accent, var(--brand)); border-radius: var(--radius-md); background: var(--surface); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        .exec-card:hover { border-color: color-mix(in srgb, var(--card-border-accent, #38bdf8) 60%, transparent); box-shadow: 0 6px 16px -2px rgba(0, 0, 0, 0.45); }

        .exec-card-verdict { --card-border-accent: #a855f7; }
        .exec-card-verdict[data-level='allow'] { --card-border-accent: var(--ok-ink); }
        .exec-card-verdict[data-level='partial'] { --card-border-accent: var(--warn-ink); }
        .exec-card-verdict[data-level='deny'] { --card-border-accent: var(--danger-ink); }
        .exec-card-health { --card-border-accent: #38bdf8; }
        .exec-card-scope { --card-border-accent: #10b981; }
        .exec-card-cost { --card-border-accent: #f59e0b; }

        .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .head-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .head-right { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
        .card-eyebrow { color: var(--dim); font-size: var(--fs-label); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
        .card-title { color: #f1f5f9; font-size: var(--fs-title); font-weight: 650; line-height: 1.3; }

        .exec-icon-chip { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: var(--radius-sm); font-size: 1rem; border: 1px solid transparent; }
        .verdict-accent { background: rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.35); color: #c084fc; }
        .health-accent { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.35); color: #38bdf8; }
        .scope-accent { background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.35); color: #34d399; }
        .cost-accent { background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.35); color: #fbbf24; }

        .exec-action-btn { padding: 0.125rem 0.5rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font: inherit; font-size: var(--fs-label); font-weight: 550; cursor: pointer; transition: color 0.15s, border-color 0.15s; }
        .exec-action-btn:hover { border-color: var(--brand); color: #f8fafc; }
        .exec-pill-status { padding: 0.125rem 0.5rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--dim); font-size: var(--fs-label); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }

        .exec-level-badge { display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: var(--radius-sm); font-size: var(--fs-label); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid currentColor; }
        .level-allow { color: var(--ok-ink); background: rgba(52, 211, 153, 0.12); }
        .level-partial { color: var(--warn-ink); background: rgba(251, 191, 36, 0.12); }
        .level-deny { color: var(--danger-ink); background: rgba(248, 113, 113, 0.12); }
        .level-unknown { color: var(--muted); background: rgba(148, 163, 184, 0.12); }

        /* Card 1 Specifics */
        .verdict-primary-row { display: flex; align-items: center; gap: var(--space-4); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-soft); }
        .score-display { display: flex; align-items: baseline; gap: 0.25rem; flex-shrink: 0; }
        .score-num { font-size: 2rem; font-weight: 800; color: #f8fafc; line-height: 1; font-variant-numeric: tabular-nums; }
        .score-denom { font-size: var(--fs-title); color: var(--dim); font-weight: 600; }
        .score-info { display: flex; flex-direction: column; gap: 0.25rem; flex: 1 1 auto; min-width: 0; }
        .score-track-wrap { width: 100%; height: 0.5rem; border-radius: 999px; background: var(--surface-2); overflow: hidden; border: 1px solid var(--line-soft); }
        .score-track { width: 100%; height: 100%; }
        .score-fill { display: block; height: 100%; border-radius: 999px; background: var(--brand); transition: width 0.3s ease; }
        .score-fill[data-level='allow'] { background: var(--ok-ink); }
        .score-fill[data-level='partial'] { background: var(--warn-ink); }
        .score-fill[data-level='deny'] { background: var(--danger-ink); }
        .score-fill[data-level='unknown'] { background: var(--dim); }
        .score-status-desc { color: var(--muted); font-size: var(--fs-label); line-height: 1.4; }

        .deduction-ledger { display: flex; flex-direction: column; gap: 0.25rem; padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-label); }
        .ledger-item { display: grid; grid-template-columns: 3rem minmax(9.5rem, max-content) minmax(0, 1fr); gap: var(--space-2); align-items: baseline; }
        .ledger-item.penalty { color: var(--warn-ink); }
        .ledger-item.final { margin-top: 0.25rem; padding-top: 0.25rem; border-top: 1px solid var(--line-soft); font-weight: 700; }
        .ledger-tag { color: var(--dim); font-variant-numeric: tabular-nums; text-transform: uppercase; letter-spacing: 0.04em; }
        .ledger-val { color: #f1f5f9; font-weight: 650; }
        .ledger-item.penalty .ledger-val { color: var(--warn-ink); }
        .ledger-desc { color: var(--muted); overflow-wrap: anywhere; }

        .exec-meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line-soft); }
        .meta-item { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
        .meta-label { color: var(--dim); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.05em; }
        .meta-val { color: #cbd5e1; font-size: var(--fs-label); font-weight: 600; overflow-wrap: anywhere; }

        /* Card 2 Specifics */
        .health-summary-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-soft); }
        .health-metric { display: flex; flex-direction: column; gap: 0.25rem; }
        .health-label { color: var(--dim); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
        .health-val-row { display: flex; align-items: baseline; gap: 0.375rem; }
        .health-big { font-size: 1.375rem; font-weight: 750; color: #f8fafc; font-variant-numeric: tabular-nums; }
        .health-big.latency { color: #7dd3fc; }
        .health-pct { color: var(--muted); font-size: var(--fs-label); font-weight: 600; }
        .health-sub { color: var(--dim); font-size: var(--fs-label); }
        .mini-bar-track { width: 100%; height: 0.25rem; border-radius: 999px; background: var(--surface-2); overflow: hidden; margin-top: 0.125rem; }
        .mini-bar-fill { display: block; height: 100%; background: #38bdf8; border-radius: 999px; }

        .exec-tiles-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
        .exec-tile { display: flex; flex-direction: column; gap: 0.125rem; padding: var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); }
        .tile-label { color: var(--dim); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.05em; }
        .tile-val { color: #f1f5f9; font-size: var(--fs-body); font-weight: 700; font-variant-numeric: tabular-nums; }
        .tile-val.ok { color: var(--ok-ink); }
        .tile-val.danger { color: var(--danger-ink); }
        .tile-sub { color: var(--dim); font-size: var(--fs-label); }

        .host-signals-block { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line-soft); }
        .signals-block-title { color: var(--dim); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
        .signals-compact-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
        .signal-compact-item { display: flex; flex-direction: column; gap: 0.0625rem; padding: 0.25rem 0.375rem; border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); }
        .sig-key { color: var(--dim); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.04em; }
        .sig-val { color: #cbd5e1; font-size: var(--fs-label); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Card 3 Specifics */
        .scope-status-box { display: flex; flex-direction: column; gap: 0.25rem; padding: var(--space-3); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); background: rgba(16, 185, 129, 0.06); }
        .scope-status-box[data-state='blocked'] { border-color: rgba(248, 113, 113, 0.3); background: rgba(248, 113, 113, 0.06); }
        .scope-status-box.read-only { border-color: rgba(148, 163, 184, 0.2); background: rgba(148, 163, 184, 0.04); }
        .scope-status-head { display: flex; align-items: center; gap: 0.375rem; }
        .status-indicator-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--ok-ink); }
        .scope-status-box[data-state='blocked'] .status-indicator-dot { background: var(--danger-ink); }
        .status-indicator-dot.neutral { background: var(--muted); }
        .scope-status-title { font-size: var(--fs-label); font-weight: 750; letter-spacing: 0.06em; text-transform: uppercase; color: #f8fafc; }
        .scope-status-desc { color: var(--muted); font-size: var(--fs-label); line-height: 1.45; }
        .scope-target-row { display: flex; align-items: baseline; gap: 0.25rem; }
        .target-label { color: var(--dim); font-size: var(--fs-label); }
        .target-code { color: #7dd3fc; font-size: var(--fs-label); }

        .scope-details-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
        .scope-detail-item { display: flex; flex-direction: column; gap: 0.0625rem; }
        .sd-label { color: var(--dim); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.04em; }
        .sd-val { color: #cbd5e1; font-size: var(--fs-label); font-weight: 550; }
        .sd-val.warn { color: var(--warn-ink); }

        .sandbox-triad { display: flex; flex-direction: column; gap: 0.25rem; padding-top: var(--space-2); border-top: 1px solid var(--line-soft); }
        .triad-header { color: var(--dim); font-size: var(--fs-label); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        .triad-items { display: flex; flex-direction: column; gap: 0.1875rem; font-size: var(--fs-label); color: var(--muted); }
        .triad-item { display: flex; align-items: center; gap: 0.375rem; }
        .triad-check { color: var(--ok-ink); font-weight: 700; }

        /* Card 4 Specifics */
        .cost-headline-block { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-soft); }
        .cost-headline-val { display: flex; flex-direction: column; gap: 0.125rem; }
        .cost-label { color: var(--dim); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
        .cost-big { font-size: 1.5rem; font-weight: 800; color: #f8fafc; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .cost-sub { color: var(--dim); font-size: var(--fs-label); }
        .cost-aux-stats { display: flex; align-items: center; gap: var(--space-4); }
        .aux-stat { display: flex; flex-direction: column; gap: 0.0625rem; }
        .aux-label { color: var(--dim); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.04em; }
        .aux-val { color: #cbd5e1; font-size: var(--fs-title); font-weight: 700; font-variant-numeric: tabular-nums; }
        .aux-val.cached { color: #38bdf8; }

        .cost-gauge-wrap { display: flex; flex-direction: column; gap: 0.25rem; }
        .cost-gauge-bar { display: flex; width: 100%; height: 0.5rem; border-radius: 999px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--line-soft); }
        .gauge-fresh { display: block; height: 100%; background: #34d399; }
        .gauge-cache { display: block; height: 100%; background: #38bdf8; }
        .gauge-legend { display: flex; align-items: center; gap: var(--space-3); font-size: var(--fs-label); color: var(--muted); }
        .legend-item { display: flex; align-items: center; gap: 0.25rem; }
        .dot { width: 0.375rem; height: 0.375rem; border-radius: 50%; }
        .dot.fresh { background: #34d399; }
        .dot.cache { background: #38bdf8; }

        /* Multi-worker table in Card 4 */
        .worker-usage { display: grid; gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line-soft); }
        .worker-usage-title { margin: 0; color: var(--muted); font-size: var(--fs-label); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); }
        .worker-usage-count { color: var(--dim); font-weight: 500; letter-spacing: .02em; text-transform: none; }
        .worker-table { width: 100%; border-collapse: collapse; font-size: var(--fs-label); table-layout: fixed; }
        .worker-table col.col-worker { width: 22%; }
        .worker-table col.col-model { width: 36%; }
        .worker-table col.col-num { width: 14%; }
        .worker-table th, .worker-table td { padding: var(--space-2) var(--space-2); border-bottom: 1px solid var(--line-soft); text-align: left; vertical-align: baseline; }
        .worker-table thead th { padding-block: var(--space-1); color: var(--muted); font-size: var(--fs-label); font-weight: 600; border-bottom: 1px solid var(--line); text-transform: uppercase; letter-spacing: .04em; }
        .worker-table tbody tr:last-child th, .worker-table tbody tr:last-child td { border-bottom: 0; }
        .worker-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: #cbd5e1; }
        .worker-table .num.missing { color: var(--dim); font-style: italic; }
        .worker-table .worker-name { color: #e2e8f0; font-weight: 600; overflow-wrap: anywhere; }
        .worker-title-wrap { display: flex; flex-direction: column; gap: .0625rem; min-width: 0; }
        .worker-label-bold { color: #f1f5f9; font-weight: 650; }
        .worker-id-tag { color: var(--dim); font-size: .6875rem; font-family: ui-monospace, monospace; }
        .worker-model-cell { vertical-align: baseline; min-width: 0; }
        .worker-model-badge { display: inline-block; max-width: 100%; padding: .0625rem .375rem; border: 1px solid rgba(56,189,248,.3); border-radius: .25rem; background: rgba(56,189,248,.08); color: #7dd3fc; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .6875rem; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
        .worker-model-badge.unreported { border-color: rgba(148,163,184,.25); background: rgba(148,163,184,.06); color: var(--dim); font-style: italic; }
        .cached-highlight { color: #38bdf8; font-weight: 650; }

        .cost-footer-meta { display: flex; align-items: center; gap: var(--space-4); padding-top: var(--space-2); border-top: 1px solid var(--line-soft); font-size: var(--fs-label); color: var(--dim); }
        .cost-footer-meta strong { color: #cbd5e1; }

        .empty-hint { color: var(--dim); font-size: var(--fs-label); font-style: italic; margin: 0; }

        @media (max-width: 63.9375rem) {
            .exec-grid { grid-template-columns: 1fr; }
        }
    `],
})
export class ExecutiveDiagnosticsComponent {
    readonly verdict = input<TurnVerdictView | null>(null);
    readonly effectiveness = input<EffectivenessView | null>(null);
    readonly signals = input<HostSignalsView | null>(null);
    readonly writeGate = input<WriteGateView | null>(null);
    readonly tokens = input<TokenSummaryView>({
        input: null,
        output: null,
        cacheRead: null,
        estimated: false,
    });
    readonly workers = input<WorkerTokenUsageView[]>([]);
    readonly llmCallCount = input<number>(0);
    readonly toolCount = input<number>(0);
    readonly fileCount = input<number>(0);

    readonly gateCopied = signal(false);
    readonly tokenCopied = signal(false);

    levelMeaning(v: TurnVerdictView): string {
        switch (v.level) {
            case 'allow': return 'Adjudicated: All canonical trace proofs verified. Output sustained as compliant.';
            case 'partial': return `Degraded: ${v.gaps.length} proof gap(s) recorded. Claim cannot be sustained as allow.`;
            case 'deny': return 'Rejected: Formal rule violation or explicit security denial recorded.';
            default: return 'Unproven: Host emitted no conclusive decision claim. Evaluated as advisory unknown.';
        }
    }

    stageCoveragePct(e: EffectivenessView): number {
        if (!e.stepsTotal) return 0;
        return Math.round((e.stepsWithEvidence / e.stepsTotal) * 100);
    }

    actorLine(actor: VerdictActor | null): string {
        if (!actor) return 'no actor recorded';
        const id = typeof actor['id'] === 'string' ? actor['id'] : '';
        const role = typeof actor['role'] === 'string' ? actor['role'] : '';
        if (id && role) return `${id} (${role})`;
        return id || role || 'unknown actor';
    }

    writeGateActor(actor: Record<string, unknown> | null): string {
        return writeGateActorOf(actor);
    }

    gateMeaning(gate: WriteGateView): string {
        if (gate.allowed) return `Scope authorized write access to ${gate.target}.`;
        return `Write gate blocked access to ${gate.target}. Rule failure: ${gate.code || 'BLOCKED_SCOPE'}.`;
    }

    gateCodeMeaning(code: string | null): string {
        switch (code) {
            case 'BLOCKED_SCOPE': return 'target path is outside allowed_files scope';
            case 'DANGLING_SCOPE': return 'target parent directory does not exist';
            case 'EMPTY_SCOPE': return 'worker has no allowed_files declared';
            default: return 'scope policy violation';
        }
    }

    countOrDash(val: number | null | undefined): string {
        return typeof val === 'number' && Number.isFinite(val) ? String(val) : '—';
    }

    humanDuration(ms: number | null | undefined): string {
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    tokenText(val: number | null | undefined): string {
        if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
        return val.toLocaleString('en-US');
    }

    promptTotal(): number | null {
        const inp = this.tokens().input;
        const cache = this.tokens().cacheRead;
        if (inp === null && cache === null) return null;
        return (inp || 0) + (cache || 0);
    }

    hasTokenRatio(): boolean {
        const inp = this.tokens().input;
        const cache = this.tokens().cacheRead;
        return typeof inp === 'number' && typeof cache === 'number' && (inp > 0 || cache > 0);
    }

    gaugePercent(val: number | null): number {
        const total = this.promptTotal();
        if (!total || typeof val !== 'number') return 0;
        return Math.min(100, Math.max(0, Math.round((val / total) * 100)));
    }

    uniqueModels(): string[] {
        const list = this.workers().map((w) => (w.model || '').trim()).filter((m) => m && m !== '—');
        return [...new Set(list)];
    }

    missingValue(val: string | null | undefined): boolean {
        if (!val) return true;
        const t = val.trim().toLowerCase();
        return !t || t === '—' || t === 'not captured' || t === 'not reported' || t === 'model not captured';
    }

    preflightLabel(p: HostPreflightSignal | null | undefined): string {
        if (!p) return 'not reported';
        return p.state || 'not captured';
    }

    reconLabel(r: HostReconCall[] | null | undefined): string {
        if (!r || !r.length) return 'not reported';
        return `${r.length} adapter(s) called`;
    }

    brainTierLabel(t: string | null | undefined): string {
        return t || 'not reported';
    }

    distillLabel(d: HostDistillSignal | null | undefined): string {
        if (!d) return 'not reported';
        if (d.memorySaved) return `Saved (${d.lessons ?? 0} lessons)`;
        return 'not saved';
    }

    relative(iso: string | null | undefined): string {
        if (!iso) return '—';
        return relativeTime(iso);
    }

    copyGate(): void {
        const gate = this.writeGate();
        if (!gate) return;
        const text = `${gate.allowed ? 'ALLOWED' : 'BLOCKED'}: ${gate.target} (${gate.decisionId})`;
        navigator.clipboard?.writeText(text).then(() => {
            this.gateCopied.set(true);
            setTimeout(() => this.gateCopied.set(false), 1500);
        });
    }

    copyTokens(): void {
        const t = this.tokens();
        const text = `Prompt Total: ${this.tokenText(this.promptTotal())} (Net Input: ${this.tokenText(t.input)}, Cache Read: ${this.tokenText(t.cacheRead)}, Output: ${this.tokenText(t.output)})`;
        navigator.clipboard?.writeText(text).then(() => {
            this.tokenCopied.set(true);
            setTimeout(() => this.tokenCopied.set(false), 1500);
        });
    }
}
