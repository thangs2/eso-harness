import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, input } from '@angular/core';
import type { ObservationDto } from '../../../../../../../libs/api-client/types.js';

export type OfficeRoomState = 'idle' | 'working' | 'done' | 'blocked';

export interface OfficeWorker {
    id: string;
    label: string;
    events: number;
    failures: number;
    state?: OfficeRoomState;
}

interface OfficeRoom {
    id: string;
    label: string;
    index: number;
    theme: string;
    accent: string;
    events: number;
    failures: number;
    state: OfficeRoomState;
    x: number;
    y: number;
    scale: number;
    labelSide: 'top' | 'bottom';
}

const THEMES: Record<string, { theme: string; accent: string }> = {
    scout: { theme: 'Research', accent: '#60a5fa' },
    plan: { theme: 'Planning', accent: '#a78bfa' },
    build: { theme: 'Engineering', accent: '#34d399' },
    verify: { theme: 'Verification', accent: '#fbbf24' },
    audit: { theme: 'Audit', accent: '#f472b6' },
    qc: { theme: 'Quality', accent: '#22d3ee' },
    'qc-2': { theme: 'Quality 2', accent: '#2dd4bf' },
    fixbug: { theme: 'Repair Bay', accent: '#fb923c' },
};

/** 2.5D office: modular rooms arranged around the Lead brain. */
@Component({
    selector: 'eso-office-2d5d',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="office-stage" [class.playing]="playing()">
            <div class="office-floor" aria-hidden="true"></div>

            <svg class="office-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                    <marker id="office-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#5aa9ff"></path>
                    </marker>
                </defs>
                @for (link of linkViews(); track link.id) {
                    <path class="office-link" [class.on-path]="link.onPath" [class.active]="link.active" [attr.d]="link.d" [attr.marker-end]="link.onPath ? 'url(#office-arrow)' : null" vector-effect="non-scaling-stroke"></path>
                    @if (playing() && link.active) {
                        <circle class="office-packet" r=".55" vector-effect="non-scaling-stroke">
                            <animateMotion [attr.path]="link.d" dur="1.1s" begin="0s" repeatCount="indefinite"></animateMotion>
                        </circle>
                    }
                }
            </svg>
            @for (link of stepLinks(); track link.id) {
                <span class="office-step" [class.active]="link.active" [style.left.%]="link.midX" [style.top.%]="link.midY">{{ link.step }}</span>
            }

            <button type="button" class="brain" [class.active]="playing()" (click)="selectWorker.emit('')" aria-label="Lead brain">
                <span class="brain-ring"></span>
                <span class="brain-core">L</span>
                <strong>LEAD</strong>
                <small>brain · {{ totalEvents() }} ev</small>
            </button>

            @for (room of rooms(); track room.id) {
                <button type="button" class="room" [style.--room-scale]="room.scale" [class.label-top]="room.labelSide === 'top'" [class.working]="room.state === 'working'" [class.done]="room.state === 'done'" [class.blocked]="room.state === 'blocked'" [class.selected]="room.id === selectedWorker()" [style.left.%]="room.x" [style.top.%]="room.y" [style.--accent]="room.accent" (click)="selectWorker.emit(room.id)">
                    <span class="room-index">{{ room.index }}</span>
                    <span class="room-art" aria-hidden="true">
                        <span class="room-shadow"></span>
                        <span class="room-floor"></span>
                        <span class="room-wall back"></span>
                        <span class="room-wall side"></span>
                        <span class="room-desk"></span>
                        <span class="room-screen"></span>
                        <span class="room-plant"></span>
                        <span class="room-character"><i class="head"></i><i class="body"></i></span>
                    </span>
                    <span class="room-label"><strong>{{ room.label }}</strong><small>{{ room.theme }} · {{ room.events }} ev</small></span>
                    <span class="room-state">{{ room.state }}</span>
                </button>
            }

            <div class="office-legend">
                <span><i class="dot idle"></i>idle</span>
                <span><i class="dot working"></i>working</span>
                <span><i class="dot done"></i>done</span>
                <span><i class="dot blocked"></i>blocked</span>
                <span>Lead · central brain</span>
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; }
        .office-stage { position: relative; height: 560px; overflow: hidden; border: 1px solid var(--line, #253047); border-radius: 12px; background: radial-gradient(circle at 50% 44%, #1a2c42 0%, #0a101a 68%); isolation: isolate; }
        .office-floor { position: absolute; left: 7%; right: 7%; top: 15%; bottom: 7%; border: 1px solid rgba(90,169,255,.13); border-radius: 18px; background-image: linear-gradient(rgba(90,169,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(90,169,255,.06) 1px, transparent 1px); background-size: 42px 42px; transform: perspective(900px) rotateX(56deg) rotateZ(-45deg); transform-origin: center; opacity: .85; z-index: 0; }
.office-links { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; overflow: visible; pointer-events: none; }
        .office-link { fill: none; stroke: #314764; stroke-width: .8; stroke-dasharray: 1.6 1.6; opacity: .45; }
        .office-link.on-path { stroke: #5aa9ff; stroke-width: 1.2; stroke-dasharray: none; opacity: .9; filter: drop-shadow(0 0 4px rgba(90,169,255,.45)); }
        .office-link.active { stroke: #7dd3fc; stroke-width: 1.5; opacity: 1; filter: drop-shadow(0 0 6px rgba(125,211,252,.75)); }
        .office-packet { fill: #7dd3fc; filter: drop-shadow(0 0 4px #5aa9ff); }
        .office-step { position: absolute; z-index: 4; display: grid; place-items: center; width: 16px; height: 16px; border: 1px solid rgba(90,169,255,.5); border-radius: 50%; background: #0d1622; color: #7dd3fc; font-size: 8px; font-weight: 700; transform: translate(-50%,-50%); pointer-events: none; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
        .office-step.active { border-color: #7dd3fc; background: #123147; color: #fff; box-shadow: 0 0 10px rgba(125,211,252,.45); }
        .brain { position: absolute; left: 50%; top: 50%; z-index: 3; display: grid; justify-items: center; gap: 1px; width: 112px; padding: 10px 8px; border: 1px solid rgba(90,169,255,.62); border-radius: 16px; background: radial-gradient(circle at 50% 18%, #20435e 0%, #0e1929 78%); color: #e0f2fe; box-shadow: 0 0 38px rgba(90,169,255,.2), 0 18px 34px rgba(0,0,0,.5); transform: translate(-50%,-50%); cursor: pointer; font: inherit; }
        .brain.active { animation: brain-pulse 1.5s ease-in-out infinite; }
        .brain-ring { position: absolute; inset: -28px; border: 1px solid rgba(90,169,255,.13); border-radius: 50%; box-shadow: inset 0 0 34px rgba(90,169,255,.13); pointer-events: none; }
        .brain-core { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid #5aa9ff; border-radius: 50%; background: #17304a; color: #fff; font-size: 13px; font-weight: 700; }
        .brain strong { font-size: 11px; letter-spacing: .09em; }
        .brain small { color: #8fb3d1; font-size: 9px; }

        .room { position: absolute; z-index: 2; display: grid; justify-items: center; gap: 3px; width: 136px; scale: var(--room-scale, 1); padding: 0; border: 0; background: transparent; color: #cbd5e1; cursor: pointer; transform: translate(-50%,-50%); font: inherit; text-align: center; }
        .room-index { position: absolute; top: 8px; left: 6px; z-index: 4; display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid #2b3b52; border-radius: 50%; background: #0d1118; color: #94a3b8; font-size: 8px; }
        .room-theme { position: relative; z-index: 3; margin-top: 2px; color: var(--accent); font-size: 8px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; text-shadow: 0 1px 2px #000; }
        .room-art { position: relative; display: block; width: 128px; height: 88px; transform: scale(.92); transition: transform .2s ease, filter .2s ease; }
        .room:hover .room-art, .room.selected .room-art { transform: scale(1); filter: brightness(1.12); }
        .room-shadow { position: absolute; left: 18px; right: 8px; bottom: 7px; height: 16px; border-radius: 50%; background: rgba(0,0,0,.4); filter: blur(5px); }
        .room-floor { position: absolute; left: 18px; right: 8px; bottom: 10px; height: 52px; border: 1px solid color-mix(in srgb, var(--accent) 32%, #253047); background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 15%, #141c28), #0e1621); transform: skewY(-18deg); border-radius: 3px; }
        .room-wall { position: absolute; border: 1px solid color-mix(in srgb, var(--accent) 26%, #253047); background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 11%, #151e2b), #0f1722); }
        .room-wall.back { left: 24px; top: 9px; width: 82px; height: 42px; transform: skewY(-18deg); }
        .room-wall.side { left: 24px; top: 25px; width: 22px; height: 44px; transform: skewY(18deg); }
        .room-desk { position: absolute; left: 39px; bottom: 25px; width: 57px; height: 8px; border: 1px solid #33445b; border-radius: 2px; background: #243246; transform: skewY(-14deg); }
        .room-screen { position: absolute; left: 57px; bottom: 36px; width: 25px; height: 17px; border: 1px solid color-mix(in srgb, var(--accent) 55%, #33445b); border-radius: 2px; background: color-mix(in srgb, var(--accent) 22%, #07111d); box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 25%, transparent); }
        .room-plant { position: absolute; right: 20px; bottom: 31px; width: 7px; height: 14px; border-radius: 4px 4px 1px 1px; background: #2f7d52; box-shadow: -5px 5px 0 -2px #256843, 5px 7px 0 -3px #256843; }
        .room-character { position: absolute; left: 42px; bottom: 31px; width: 18px; height: 27px; }
        .head { position: absolute; left: 4px; top: 0; width: 10px; height: 10px; border-radius: 50%; background: #d6b28a; box-shadow: inset 0 -2px 0 rgba(0,0,0,.18); }
        .body { position: absolute; left: 2px; top: 9px; width: 14px; height: 16px; border-radius: 6px 6px 3px 3px; background: var(--accent); opacity: .9; }
        .room-label { position: relative; z-index: 3; display: grid; gap: 1px; width: 92px; padding: 2px 5px; border: 1px solid #2b3b52; border-radius: 7px; background: rgba(13,17,24,.94); box-shadow: 0 6px 14px rgba(0,0,0,.35); }
        .room-label strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; color: #e2e8f0; }
        .room-label small { color: #8b97ab; font-size: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .room-state { position: absolute; top: 7px; right: 3px; z-index: 4; padding: 1px 5px; border: 1px solid #2b3b52; border-radius: 999px; background: #0d1118; color: #8b97ab; font-size: 7px; text-transform: uppercase; letter-spacing: .04em; }
        .room.done .room-state { color: #6ee7b7; border-color: rgba(110,231,183,.35); }
        .room.blocked .room-state { color: #fca5a5; border-color: rgba(252,165,165,.4); }
        .room.working .room-state { color: #7dd3fc; border-color: rgba(125,211,252,.45); }
        .room.working .room-screen { animation: screen-flicker 1.2s steps(2,end) infinite; }
        .room.working .head { animation: head-bob .9s ease-in-out infinite; }
        .room.done .room-art { filter: drop-shadow(0 0 8px rgba(78,201,122,.25)); }
        .room.blocked .room-art { filter: drop-shadow(0 0 8px rgba(255,107,107,.3)); }
        .room.blocked .room-art { animation: room-shake .45s ease-in-out infinite; }
        .room.working, .room.done, .room.blocked { filter: none; }
        .room.label-top { display: flex; flex-direction: column-reverse; }
        .room.label-top .room-label { margin-bottom: 2px; }
        .room.selected .room-label { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent), 0 8px 18px rgba(0,0,0,.4); }
        .office-legend { position: absolute; left: 12px; bottom: 10px; z-index: 5; display: flex; align-items: center; gap: 12px; color: #8b97ab; font-size: 9px; }
        .office-legend .dot { display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 50%; background: #64748b; }
        .office-legend .dot.working { background: #5aa9ff; } .office-legend .dot.done { background: #4ec97a; } .office-legend .dot.blocked { background: #ff6b6b; }
        @keyframes brain-pulse { 0%,100% { box-shadow: 0 0 30px rgba(90,169,255,.18), 0 18px 34px rgba(0,0,0,.5); } 50% { box-shadow: 0 0 52px rgba(90,169,255,.42), 0 18px 34px rgba(0,0,0,.5); } }
        @keyframes screen-flicker { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
        @keyframes head-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
        @keyframes room-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-1px); } 75% { transform: translateX(1px); } }
        @media (max-width: 900px) { .office-stage { min-height: 520px; } .room { width: 126px; } .room-art { transform: scale(.8); } }
        @media (prefers-reduced-motion: reduce) { .brain, .room, .room-art, .room-screen, .head { animation: none !important; transition: none !important; } }
    `],
})
export class Office2d5dComponent {
    readonly workers = input<OfficeWorker[]>([]);
    readonly edges = input<{ from: string; to: string }[]>([]);
    readonly events = input<ObservationDto[]>([]);
    readonly pulseIndex = input(0);
    readonly playing = input(false);
    readonly selectedWorker = input('');
    @Output() readonly selectWorker = new EventEmitter<string>();

    readonly rooms = computed<OfficeRoom[]>(() => {
        const workers = this.workers();
        const visible = this.events().slice(0, Math.max(0, this.pulseIndex()));
        const count = workers.length;
        const center = { x: 50, y: 50 };
        const innerCount = Math.min(8, count);
        return workers.map((worker, index) => {
            const meta = THEMES[worker.id] || THEMES[worker.id.replace(/^worker-/, '')] || { theme: 'Workspace', accent: '#60a5fa' };
            let x = center.x;
            let y = center.y;
            let scale = 1;
            if (index < innerCount) {
                const angle = (-90 + (360 / Math.max(1, innerCount)) * index) * Math.PI / 180;
                x = center.x + Math.cos(angle) * 33;
                y = center.y + Math.sin(angle) * 29;
                scale = count > 8 ? .84 : .92;
            } else {
                const outerIndex = index - innerCount;
                const angle = (90 + outerIndex * 38) * Math.PI / 180;
                x = center.x + Math.cos(angle) * 43;
                y = center.y + Math.sin(angle) * 37;
                scale = .76;
            }
            const latest = [...visible].reverse().find((event) => event.workerId === worker.id);
            let state: OfficeRoomState = 'idle';
            if (latest?.event === 'prompt.submitted') state = 'working';
            else if (latest?.outcome === 'PASS') state = 'done';
            else if (latest?.outcome === 'FAIL' || latest?.outcome === 'BLOCKED') state = 'blocked';
            else if (!visible.length) state = worker.state || 'idle';
            return { id: worker.id, label: worker.label, index: index + 1, theme: meta.theme, accent: meta.accent, events: worker.events, failures: worker.failures, state, x, y, scale, labelSide: y < 48 ? 'top' : 'bottom' };
        });
    });
    readonly workerOrder = computed<string[]>(() => {
        const visible = this.events().slice(0, Math.max(0, this.pulseIndex())).filter((event) => event.workerId);
        const order: string[] = [];
        for (const event of visible) if (order[order.length - 1] !== event.workerId) order.push(event.workerId!);
        return order;
    });
    readonly linkViews = computed(() => {
        const order = this.workerOrder();
        const pairs = order.slice(1).map((to, index) => ({ from: order[index], to }));
        const rooms = new Map(this.rooms().map((room) => [room.id, room]));
        return this.edges().map((edge, index) => {
            const from = rooms.get(edge.from);
            const to = rooms.get(edge.to);
            if (!from || !to) return { id: String(index), d: '', midX: 0, midY: 0, onPath: false, active: false, step: 0 };
            const stepIndex = pairs.findIndex((pair) => pair.from === from.id && pair.to === to.id);
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2 - 5;
            const d = `M ${from.x} ${from.y} Q ${midX} ${(from.y + to.y) / 2 - 8} ${to.x} ${to.y}`;
            return { id: `${from.id}-${to.id}-${index}`, d, midX, midY, onPath: stepIndex >= 0, active: stepIndex === pairs.length - 1 && stepIndex >= 0, step: stepIndex + 1 };
        });
    });
    readonly stepLinks = computed(() => this.linkViews().filter((link) => link.onPath));
    readonly totalEvents = computed(() => this.workers().reduce((sum, worker) => sum + worker.events, 0));
}
