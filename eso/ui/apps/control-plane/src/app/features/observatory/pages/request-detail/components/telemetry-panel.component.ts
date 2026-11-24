import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { workerLabel as labelForWorker, type RequestDetailDto, type TokenSummaryView } from '../request-detail.models.js';

/** Telemetry & trace — the LLM call table and the raw-envelope affordance. */
@Component({
    selector: 'eso-telemetry-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="panel telemetry-panel">
            <header class="panel-head"><div><p class="eyebrow">Telemetry</p><h2>LLM calls / tools / files</h2></div><span class="badge muted">observed</span></header>
            <div class="token-tiles">
                <div><span>Input est.</span><strong>{{ tokens().input ?? '—' }}</strong><small>chars/4</small></div>
                <div><span>Output est.</span><strong>{{ tokens().output ?? '—' }}</strong><small>chars/4</small></div>
                <div><span>Tools</span><strong>{{ toolCount() }}</strong><small>observed</small></div>
                <div><span>Files</span><strong>{{ fileCount() }}</strong><small>observed</small></div>
            </div>
            <div class="table-wrap"><table class="telemetry-table">
                <thead><tr><th>#</th><th>Worker</th><th>Model</th><th>Adapter</th><th>Duration</th><th>In est.</th><th>Out est.</th><th>Outcome</th></tr></thead>
                <tbody>
                    @for (call of calls(); track call.id) {
                        <tr><td>{{ $index + 1 }}</td><td>{{ workerLabel(call.workerId) }}</td><td>{{ call.model }}</td><td>{{ call.adapter }}</td><td>{{ call.durationMs ? call.durationMs + ' ms' : '—' }}</td><td>{{ call.inputTokens ?? '—' }}</td><td>{{ call.outputTokens ?? '—' }}</td><td>{{ call.outcome }}</td></tr>
                    }
                </tbody>
            </table></div>
            <p class="hint">Tool/file extraction is not available in the adapter yet; cards show 0 instead of inventing data.</p>
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --warn-ink: #e0b341; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        h2, p { margin: 0; }
        h2 { font-size: var(--fs-title); font-weight: 650; color: #f1f5f9; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hint, .muted { color: var(--muted); font-size: var(--fs-secondary); }
        .panel { display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); white-space: nowrap; }
        .badge.muted { color: var(--muted); }
        .token-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-1) var(--space-2); }
        .token-tiles div { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: var(--space-1); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); }
        .token-tiles span { grid-column: 1; color: var(--dim); font-size: var(--fs-badge); letter-spacing: .04em; text-transform: uppercase; }
        .token-tiles strong { grid-column: 2; color: var(--warn-ink); font-size: var(--fs-body); font-variant-numeric: tabular-nums; line-height: 1.2; text-align: right; }
        .token-tiles small { grid-column: 1 / -1; color: var(--dim); font-size: var(--fs-badge); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .table-wrap { width: 100%; overflow-x: auto; }
        .telemetry-table { width: 100%; border-collapse: collapse; font-size: var(--fs-secondary); }
        .telemetry-table th { padding: var(--space-2); border-bottom: 1px solid var(--line); background: var(--surface-3); color: var(--muted); font-size: var(--fs-badge); font-weight: 500; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
        .telemetry-table td { padding: var(--space-2); border-bottom: 1px solid var(--line); }
        @media (max-width: 47.9375rem) { .token-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    `],
})
export class TelemetryPanelComponent {
    readonly calls = input<RequestDetailDto['telemetry']['llmCalls']>([]);
    readonly tokens = input<TokenSummaryView>({ input: null, output: null, estimated: false });
    readonly toolCount = input<number>(0);
    readonly fileCount = input<number>(0);

    workerLabel(id: string | null | undefined): string {
        return labelForWorker(id);
    }
}
