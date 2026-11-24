import { ChangeDetectionStrategy, Component, input } from '@angular/core';
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
    type VerdictActor,
    type WriteGateView,
} from '../request-detail.models.js';

/** The four at-a-glance cards: verdict, effectiveness (+ host signals), write gate, cost. */
@Component({
    selector: 'eso-glance-cards',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
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
                    <div><span>Input</span><strong>{{ tokens().input ?? '—' }}</strong><small>{{ tokens().estimated ? 'estimated · chars/4' : 'not captured' }}</small></div>
                    <div><span>Output</span><strong>{{ tokens().output ?? '—' }}</strong><small>{{ tokens().estimated ? 'estimated · chars/4' : 'not captured' }}</small></div>
                    <div><span title="LLM calls">Calls</span><strong>{{ llmCallCount() }}</strong><small>worker steps</small></div>
                    <div><span>Tools</span><strong>{{ toolCount() }}</strong><small>{{ fileCount() }} files</small></div>
                </div>
                <p class="hint">Estimated chars/4 · not provider-reported.</p>
            </section>
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --warn-ink: #e0b341; --ok-ink: #4ec97a; --danger-ink: #ff6b6b; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        h2, p, dl, dd, dt { margin: 0; }
        h2 { font-size: var(--fs-title); line-height: var(--lh); font-weight: 650; color: #f1f5f9; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hint, .muted { color: var(--muted); font-size: var(--fs-secondary); }
        .glance-grid { display: grid; grid-template-columns: minmax(0, .95fr) minmax(0, 1.9fr) minmax(0, 1fr) minmax(0, .95fr); gap: var(--space-3); align-items: start; }
        .glance-grid > * { min-width: 0; }
        .panel { display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-accent, var(--brand)); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .card-head-main { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .card-head-main h2 { margin: 0; }
        .icon-chip { display: grid; place-items: center; flex: 0 0 auto; width: 1.5rem; height: 1.5rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--brand); font-size: var(--fs-secondary); line-height: 1; }
        .effectiveness-chip { border-color: rgba(90,169,255,.35); color: var(--brand); }
        .signals-chip { border-color: rgba(192,132,252,.35); color: #c084fc; }
        .gate-chip { border-color: rgba(224,179,65,.4); color: var(--warn-ink); }
        .tokens-chip { border-color: rgba(224,179,65,.35); color: var(--warn-ink); }
        .badge { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); line-height: 1.2; font-weight: 500; white-space: nowrap; }
        .badge.muted { color: var(--muted); background: var(--surface-2); }
        .verdict-hero { --card-accent: #64748b; display: grid; align-content: start; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-accent); border-radius: var(--radius-md); background: var(--surface); min-width: 0; font-size: var(--text-sm); box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); line-height: var(--lh); }
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
        .verdict-basis { color: #cbd5e1; font-size: var(--fs-secondary); line-height: var(--lh); overflow-wrap: anywhere; }
        .verdict-level-badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid currentColor; border-radius: var(--radius-sm); font-size: var(--fs-badge); font-weight: 700; letter-spacing: .06em; line-height: 1.2; text-transform: uppercase; white-space: nowrap; }
        .level-allow { color: var(--ok-ink); background: rgba(78,201,122,.12); }
        .level-partial { color: var(--warn-ink); background: rgba(224,179,65,.12); }
        .level-deny { color: var(--danger-ink); background: rgba(255,107,107,.12); }
        .level-unknown { color: var(--muted); background: rgba(139,151,171,.12); }
        .effectiveness { --card-accent: var(--brand); display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--card-accent); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
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
        .status-dot { display: inline-block; width: .4375rem; height: .4375rem; border-radius: 50%; background: currentColor; }
        @media (max-width: 74.9375rem) { .glance-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .signal-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 62.5rem) { .top-grid { grid-template-columns: 1fr; } }
        @media (max-width: 47.9375rem) { .glance-grid { grid-template-columns: minmax(0, 1fr); } }
    `],
})
export class GlanceCardsComponent {
    readonly verdict = input<TurnVerdictView | null>(null);
    readonly effectiveness = input<EffectivenessView | null>(null);
    readonly signals = input<HostSignalsView | null>(null);
    readonly writeGate = input<WriteGateView | null>(null);
    readonly tokens = input<TokenSummaryView>({ input: null, output: null, estimated: false });
    readonly llmCallCount = input<number>(0);
    readonly toolCount = input<number>(0);
    readonly fileCount = input<number>(0);

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

    gateLabel(): string {
        const gate = this.writeGate();
        return gate ? (gate.allowed ? 'allowed' : 'blocked') : 'not recorded';
    }

    writeGateActor(actor: Record<string, unknown> | null): string {
        return writeGateActorOf(actor);
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

    /** P6c — calls per adapter, exactly as reported; no calls reported ⇒ "not captured". */
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
