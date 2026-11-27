import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
    OBSERVED_WORKER_EVENTS,
    formatAt as formatDateAt,
    workerLabel as labelForWorker,
    type ConfiguredGraphStep,
    type DivergenceKind,
    type ObservedGraphStep,
    type RequestDetailWithVerdict,
    type RuntimeDivergence,
} from '../request-detail.models.js';

/** Graphs & topology — configured order vs observed order, with a named divergence. */
@Component({
    selector: 'eso-graph-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="panel graph-panel">
            <header class="panel-head"><div><p class="eyebrow">Trace flow</p><h2>Worker handoff</h2></div><span class="muted">{{ eventCount() }} events</span></header>
            <div class="flow-chain">
                <div class="flow-node prompt"><strong>Prompt</strong><small>{{ workerId() || '—' }}</small></div>
                @for (stage of detail().pipeline; track stage.workerId) {
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
                            <span class="runtime-name"><strong>{{ step.label }}</strong><small><span class="role-chip">{{ workerRole(step.workerId) }}</span> · <code>{{ step.workerId }}</code></small></span>
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
                            <span class="runtime-name"><strong>{{ worker.label }}</strong><small><span class="role-chip">{{ workerRole(worker.workerId) }}</span> · {{ worker.event }} · {{ formatAt(worker.at) }}</small></span>
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
                <div class="divergence-tone-cards">
                    <div class="tone-card" [class.active-tone]="divergence().kind === 'matches'"><span class="tone-dot ok"></span><span class="tone-label">Matches</span><strong class="font-mono">{{ divergence().kind === 'matches' ? 'YES' : '—' }}</strong></div>
                    <div class="tone-card" [class.active-tone]="divergence().missing.length > 0"><span class="tone-dot warn"></span><span class="tone-label">Missing</span><strong class="font-mono">{{ divergence().missing.length }}</strong></div>
                    <div class="tone-card" [class.active-tone]="divergence().extra.length > 0"><span class="tone-dot bad"></span><span class="tone-label">Extra</span><strong class="font-mono">{{ divergence().extra.length }}</strong></div>
                    <div class="tone-card" [class.active-tone]="divergence().kind === 'reordered'"><span class="tone-dot info"></span><span class="tone-label">Reordered</span><strong class="font-mono">{{ divergence().kind === 'reordered' ? 'YES' : '—' }}</strong></div>
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
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --warn-ink: #e0b341; --ok-ink: #4ec97a; --danger-ink: #ff6b6b; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        h2, h3, p { margin: 0; }
        h2 { font-size: var(--fs-title); font-weight: 650; color: #f1f5f9; }
        h3 { font-size: var(--fs-secondary); font-weight: 600; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hint, .muted { color: var(--muted); font-size: var(--fs-secondary); }
        .panel { display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .flow-chain { display: flex; align-items: center; gap: var(--space-2); padding-bottom: var(--space-1); overflow-x: auto; }
        .flow-node { display: grid; gap: var(--space-1); min-width: 5.625rem; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
        .flow-node strong { font-size: var(--fs-secondary); }
        .flow-node small { color: var(--muted); font-size: var(--fs-badge); }
        .flow-node.ok { border-color: var(--ok-ink); }
        .flow-node.bad { border-color: var(--warn-ink); }
        .flow-node.prompt { border-color: var(--brand); }
        .flow-arrow { color: var(--muted); font-size: var(--fs-secondary); }
        .runtime-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
        .runtime-column { display: grid; align-content: start; gap: var(--space-2); min-width: 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-2); box-shadow: 0 1px 2px rgba(0,0,0,.2); }
        .runtime-column-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-soft); }
        .runtime-column-head h3 { margin: 0; font-size: var(--fs-secondary); }
        .runtime-column-head small { color: var(--muted); font-size: var(--fs-badge); }
        .runtime-row { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); padding: var(--space-1) 0; border-bottom: 1px solid var(--line-soft); }
        .runtime-row:last-child { border-bottom: 0; }
        .runtime-no { width: 1.5rem; height: 1.5rem; display: inline-grid; place-items: center; border-radius: var(--radius-sm); background: var(--surface-3); border: 1px solid var(--line-soft); color: var(--muted); font-size: var(--fs-badge); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
        .runtime-name { display: grid; gap: 0; min-width: 0; }
        .runtime-name strong { color: var(--ink); font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .runtime-name small { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; color: var(--muted); font-size: var(--fs-badge); overflow-wrap: anywhere; }
        .role-chip { display: inline-block; padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--brand); font-size: var(--fs-badge); }
        .badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
        .badge.ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); }
        .badge.warn { color: #fde68a; border-color: rgba(224,179,65,.45); }
        .badge.bad { color: #fecaca; border-color: rgba(255,107,107,.4); }
        .badge.muted { color: var(--muted); }
        .badge.info { color: #bae6fd; border-color: rgba(90,169,255,.4); }
        .runtime-divergence { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface-2); box-shadow: 0 1px 2px rgba(0,0,0,.2); }
        .runtime-divergence[data-kind='missing'] { border-left-color: var(--warn-ink); }
        .runtime-divergence[data-kind='extra'] { border-left-color: var(--danger-ink); }
        .runtime-divergence[data-kind='matches'] { border-left-color: var(--ok-ink); }
        .divergence-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        .divergence-tone-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); margin: var(--space-1) 0; }
        .tone-card { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-3); font-size: var(--fs-badge); }
        .tone-card.active-tone { border-color: var(--line); background: rgba(255,255,255,.04); }
        .tone-dot { width: .5rem; height: .5rem; border-radius: 62.44rem; }
        .tone-dot.ok { background: var(--ok-ink); }
        .tone-dot.warn { background: var(--warn-ink); }
        .tone-dot.bad { background: var(--danger-ink); }
        .tone-dot.info { background: var(--brand); }
        .tone-label { color: var(--muted); }
        .tone-card strong { margin-left: auto; color: var(--ink); font-variant-numeric: tabular-nums; }
        .divergence-line { color: #cbd5e1; font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .divergence-key { color: var(--warn-ink); font-weight: 700; }
        .divergence-line.extra .divergence-key { color: var(--danger-ink); }
        @media (max-width: 62.5rem) { .runtime-compare { grid-template-columns: 1fr; } .divergence-tone-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    `],
})
export class GraphPanelComponent {
    readonly detail = input.required<RequestDetailWithVerdict>();

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
            path.push({ workerId, label: labelForWorker(workerId), outcome: event.outcome || '—', event: event.event, at: event.at });
        }
        return path;
    });

    /** B0-10 — set + order comparison; `missing`/`extra` are named, `matches` needs identical order. */
    readonly divergence = computed<RuntimeDivergence>(() => {
        const configured = this.configuredGraph().map((step) => step.workerId);
        const observed = this.observedGraph().map((step) => step.workerId);
        if (!configured.length && !observed.length) return { kind: 'empty', missing: [], extra: [], configuredCount: 0, observedCount: 0 };
        const configuredSet = new Set(configured);
        const observedSet = new Set(observed);
        const missing = configured.filter((workerId) => !observedSet.has(workerId));
        const extra = observed.filter((workerId) => !configuredSet.has(workerId));
        const orderMatches = !missing.length && !extra.length && configured.length === observed.length && configured.every((workerId, index) => workerId === observed[index]);
        const kind: DivergenceKind = missing.length ? 'missing' : extra.length ? 'extra' : orderMatches ? 'matches' : 'reordered';
        return { kind, missing, extra, configuredCount: configured.length, observedCount: observed.length };
    });

    readonly eventCount = computed(() => this.detail().events.length);
    readonly workerId = computed(() => this.detail().request.workerId);

    formatAt(value: string): string {
        return formatDateAt(value);
    }

    workerLabel(id: string | null | undefined): string {
        return labelForWorker(id);
    }

    workerRole(workerId: string | null | undefined): string {
        if (!workerId) return 'Worker';
        const stage = this.detail().pipeline.find((s) => s.workerId === workerId);
        return stage?.role || stage?.label || this.workerLabel(workerId);
    }
}
