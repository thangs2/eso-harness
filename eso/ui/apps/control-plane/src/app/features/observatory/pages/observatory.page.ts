import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CONTROL_PLANE_API_CLIENT } from '../../../core/tokens.js';
import { RequestGridComponent } from '../components/request-grid.component.js';
import { Office2d5dComponent, type OfficeWorker } from '../components/office-2d5d.component.js';
import { WorkersFlowComponent } from '../components/workers-flow.component.js';
import type { ConsumerSummary, FlowDefinitionDto, ObservationDto } from '../../../../../../../libs/api-client/types.js';

interface GraphNode {
    id: string;
    kind?: 'lead' | 'worker' | 'conditional';
    x: number;
    y: number;
    label: string;
    events: number;
    failures: number;
    selected: boolean;
}
interface GraphEdge {
    id: string;
    from: string;
    to: string;
    d: string;
    count: number;
}
interface TraceSummary {
    traceId: string;
    events: number;
    workers: number;
    prompts: number;
    outcome: string;
    lastAt: string;
}

@Component({
    selector: 'eso-observatory-page',
    standalone: true,
    imports: [MatButtonModule, MatFormFieldModule, MatSelectModule, RouterLink, RequestGridComponent, Office2d5dComponent, WorkersFlowComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="observatory-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Operate · observatory</p>
                    <h1>Observatory</h1>
                    <p class="subtitle">Live surface for a consumer: worker graph, traces, requests, and failures. Select a node or trace to drill in.</p>
                </div>
                <div class="header-actions">
                    <a mat-flat-button color="primary" [routerLink]="['/events']" [queryParams]="{ consumer: consumerId() }">Live event stream</a>
                    <a mat-stroked-button [routerLink]="['/office']" [queryParams]="{ consumer: consumerId() }">3D graph</a>
                    <button mat-stroked-button type="button" [disabled]="loading()" (click)="load()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button>
                </div>
            </header>

            <section class="context-bar">
                <header class="context-head">
                    <div><p class="eyebrow">Consumer context</p><p class="context-hint">Config snapshot currently used by the host for this consumer.</p></div>
                    <span class="context-readonly">read-only config</span>
                </header>
                <div class="context-grid">
                    <div class="context-field consumer-field">
                        <span class="field-label">Consumer</span>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic" density="-4" class="consumer-select">
                            <mat-select [value]="consumerId()" (selectionChange)="selectConsumer($event.value)" aria-label="Consumer" panelClass="eso-select-panel">
                                @for (consumer of consumers(); track consumer.id) {
                                    <mat-option [value]="consumer.id">{{ consumer.id }}</mat-option>
                                }
                            </mat-select>
                        </mat-form-field>
                    </div>
                    @if (consumer(); as item) {
                        <div class="context-field workspace-field">
                            <span class="field-label">Workspace</span>
                            <code class="field-value path" [title]="item.root">{{ item.root }}</code>
                        </div>
                        <div class="context-field">
                            <span class="field-label">Status</span>
                            <span class="state-pill" [class.state-ok]="item.status === 'ready'" [class.state-warn]="item.status !== 'ready'">
                                <i></i>{{ item.status }}<em>v{{ item.version }}</em>
                            </span>
                        </div>
                        <div class="context-field">
                            <span class="field-label">Observation</span>
                            <span class="state-pill" [class.state-ok]="observationConsent()" [class.state-muted]="!observationConsent()">
                                <i></i>{{ observationConsent() ? 'consent on' : 'off / unknown' }}
                            </span>
                        </div>
                        <div class="context-field">
                            <span class="field-label">Flow</span>
                            <span class="field-value flow-value">{{ flow()?.name || '—' }} @if (flow()?.version) { <em>v{{ flow()?.version }}</em> }</span>
                        </div>
                    }
                </div>
            </section>

            @if (error(); as message) { <p class="form-error" role="alert">@if (errorCode()) { <strong>{{ errorCode() }}</strong> — }{{ message }}</p> }

            <section class="kpis" aria-label="Observatory summary">
                <div><span>Events</span><strong>{{ observations().length }}</strong><small>latest 500</small></div>
                <div><span>Traces</span><strong>{{ traces().length }}</strong><small>work chains</small></div>
                <div><span>Requests</span><strong>{{ prompts().length }}</strong><small>prompt.submitted</small></div>
                <div><span>Failures</span><strong>{{ failureCount() }}</strong><small>FAIL + BLOCKED</small></div>
                <div><span>Last event</span><strong class="time">{{ lastEventAt() || '—' }}</strong><small>host-reported</small></div>
            </section>

            <section class="top-grid">
                <article class="panel graph-panel">
                    <header class="panel-head">
                        <div><p class="eyebrow">Worker graph</p><h2>{{ flow()?.name || 'No published flow' }}</h2><p class="panel-sub">{{ graphView() === 'workers' ? 'Flow · processing path from the Seven-Star Formation' : 'Office floor · Lead brain at the center' }}</p></div>
                        <div class="view-actions"><div class="view-switch" role="group" aria-label="Worker graph view mode">
                            <button type="button" [class.active]="graphView() === 'workers'" (click)="graphView.set('workers')">Workers</button>
                            <button type="button" [class.active]="graphView() === 'offices'" (click)="graphView.set('offices')">3D offices</button>
                        </div></div>
                    </header>
                    @if (!flow() || graph().nodes.length === 0) {
                        <p class="muted">No published flow for this consumer.</p>
                    } @else if (graphView() === 'workers') {
                        <eso-workers-flow
                            [workers]="officeWorkers()"
                            [edges]="flowEdges()"
                            [events]="pulseEvents()"
                            [pulseIndex]="pulseIndex()"
                            [playing]="pulsePlaying()"
                            [selectedWorker]="selectedWorker()"
                            (selectWorker)="selectNode($event)" />
                    } @else {
                        <eso-office-2d5d
                            [workers]="officeWorkers()"
                            [edges]="flowEdges()"
                            [events]="pulseEvents()"
                            [pulseIndex]="pulseIndex()"
                            [playing]="pulsePlaying()"
                            [selectedWorker]="selectedWorker()"
                            (selectWorker)="selectNode($event)" />
                    }
                </article>

                <aside class="panel side-panel" id="live-pulse">
                    <header class="panel-head">
                        <div><p class="eyebrow">Live pulse</p><h2>{{ pulseTrace() || 'Play a request' }}</h2></div>
                        @if (pulsePlaying()) { <button type="button" class="stop-btn" (click)="stopPulse()">Stop</button> }
                    </header>
                    <form class="pulse-form" (submit)="playPulse($event)">
                        <input [value]="pulseQuery()" (input)="pulseQuery.set($any($event.target).value)" placeholder="Trace ID / request text / turn…" aria-label="Request or trace to play">
                        <button type="submit" class="play-btn" [disabled]="pulsePlaying()" aria-label="Play trace">{{ pulsePlaying() ? '…' : '▶' }}</button>
                    </form>
                    @if (pulseError(); as message) { <p class="pulse-error" role="alert">@if (pulseErrorCode()) { <strong>{{ pulseErrorCode() }}</strong> — }{{ message }}</p> }
                    @if (pulseEvents().length > 0) {
                        <div class="pulse-meta">
                            <span>{{ displayEvents().length }} / {{ pulseEvents().length }} events</span>
                            <span class="pulse-live-dot" [class.on]="pulsePlaying()"></span>
                            <span>{{ pulsePlaying() ? 'playing' : 'ready' }}</span>
                        </div>
                        <div class="pulse-progress"><i [style.width.%]="pulseProgress()"></i></div>
                    }
                    @if (displayEvents().length === 0) {
                        <div class="pulse-empty"><strong>No events loaded</strong><span>Enter a trace ID or request text, then press Play.</span></div>
                    } @else {
                        <ul class="pulse-list" [class.playing]="pulsePlaying()">
                            @for (event of displayEvents(); track event.observationId) {
                                <li
                                    role="button"
                                    tabindex="0"
                                    (click)="openEvent(event)"
                                    (keydown.enter)="openEvent(event)"
                                    (keydown.space)="openEvent(event); $event.preventDefault()"
                                    [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'"
                                    [class.pulse-current]="pulsePlaying() && $index === displayEvents().length - 1"
                                >
                                    <div><code>{{ event.event }}</code><span>{{ event.workerId || '—' }}</span></div>
                                    <small>{{ event.at }}</small>
                                </li>
                            }
                        </ul>
                    }
                </aside>
            </section>

            <eso-request-grid [consumerId]="consumerId()" (streamTrace)="startStream($event)" />


        </main>
    `,
    styles: [`
        :host { display: block; min-width: 0; }

        /* Page layout: the page owns rhythm, sections never own outer margins. */
        .observatory-page { display: grid; gap: var(--space-5); width: 100%; max-width: calc(var(--content-max) + var(--page-pad) * 2); margin: 0 auto; padding: var(--page-pad); min-width: 0; box-sizing: border-box; }
        .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-6); margin: 0; min-width: 0; }
        .page-header h1 { margin: 0; font-size: var(--text-2xl); line-height: 1.15; letter-spacing: -.02em; }
        .eyebrow { margin: 0 0 var(--space-1); color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .subtitle { max-width: 760px; margin: var(--space-2) 0 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.6; }
        .header-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; padding-top: 2px; }

        /* Cards: padding is internal; outer spacing comes from the page grid. */
        .panel, .context-bar { min-width: 0; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .context-bar { display: grid; gap: var(--space-4); background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, var(--brand)) 0%, var(--surface) 100%); }
        .context-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); padding-bottom: var(--space-3); border-bottom: 1px solid var(--line); }
        .context-head .eyebrow { margin: 0; }
        .context-hint { margin: 2px 0 0; color: var(--muted); font-size: var(--text-xs); }
        .context-readonly { padding: 2px 8px; border: 1px solid rgba(126,227,240,.28); border-radius: 999px; background: rgba(15,42,51,.8); color: #7fe3f0; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
        .context-grid { display: grid; grid-template-columns: minmax(150px, .9fr) minmax(260px, 1.8fr) minmax(140px, .8fr) minmax(150px, .9fr) minmax(180px, 1fr); align-items: stretch; }
        .context-field { display: grid; align-content: center; gap: 6px; min-width: 0; padding: 0 var(--space-4); }
        .context-field:first-child { padding-left: 0; }
        .context-field + .context-field { border-left: 1px solid var(--line); }
        .field-label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
        .field-value { display: block; min-width: 0; color: var(--ink); font-size: var(--text-sm); font-weight: 500; }
        .field-value.path { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #cbd5e1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--text-xs); font-weight: 400; }
        .consumer-field { align-content: start; }
        .consumer-select { width: 100%; }
        .consumer-select ::ng-deep .mat-mdc-text-field-wrapper { height: 34px; border-radius: 6px; background: var(--surface-2); }
        .consumer-select ::ng-deep .mat-mdc-form-field-flex { height: 34px; align-items: center; }
        .consumer-select ::ng-deep .mat-mdc-form-field-infix { display: flex; align-items: center; min-height: 34px; padding-top: 0; padding-bottom: 0; }
        .consumer-select ::ng-deep .mat-mdc-select-trigger { color: var(--ink); font-size: var(--text-sm); }
        .consumer-select ::ng-deep .mat-mdc-select-arrow { color: var(--muted); }
        .consumer-select ::ng-deep .mdc-notched-outline__leading,
        .consumer-select ::ng-deep .mdc-notched-outline__notch,
        .consumer-select ::ng-deep .mdc-notched-outline__trailing { border-color: #33445b; border-width: 1px; }
        .consumer-select.mat-focused ::ng-deep .mdc-notched-outline__leading,
        .consumer-select.mat-focused ::ng-deep .mdc-notched-outline__notch,
        .consumer-select.mat-focused ::ng-deep .mdc-notched-outline__trailing { border-color: #5aa9ff; }
        .consumer-select ::ng-deep .mat-mdc-form-field-focus-overlay { border-radius: 6px; }
        .state-pill { display: inline-flex; align-items: center; gap: 6px; width: fit-content; max-width: 100%; padding: 3px 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); color: #cbd5e1; font-size: 11px; white-space: nowrap; }
        .state-pill i { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: currentColor; }
        .state-pill em { color: var(--muted); font-size: 10px; font-style: normal; }
        .state-ok { color: #6ee7b7; border-color: rgba(110,231,183,.35); background: rgba(78,201,122,.1); }
        .state-ok i { background: #4ec97a; }
        .state-warn { color: #f5c76b; border-color: rgba(245,199,107,.35); background: rgba(224,179,65,.1); }
        .state-warn i { background: #e0b341; }
        .state-muted { color: var(--muted); }
        .flow-value { display: inline-flex; align-items: center; gap: 6px; }
        .flow-value em { padding: 1px 6px; border: 1px solid rgba(90,169,255,.3); border-radius: 999px; background: rgba(90,169,255,.1); color: #7dd3fc; font-size: 10px; font-style: normal; }

        /* KPI row */
        .kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-3); min-width: 0; }
        .kpis div { display: grid; gap: 2px; min-width: 0; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .kpis span { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
        .kpis strong { font-size: var(--text-lg); }
        .kpis .time { overflow-wrap: anywhere; font-size: var(--text-xs); }
        .kpis small { color: var(--muted); font-size: var(--text-xs); }

        /* Graph + live pulse row */
        .top-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(300px, .4fr); gap: var(--space-4); align-items: stretch; min-width: 0; }
        .panel { display: grid; gap: var(--space-3); }
        .graph-panel { align-content: start; }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); min-width: 0; }
        .panel-head h2 { margin: 0; font-size: var(--text-md); }
        .panel-sub { margin: 3px 0 0; color: var(--muted); font-size: var(--text-xs); }
        .view-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
        .view-switch { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-2); }
        .view-switch button { padding: 5px 10px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--muted); font: inherit; font-size: 11px; cursor: pointer; }
        .view-switch button.active { border-color: var(--line); background: #1a2a3e; color: var(--ink); font-weight: 600; }
        .view-switch button:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }

        /* Live pulse: flex ownership inside one fixed-height panel. */
        .side-panel { display: flex; flex-direction: column; gap: var(--space-3); min-height: 0; max-height: 100%; overflow: hidden; }
        .side-panel .panel-head { flex: 0 0 auto; }
        .pulse-form { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
        .pulse-form input { flex: 1; min-width: 0; height: 34px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--text-xs); }
        .pulse-form input:focus { outline: 2px solid color-mix(in srgb, var(--brand) 55%, transparent); outline-offset: 1px; border-color: var(--brand); }
        .play-btn { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid rgba(90,169,255,.45); border-radius: 6px; background: rgba(90,169,255,.14); color: #7dd3fc; font-size: 13px; cursor: pointer; }
        .play-btn:hover { background: rgba(90,169,255,.24); color: #fff; }
        .play-btn:disabled { opacity: .5; cursor: default; }
        .stop-btn { padding: 4px 8px; border: 1px solid #4b2a2a; border-radius: 5px; background: #2a1216; color: #fca5a5; font: inherit; font-size: 10px; cursor: pointer; }
        .pulse-error { margin: 0; color: #fca5a5; font-size: 11px; }
        .pulse-meta { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 10px; }
        .pulse-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #64748b; }
        .pulse-live-dot.on { background: #5aa9ff; box-shadow: 0 0 0 3px rgba(90,169,255,.12); animation: live-dot 1s ease-in-out infinite; }
        .pulse-progress { height: 2px; overflow: hidden; border-radius: 999px; background: #1e2a3e; }
        .pulse-progress i { display: block; height: 100%; background: linear-gradient(90deg, #5aa9ff, #7dd3fc); transition: width .25s ease; }
        .pulse-empty { display: grid; gap: 4px; padding: var(--space-4); border: 1px dashed var(--line); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--surface) 94%, var(--brand)); }
        .pulse-empty strong { color: var(--ink); font-size: var(--text-xs); }
        .pulse-empty span { color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
        .pulse-list { display: grid; align-content: start; flex: 1 1 0; gap: 6px; min-height: 0; margin: 0; padding: 0; overflow-y: auto; list-style: none; scrollbar-color: #2b3b52 #0b1118; scrollbar-width: thin; }
        .pulse-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
        .pulse-list li:hover { background: var(--surface-2); }
        .pulse-list li:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
        .pulse-list li.bad { border-left: 3px solid var(--warn-ink, #d97706); }
        .pulse-list li.pulse-current { border-color: rgba(90,169,255,.55); background: #16263c; }
        .pulse-list div { display: grid; gap: 1px; min-width: 0; }
        .pulse-list code { overflow: hidden; color: var(--brand); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .pulse-list span { color: var(--muted); font-size: 10px; }
        .pulse-list small { color: var(--muted); font-size: 9px; white-space: nowrap; }
        .pulse-list.playing li { animation: pulse-in .25s ease-out; }

        .form-error { margin: 0; color: #f87171; }
        .muted { color: var(--muted); }

        @keyframes live-dot { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
        @keyframes pulse-in { from { opacity: .25; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }

        @media (max-width: 1200px) {
            .top-grid { grid-template-columns: minmax(0, 1fr); }
            .side-panel { max-height: none; }
            .pulse-list { max-height: 420px; }
        }
        @media (max-width: 1100px) {
            .context-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: var(--space-3); }
            .context-field { padding: 0; }
            .context-field + .context-field { border-left: 0; }
            .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 700px) {
            .page-header { flex-direction: column; gap: var(--space-3); }
            .context-grid { grid-template-columns: 1fr; }
            .context-head { flex-direction: column; }
            .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
    `],
})
export class ObservatoryPage implements OnInit, OnDestroy {
    private readonly api = inject(CONTROL_PLANE_API_CLIENT, { optional: true });
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    /** V2 telemetry: one in-memory session id per page load, never persisted. */
    private readonly uiSession = crypto.randomUUID();

    readonly consumers = signal<ConsumerSummary[]>([]);
    readonly consumerId = signal('');
    readonly observations = signal<ObservationDto[]>([]);
    readonly flow = signal<FlowDefinitionDto | null>(null);
    readonly loading = signal(false);
    readonly error = signal('');
    readonly errorCode = signal('');
    readonly observationConsent = signal(false);
    readonly selectedWorker = signal('');

    readonly consumer = computed(() => this.consumers().find((item) => item.id === this.consumerId()) ?? null);
    readonly workerStats = computed(() => {
        const stats = new Map<string, { events: number; failures: number }>();
        for (const event of this.observations()) {
            const key = event.workerId || 'unknown';
            if (!stats.has(key)) stats.set(key, { events: 0, failures: 0 });
            const row = stats.get(key)!;
            row.events += 1;
            if (event.outcome === 'FAIL' || event.outcome === 'BLOCKED') row.failures += 1;
        }
        return stats;
    });
    readonly graph = computed(() => {
        const flow = this.flow();
        if (!flow || !flow.nodes.length) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], width: 820, height: 360 };
        const width = 820;
        const height = 360;
        const xs = flow.nodes.map((node) => node.x);
        const ys = flow.nodes.map((node) => node.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const padX = 70;
        const padY = 60;
        const scaleX = maxX === minX ? 1 : (width - padX * 2) / (maxX - minX);
        const scaleY = maxY === minY ? 1 : (height - padY * 2) / (maxY - minY);
        const positions = new Map(flow.nodes.map((node) => [node.workerId, { x: padX + (node.x - minX) * scaleX, y: padY + (node.y - minY) * scaleY }]));
        const selected = this.selectedWorker();
        const stats = this.workerStats();
        const nodes: GraphNode[] = flow.nodes.map((node) => ({
            id: node.workerId,
            kind: node.workerId === 'worker-fixbug' ? 'conditional' as const : 'worker' as const,
            x: positions.get(node.workerId)!.x,
            y: positions.get(node.workerId)!.y,
            label: node.workerId,
            events: stats.get(node.workerId)?.events || 0,
            failures: stats.get(node.workerId)?.failures || 0,
            selected: selected === node.workerId,
        }));
        const counts = this.transitionCounts();
        const edges: GraphEdge[] = flow.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return { id: edge.id, from: edge.from, to: edge.to, d: '', count: 0 };
            return { id: edge.id, from: edge.from, to: edge.to, d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, count: counts.get(`${edge.from}->${edge.to}`) || 0 };
        });
        return { nodes, edges, width, height };
    });

    readonly officeWorkers = computed<OfficeWorker[]>(() => this.graph().nodes.map((node) => ({
        id: node.id,
        label: this.shortId(node.id),
        events: node.events,
        failures: node.failures,
        state: this.workerState(node.id),
    })));

    readonly flowEdges = computed(() => (this.flow()?.edges ?? []).map((edge) => ({ from: edge.from, to: edge.to })));

    readonly graphView = signal<'workers' | 'offices'>('workers');
    readonly pulseQuery = signal('');
    readonly pulseTrace = signal('');
    readonly pulseEvents = signal<ObservationDto[]>([]);
    readonly pulseIndex = signal(0);
    readonly pulsePlaying = signal(false);
    readonly pulseError = signal('');
    readonly pulseErrorCode = signal('');
    private pulseTimer: ReturnType<typeof setInterval> | null = null;
    readonly displayEvents = computed(() => this.pulseEvents().length
        ? this.pulseEvents().slice(0, this.pulseIndex())
        : this.sideEvents());
    readonly pulseProgress = computed(() => this.pulseEvents().length
        ? Math.round(this.pulseIndex() / this.pulseEvents().length * 100)
        : 0);
    readonly selectedEvents = computed(() => {
        const worker = this.selectedWorker();
        return this.observations().filter((item) => !worker || item.workerId === worker);
    });
    readonly sideEvents = computed(() => this.selectedEvents().slice(0, 10));
    readonly traces = computed<TraceSummary[]>(() => {
        const groups = new Map<string, ObservationDto[]>();
        for (const event of this.observations()) {
            if (!groups.has(event.traceId)) groups.set(event.traceId, []);
            groups.get(event.traceId)!.push(event);
        }
        return [...groups.entries()].map(([traceId, events]) => {
            const sorted = [...events].sort((left, right) => String(left.at).localeCompare(String(right.at)));
            const last = sorted[sorted.length - 1];
            return {
                traceId,
                events: events.length,
                workers: new Set(events.map((item) => item.workerId).filter(Boolean)).size,
                prompts: events.filter((item) => item.event === 'prompt.submitted').length,
                outcome: last?.outcome || '—',
                lastAt: last?.at || '',
            };
        }).sort((left, right) => String(right.lastAt).localeCompare(String(left.lastAt)));
    });
    readonly prompts = computed(() => this.observations().filter((item) => item.event === 'prompt.submitted'));
    readonly failureCount = computed(() => this.observations().filter((item) => item.outcome === 'FAIL' || item.outcome === 'BLOCKED').length);
    readonly lastEventAt = computed(() => this.observations()[0]?.at || '');

    ngOnInit(): void {
        this.trackSurface('surface.observatory.open');
        void this.init();
    }

    /** V2 telemetry — fire-and-forget; a beacon failure must never block or surface in the UI. */
    private trackSurface(surface: string): void {
        if (!this.api) return;
        const consumerId = this.consumerId() || this.route.snapshot.queryParamMap.get('consumer') || null;
        void this.api.postUiEvent({ surface, consumerId, session: this.uiSession }).catch(() => undefined);
    }

    private async init(): Promise<void> {
        if (!this.api) return;
        try {
            const list = await this.api.listConsumers();
            this.consumers.set(list.items || []);
        } catch (error) {
            this.fail(error, 'OBS_UPSTREAM_FAILED', 'Unable to load consumers');
            return;
        }
        const query = this.route.snapshot.queryParamMap;
        const requested = query.get('consumer') || query.get('project') || '';
        const requestedTrace = query.get('trace') || query.get('pulse') || query.get('request') || '';
        const fallback = this.consumers()[0]?.id || '';
        if (requested && !this.consumers().some((item) => item.id === requested)) {
            this.failWith('OBS_CONSUMER_UNKNOWN', `Consumer "${requested}" not found`);
            return;
        }
        this.consumerId.set(requested || fallback);
        if (this.consumerId()) await this.load();
        if (requestedTrace) {
            this.pulseQuery.set(requestedTrace);
            this.playPulse();
        }
    }

    selectConsumer(id: string): void {
        this.stopPulse();
        this.consumerId.set(id);
        this.selectedWorker.set('');
        this.pulseQuery.set('');
        this.pulseTrace.set('');
        this.pulseEvents.set([]);
        this.pulseIndex.set(0);
        this.pulseError.set('');
        this.pulseErrorCode.set('');
        this.errorCode.set('');
        void this.router.navigate([], { relativeTo: this.route, queryParams: { consumer: id, trace: null }, queryParamsHandling: 'merge', replaceUrl: true });
        void this.load();
    }

    async load(): Promise<void> {
        const id = this.consumerId();
        if (!id || !this.api) return;
        this.loading.set(true);
        this.error.set('');
        this.errorCode.set('');
        let rows: ObservationDto[] = [];
        try {
            rows = await this.api.getConsumerObservations(id, 500);
        } catch (error) {
            this.loading.set(false);
            this.fail(error, 'OBS_UPSTREAM_FAILED', 'Unable to load observations');
            return;
        }
        try {
            const [flows, detail] = await Promise.all([
                this.api.getConsumerFlows(id).catch(() => []),
                this.api.getConsumer(id).catch(() => null),
            ]);
            this.observations.set([...rows].sort((left, right) => String(right.at || right.receivedAt).localeCompare(String(left.at || left.receivedAt))));
            const summary = (flows || []).find((item) => item.isDefault) || (flows || []).find((item) => item.status === 'published') || (flows || [])[0];
            if (summary) this.flow.set(await this.api.getConsumerFlow(id, summary.id).catch(() => null));
            const anyDetail = detail as any;
            this.observationConsent.set(anyDetail?.profile?.observation?.consent === true || anyDetail?.profile?.profile?.observation?.consent === true);
        } catch (error) {
            this.fail(error, 'OBS_UPSTREAM_FAILED', 'Unable to load observatory');
        } finally {
            this.loading.set(false);
        }
    }

    /** Mã lỗi theo SRS `04` §6: 401/403 ⇒ OBS_DENIED · 404 consumer ⇒ OBS_CONSUMER_UNKNOWN. */
    private fail(error: unknown, fallbackCode: string, fallbackMessage: string): void {
        const e = error as { status?: number; code?: string; detail?: string; message?: string };
        const code = e?.status === 401 || e?.status === 403
            ? 'OBS_DENIED'
            : e?.code === 'CONSUMER_NOT_FOUND'
                ? 'OBS_CONSUMER_UNKNOWN'
                : fallbackCode;
        this.errorCode.set(code);
        this.error.set(e?.detail || e?.message || fallbackMessage);
    }

    private failWith(code: string, message: string): void {
        this.errorCode.set(code);
        this.error.set(message);
    }

    private transitionCounts(): Map<string, number> {
        const byTrace = new Map<string, ObservationDto[]>();
        for (const event of this.observations()) {
            if (!byTrace.has(event.traceId)) byTrace.set(event.traceId, []);
            byTrace.get(event.traceId)!.push(event);
        }
        const counts = new Map<string, number>();
        for (const events of byTrace.values()) {
            const sorted = events.filter((item) => item.workerId).sort((left, right) => String(left.at).localeCompare(String(right.at)));
            for (let index = 1; index < sorted.length; index += 1) {
                const key = `${sorted[index - 1].workerId}->${sorted[index].workerId}`;
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        }
        return counts;
    }

    edgeMid(edge: GraphEdge): { x: number; y: number } {
        const match = /M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)/.exec(edge.d);
        if (!match) return { x: 0, y: 0 };
        return { x: (Number(match[1]) + Number(match[3])) / 2, y: (Number(match[2]) + Number(match[4])) / 2 };
    }

    selectNode(id: string): void {
        this.selectedWorker.set(id === 'lead' ? '' : id);
    }

    startStream(traceId: string): void {
        this.pulseQuery.set(traceId);
        this.playPulse();
        setTimeout(() => document.getElementById('live-pulse')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
    }

    playPulse(event?: Event): void {
        event?.preventDefault();
        this.stopPulse();
        const query = (this.pulseQuery() || this.pulseTrace()).trim().toLowerCase();
        if (!query) { this.pulseErrorCode.set('OBS_QUERY_EMPTY'); this.pulseError.set('Enter a trace ID or request text.'); return; }
        const traceIds = [...new Set(this.observations().map((item) => item.traceId))];
        const exact = traceIds.find((id) => id.toLowerCase() === query);
        const matched = exact || traceIds.find((id) => this.observations().some((item) => item.traceId === id && [
            item.workerId, item.event, item.outcome,
            (item.evidence as Record<string, unknown> | undefined)?.['userQuery'], (item.evidence as Record<string, unknown> | undefined)?.['requestHash'], (item.evidence as Record<string, unknown> | undefined)?.['requestLength'],
        ].join(' ').toLowerCase().includes(query)));
        if (!matched) { this.pulseErrorCode.set('OBS_TRACE_NOT_MATCHED'); this.pulseError.set('No trace or request matched.'); return; }
        const events = this.observations()
            .filter((item) => item.traceId === matched)
            .sort((left, right) => String(left.at).localeCompare(String(right.at)));
        if (!events.length) { this.pulseErrorCode.set('OBS_TRACE_EMPTY'); this.pulseError.set('Trace has no events.'); return; }
        this.pulseError.set('');
        this.pulseErrorCode.set('');
        this.pulseQuery.set(matched);
        this.pulseTrace.set(matched);
        void this.router.navigate([], { relativeTo: this.route, queryParams: { trace: matched }, queryParamsHandling: 'merge', replaceUrl: true });
        this.pulseEvents.set(events);
        this.pulseIndex.set(1);
        this.pulsePlaying.set(true);
        this.selectedWorker.set(events[0].workerId || '');
        this.pulseTimer = setInterval(() => {
            const next = this.pulseIndex() + 1;
            if (next > events.length) { this.stopPulse(); return; }
            this.pulseIndex.set(next);
            this.selectedWorker.set(events[Math.min(next, events.length) - 1]?.workerId || '');
            if (next >= events.length) this.stopPulse();
        }, 450);
    }

    stopPulse(): void {
        if (this.pulseTimer) clearInterval(this.pulseTimer);
        this.pulseTimer = null;
        this.pulsePlaying.set(false);
    }

    ngOnDestroy(): void {
        this.stopPulse();
    }

    private workerState(workerId: string): 'idle' | 'working' | 'done' | 'blocked' {
        const latest = this.observations()
            .filter((event) => event.workerId === workerId)
            .sort((left, right) => String(right.at).localeCompare(String(left.at)))[0];
        if (!latest) return 'idle';
        if (latest.event === 'prompt.submitted') return 'working';
        if (latest.outcome === 'PASS') return 'done';
        if (latest.outcome === 'FAIL' || latest.outcome === 'BLOCKED') return 'blocked';
        return 'idle';
    }

    shortId(id: string): string {
        return id.replace(/^worker-/, '').slice(0, 9);
    }

    openEvent(event: ObservationDto): void {
        if (event.event === 'prompt.submitted') {
            void this.router.navigate(['/requests', event.traceId], { queryParams: { consumer: this.consumerId() } });
            return;
        }
        void this.router.navigate(['/events'], { queryParams: { consumer: this.consumerId(), trace: event.traceId, event: event.event } });
    }

    evidenceValue(event: ObservationDto, key: string): string {
        const value = (event.evidence as Record<string, unknown> | null) ?? {};
        const item = value[key];
        return item === undefined || item === null || item === '' ? '—' : String(item);
    }
}
