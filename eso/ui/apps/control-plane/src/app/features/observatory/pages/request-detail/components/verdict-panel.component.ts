import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import {
    NEXT_STEP,
    relativeTime,
    type ActionEventView,
    type JevView,
    type ReceiptVerificationState,
    type RequestCheckView,
    type RequestDetailDto,
    type RequestReceiptSummaryDto,
    type SpecRefView,
    type TurnVerdictView,
    type VerdictActor,
    type VerdictLevel,
    type VerdictRuleRef,
    type WriteGateView,
} from '../request-detail.models.js';

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
        </div>
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --warn-ink: #e0b341; --ok-ink: #4ec97a; --danger-ink: #ff6b6b; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        .verdict-panel { display: grid; gap: var(--space-4); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        h2, h3, p, dl, dd, dt, ul, li { margin: 0; }
        h2 { font-size: var(--fs-title); font-weight: 650; color: #f1f5f9; }
        h3 { display: flex; align-items: baseline; gap: var(--space-2); font-size: var(--fs-title); font-weight: 600; color: #e2e8f0; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hint, .muted { color: var(--muted); font-size: var(--fs-secondary); }
        .panel { display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .badge { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); line-height: 1.2; white-space: nowrap; }
        .badge.ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); }
        .badge.bad { color: #fecaca; border-color: rgba(255,107,107,.4); }
        .badge.muted { color: var(--muted); }
        .verdict-block { display: grid; gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line); }
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
        .rule-refs, .gap-list, .action-list, .next-codes { display: grid; gap: var(--space-1); padding: 0; list-style: none; }
        .rule-ref { padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .rule-ref code { color: var(--brand); }
        .verdict-score-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); color: var(--muted); font-size: var(--fs-secondary); }
        .verdict-score-line strong { color: var(--ink); font-size: var(--fs-title); font-variant-numeric: tabular-nums; }
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
        .next-codes { grid-auto-flow: column; justify-content: start; }
        .next-codes li { padding: 0 var(--space-2); border: 1px solid rgba(224,179,65,.4); border-radius: var(--radius-sm); background: rgba(224,179,65,.1); color: var(--warn-ink); font-size: var(--fs-badge); }
        .jev-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-3); color: #cbd5e1; font-size: var(--fs-body); overflow-wrap: anywhere; }
        .jev-summary { color: var(--ink); }
        .jev-mismatch { padding: 0 var(--space-2); border: 1px solid rgba(224,179,65,.45); border-radius: var(--radius-sm); background: rgba(224,179,65,.12); color: var(--warn-ink); font-size: var(--fs-secondary); }
        .checks { display: grid; gap: var(--space-1); }
        .check-row { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); }
        .check-status { min-width: 2.5rem; color: var(--muted); font-size: var(--fs-badge); font-weight: 700; text-transform: uppercase; }
        .check-status[data-status='pass'] { color: var(--ok-ink); }
        .check-status[data-status='warn'] { color: var(--warn-ink); }
        .check-status[data-status='skip'] { color: var(--dim); }
        .check-row strong { color: #cbd5e1; font-size: var(--fs-secondary); white-space: nowrap; }
        .check-row small { color: var(--dim); font-size: var(--fs-secondary); }
        .table-wrap { width: 100%; overflow-x: auto; }
        .telemetry-table { width: 100%; border-collapse: collapse; font-size: var(--fs-secondary); }
        .telemetry-table th { padding: var(--space-2); border-bottom: 1px solid var(--line); background: var(--surface-3); color: var(--muted); font-size: var(--fs-badge); font-weight: 500; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
        .telemetry-table td { padding: var(--space-2); border-bottom: 1px solid var(--line); }
    `],
})
export class VerdictPanelComponent {
    readonly verdict = input<TurnVerdictView | null>(null);
    readonly spec = input<SpecRefView | null>(null);
    readonly writeGate = input<WriteGateView | null>(null);
    readonly jev = input<JevView | null>(null);
    readonly receipt = input<RequestReceiptSummaryDto | null>(null);
    readonly receiptVerification = input<ReceiptVerificationState>('unavailable');
    readonly checks = input<RequestCheckView[]>([]);
    readonly stages = input<RequestDetailDto['pipeline']>([]);
    readonly actionEvents = input<ActionEventView[]>([]);

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
