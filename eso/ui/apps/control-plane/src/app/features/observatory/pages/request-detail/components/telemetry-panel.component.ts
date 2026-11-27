import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { workerLabel as labelForWorker, type RequestDetailDto, type TokenSummaryView } from '../request-detail.models.js';

/** Telemetry & trace — the LLM call table, token ratio bar, and hook ingest ledger. */
@Component({
    selector: 'eso-telemetry-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="panel telemetry-panel">
            <header class="panel-head"><div><p class="eyebrow">Telemetry</p><h2>LLM calls / tools / files</h2></div><span class="badge muted font-mono">observed</span></header>
            <div class="token-tiles">
                <div><span>{{ tokens().estimated ? 'Input est.' : 'Input' }}</span><strong>{{ tokens().input ?? '—' }}</strong><small>{{ tokens().estimated ? 'chars/4' : 'reported' }}</small></div>
                <div><span>{{ tokens().estimated ? 'Output est.' : 'Output' }}</span><strong>{{ tokens().output ?? '—' }}</strong><small>{{ tokens().estimated ? 'chars/4' : 'reported' }}</small></div>
                <div><span>Tools</span><strong>{{ toolCount() }}</strong><small>observed</small></div>
                <div><span>Files</span><strong>{{ fileCount() }}</strong><small>observed</small></div>
            </div>

            <div class="ratio-container" aria-label="Token ratio bar">
                <div class="ratio-head">
                    <span class="ratio-label font-mono"><strong class="in-accent">{{ inputPct() }}%</strong> In ({{ tokens().input ?? 0 }})</span>
                    <span class="ratio-title">Token Distribution Ratio</span>
                    <span class="ratio-label font-mono"><strong class="out-accent">{{ outputPct() }}%</strong> Out ({{ tokens().output ?? 0 }})</span>
                </div>
                <div class="ratio-track" role="progressbar" [attr.aria-valuenow]="inputPct()" aria-valuemin="0" aria-valuemax="100">
                    <span class="ratio-bar in-bar" [style.width.%]="inputPct()"></span>
                    <span class="ratio-bar out-bar" [style.width.%]="outputPct()"></span>
                </div>
            </div>

            <div class="section-block">
                <header class="sub-head">
                    <h3>LLM calls ({{ calls().length }})</h3>
                    <span class="badge muted font-mono">{{ calls().length }} call(s)</span>
                </header>
                <div class="table-wrap"><table class="telemetry-table">
                    <thead><tr><th>#</th><th>Worker</th><th>Model</th><th>Adapter</th><th>Duration</th><th>In</th><th>Out</th><th>Outcome</th></tr></thead>
                    <tbody>
                        @for (call of calls(); track call.id) {
                            <tr><td>{{ $index + 1 }}</td><td>{{ workerLabel(call.workerId) }}</td><td class="font-mono">{{ call.model }}</td><td>{{ call.adapter }}</td><td class="font-mono tabular-nums">{{ call.durationMs ? call.durationMs + ' ms' : '—' }}</td><td class="font-mono tabular-nums">{{ call.inputTokens ?? '—' }}</td><td class="font-mono tabular-nums">{{ call.outputTokens ?? '—' }}</td><td><span class="badge font-mono" [class.ok]="call.outcome === 'PASS' || call.outcome === 'COMPLETED'" [class.bad]="call.outcome === 'FAIL' || call.outcome === 'BLOCKED'">{{ call.outcome }}</span></td></tr>
                        } @empty {
                            <tr><td colspan="8" class="hint">No LLM calls recorded for this request.</td></tr>
                        }
                    </tbody>
                </table></div>
            </div>

            <div class="section-block ingest-block">
                <header class="sub-head">
                    <h3>Hook ingest events &amp; trace ledger</h3>
                    <span class="badge muted font-mono">{{ events().length }} event(s)</span>
                </header>
                <div class="table-wrap">
                    <table class="telemetry-table ingest-table">
                        <thead><tr><th>Time</th><th>Worker</th><th>Event</th><th>Outcome</th><th>Runtime Key</th></tr></thead>
                        <tbody>
                            @for (evt of events(); track evt.observationId || $index) {
                                <tr>
                                    <td class="font-mono tabular-nums">{{ formatClock(evt.at) }}</td>
                                    <td>{{ workerLabel(evt.workerId) }}</td>
                                    <td><code class="font-mono">{{ evt.event }}</code></td>
                                    <td><span class="badge font-mono" [class.ok]="evt.outcome === 'PASS' || evt.outcome === 'COMPLETED'" [class.bad]="evt.outcome === 'FAIL' || evt.outcome === 'BLOCKED'">{{ evt.outcome || '—' }}</span></td>
                                    <td class="font-mono text-dim">{{ evt.runtimeKey || '—' }}</td>
                                </tr>
                            } @empty {
                                <tr><td colspan="5" class="hint">No ingest events recorded for this request.</td></tr>
                            }
                        </tbody>
                    </table>
                </div>
            </div>

            <p class="hint">Tool/file extraction is not available in the adapter yet; cards show 0 instead of inventing data.</p>
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #818cf8; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --ok-ink: #34d399; --warn-ink: #fbbf24; --danger-ink: #f87171; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        h2, h3, p { margin: 0; }
        h2 { font-size: var(--fs-title); font-weight: 650; color: #f1f5f9; }
        h3 { font-size: var(--fs-secondary); font-weight: 600; color: #e2e8f0; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hint, .muted { color: var(--muted); font-size: var(--fs-secondary); }
        .text-dim { color: var(--dim); }
        .panel { display: grid; align-content: start; gap: var(--space-3); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .sub-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-1); }
        .section-block { display: grid; gap: var(--space-1); }
        .badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .badge.muted { color: var(--muted); }
        .badge.ok { color: #a7f3d0; border-color: rgba(52,211,153,.3); background: rgba(52,211,153,.1); }
        .badge.bad { color: #fecaca; border-color: rgba(248,113,113,.4); background: rgba(248,113,113,.1); }
        .token-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-1) var(--space-2); }
        .token-tiles div { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: var(--space-1); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); }
        .token-tiles span { grid-column: 1; color: var(--dim); font-size: var(--fs-badge); letter-spacing: .04em; text-transform: uppercase; }
        .token-tiles strong { grid-column: 2; color: var(--warn-ink); font-size: var(--fs-body); font-variant-numeric: tabular-nums; line-height: 1.2; text-align: right; }
        .token-tiles small { grid-column: 1 / -1; color: var(--dim); font-size: var(--fs-badge); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ratio-container { display: grid; gap: var(--space-1); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); }
        .ratio-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--fs-badge); }
        .ratio-title { color: var(--dim); letter-spacing: .05em; text-transform: uppercase; font-weight: 600; }
        .ratio-label { color: var(--muted); font-variant-numeric: tabular-nums; }
        .in-accent { color: #38bdf8; }
        .out-accent { color: #c084fc; }
        .ratio-track { display: flex; width: 100%; height: .375rem; border-radius: 62.44rem; overflow: hidden; background: #0a0e17; }
        .ratio-bar { height: 100%; transition: width .3s ease; }
        .in-bar { background: #38bdf8; }
        .out-bar { background: #c084fc; }
        .table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--line-soft); border-radius: var(--radius-sm); }
        .telemetry-table { width: 100%; border-collapse: collapse; font-size: var(--fs-secondary); }
        .telemetry-table th { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); background: var(--surface-3); color: var(--muted); font-size: var(--fs-badge); font-weight: 500; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
        .telemetry-table td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line-soft); }
        .telemetry-table tr:last-child td { border-bottom: 0; }
        .telemetry-table code { color: var(--brand); font-size: var(--fs-badge); }
        @media (max-width: 47.9375rem) { .token-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    `],
})
export class TelemetryPanelComponent {
    readonly calls = input<RequestDetailDto['telemetry']['llmCalls']>([]);
    readonly tokens = input<TokenSummaryView>({ input: null, output: null, cacheRead: null, estimated: false });
    readonly toolCount = input<number>(0);
    readonly fileCount = input<number>(0);
    readonly events = input<RequestDetailDto['events']>([]);

    readonly totalTokens = computed(() => {
        const inTok = this.tokens().input ?? 0;
        const outTok = this.tokens().output ?? 0;
        return inTok + outTok;
    });

    readonly inputPct = computed(() => {
        const total = this.totalTokens();
        if (total <= 0) return 50;
        return Math.max(1, Math.min(99, Math.round(((this.tokens().input ?? 0) / total) * 100)));
    });

    readonly outputPct = computed(() => 100 - this.inputPct());

    workerLabel(id: string | null | undefined): string {
        return labelForWorker(id);
    }

    formatClock(value: string | null | undefined): string {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    }
}
