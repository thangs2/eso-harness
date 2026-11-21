import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CONTROL_PLANE_API_CLIENT } from '../../../core/tokens.js';
import type { ConsumerSummary, ObservationDto } from '../../../../../../../libs/api-client/types.js';
import { OfficeScene, type OfficeStatus, type OfficeWorker } from '../office/office-scene.js';

interface WorkerDef {
    id: string;
    label: string;
    role: string;
    color: string;
}

const WORKERS: WorkerDef[] = [
    { id: 'worker-scout', label: 'Scout', role: 'Research', color: '#67e8f9' },
    { id: 'worker-plan', label: 'Plan', role: 'Planner', color: '#60a5fa' },
    { id: 'worker-build', label: 'Build', role: 'Builder', color: '#34d399' },
    { id: 'worker-verify', label: 'Verify', role: 'QA', color: '#a78bfa' },
    { id: 'worker-audit', label: 'Audit', role: 'Auditor', color: '#fbbf24' },
    { id: 'worker-fixbug', label: 'Fixbug', role: 'Fixer', color: '#fb923c' },
    { id: 'worker-qc', label: 'QC 1', role: 'QC', color: '#f472b6' },
    { id: 'worker-qc-2', label: 'QC 2', role: 'QC', color: '#fb7185' },
];

