import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { ReceiptEvidenceSourceDto } from '../../../../../../../../../libs/api-client/types.js';
import type { ExplicitUnknownItem } from '../evidence-effectiveness.selectors.js';
import {
    NEXT_STEP,
    relativeTime,
    type ActionEventView,
    type JevView,
    type PreTurnGateView,
    type ReceiptVerificationState,
    type RequestCheckView,
    type RequestDetailDto,
    type RequestReceiptSummaryDto,
    type SpecRefView,
    type TurnVerdictView,
    type UnifiedGapItem,
    type VerdictActor,
    type VerdictLevel,
    type VerdictRuleRef,
    type WriteGateView,
} from '../request-detail.models.js';
import { toPostTurnGaps } from '../request-detail.selectors.js';

/** Verdict & gaps — Q1–Q6, the JEV line, the canonical write-gate line and heuristic checks. */
@Component({
    selector: 'eso-verdict-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="verdict-panel">
            <section class="panel">
                <header class="panel-head"><div><p class="eyebrow">Verdict</p><h2>Verdict &amp; gaps</h2></div><span class="badge muted">ESO adjudication</span></header>
                @if (verdict(); as v) {
                    <div class="verdict-block q1-block">
                        <h3><span class="q-no">Q1</span> Verdict</h3>
                        <div class="verdict-head">
                            <span class="verdict-level-badge" [class]="'level-' + v.level">{{ v.level }}</span>
                            <div class="verdict-meta"><small>Score</small><strong>{{ v.score }}</strong></div>
                            <div class="verdict-meta"><small>Actor</small><span class="verdict-actor-id">{{ actorId(v.actor) }}</span>@if (actorRole(v.actor); as role) {<span class="verdict-actor-role">{{ role }}</span>}</div>
                            <div class="verdict-meta"><small>Computed</small><time>{{ relative(v.computedAt) }}</time></div>
                        </div>
                        <p class="verdict-basis">{{ v.basis }}</p>
                    </div>
                    <div class="verdict-block q2-block">
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
                            <span class="lock-icon" aria-hidden="true">🔒</span>
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
                    <div class="verdict-block q3-block">
                        <h3><span class="q-no">Q3</span> Turn Proof</h3>
                        <p class="verdict-score-line">Score <strong>{{ v.score }}</strong> / 100 · {{ postGaps().length }} gap(s)</p>
                        <ul class="gap-list">
                            @for (gap of postGaps(); track gap.domain + ':' + gap.code + ':' + $index) {
                                <li class="gap-row">
                                    <div class="gap-head">
                                        <span class="gap-domain" [attr.data-domain]="gap.domain">{{ gap.domain }}</span>
                                        <code>{{ gap.code }}</code> · <span>{{ gap.what }}</span>
                                        @if (gap.where) { <code class="gap-where">{{ gap.where }}</code> }
                                    </div>
                                    <p class="gap-consequence">{{ gap.consequence }}</p>
                                </li>
                            } @empty {
                                <li class="hint">No gaps recorded</li>
                            }
                        </ul>
                        <div class="unknowns-box" aria-label="Explicit Unknowns (BR-18)">
                            <div class="unknowns-head">
                                <span class="q-no">BR-18</span>
                                <strong>Explicit Unknowns</strong>
                                <span class="badge muted">{{ explicitUnknowns().length }} blind spot(s)</span>
                            </div>
                            @if (explicitUnknowns().length > 0) {
                                <ul class="unknowns-list">
                                    @for (item of explicitUnknowns(); track item.id) {
                                        <li class="unknown-row">
                                            <div class="unknown-top">
                                                <span class="unknown-area">{{ item.area }}</span>
                                                <strong>{{ item.label }}</strong>
                                            </div>
                                            <p class="unknown-detail">{{ item.detail }}</p>
                                        </li>
                                    }
                                </ul>
                            } @else {
                                <p class="hint">All checked evidence dimensions were reported for this turn.</p>
                            }
                        </div>
                    </div>
                } @else {
                    <p class="hint">The API response for this request carried no verdict.</p>
                }
                @if (preTurnGate(); as pre) {
                    <div class="verdict-block pre-turn-block" aria-label="Pre-turn gate">
                        <h3><span class="q-no">PRE</span> Pre-turn gate</h3>
                        <p class="pre-turn-summary">
                            <span class="badge" [class.ok]="pre.decision === 'allow'" [class.bad]="pre.decision === 'block'">{{ pre.decision }}</span>
                            <span class="badge">{{ pre.level }}</span>
                            <span class="badge muted">{{ pre.enforcement }}</span>
                            <span class="hint">{{ pre.gaps.length }} gap(s)</span>
                        </p>
                        @if (pre.gaps.length) {
                            <ul class="gap-list">
                                @for (gap of pre.gaps; track gap.domain + ':' + gap.code + ':' + $index) {
                                    <li class="gap-row">
                                        <div class="gap-head">
                                            <span class="gap-domain" [attr.data-domain]="gap.domain">{{ gap.domain }}</span>
                                            <code>{{ gap.code }}</code> · <span>{{ gap.what }}</span>
                                            @if (gap.where) { <code class="gap-where">{{ gap.where }}</code> }
                                        </div>
                                        <p class="gap-consequence">{{ gap.consequence }}</p>
                                    </li>
                                }
                            </ul>
                        } @else {
                            <p class="hint">No pre-turn gaps recorded</p>
                        }
                    </div>
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
                    <div class="verdict-block q5-block">
                        <h3><span class="q-no">Q5</span> Integrity</h3>
                        @if (receipt(); as r) {
                            <div class="receipt-seal-badge">
                                <span class="seal-icon">🛡️</span>
                                <span class="seal-text">Receipt v2 SHA-256 Digest Sealed</span>
                            </div>
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
                        <div class="sources-box" aria-label="Receipt v2 Verified Sources">
                            <div class="unknowns-head">
                                <span class="q-no">v2</span>
                                <strong>Receipt v2 Verified Sources (<code>sources[]</code>)</strong>
                                <span class="badge muted">{{ receiptSources().length }} source(s)</span>
                            </div>
                            @if (receiptSources().length > 0) {
                                <div class="sources-table-wrap">
                                    <table class="telemetry-table sources-table font-mono">
                                        <colgroup>
                                            <col class="col-req" />
                                            <col class="col-where" />
                                            <col class="col-hash" />
                                            <col class="col-verified" />
                                            <col class="col-at" />
                                        </colgroup>
                                        <thead>
                                            <tr><th>Requirement</th><th>Where</th><th>Hash</th><th>Verified</th><th>Verified At</th></tr>
                                        </thead>
                                        <tbody>
                                            @for (src of receiptSources(); track src.where + ':' + $index) {
                                                <tr>
                                                    <td class="src-req"><code [title]="src.requirementId || ''">{{ src.requirementId || '—' }}</code></td>
                                                    <td class="src-where"><code [title]="src.where">{{ src.where }}</code></td>
                                                    <td class="src-hash"><code [title]="src.hash || ''">{{ shortHash(src.hash) }}</code></td>
                                                    <td class="src-verified">
                                                        <span class="badge" [class.ok]="src.verified" [class.bad]="!src.verified">
                                                            {{ src.verified ? '✓ verified' : '✗ unverified' }}
                                                        </span>
                                                    </td>
                                                    <td class="src-at" [title]="src.verifiedAt || ''">{{ formatVerifiedAt(src.verifiedAt) }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            } @else {
                                <p class="hint">0 server-verified sources were sealed in this receipt.</p>
                            }
                        </div>
                    </div>
                    <div class="verdict-block q6-block">
                        <h3><span class="q-no">Q6</span> What next</h3>
                        <p class="next-step">{{ nextStep(v.level) }}</p>
                        @if (groupedGapCodes().length) {
                            <ul class="next-codes">
                                @for (item of groupedGapCodes(); track item.code) {
                                    <li [title]="item.title">{{ item.code }}@if (item.count > 1) { <span class="code-count">×{{ item.count }}</span> }</li>
                                }
                            </ul>
                        } @else {
                            <p class="hint">No gap codes recorded for this verdict.</p>
                        }
                    </div>
                } @else {
                    <p class="hint">No verdict was returned, so no next step can be derived.</p>
                }
            </section>

            <section class="panel checks-panel">
                <header class="panel-head"><div><p class="eyebrow">Heuristic checks — not the verdict</p><h2>Checks &amp; worker outcomes</h2></div><span class="badge muted">{{ checks().length }} checks</span></header>
                <div class="checks checks-grid">
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
        </div>
    `,
    styles: [`
        :host { display: block; min-width: 0; max-width: 100%; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --warn-ink: #e0b341; --ok-ink: #4ec97a; --danger-ink: #ff6b6b; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        .verdict-panel { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); min-width: 0; max-width: 100%; color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        h2, h3, p, dl, dd, dt, ul, li { margin: 0; }
        h2 { font-size: var(--fs-title); font-weight: 650; color: #f1f5f9; }
        h3 { display: flex; align-items: baseline; gap: var(--space-2); font-size: var(--fs-title); font-weight: 600; color: #e2e8f0; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hint, .muted { color: var(--muted); font-size: var(--fs-secondary); }
        .panel, .next-panel { display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface); min-width: 0; max-width: 100%; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); min-width: 0; }
        .badge { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); line-height: 1.2; white-space: nowrap; }
        .badge.ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); }
        .badge.bad { color: #fecaca; border-color: rgba(255,107,107,.4); }
        .badge.muted { color: var(--muted); }
        .verdict-block { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line); min-width: 0; max-width: 100%; }
        .q1-block { border-left: 3px solid #4ec97a; padding-left: var(--space-3); }
        .q2-block { border-left: 3px solid #38bdf8; padding-left: var(--space-3); }
        .q3-block { border-left: 3px solid #c084fc; padding-left: var(--space-3); }
        .pre-turn-block { border-left: 3px solid var(--warn-ink); padding-left: var(--space-3); }
        .jev-block { border-left: 3px solid #818cf8; padding-left: var(--space-3); }
        .q5-block { border-left: 3px solid #4ec97a; padding-left: var(--space-3); }
        .q6-block { border-left: 3px solid #c084fc; padding-left: var(--space-3); }
        .change-panel { border-left: 3px solid #38bdf8; }
        .checks-panel { border-left: 3px solid var(--brand); }
        .receipt-seal-badge { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border: 1px solid rgba(78,201,122,.3); border-radius: var(--radius-sm); background: rgba(78,201,122,.1); color: var(--ok-ink); font-size: var(--fs-secondary); font-weight: 600; width: fit-content; }
        .verdict-level-badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid currentColor; border-radius: var(--radius-sm); font-size: var(--fs-badge); font-weight: 700; letter-spacing: .06em; line-height: 1.2; text-transform: uppercase; white-space: nowrap; }
        .level-allow { color: var(--ok-ink); background: rgba(78,201,122,.12); }
        .level-partial { color: var(--warn-ink); background: rgba(224,179,65,.12); }
        .level-deny { color: var(--danger-ink); background: rgba(255,107,107,.12); }
        .level-unknown { color: var(--muted); background: rgba(139,151,171,.12); }
        .verdict-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); }
        .verdict-meta { display: grid; gap: 0; }
        .verdict-meta small { color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .verdict-meta strong { color: var(--warn-ink); font-size: 1.125rem; line-height: 1.1; font-variant-numeric: tabular-nums; }
        .verdict-meta time { color: var(--ink); font-size: var(--fs-secondary); }
        .verdict-actor-id { color: var(--ink); font-size: var(--fs-secondary); }
        .verdict-actor-role { display: block; color: var(--dim); font-size: var(--fs-badge); }
        .verdict-basis { color: #cbd5e1; font-size: var(--fs-secondary); line-height: var(--lh); overflow-wrap: anywhere; }
        .q-no { color: var(--muted); font-size: var(--fs-badge); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .rule-refs, .gap-list, .action-list { display: grid; gap: var(--space-1); padding: 0; list-style: none; min-width: 0; max-width: 100%; }
        .rule-ref { padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .rule-ref code { color: var(--brand); }
        .verdict-score-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); color: var(--muted); font-size: var(--fs-secondary); }
        .verdict-score-line strong { color: var(--ink); font-size: var(--fs-title); font-variant-numeric: tabular-nums; }
        .gap-row { display: grid; gap: var(--space-1); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-left: 3px solid var(--warn-ink); border-radius: var(--radius-sm); background: var(--surface-2); }
        .gap-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1); color: #cbd5e1; font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .gap-head code { color: var(--warn-ink); font-weight: 700; }
        .gap-domain { display: inline-flex; align-items: center; padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--brand); font-size: var(--fs-badge); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
        .gap-domain[data-domain='pre'] { color: var(--warn-ink); border-color: rgba(224,179,65,.35); }
        .gap-domain[data-domain='knowledge'] { color: #c084fc; border-color: rgba(192,132,252,.35); }
        .gap-head code.gap-where { color: var(--brand); font-weight: 500; }
        .gap-consequence { color: var(--muted); font-size: var(--fs-secondary); }
        .pre-turn-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
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
        .copy-path:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .receipt-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); color: var(--muted); font-size: var(--fs-body); }
        .receipt-line code { color: var(--brand); overflow-wrap: anywhere; }
        .receipt-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: var(--space-1) var(--space-3); }
        .receipt-facts div { display: grid; gap: 0; min-width: 0; }
        .receipt-facts dt { color: var(--muted); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .receipt-facts dd { color: var(--ink); font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .receipt-facts code { color: var(--brand); }
        .receipt-verify { margin: 0; }
        .next-step { padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-left: 3px solid var(--brand); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font-size: var(--fs-body); }
        .next-codes { display: flex; flex-wrap: wrap; gap: var(--space-1); max-width: 100%; padding: 0; list-style: none; }
        .next-codes li { display: inline-flex; align-items: center; gap: 0.25rem; max-width: 100%; padding: 0.125rem var(--space-2); border: 1px solid rgba(224,179,65,.4); border-radius: var(--radius-sm); background: rgba(224,179,65,.1); color: var(--warn-ink); font-size: var(--fs-badge); font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
        .next-codes .code-count { font-weight: 700; opacity: .9; }
        .jev-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-3); color: #cbd5e1; font-size: var(--fs-body); overflow-wrap: anywhere; }
        .jev-summary { color: var(--ink); }
        .jev-mismatch { padding: 0 var(--space-2); border: 1px solid rgba(224,179,65,.45); border-radius: var(--radius-sm); background: rgba(224,179,65,.12); color: var(--warn-ink); font-size: var(--fs-secondary); }
        .checks { display: grid; gap: var(--space-1); }
        .checks-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
        @media (max-width: 48rem) { .checks-grid { grid-template-columns: minmax(0, 1fr); } }
        .check-row { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); }
        .check-status { min-width: 2.5rem; color: var(--muted); font-size: var(--fs-badge); font-weight: 700; text-transform: uppercase; }
        .check-status[data-status='pass'] { color: var(--ok-ink); }
        .check-status[data-status='warn'] { color: var(--warn-ink); }
        .check-status[data-status='skip'] { color: var(--dim); }
        .check-row strong { color: #cbd5e1; font-size: var(--fs-secondary); white-space: nowrap; }
        .check-row small { color: var(--dim); font-size: var(--fs-secondary); }
        .table-wrap, .sources-table-wrap { width: 100%; max-width: 100%; overflow-x: auto; }
        .telemetry-table { width: 100%; border-collapse: collapse; font-size: var(--fs-secondary); }
        .telemetry-table th { padding: var(--space-2); border-bottom: 1px solid var(--line); background: var(--surface-3); color: var(--muted); font-size: var(--fs-badge); font-weight: 500; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
        .telemetry-table td { padding: var(--space-2); border-bottom: 1px solid var(--line); vertical-align: top; }
        .unknowns-box, .sources-box { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px dashed var(--line); min-width: 0; max-width: 100%; }
        .unknowns-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font-size: var(--fs-secondary); color: var(--ink); }
        .unknowns-list { display: grid; gap: var(--space-1); padding: 0; list-style: none; }
        .unknown-row { display: grid; gap: 0.125rem; padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-left: 3px solid var(--dim); border-radius: var(--radius-sm); background: var(--surface-2); }
        .unknown-top { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font-size: var(--fs-secondary); }
        .unknown-area { padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--muted); font-size: var(--fs-badge); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
        .unknown-detail { color: var(--muted); font-size: var(--fs-secondary); }
        .sources-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
        .sources-table col.col-req { width: 16%; }
        .sources-table col.col-where { width: 42%; }
        .sources-table col.col-hash { width: 16%; }
        .sources-table col.col-verified { width: 10%; }
        .sources-table col.col-at { width: 16%; }
        .sources-table code { color: var(--brand); overflow-wrap: anywhere; word-break: break-word; }
        .src-req, .src-where { overflow-wrap: anywhere; word-break: break-word; }
        .src-hash, .src-at { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
        .src-verified { white-space: nowrap; }
    `],
})
export class VerdictPanelComponent {
    readonly verdict = input<TurnVerdictView | null>(null);
    readonly preTurnGate = input<PreTurnGateView | null>(null);
    readonly spec = input<SpecRefView | null>(null);
    readonly writeGate = input<WriteGateView | null>(null);
    readonly jev = input<JevView | null>(null);
    readonly receipt = input<RequestReceiptSummaryDto | null>(null);
    readonly receiptVerification = input<ReceiptVerificationState>('unavailable');
    readonly receiptSources = input<ReceiptEvidenceSourceDto[]>([]);
    readonly explicitUnknowns = input<ExplicitUnknownItem[]>([]);
    readonly checks = input<RequestCheckView[]>([]);
    readonly stages = input<RequestDetailDto['pipeline']>([]);
    readonly actionEvents = input<ActionEventView[]>([]);

    readonly postGaps = computed<UnifiedGapItem[]>(() => toPostTurnGaps(this.verdict()?.gaps ?? []));
    readonly groupedGapCodes = computed<Array<{ code: string; count: number; title: string }>>(() => {
        const gaps = this.verdict()?.gaps ?? [];
        const byCode = new Map<string, { count: number; whats: string[] }>();
        for (const gap of gaps) {
            const code = (gap.code || 'UNKNOWN').trim();
            const entry = byCode.get(code) ?? { count: 0, whats: [] };
            entry.count += 1;
            const what = (gap.what || '').trim();
            if (what && entry.whats.length < 5 && !entry.whats.includes(what)) {
                entry.whats.push(what);
            }
            byCode.set(code, entry);
        }
        return Array.from(byCode.entries()).map(([code, { count, whats }]) => ({
            code,
            count,
            title: whats.length
                ? `${code} (${count}): ${whats.join(' · ')}${count > whats.length ? ' …' : ''}`
                : `${code} (${count})`,
        }));
    });
    readonly specPathCopied = signal(false);

    actorId(actor: VerdictActor | null): string {
        const id = actor && typeof actor['id'] === 'string' ? actor['id'].trim() : '';
        return id || 'unknown actor';
    }

    actorRole(actor: VerdictActor | null): string {
        const role = actor && typeof actor['role'] === 'string' ? actor['role'].trim() : '';
        return role || '';
    }

    relative(value: string): string {
        return relativeTime(value);
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

    shortHash(hash: string | null): string {
        if (!hash || !hash.trim()) return '—';
        const clean = hash.trim();
        return clean.length > 12 ? `${clean.slice(0, 12)}…` : clean;
    }

    formatVerifiedAt(value: string | null | undefined): string {
        if (!value || !value.trim()) return '—';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return this.relative(value);
        return parsed.toISOString().slice(11, 19);
    }

    /** Q6 — the only mapping the page is allowed to make: level ⇒ next action. */
    nextStep(level: VerdictLevel): string {
        return NEXT_STEP[level];
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
            () => this.specPathCopied.set(false),
        );
    }
}
