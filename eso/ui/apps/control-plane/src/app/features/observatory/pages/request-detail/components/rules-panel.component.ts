import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RequestDetailWithVerdict } from '../request-detail.models.js';

/** Rules & context — recon layer, worker context, routing and the raw envelope. */
@Component({
    selector: 'eso-rules-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="panel rules-panel">
            <header class="panel-head"><div><p class="eyebrow">Context</p><h2>Worker context &amp; routing</h2></div><span class="badge muted font-mono">read-only</span></header>
            <div class="recon-section">
                <div class="recon-header">
                    <h3>Recon from consumer config</h3>
                    <span class="badge muted font-mono">{{ detail().recon.length }} adapter(s)</span>
                </div>
                <div class="recon-grid">
                    @for (adapter of detail().recon; track adapter.id) {
                        <div class="recon-card">
                            <div class="recon-card-top">
                                <strong>{{ adapter.label }}</strong>
                                <span class="badge" [class.ok]="adapter.status === 'ok' || adapter.status === 'READY'" [class.muted]="adapter.status !== 'ok' && adapter.status !== 'READY'">{{ adapter.status }}</span>
                            </div>
                            <div class="recon-card-body">
                                <code class="adapter-id font-mono">{{ adapter.id }}</code>
                                <span class="source-tag">src: {{ adapter.source }}</span>
                            </div>
                            <div class="recon-card-bottom">
                                <span class="req-pill font-mono">{{ adapter.required ? 'required' : 'optional' }}</span>
                                <span class="recon-calls font-mono tabular-nums"><strong>{{ adapter.calls }}</strong> call(s)</span>
                            </div>
                        </div>
                    } @empty {
                        <p class="hint">Consumer config declares no recon layer.</p>
                    }
                </div>
            </div>
            <div class="context-grid">
                <div class="context-card">
                    <header class="context-head"><h3>Worker context</h3></header>
                    <dl class="facts-grid">
                        <dt>Worker</dt><dd><code>{{ contextValue('workerId') }}</code></dd>
                        <dt>Role</dt><dd>{{ contextValue('role') }}</dd>
                        <dt>Layer</dt><dd>{{ contextValue('layer') }}</dd>
                        <dt>Scope</dt><dd>{{ contextValue('scope') }}</dd>
                        <dt>Capabilities</dt><dd>{{ contextList('capabilities') }}</dd>
                        <dt>Verbs</dt><dd>{{ contextList('verbs') }}</dd>
                        <dt>Quality bar</dt><dd>{{ contextList('qualityBar') }}</dd>
                        <dt>Escalation</dt><dd>{{ contextValue('escalation') }}</dd>
                    </dl>
                    <details class="code-drawer"><summary><span class="drawer-tag font-mono">TXT</span> Worker instructions</summary><pre class="raw font-mono">{{ contextValue('instructions') }}</pre></details>
                </div>
                <div class="context-card">
                    <header class="context-head"><h3>Routing</h3></header>
                    <dl class="facts-grid">
                        <dt>Adapter</dt><dd>{{ routingValue('adapter') }}</dd>
                        <dt>Model</dt><dd><code>{{ routingValue('model') }}</code></dd>
                        <dt>Model source</dt><dd>{{ routingValue('modelSource') }}</dd>
                        <dt>Tier</dt><dd>{{ routingValue('tier') }}</dd>
                        <dt>Effort</dt><dd>{{ routingValue('effort') }}</dd>
                        <dt>Task type</dt><dd>{{ routingValue('taskType') }}</dd>
                    </dl>
                    <details class="code-drawer"><summary><span class="drawer-tag font-mono">JSON</span> Event envelope · prompt.submitted</summary><pre class="raw font-mono">{{ envelope() }}</pre></details>
                </div>
            </div>
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --ok-ink: #34d399; --warn-ink: #fbbf24; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        h2, h3, p, dl, dd, dt, ul, li { margin: 0; }
        h2 { font-size: var(--fs-title); font-weight: 650; color: #f1f5f9; }
        h3 { font-size: var(--fs-body); font-weight: 600; color: #e2e8f0; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hint, .muted { color: var(--muted); font-size: var(--fs-secondary); }
        .panel { display: grid; align-content: start; gap: var(--space-3); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid #fbbf24; border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .badge.muted { color: var(--muted); }
        .badge.ok { color: #a7f3d0; border-color: rgba(52,211,153,.3); background: rgba(52,211,153,.1); }
        .recon-section { display: grid; gap: var(--space-2); }
        .recon-header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
        .recon-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--space-2); }
        .recon-card { display: grid; gap: var(--space-1); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-left: 3px solid #fbbf24; border-radius: var(--radius-sm); background: var(--surface-2); box-shadow: 0 1px 2px rgba(0,0,0,.15); }
        .recon-card-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
        .recon-card-top strong { color: #e2e8f0; font-size: var(--fs-secondary); font-weight: 600; }
        .recon-card-body { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
        .adapter-id { color: var(--brand); font-size: var(--fs-badge); }
        .source-tag { color: var(--dim); font-size: var(--fs-badge); }
        .recon-card-bottom { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding-top: var(--space-1); border-top: 1px solid var(--line-soft); }
        .req-pill { padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--muted); font-size: var(--fs-badge); }
        .recon-calls { color: var(--muted); font-size: var(--fs-badge); }
        .recon-calls strong { color: var(--ok-ink); }
        .context-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
        .context-card { display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); }
        .context-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); padding-bottom: var(--space-1); border-bottom: 1px solid var(--line-soft); }
        .facts-grid { display: grid; grid-template-columns: 6.875rem minmax(0, 1fr); gap: .1875rem var(--space-3); font-size: var(--fs-secondary); }
        .facts-grid dt { color: var(--muted); }
        .facts-grid dd { min-width: 0; color: var(--ink); overflow-wrap: anywhere; }
        .facts-grid dd code { color: var(--brand); font-size: var(--fs-secondary); }
        .code-drawer { margin-top: var(--space-2); }
        .code-drawer summary { color: var(--muted); font-size: var(--fs-secondary); cursor: pointer; user-select: none; }
        .code-drawer summary:hover { color: var(--ink); }
        .drawer-tag { display: inline-block; padding: 0 var(--space-1); margin-right: var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--brand); font-size: var(--fs-badge); font-weight: 600; }
        pre { max-height: 18rem; overflow: auto; margin: var(--space-1) 0 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: #cbd5e1; font-size: var(--fs-secondary); line-height: var(--lh); white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .raw { margin: 0; }
        @media (max-width: 47.9375rem) { .context-grid { grid-template-columns: minmax(0, 1fr); } }
    `],
})
export class RulesPanelComponent {
    readonly detail = input.required<RequestDetailWithVerdict>();

    readonly envelope = computed(() => {
        const request = this.detail().request;
        return JSON.stringify({
            event_id: request.id,
            trace_id: request.traceId,
            span_id: `${request.traceId}:${request.workerId || 'unknown'}:1`,
            parent_span_id: null,
            worker_id: request.workerId,
            host_binding_id: request.runtimeKey,
            type: 'prompt.submitted',
            at: request.startedAt,
            decision: 'not recorded',
            payload: {
                userQuery: request.userQuery,
                requestHash: request.promptHash,
                requestLength: request.promptLength,
                taskType: request.taskType,
                flowId: request.flowId,
                model: request.model,
                adapter: request.adapter,
            },
        }, null, 2);
    });

    contextValue(key: string): string {
        const value = this.detail().context[key];
        return value === undefined || value === null || value === '' ? '—' : String(value);
    }

    contextList(key: string): string {
        const value = this.detail().context[key];
        return Array.isArray(value) ? value.map(String).join(', ') || 'none' : this.contextValue(key);
    }

    routingValue(key: string): string {
        const value = this.detail().routing[key];
        return value === undefined || value === null || value === '' ? '—' : String(value);
    }
}