@Component({
    selector: 'eso-office-page',
    standalone: true,
    imports: [MatButtonModule, RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="office-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Operate · office 3D</p>
                    <h1>Worker office</h1>
                    <p class="subtitle">8 staff · 8 desks · handoff graph. Office renders observations; it is not a data source.</p>
                </div>
                <div class="header-actions">
                    <label class="consumer-select">Consumer
                        <select (change)="selectConsumer($any($event.target).value)">
                            @for (consumer of consumers(); track consumer.id) { <option [value]="consumer.id" [selected]="consumer.id === consumerId()">{{ consumer.id }}</option> }
                        </select>
                    </label>
                    <a mat-stroked-button routerLink="/events" [queryParams]="{ consumer: consumerId() }">2D stream</a>
                    <button mat-stroked-button type="button" (click)="resetCamera()">Reset camera</button>
                    <button mat-stroked-button type="button" [disabled]="loading()" (click)="load()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button>
                </div>
            </header>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }

            <section class="office-layout">
                <aside class="team-panel" aria-label="Team roster">
                    <header class="panel-head">
                        <div><p class="eyebrow">Team</p><h2>Staff</h2></div>
                        <span class="live-chip"><i></i> live</span>
                    </header>
                    <div class="roster">
                        @for (worker of workers(); track worker.id) {
                            <button type="button" class="staff-row" [class.selected]="selectedWorker() === worker.id" (click)="selectWorker(worker.id)">
                                <span class="status-dot" [attr.data-status]="worker.status" [style.background]="worker.color"></span>
                                <span class="staff-copy"><strong>{{ worker.label }}</strong><small>{{ worker.role }}</small></span>
                                <span class="staff-state">{{ worker.status }}</span>
                            </button>
                        }
                    </div>
                    @if (selectedWorker(); as id) {
                        <section class="selected-card">
                            <p class="eyebrow">Selected</p>
                            <strong>{{ workerById(id)?.label }}</strong>
                            <span>{{ workerById(id)?.lastEvent || 'no event' }}</span>
                            <a [routerLink]="['/events']" [queryParams]="{ consumer: consumerId(), trace: workerById(id)?.traceId }">Open evidence →</a>
                        </section>
                    }
                </aside>

                <section class="stage">
                    <canvas #canvas class="office-canvas" aria-label="3D worker office"></canvas>
                    <div class="stage-top">
                        <span class="stage-chip">SCENE · isometric office</span>
                        <span class="stage-chip">{{ traceId() || 'no trace' }}</span>
                    </div>
                    <div class="stage-bottom">
                        <span>drag orbit · scroll zoom · click staff</span>
                        <span class="scene-legend"><i class="working"></i>working <i class="done"></i>done <i class="blocked"></i>blocked <i class="offline"></i>offline</span>
                    </div>
                </section>

                <aside class="ops-panel" aria-label="Operations">
                    <section class="mission-card">
                        <header class="panel-head"><div><p class="eyebrow">Current mission</p><h2>{{ missionTitle() }}</h2></div></header>
                        @if (traceSummary(); as summary) {
                            <div class="mission-meta"><span>{{ summary.events }} events</span><span>{{ summary.workers }}/8 staff</span><span class="badge" [class.bad]="summary.outcome === 'FAIL' || summary.outcome === 'BLOCKED'">{{ summary.outcome }}</span></div>
                            <div class="progress"><span [style.width.%]="(summary.workers / 8) * 100"></span></div>
                            <small>{{ summary.lastAt }}</small>
                        }
                    </section>

                    <section class="activity-card">
                        <header class="panel-head"><div><p class="eyebrow">Activity</p><h2>Event pulse</h2></div><a mat-button routerLink="/events" [queryParams]="{ consumer: consumerId() }">all</a></header>
                        @if (activity().length === 0) {
                            <p class="muted">No event in window.</p>
                        } @else {
                            <ul class="activity-list">
                                @for (event of activity(); track event.observationId) {
                                    <li [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'" (click)="selectEvent(event)">
                                        <span class="activity-dot" [style.background]="workerColor(event.workerId)"></span>
                                        <div><code>{{ event.event }}</code><small>{{ event.workerId || '—' }} · {{ event.at }}</small></div>
                                    </li>
                                }
                            </ul>
                        }
                    </section>

                    <a mat-stroked-button class="requests-link" routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">Prompt requests · {{ requestCount() }}</a>
                </aside>
            </section>
        </main>
    `,
    styles: [`
        .office-page { display: grid; gap: var(--space-4); max-width: var(--container); margin: 0 auto; }
        .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
        .page-header h1 { margin: 0 0 var(--space-1); }
        .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: var(--text-xs); margin: 0 0 var(--space-1); }
        .subtitle { color: var(--muted); margin: 0; }
        .header-actions { display: flex; align-items: end; gap: var(--space-2); flex-wrap: wrap; }
        .consumer-select { display: grid; gap: 4px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
        .consumer-select select { padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; }
        .office-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr) 280px; gap: var(--space-3); align-items: stretch; min-height: 660px; }
        .team-panel, .ops-panel { display: grid; align-content: start; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); min-width: 0; }
        .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
        .panel-head h2 { margin: 0; font-size: var(--text-md); }
        .live-chip { display: inline-flex; align-items: center; gap: 4px; color: #22c55e; font-size: 10px; }
        .live-chip i { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
        .roster { display: grid; gap: 5px; }
        .staff-row { display: flex; align-items: center; gap: var(--space-2); padding: 7px 8px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
        .staff-row:hover { background: var(--surface-2); }
        .staff-row.selected { border-color: var(--brand); background: color-mix(in srgb, var(--surface) 88%, var(--brand)); }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent); }
        .staff-copy { display: grid; gap: 1px; min-width: 0; flex: 1; }
        .staff-copy strong { font-size: var(--text-xs); }
        .staff-copy small { color: var(--muted); font-size: 10px; }
        .staff-state { color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
        .selected-card { display: grid; gap: 3px; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
        .selected-card strong { font-size: var(--text-sm); }
        .selected-card span { color: var(--muted); font-size: var(--text-xs); }
        .selected-card a { color: var(--brand); font-size: var(--text-xs); }
        .stage { position: relative; overflow: hidden; min-height: 660px; border: 1px solid var(--line); border-radius: var(--radius-md); background: #0b1016; }
        .office-canvas { display: block; width: 100%; height: 100%; min-height: 660px; touch-action: none; cursor: grab; }
        .office-canvas:active { cursor: grabbing; }
        .stage-top { position: absolute; top: var(--space-3); left: var(--space-3); right: var(--space-3); display: flex; gap: 6px; justify-content: space-between; pointer-events: none; }
        .stage-chip { padding: 4px 8px; border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); border-radius: 999px; background: rgba(8, 13, 20, .62); color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .05em; }
        .stage-bottom { position: absolute; left: var(--space-3); right: var(--space-3); bottom: var(--space-3); display: flex; justify-content: space-between; color: var(--muted); font-size: 9px; pointer-events: none; }
        .scene-legend { display: flex; align-items: center; gap: 6px; }
        .scene-legend i { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-left: 4px; }
        .scene-legend .working { background: #22d3ee; } .scene-legend .done { background: #22c55e; } .scene-legend .blocked { background: #f59e0b; } .scene-legend .offline { background: #475569; }
        .mission-card, .activity-card { display: grid; gap: var(--space-2); padding-bottom: var(--space-3); border-bottom: 1px solid var(--line); }
        .mission-card h2 { font-size: var(--text-sm); overflow-wrap: anywhere; }
        .mission-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); color: var(--muted); font-size: 10px; }
        .badge { padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--surface-2) 80%, var(--brand)); color: var(--ink); font-size: 9px; font-weight: 700; }
        .badge.bad { color: var(--warn-ink, #d97706); }
        .progress { height: 5px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
        .progress span { display: block; height: 100%; background: var(--brand); }
        .mission-card small { color: var(--muted); font-size: 9px; }
        .activity-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 250px; overflow: auto; }
        .activity-list li { display: flex; align-items: center; gap: 7px; padding: 5px 0; cursor: pointer; }
        .activity-list li:hover { background: var(--surface-2); }
        .activity-list li.bad code { color: var(--warn-ink, #d97706); }
        .activity-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
        .activity-list div { display: grid; gap: 1px; min-width: 0; }
        .activity-list code { color: var(--brand); font-size: 10px; overflow: hidden; text-overflow: ellipsis; }
        .activity-list small { color: var(--muted); font-size: 9px; }
        .requests-link { justify-self: stretch; }
        .muted { color: var(--muted); font-size: var(--text-xs); }
        @media (max-width: 1180px) { .office-layout { grid-template-columns: 190px minmax(0, 1fr); } .ops-panel { grid-column: 1 / -1; } .stage, .office-canvas { min-height: 540px; } }
        @media (max-width: 760px) { .office-layout { grid-template-columns: 1fr; } .page-header { flex-direction: column; } .stage, .office-canvas { min-height: 440px; } }
    `],
})
export class OfficePage implements OnInit, AfterViewInit, OnDestroy {
    private readonly api = inject(CONTROL_PLANE_API_CLIENT, { optional: true });
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
    private scene: OfficeScene | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    readonly consumers = signal<ConsumerSummary[]>([]);
    readonly consumerId = signal('');
    readonly observations = signal<ObservationDto[]>([]);
    readonly loading = signal(false);
    readonly error = signal('');
    readonly selectedWorker = signal('');
    readonly sceneReady = signal(false);
    readonly activeTraceId = signal('');

    readonly workers = computed<OfficeWorker[]>(() => {
        const trace = this.activeTraceId();
        const all = this.observations();
        const rows = trace ? all.filter((item) => item.traceId === trace) : all;
        return WORKERS.map((def) => {
            const latest = rows.find((item) => item.workerId === def.id);
            const any = all.find((item) => item.workerId === def.id);
            const status = latest ? this.statusFor(latest) : any ? 'idle' : 'offline';
            return {
                id: def.id,
                label: def.label,
                role: def.role,
                color: def.color,
                status,
                lastEvent: latest?.event || 'no event',
                lastAt: latest?.at || '—',
                traceId: trace,
            };
        });
    });
    readonly traceId = computed(() => this.activeTraceId());
    readonly traceSummary = computed(() => {
        const trace = this.traceId();
        if (!trace) return null;
        const rows = this.observations().filter((item) => item.traceId === trace);
        const last = rows[0];
        return { events: rows.length, workers: new Set(rows.map((item) => item.workerId).filter(Boolean)).size, outcome: last?.outcome || '—', lastAt: last?.at || '' };
    });
    readonly missionTitle = computed(() => this.traceId() || 'No active mission');
    readonly activity = computed(() => this.observations().slice(0, 12));
    readonly requestCount = computed(() => this.observations().filter((item) => item.event === 'prompt.submitted').length);

    private readonly syncScene = effect(() => {
        const workers = this.workers();
        if (!this.sceneReady() || !this.scene) return;
        this.scene.setWorkers(workers);
        const selected = this.selectedWorker();
        if (selected) this.scene.setSelected(selected);
    });

    ngOnInit(): void {
        void this.init();
        this.timer = setInterval(() => { if (!this.loading()) void this.load(); }, 5000);
    }

    ngAfterViewInit(): void {
        const canvas = this.canvas()?.nativeElement;
        if (!canvas) return;
        this.scene = new OfficeScene(canvas, (workerId) => this.selectWorker(workerId));
        this.sceneReady.set(true);
    }

    ngOnDestroy(): void {
        if (this.timer) clearInterval(this.timer);
        this.scene?.dispose();
        this.syncScene.destroy();
    }

    private async init(): Promise<void> {
        if (!this.api) return;
        try {
            const list = await this.api.listConsumers();
            this.consumers.set(list.items || []);
        } catch (error) {
            this.error.set((error as Error)?.message || 'Unable to load consumers');
        }
        const query = this.route.snapshot.queryParamMap;
        const requested = query.get('consumer') || '';
        const fallback = this.consumers()[0]?.id || '';
        this.consumerId.set(requested && this.consumers().some((item) => item.id === requested) ? requested : fallback);
        if (this.consumerId()) await this.load();
    }

    selectConsumer(id: string): void {
        this.consumerId.set(id);
        this.selectedWorker.set('');
        void this.router.navigate([], { relativeTo: this.route, queryParams: { consumer: id }, queryParamsHandling: 'merge', replaceUrl: true });
        void this.load();
    }

    async load(): Promise<void> {
        if (!this.api || !this.consumerId()) return;
        this.loading.set(true);
        this.error.set('');
        try {
            const rows = await this.api.getConsumerObservations(this.consumerId(), 500);
            const sorted = [...rows].sort((left, right) => String(right.at || right.receivedAt).localeCompare(String(left.at || left.receivedAt)));
            this.observations.set(sorted);
            const counts = new Map<string, number>();
            for (const event of sorted) counts.set(event.traceId, (counts.get(event.traceId) || 0) + 1);
            const best = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || sorted[0]?.traceId || '';
            if (best && best !== this.activeTraceId()) this.activeTraceId.set(best);
        } catch (error) {
            this.error.set((error as Error)?.message || 'Unable to load events');
        } finally {
            this.loading.set(false);
        }
    }

    selectWorker(id: string): void {
        this.selectedWorker.set(id);
        this.scene?.setSelected(id);
    }

    selectEvent(event: ObservationDto): void {
        if (event.workerId) this.selectWorker(event.workerId);
    }

    resetCamera(): void {
        this.scene?.resetCamera();
    }

    workerById(id: string): OfficeWorker | undefined {
        return this.workers().find((item) => item.id === id);
    }

    workerColor(workerId: string | null | undefined): string {
        return WORKERS.find((item) => item.id === workerId)?.color || '#64748b';
    }

    private statusFor(event: ObservationDto | undefined): OfficeStatus {
        if (!event) return 'offline';
        if (event.event === 'prompt.submitted') return 'working';
        if (event.outcome === 'FAIL' || event.outcome === 'BLOCKED') return 'blocked';
        if (event.outcome === 'PASS') return 'done';
        return 'thinking';
    }
}
