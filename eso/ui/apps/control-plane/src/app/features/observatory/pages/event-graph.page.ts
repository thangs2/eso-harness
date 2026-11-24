import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CONTROL_PLANE_API_CLIENT } from '../../../core/tokens.js';
import type { ConsumerSummary, ObservationDto } from '../../../../../../../libs/api-client/types.js';

interface Point3D {
    x: number;
    y: number;
    z: number;
    color: string;
    label: string;
    event: ObservationDto;
}

@Component({
    selector: 'eso-event-graph-page',
    standalone: true,
    imports: [MatButtonModule, RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="graph-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Observatory · 3D event graph</p>
                    <h1>Event graph 3D</h1>
                    <p class="subtitle">x = time · y = worker · z = trace depth. Same event store as the 2D timeline. Read-only.</p>
                </div>
                <div class="header-actions">
                    <a mat-stroked-button routerLink="/observatory">Observatory</a>
                    <button mat-stroked-button type="button" (click)="resetView()">Reset view</button>
                    <button mat-stroked-button type="button" (click)="load()" [disabled]="loading()">{{ loading() ? 'Loading…' : 'Refresh' }}</button>
                </div>
            </header>

            <section class="controls">
                <label>Consumer
                    <select (change)="selectConsumer($any($event.target).value)">
                        @for (consumer of consumers(); track consumer.id) { <option [value]="consumer.id" [selected]="consumer.id === consumerId()">{{ consumer.id }}</option> }
                    </select>
                </label>
                <label class="inline"><input type="checkbox" [checked]="autoRotate()" (change)="autoRotate.set($any($event.target).checked)"> Auto-rotate</label>
                <span class="hint">Drag to rotate · scroll to zoom</span>
                <span class="legend"><i class="dot pass"></i>completed <i class="dot fail"></i>failed <i class="dot prompt"></i>request</span>
            </section>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }

            <section class="canvas-panel">
                <canvas #canvas class="graph-canvas" (pointerdown)="onPointerDown($event)" (pointermove)="onPointerMove($event)" (pointerup)="onPointerUp()" (pointercancel)="onPointerUp()" (wheel)="onWheel($event)"></canvas>
                @if (!loading() && observations().length === 0) {
                    <p class="canvas-empty">No events in the loaded window.</p>
                }
                <div class="canvas-foot"><span>{{ observations().length }} events · {{ traceCount() }} traces · {{ workerCount() }} workers</span><span>same event store as 2D</span></div>
            </section>
        </main>
    `,
    styles: [`
        .graph-page { display: grid; gap: var(--space-4); max-width: var(--container); margin: 0 auto; }
        .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
        .page-header h1 { margin: 0 0 var(--space-1); }
        .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: var(--text-xs); margin: 0 0 var(--space-1); }
        .subtitle { color: var(--muted); margin: 0; }
        .header-actions { display: flex; gap: var(--space-2); }
        .controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); font-size: var(--text-xs); }
        .controls label { display: flex; align-items: center; gap: 6px; color: var(--muted); }
        .controls select { padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; }
        .hint { color: var(--muted); }
        .legend { display: flex; align-items: center; gap: 6px; margin-left: auto; color: var(--muted); }
        .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .dot.pass { background: #22c55e; } .dot.fail { background: #f59e0b; } .dot.prompt { background: #67e8f9; }
        .canvas-panel { position: relative; min-height: 620px; border: 1px solid var(--line); border-radius: var(--radius-md); background: radial-gradient(circle at 50% 40%, #15202b 0%, #0b1016 70%); overflow: hidden; }
        .graph-canvas { display: block; width: 100%; height: 620px; touch-action: none; cursor: grab; }
        .graph-canvas:active { cursor: grabbing; }
        .canvas-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
        .canvas-foot { position: absolute; left: var(--space-4); right: var(--space-4); bottom: var(--space-3); display: flex; justify-content: space-between; color: var(--muted); font-size: 10px; pointer-events: none; }
        @media (max-width: 800px) { .page-header { flex-direction: column; } .legend { margin-left: 0; } .canvas-panel, .graph-canvas { min-height: 480px; height: 480px; } }
    `],
})
export class EventGraphPage implements OnInit, AfterViewInit, OnDestroy {
    private readonly api = inject(CONTROL_PLANE_API_CLIENT, { optional: true });
    private readonly route = inject(ActivatedRoute);
    private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
    private frame: number | null = null;
    private dragging = false;
    private lastX = 0;
    private lastY = 0;
    private yaw = -0.55;
    private pitch = 0.45;
    private zoom = 1;

    readonly consumers = signal<ConsumerSummary[]>([]);
    readonly consumerId = signal('');
    readonly observations = signal<ObservationDto[]>([]);
    readonly loading = signal(false);
    readonly error = signal('');
    readonly autoRotate = signal(true);
    readonly traceCount = computed(() => new Set(this.observations().map((item) => item.traceId)).size);
    readonly workerCount = computed(() => new Set(this.observations().map((item) => item.workerId).filter(Boolean)).size);

    ngOnInit(): void {
        void this.init();
    }

    ngAfterViewInit(): void {
        this.animate();
    }

    ngOnDestroy(): void {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        window.removeEventListener('resize', this.onResize);
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
        window.addEventListener('resize', this.onResize);
        if (this.consumerId()) await this.load();
    }

    selectConsumer(id: string): void {
        this.consumerId.set(id);
        void this.load();
    }

    async load(): Promise<void> {
        if (!this.api || !this.consumerId()) return;
        this.loading.set(true);
        this.error.set('');
        try {
            const rows = await this.api.getConsumerObservations(this.consumerId(), 500);
            this.observations.set([...rows].sort((left, right) => String(left.at).localeCompare(String(right.at))));
        } catch (error) {
            this.error.set((error as Error)?.message || 'Unable to load events');
        } finally {
            this.loading.set(false);
        }
    }

    private readonly onResize = () => { /* canvas is resized on every frame */ };

    private animate = (): void => {
        if (this.autoRotate()) this.yaw += 0.0025;
        this.draw();
        this.frame = requestAnimationFrame(this.animate);
    };

    private prepare(): { points: Point3D[]; traces: string[]; workers: string[] } {
        const rows = this.observations();
        const traces = [...new Set(rows.map((item) => item.traceId))].slice(-10);
        const workers = [...new Set(rows.map((item) => item.workerId || 'unknown'))];
        const traceTimes = new Map<string, { start: number; span: number }>();
        for (const trace of traces) {
            const times = rows.filter((item) => item.traceId === trace).map((item) => new Date(item.at || item.receivedAt).getTime()).filter((value) => Number.isFinite(value));
            const start = times.length ? Math.min(...times) : 0;
            const end = times.length ? Math.max(...times) : 1;
            traceTimes.set(trace, { start, span: Math.max(1, end - start) });
        }
        const points: Point3D[] = [];
        for (const event of rows) {
            const traceIndex = traces.indexOf(event.traceId);
            if (traceIndex < 0) continue;
            const workerIndex = workers.indexOf(event.workerId || 'unknown');
            const time = new Date(event.at || event.receivedAt).getTime();
            const window = traceTimes.get(event.traceId) || { start: 0, span: 1 };
            const color = event.event === 'prompt.submitted' ? '#67e8f9'
                : event.outcome === 'FAIL' || event.outcome === 'BLOCKED' ? '#f59e0b'
                    : '#22c55e';
            points.push({
                x: ((time - window.start) / window.span) * 2 - 1,
                y: workers.length === 1 ? 0 : (workerIndex / (workers.length - 1)) * 2 - 1,
                z: traces.length === 1 ? 0 : (traceIndex / (traces.length - 1)) * 2 - 1,
                color,
                label: event.event,
                event,
            });
        }
        return { points, traces, workers };
    }

    private draw(): void {
        const canvas = this.canvasRef()?.nativeElement;
        if (!canvas) return;
        const parent = canvas.parentElement;
        const width = parent?.clientWidth || 960;
        const height = parent?.clientHeight || 620;
        if (canvas.width !== width * devicePixelRatio || canvas.height !== height * devicePixelRatio) {
            canvas.width = width * devicePixelRatio;
            canvas.height = height * devicePixelRatio;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const { points, traces, workers } = this.prepare();
        const cx = width / 2;
        const cy = height / 2;
        const scale = Math.min(width, height) * 0.31 * this.zoom;
        const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
        const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
        const project = (x: number, y: number, z: number) => {
            const rx = x * cosY - z * sinY;
            const rz = x * sinY + z * cosY;
            const ry = y * cosP - rz * sinP;
            const depth = y * sinP + rz * cosP;
            const perspective = 1 / (1 + depth * 0.24);
            return { x: cx + rx * scale * perspective, y: cy - ry * scale * perspective, depth };
        };

        // worker grid planes
        ctx.lineWidth = 1;
        for (let w = 0; w < workers.length; w += 1) {
            const y = workers.length === 1 ? 0 : (w / (workers.length - 1)) * 2 - 1;
            ctx.strokeStyle = 'rgba(148,163,184,0.14)';
            ctx.beginPath();
            const a = project(-1, y, -1);
            const b = project(1, y, -1);
            const c = project(1, y, 1);
            const d = project(-1, y, 1);
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.stroke();
            ctx.fillStyle = 'rgba(148,163,184,0.8)';
            ctx.font = '10px ui-sans-serif, system-ui';
            const label = project(-1.05, y, -1);
            ctx.fillText(workers[w], label.x - 40, label.y + 3);
        }

        // trace lines
        for (const trace of traces) {
            const tracePoints = points.filter((point) => point.event.traceId === trace);
            if (tracePoints.length < 2) continue;
            ctx.strokeStyle = 'rgba(103,232,249,0.18)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            tracePoints.forEach((point, index) => {
                const p = project(point.x, point.y, point.z);
                if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
        }

        // events: far to near
        const projected = points.map((point) => ({ point, p: project(point.x, point.y, point.z) })).sort((left, right) => left.p.depth - right.p.depth);
        for (const item of projected) {
            const radius = item.point.event.event === 'prompt.submitted' ? 4.5 : 3;
            ctx.beginPath();
            ctx.arc(item.p.x, item.p.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = item.point.color;
            ctx.globalAlpha = 0.9;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.font = '10px ui-sans-serif, system-ui';
        ctx.fillText('time →', width - 74, height - 28);
        ctx.fillText('worker / trace depth', 16, 22);
    }

    resetView(): void {
        this.yaw = -0.55;
        this.pitch = 0.45;
        this.zoom = 1;
    }

    onPointerDown(event: PointerEvent): void {
        this.dragging = true;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    }

    onPointerMove(event: PointerEvent): void {
        if (!this.dragging) return;
        this.yaw += (event.clientX - this.lastX) * 0.006;
        this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch + (event.clientY - this.lastY) * 0.004));
        this.lastX = event.clientX;
        this.lastY = event.clientY;
    }

    onPointerUp(): void {
        this.dragging = false;
    }

    onWheel(event: WheelEvent): void {
        event.preventDefault();
        this.zoom = Math.max(0.5, Math.min(2.5, this.zoom * (event.deltaY > 0 ? 0.95 : 1.05)));
    }
}
