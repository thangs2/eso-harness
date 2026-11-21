import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CONTROL_PLANE_API_CLIENT } from '../../../core/tokens.js';
import type { ConsumerSummary, ObservationDto } from '../../../../../../../libs/api-client/types.js';

interface WorkerLane {
    workerId: string;
    events: ObservationDto[];
}

@Component({
    selector: 'eso-event-stream-page',
    standalone: true,
    imports: [MatButtonModule, RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="stream-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Observatory · {{ requestMode ? 'requests' : 'event stream' }}</p>
                    <h1>{{ requestMode ? 'Prompt requests' : 'Event stream viewer' }}</h1>
                    <p class="subtitle">{{ requestMode ? 'Request metadata by trace/worker. Prompt body is not stored.' : 'Event stream by trace/worker. Select an event to inspect request/evidence detail. ESO is read-only.' }}</p>
                </div>
                <div class="header-actions">
                    <a mat-stroked-button routerLink="/observatory">Observatory</a>
                    <a mat-stroked-button routerLink="/office" [queryParams]="{ consumer: consumerId() }">Office 3D</a>
                    <button mat-stroked-button type="button" [disabled]="loading()" (click)="load()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button>
                </div>
            </header>

            <section class="filters" aria-label="Event filters">
                <label>Consumer
                    <select (change)="selectConsumer($any($event.target).value)">
                        @for (consumer of consumers(); track consumer.id) { <option [value]="consumer.id" [selected]="consumer.id === consumerId()">{{ consumer.id }}</option> }
                    </select>
                </label>
                <label>Event
                    <select [value]="eventFilter()" (change)="eventFilter.set($any($event.target).value)">
                        <option value="all">all events</option>
                        @for (event of eventOptions(); track event) { <option [value]="event" [selected]="event === eventFilter()">{{ event }}</option> }
                    </select>
                </label>
                <label>Outcome
                    <select [value]="outcomeFilter()" (change)="outcomeFilter.set($any($event.target).value)">
                        <option value="all">all outcomes</option>
                        @for (outcome of outcomeOptions(); track outcome) { <option [value]="outcome" [selected]="outcome === outcomeFilter()">{{ outcome }}</option> }
                    </select>
                </label>
                <label>Worker
                    <input [value]="workerFilter()" (input)="workerFilter.set($any($event.target).value); page.set(0)" placeholder="worker-scout">
                </label>
                <label>Trace
                    <input [value]="traceFilter()" (input)="setTrace($any($event.target).value)" placeholder="trace id">
                </label>
                <label>Order
                    <select [value]="order()" (change)="order.set($any($event.target).value)">
                        <option value="desc">newest first</option>
                        <option value="asc">oldest first</option>
                    </select>
                </label>
            </section>

            <div class="stream-toolbar">
                <span class="stream-count">{{ filtered().length }} events · {{ traceCount() }} traces</span>
                <div class="quick-filters">
                    <button type="button" class="chip" [class.on]="eventFilter() === 'all'" (click)="eventFilter.set('all')">All</button>
                    <button type="button" class="chip" [class.on]="eventFilter() === 'prompt.submitted'" (click)="eventFilter.set('prompt.submitted')">Requests</button>
                    <button type="button" class="chip" [class.on]="outcomeFilter() === 'FAIL'" (click)="outcomeFilter.set('FAIL')">Failures</button>
                </div>
                <label class="auto-refresh"><span class="live-dot" [class.off]="!autoRefresh()"></span><input type="checkbox" [checked]="autoRefresh()" (change)="toggleLive($any($event.target).checked)"> Live · {{ streamState() === 'live' ? 'SSE' : streamState() === 'connecting' ? 'connecting…' : 'poll fallback' }}</label>
            </div>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }

            @if (selectedTrace(); as traceId) {
                <section class="timeline-panel" aria-label="Trace timeline">
                    <header class="timeline-head">
                        <div><p class="eyebrow">Trace · 2D timeline</p><h2>{{ traceId }}</h2></div>
                        <button mat-button type="button" (click)="selectedTrace.set('')">Clear trace</button>
                    </header>
                    @if (traceObservations().length === 0) {
                        <p class="muted">No events for this trace in the loaded window.</p>
                    } @else {
                        <div class="timeline">
                            <div class="axis-row">
                                <span></span>
                                <div class="axis"><span>{{ traceStart() }}</span><span class="axis-now">live →</span><span>{{ traceEnd() }}</span></div>
                            </div>
                            @for (lane of traceLanes(); track lane.workerId) {
                                <div class="lane">
                                    <span class="lane-label">{{ lane.workerId || 'unknown' }}</span>
                                    <div class="lane-track">
                                        @for (event of lane.events; track event.observationId) {
                                            <button type="button" class="lane-event" [class.fail]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'" [style.left.%]="leftPercent(event)" [style.top.px]="eventTop(lane, event)" [title]="event.event + ' · ' + event.at" (click)="selectObservation(event)">
                                                <span>{{ eventLabel(event) }}</span>
                                            </button>
                                        }
                                    </div>
                                </div>
                            }
                        </div>
                    }
                </section>
            }

            <div class="stream-layout">
                <section class="event-list" aria-label="Event rows">
                    @if (loading() && observations().length === 0) {
                        <p class="loading-label" role="status">Loading events…</p>
                    } @else if (pageItems().length === 0) {
                        <section class="empty"><strong>No matching events</strong><span>Try another consumer, event or trace.</span></section>
                    } @else {
                        @for (event of pageItems(); track event.observationId) {
                            <article class="event-row" [class.selected]="selectedObservation()?.observationId === event.observationId" (click)="selectObservation(event)">
                                <div class="event-head">
                                    <code>{{ event.event }}</code>
                                    @if (event.outcome) { <span class="badge">{{ event.outcome }}</span> }
                                    <time [attr.datetime]="event.at">{{ event.at }}</time>
                                </div>
                                <div class="event-meta">
                                    <span><small>Worker</small>{{ event.workerId || '—' }}</span>
                                    <span><small>Host</small>{{ event.hostId }}</span>
                                    <span><small>Trace</small><code>{{ event.traceId }}</code></span>
                                </div>
                            </article>
                        }
                        <footer class="pager">
                            <button mat-stroked-button type="button" [disabled]="page() === 0" (click)="page.set(page() - 1)">Previous</button>
                            <span>Page {{ page() + 1 }} / {{ pageCount() }}</span>
                            <button mat-stroked-button type="button" [disabled]="page() + 1 >= pageCount()" (click)="page.set(page() + 1)">Next</button>
                        </footer>
                    }
                </section>

                <aside class="detail" aria-label="Event detail">
                    @if (selectedObservation(); as event) {
                        <div class="detail-head">
                            <p class="eyebrow">Event detail</p>
                            <h2>{{ event.event }}</h2>
                            <span class="badge">{{ event.outcome || 'no outcome' }}</span>
                        </div>
                        <section class="envelope">
                            <p class="eyebrow">Event envelope</p>
                            <dl class="detail-grid">
                                <dt>event_id</dt><dd><code>{{ event.observationId }}</code></dd>
                                <dt>trace_id</dt><dd><code>{{ event.traceId }}</code></dd>
                                <dt>span_id</dt><dd><code>{{ spanId(event) }}</code></dd>
                                <dt>parent_span_id</dt><dd><code>{{ parentSpanId(event) }}</code></dd>
                                <dt>worker_id</dt><dd>{{ event.workerId || '—' }}</dd>
                                <dt>host_binding_id</dt><dd><code>{{ event.runtimeKey }}</code></dd>
                                <dt>type</dt><dd><code>{{ event.event }}</code></dd>
                                <dt>at</dt><dd>{{ event.at }}</dd>
                                <dt>decision</dt><dd>{{ decision(event) }}</dd>
                            </dl>
                        </section>
                        @if (event.event === 'prompt.submitted') {
                            <a class="request-open" [routerLink]="['/requests', event.traceId]" [queryParams]="{ consumer: consumerId() }">Open full request detail →</a>
                            <section class="request-card">
                                <p class="eyebrow">Prompt request</p>
                                <p>Body is not stored by ESO policy. Only request metadata is retained.</p>
                                <dl class="detail-grid">
                                    <dt>Request hash</dt><dd><code>{{ evidenceValue(event, 'requestHash') }}</code></dd>
                                    <dt>Request length</dt><dd>{{ evidenceValue(event, 'requestLength') }}</dd>
                                    <dt>Task type</dt><dd>{{ evidenceValue(event, 'taskType') }}</dd>
                                    <dt>Model</dt><dd>{{ evidenceValue(event, 'model') }}</dd>
                                    <dt>Adapter</dt><dd>{{ evidenceValue(event, 'adapter') }}</dd>
                                </dl>
                            </section>
                        }
                        <details open>
                            <summary>Evidence</summary>
                            <pre>{{ evidenceText(event.evidence) }}</pre>
                        </details>
                    } @else {
                        <div class="detail-empty"><strong>Select an event</strong><span>Detail request/evidence appears here.</span></div>
                    }
                </aside>
            </div>
        </main>
    `,
    styles: [`
        .stream-page { display: grid; gap: var(--space-4); max-width: var(--container); margin: 0 auto; }
        .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
        .page-header h1 { margin: 0 0 var(--space-1); }
        .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: var(--text-xs); margin: 0 0 var(--space-1); }
        .subtitle { color: var(--muted); margin: 0; }
        .header-actions { display: flex; gap: var(--space-2); }
        .filters { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .filters label { display: grid; gap: 4px; font-size: var(--text-xs); color: var(--muted); }
        .filters select, .filters input { min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; }
        .stream-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); color: var(--muted); font-size: var(--text-xs); }
        .quick-filters { display: flex; gap: 6px; }
        .chip { padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--muted); font: inherit; font-size: 10px; cursor: pointer; }
        .chip.on { border-color: var(--brand); color: var(--brand); background: color-mix(in srgb, var(--surface) 88%, var(--brand)); }
        .auto-refresh { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px color-mix(in srgb, #22c55e 20%, transparent); animation: pulse 1.8s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
        .timeline-panel { padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .timeline-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); margin-bottom: var(--space-3); }
        .timeline-head h2 { margin: 0; font-size: var(--text-md); }
        .timeline { display: grid; gap: 4px; }
        .axis-row { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: var(--space-3); }
        .axis { display: flex; justify-content: space-between; color: var(--muted); font-size: 9px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
        .axis-now { color: var(--brand); }
        .lane { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: var(--space-3); align-items: center; }
        .lane-label { font-size: var(--text-xs); color: var(--muted); text-align: left; }
        .lane-track { position: relative; min-height: 84px; border-bottom: 1px dashed var(--line); }
        .lane-event { position: absolute; transform: translateX(-50%); max-width: 180px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); color: var(--ink); font: inherit; font-size: 10px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lane-event.fail { border-color: var(--warn-ink, #d97706); color: var(--warn-ink, #d97706); }
        .stream-layout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, .65fr); gap: var(--space-4); align-items: start; }
        .event-list { display: grid; gap: var(--space-2); }
        .event-row { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); cursor: pointer; }
        .event-row.selected { border-color: var(--brand); background: color-mix(in srgb, var(--surface) 92%, var(--brand)); }
        .event-head { display: flex; align-items: center; gap: var(--space-3); }
        .event-head code { color: var(--brand); font-weight: 650; }
        .event-head time { margin-left: auto; color: var(--muted); font-size: var(--text-xs); }
        .event-meta { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
        .event-meta span { display: grid; gap: 1px; font-size: var(--text-xs); }
        .event-meta small { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
        .detail { position: sticky; top: 80px; display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .detail-head h2 { margin: 0; font-size: var(--text-lg); }
        .envelope { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
        .envelope .eyebrow { margin-bottom: var(--space-2); }
        .detail-grid { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 6px var(--space-3); margin: 0; font-size: var(--text-xs); }
        .detail-grid dt { color: var(--muted); }
        .detail-grid dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
        .request-open { color: var(--brand); font-size: var(--text-xs); font-weight: 650; }
        .request-card { padding: var(--space-3); border-left: 3px solid var(--brand); background: var(--surface-2); border-radius: var(--radius-sm); }
        .request-card p { margin: 0 0 var(--space-2); color: var(--muted); font-size: var(--text-xs); }
        .detail pre { max-height: 260px; overflow: auto; padding: var(--space-3); border-radius: var(--radius-sm); background: var(--surface-2); font-size: 11px; white-space: pre-wrap; }
        .detail-empty, .empty { display: grid; gap: 4px; padding: var(--space-4); border: 1px dashed var(--line); border-radius: var(--radius-md); color: var(--muted); }
        .detail-empty strong, .empty strong { color: var(--ink); }
        .badge { padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--surface-2) 80%, var(--brand)); color: var(--ink); font-size: 10px; font-weight: 700; }
        .pager { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); color: var(--muted); font-size: var(--text-xs); }
        .loading-label, .muted { color: var(--muted); }
        @media (max-width: 1100px) { .filters { grid-template-columns: repeat(3, minmax(0, 1fr)); } .stream-layout { grid-template-columns: 1fr; } .detail { position: static; } }
        @media (max-width: 700px) { .filters { grid-template-columns: 1fr; } .page-header { flex-direction: column; } .lane { grid-template-columns: 1fr; } .lane-label { text-align: left; } }
    `],
})
export class EventStreamPage implements OnInit, OnDestroy {
    private readonly api = inject(CONTROL_PLANE_API_CLIENT, { optional: true });
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private timer: ReturnType<typeof setInterval> | null = null;
    private streamAbort: AbortController | null = null;
    readonly requestMode = this.route.snapshot.routeConfig?.path === 'requests';

    readonly consumers = signal<ConsumerSummary[]>([]);
    readonly consumerId = signal('');
    readonly observations = signal<ObservationDto[]>([]);
    readonly loading = signal(false);
    readonly error = signal('');
    readonly eventFilter = signal('all');
    readonly outcomeFilter = signal('all');
    readonly workerFilter = signal('');
    readonly traceFilter = signal('');
    readonly order = signal<'asc' | 'desc'>('desc');
    readonly autoRefresh = signal(true);
    readonly streamState = signal<'connecting' | 'live' | 'fallback' | 'closed'>('closed');
    readonly page = signal(0);
    readonly selectedTrace = signal('');
    readonly selectedObservation = signal<ObservationDto | null>(null);
    readonly pageSize = 40;

    readonly eventOptions = computed(() => [...new Set(this.observations().map((item) => item.event))].sort());
    readonly outcomeOptions = computed(() => [...new Set(this.observations().map((item) => item.outcome).filter((item): item is string => Boolean(item)))].sort());
    readonly filtered = computed(() => {
        const event = this.eventFilter();
        const outcome = this.outcomeFilter();
        const worker = this.workerFilter().trim().toLowerCase();
        const trace = this.traceFilter().trim().toLowerCase();
        const rows = this.observations().filter((item) => {
            if (event !== 'all' && item.event !== event) return false;
            if (outcome !== 'all' && item.outcome !== outcome) return false;
            if (worker && !(item.workerId || '').toLowerCase().includes(worker)) return false;
            if (trace && !item.traceId.toLowerCase().includes(trace)) return false;
            return true;
        });
        return [...rows].sort((left, right) => {
            const delta = String(left.at || left.receivedAt).localeCompare(String(right.at || right.receivedAt));
            return this.order() === 'asc' ? delta : -delta;
        });
    });
    readonly traceCount = computed(() => new Set(this.filtered().map((item) => item.traceId)).size);
    readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));
    readonly pageItems = computed(() => {
        const start = Math.min(this.page(), this.pageCount() - 1) * this.pageSize;
        return this.filtered().slice(start, start + this.pageSize);
    });
    readonly traceObservations = computed(() => {
        const trace = this.selectedTrace();
        if (!trace) return [];
        return this.observations().filter((item) => item.traceId === trace).sort((left, right) => String(left.at).localeCompare(String(right.at)));
    });
    readonly traceLanes = computed<WorkerLane[]>(() => {
        const lanes = new Map<string, ObservationDto[]>();
        for (const event of this.traceObservations()) {
            const key = event.workerId || 'unknown';
            if (!lanes.has(key)) lanes.set(key, []);
            lanes.get(key)!.push(event);
        }
        return [...lanes.entries()].map(([workerId, events]) => ({ workerId, events }));
    });
    readonly traceStart = computed(() => this.traceObservations()[0]?.at || '—');
    readonly traceEnd = computed(() => this.traceObservations().at(-1)?.at || '—');
    readonly traceRange = computed(() => {
        const rows = this.traceObservations();
        if (rows.length === 0) return { start: 0, span: 1 };
        const times = rows.map((item) => new Date(item.at || item.receivedAt).getTime()).filter((value) => Number.isFinite(value));
        const start = Math.min(...times);
        const end = Math.max(...times);
        return { start, span: Math.max(1, end - start) };
    });

    ngOnInit(): void {
        void this.init();
        this.timer = setInterval(() => {
            if (this.autoRefresh() && this.streamState() !== 'live') void this.load();
        }, 5000);
    }

    ngOnDestroy(): void {
        if (this.timer) clearInterval(this.timer);
        this.stopStream();
    }

    toggleLive(enabled: boolean): void {
        this.autoRefresh.set(enabled);
        if (enabled) this.startStream();
        else this.stopStream();
    }

    private async init(): Promise<void> {
        if (!this.api) return;
        try {
            const list = await this.api.listConsumers();
            this.consumers.set(list.items || []);
        } catch (error) {
            this.error.set((error as { detail?: string; message?: string })?.detail || (error as Error)?.message || 'Unable to load consumers');
        }
        const query = this.route.snapshot.queryParamMap;
        const requested = query.get('consumer') || query.get('project') || '';
        const fallback = this.consumers()[0]?.id || '';
        this.consumerId.set(requested && this.consumers().some((item) => item.id === requested) ? requested : fallback);
        const trace = query.get('trace');
        if (trace) { this.selectedTrace.set(trace); this.traceFilter.set(trace); }
        const event = query.get('event');
        if (event) this.eventFilter.set(event);
        if (this.route.snapshot.routeConfig?.path === 'requests') this.eventFilter.set('prompt.submitted');
        if (this.consumerId()) { await this.load(); this.startStream(); }
    }

    private startStream(): void {
        this.stopStream();
        const id = this.consumerId();
        if (!this.api || !id || !this.autoRefresh()) { this.streamState.set('closed'); return; }
        const { url, headers } = this.api.observationStream(id);
        const controller = new AbortController();
        this.streamAbort = controller;
        this.streamState.set('connecting');
        void (async () => {
            try {
                const response = await fetch(url, { headers, signal: controller.signal });
                if (!response.ok || !response.body) throw new Error(`stream HTTP ${response.status}`);
                this.streamState.set('live');
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let boundary = buffer.indexOf('\n\n');
                    while (boundary >= 0) {
                        const frame = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
                        if (data) {
                            try {
                                const parsed = JSON.parse(data) as { items?: ObservationDto[] };
                                if (Array.isArray(parsed.items)) this.applyRows(parsed.items);
                            } catch { /* ignore malformed frame */ }
                        }
                        boundary = buffer.indexOf('\n\n');
                    }
                }
            } catch (error) {
                if (controller.signal.aborted) return;
                this.streamState.set('fallback');
                this.error.set((error as Error)?.message || 'SSE unavailable; using polling fallback');
            }
        })();
    }

    private stopStream(): void {
        this.streamAbort?.abort();
        this.streamAbort = null;
        this.streamState.set('closed');
    }

    private applyRows(rows: ObservationDto[]): void {
        const merged = new Map(this.observations().map((item) => [item.observationId, item]));
        for (const row of rows) merged.set(row.observationId, row);
        const sorted = [...merged.values()].sort((left, right) => String(right.at || right.receivedAt).localeCompare(String(left.at || left.receivedAt)));
        this.observations.set(sorted);
        if (!this.selectedTrace()) {
            const counts = new Map<string, number>();
            for (const event of sorted) counts.set(event.traceId, (counts.get(event.traceId) || 0) + 1);
            const best = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
            if (best) this.selectedTrace.set(best);
        }
    }

    selectConsumer(id: string): void {
        this.consumerId.set(id);
        this.page.set(0);
        this.selectedTrace.set('');
        this.selectedObservation.set(null);
        void this.router.navigate([], { relativeTo: this.route, queryParams: { consumer: id }, queryParamsHandling: 'merge', replaceUrl: true });
        this.stopStream();
        void this.load().then(() => this.startStream());
    }

    setTrace(value: string): void {
        this.traceFilter.set(value);
        this.page.set(0);
        this.selectedTrace.set(value.trim());
    }

    async load(): Promise<void> {
        const id = this.consumerId();
        if (!id || !this.api) return;
        this.loading.set(true);
        this.error.set('');
        try {
            const rows = await this.api.getConsumerObservations(id, 500);
            const sorted = [...rows].sort((left, right) => String(right.at || right.receivedAt).localeCompare(String(left.at || left.receivedAt)));
            this.observations.set(sorted);
            if (this.eventFilter() === 'prompt.submitted') {
                const request = sorted.find((event) => event.event === 'prompt.submitted');
                if (request) {
                    this.selectedTrace.set(request.traceId);
                    this.selectedObservation.set(request);
                }
            } else if (!this.selectedTrace()) {
                const counts = new Map<string, number>();
                for (const event of sorted) counts.set(event.traceId, (counts.get(event.traceId) || 0) + 1);
                const best = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || sorted[0]?.traceId;
                if (best) {
                    this.selectedTrace.set(best);
                    this.selectedObservation.set(sorted.find((event) => event.traceId === best) || sorted[0]);
                }
            }
            if (!this.selectedObservation() && sorted[0]) this.selectedObservation.set(sorted[0]);
        } catch (error) {
            this.error.set((error as { detail?: string; message?: string })?.detail || (error as Error)?.message || 'Unable to load observations');
        } finally {
            this.loading.set(false);
        }
    }

    selectObservation(event: ObservationDto): void {
        this.selectedObservation.set(event);
        if (event.traceId && event.traceId !== this.selectedTrace()) this.selectedTrace.set(event.traceId);
    }

    eventTop(lane: WorkerLane, event: ObservationDto): number {
        const index = lane.events.findIndex((item) => item.observationId === event.observationId);
        return 4 + (Math.max(0, index) % 3) * 26;
    }

    spanId(event: ObservationDto): string {
        const evidence = (event.evidence as Record<string, unknown> | null) ?? {};
        return String(evidence['spanId'] || `${event.traceId}:${event.workerId || 'unknown'}:${evidence['hostStep'] ?? evidence['remoteJobId'] ?? 'event'}`);
    }

    parentSpanId(event: ObservationDto): string {
        const rows = this.traceObservations();
        const index = rows.findIndex((item) => item.observationId === event.observationId);
        return index > 0 ? this.spanId(rows[index - 1]) : '—';
    }

    decision(event: ObservationDto): string {
        const evidence = (event.evidence as Record<string, unknown> | null) ?? {};
        return String(evidence['decision'] || 'not recorded');
    }

    eventLabel(event: ObservationDto): string {
        const labels: Record<string, string> = {
            'worker.completed': 'completed',
            'worker.failed': 'failed',
            'worker.remote.completed': 'remote completed',
            'worker.remote.failed': 'remote failed',
            'prompt.submitted': 'request',
        };
        return labels[event.event] || event.event;
    }

    leftPercent(event: ObservationDto): number {
        const range = this.traceRange();
        const time = new Date(event.at || event.receivedAt).getTime();
        if (!Number.isFinite(time)) return 0;
        return Math.min(96, Math.max(4, ((time - range.start) / range.span) * 100));
    }

    evidenceValue(event: ObservationDto, key: string): string {
        const value = (event.evidence as Record<string, unknown> | null) ?? {};
        const item = value[key];
        return item === undefined || item === null || item === '' ? '—' : String(item);
    }

    evidenceText(value: unknown): string {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }
}
