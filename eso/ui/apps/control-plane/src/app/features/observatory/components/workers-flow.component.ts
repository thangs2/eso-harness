import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, input } from '@angular/core';
import type { ObservationDto } from '../../../../../../../libs/api-client/types.js';
import type { OfficeWorker } from './office-2d5d.component.js';

interface FlowEdge { from: string; to: string; }
interface FlowNode { id: string; label: string; x: number; y: number; state: string; }

/** Worker flow layer: positions follow the Seven-Star Formation SVG node locations. */
@Component({
    selector: 'eso-workers-flow',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="flow-layer">
            <svg viewBox="0 0 800 560" role="img" aria-label="Worker flow">
                <defs>
                    <marker id="wf-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b5673"></path>
                    </marker>
                </defs>
                @for (edge of edgeViews(); track edge.id) {
                    <g class="edge" [class.active]="edge.active">
                        <path [attr.d]="edge.d" marker-end="url(#wf-arrow)"></path>
                        @if (playing() && edge.active) {
                            <circle class="packet" r="2.6">
                                <animateMotion [attr.path]="edge.d" dur="1.3s" begin="0s" repeatCount="indefinite"></animateMotion>
                            </circle>
                        }
                    </g>
                }
                @for (node of nodes(); track node.id) {
                    <g class="node" [class.active]="node.id === activeId() || node.id === selectedWorker()" [class.selected]="node.id === selectedWorker()" [class.working]="node.state === 'working'" [class.done]="node.state === 'done'" [class.blocked]="node.state === 'blocked'" (click)="selectWorker.emit(node.id)">
                        <rect [attr.x]="node.x - 42" [attr.y]="node.y - 15" width="84" height="30" rx="8"></rect>
                        <circle [attr.cx]="node.x - 30" [attr.cy]="node.y" r="3" class="state-dot"></circle>
                        <text [attr.x]="node.x - 19" [attr.y]="node.y + 4">{{ node.label }}</text>
                    </g>
                }
            </svg>
            <div class="flow-note">Flow layer · worker positions mapped to the Seven-Star Formation SVG</div>
        </div>
    `,
    styles: [`
        :host { display: block; }
        .flow-layer { position: relative; height: 560px; border: 1px solid var(--line, #253047); border-radius: 10px; background: radial-gradient(circle at 50% 45%, #122034 0%, #0a101a 70%); overflow: hidden; }
        .flow-layer::before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgba(90,169,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(90,169,255,.04) 1px, transparent 1px); background-size: 36px 36px; pointer-events: none; }
        svg { position: relative; z-index: 1; display: block; width: 100%; height: 100%; }
        .edge path { fill: none; stroke: #314764; stroke-width: 1.1; transition: stroke .2s ease; }
        .edge.active path { stroke: #5aa9ff; stroke-width: 1.6; filter: drop-shadow(0 0 4px rgba(90,169,255,.5)); }
        .packet { fill: #7dd3fc; filter: drop-shadow(0 0 5px #5aa9ff); }
        .node { cursor: pointer; }
        .node rect { fill: #111926; stroke: #2b3b52; stroke-width: 1; transition: fill .2s ease, stroke .2s ease; }
        .node text { fill: #cbd5e1; font-size: 11px; font-weight: 600; font-family: ui-sans-serif, system-ui, sans-serif; }
        .node .state-dot { fill: #64748b; }
        .node:hover rect { stroke: #5aa9ff; }
        .node.selected rect { stroke: #5aa9ff; fill: #16263c; }
        .node.selected text { fill: #fff; }
        .node.active rect { fill: #142a3d; stroke: #5aa9ff; filter: drop-shadow(0 0 8px rgba(90,169,255,.3)); animation: node-pulse 1.4s ease-in-out infinite; }
        .node.working .state-dot { fill: #5aa9ff; animation: dot-blink .8s steps(2,end) infinite; }
        .node.done .state-dot { fill: #4ec97a; }
        .node.blocked .state-dot { fill: #ff6b6b; }
        .flow-note { position: absolute; left: 12px; bottom: 9px; z-index: 2; color: #6f8096; font-size: 9px; }
        @keyframes node-pulse { 0%,100% { opacity: 1; } 50% { opacity: .72; } }
        @keyframes dot-blink { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
        @media (prefers-reduced-motion: reduce) { .node.active rect, .node.working .state-dot { animation: none !important; } }
    `],
})
export class WorkersFlowComponent {
    readonly workers = input<OfficeWorker[]>([]);
    readonly edges = input<FlowEdge[]>([]);
    readonly events = input<ObservationDto[]>([]);
    readonly pulseIndex = input(0);
    readonly playing = input(false);
    readonly selectedWorker = input('');
    @Output() readonly selectWorker = new EventEmitter<string>();

    private readonly positions: Record<string, { x: number; y: number }> = {
        'worker-scout': { x: 392, y: 70 },
        'worker-plan': { x: 445, y: 122 },
        'worker-build': { x: 390, y: 268 },
        'worker-verify': { x: 423, y: 328 },
        'worker-audit': { x: 260, y: 404 },
        'worker-qc': { x: 218, y: 506 },
        'worker-qc-2': { x: 584, y: 506 },
        'worker-fixbug': { x: 423, y: 474 },
    };
    readonly nodes = computed<FlowNode[]>(() => {
        const visible = this.events().slice(0, Math.max(0, this.pulseIndex()));
        const inTrace = new Set(visible.map((event) => event.workerId).filter(Boolean) as string[]);
        return this.workers().map((worker) => {
            const point = this.positions[worker.id] || { x: 400, y: 280 };
            const latest = [...visible].reverse().find((event) => event.workerId === worker.id);
            let state = 'idle';
            if (!visible.length) state = worker.state || 'idle';
            else if (latest?.event === 'prompt.submitted') state = 'working';
            else if (latest?.outcome === 'PASS') state = 'done';
            else if (latest?.outcome === 'FAIL' || latest?.outcome === 'BLOCKED') state = 'blocked';
            else if (inTrace.has(worker.id)) state = 'working';
            return { id: worker.id, label: worker.label, x: point.x, y: point.y, state };
        });
    });
    readonly workerOrder = computed<string[]>(() => {
        const visible = this.events().slice(0, Math.max(0, this.pulseIndex())).filter((event) => event.workerId);
        const order: string[] = [];
        for (const event of visible) if (order[order.length - 1] !== event.workerId) order.push(event.workerId!);
        return order;
    });
    readonly activeId = computed(() => this.workerOrder().at(-1) || this.selectedWorker());
    readonly edgeViews = computed(() => {
        const nodes = new Map(this.nodes().map((node) => [node.id, node]));
        const order = this.workerOrder();
        const active = this.activeId();
        const previous = order.length > 1 ? order[order.length - 2] : '';
        return this.edges().map((edge, index) => {
            const from = nodes.get(edge.from);
            const to = nodes.get(edge.to);
            if (!from || !to) return { id: String(index), d: '', active: false, onPath: false };
            const midX = (from.x + to.x) / 2;
            const d = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
            const onPath = order.some((id, i) => i > 0 && order[i - 1] === edge.from && id === edge.to);
            return { id: `${edge.from}-${edge.to}`, d, active: edge.from === previous && edge.to === active, onPath };
        });
    });
}
