import { ChangeDetectionStrategy, Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FCanvasComponent, FFlowModule, type FCreateConnectionEvent, type FMoveNodesEvent } from '@foblex/flow';
import { ActivatedRoute, Router } from '@angular/router';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { FlowDefinitionDto, FlowProposalDto, FlowSummaryDto, FlowValidationDto, WorkerConfigDto } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-flows-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, FFlowModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="flows-page">
            <header class="flows-head page-header">
                <div>
                    <p class="eyebrow">Consumer setup · flows</p>
                    <h1>Worker flow</h1>
                    <p class="subtitle">Define how workers hand work to each other. Flow versions are independent of Stack versions. Hosts execute flows; ESO only defines and publishes them.</p>
                </div>
                <div class="flows-head-actions">
                    <button mat-stroked-button type="button" [disabled]="!active()" (click)="saveDraft()">Save draft</button>
                    <button mat-flat-button color="primary" type="button" [disabled]="publishing() || !active()" (click)="publish()">{{ publishing() ? 'Publishing…' : 'Publish' }}</button>
                </div>
            </header>


            <div class="flows-layout">
                <aside class="flow-list">
                    <header><div><p class="eyebrow">Flows</p><h2>{{ summaries().length }} defined</h2></div><button mat-stroked-button type="button" (click)="createFlow()" [disabled]="creating()">New flow</button></header>
                    @if (summaries().length === 0) {
                        <p class="muted">No flow yet. Create one from the consumer's saved workers.</p>
                    } @else {
                        @for (flow of summaries(); track flow.id) {
                            <button type="button" class="flow-list-item" [class.active]="flow.id === activeId()" (click)="selectFlow(flow.id)">
                                <span><strong>{{ flow.name }}</strong><small>{{ flow.id }} · v{{ flow.version }}</small></span>
                                <span class="flow-list-badges"><span class="badge" [class.badge-warn]="flow.status === 'draft'">{{ flow.status }}</span>@if (flow.isDefault) { <span class="badge">default</span> }</span>
                            </button>
                        }
                    }
                </aside>

                <section class="flow-workspace">
                    @if (active(); as flow) {
                        <header class="flow-toolbar">
                            <div><p class="eyebrow">{{ flow.id }}</p><h2>{{ flow.name }}</h2><span class="muted">{{ flow.status }} v{{ flow.version }} · {{ flow.nodes.length }} nodes · {{ flow.edges.length }} edges</span></div>
                            <div class="flow-toolbar-actions">
                                <button mat-stroked-button type="button" (click)="undo()" [disabled]="history().length === 0">Undo</button>
                                <button mat-stroked-button type="button" (click)="redo()" [disabled]="future().length === 0">Redo</button>
                                <button mat-stroked-button type="button" (click)="fitCanvas()">Fit</button>
                                <button mat-stroked-button type="button" (click)="setDefault()" [disabled]="isActiveDefault() || active()?.status !== 'published'">{{ isActiveDefault() ? 'Default flow' : 'Set default' }}</button>
                                <button mat-stroked-button type="button" (click)="validate()" [disabled]="validating()">{{ validating() ? 'Validating…' : 'Validate' }}</button>
                            </div>
                        </header>

                        @if (proposal(); as proposal) {
                            <div class="flow-proposal">
                                <div><strong>SLP flow proposal</strong><span>{{ proposal.sourceFile }} · {{ proposal.flow?.nodes.length }} nodes · {{ proposal.flow?.edges.length }} edges</span>@if (proposal.warnings?.length) { <small>{{ proposal.warnings.join(' · ') }}</small> }</div>
                                <button mat-flat-button color="primary" type="button" [disabled]="proposalApplying()" (click)="applyProposal()">{{ proposalApplying() ? 'Applying…' : 'Create draft' }}</button>
                            </div>
                        }

                        @if (validation(); as result) {
                            <div class="flow-validation" [class.flow-validation-ok]="result.ok">
                                <strong>{{ result.ok ? 'Flow is valid' : 'Flow has errors' }}</strong>
                                @if (result.errors.length) { <span>{{ result.errors.join(' · ') }}</span> }
                                @if (result.warnings.length) { <span class="muted">{{ result.warnings.join(' · ') }}</span> }
                            </div>
                        }

                        <div class="flow-body">
                            <div class="flow-canvas-wrap">
                                <f-flow fDraggable (fFullRendered)="fitCanvas()" (fMoveNodes)="onMoveNodes($event)" (fCreateConnection)="onCreateConnection($event)">
                                    <f-canvas fZoom>
                                        <f-connection-for-create />
                                        <ng-container ngProjectAs="[fConnections]">
                                            @for (edge of flow.edges; track edge.id) {
                                                <f-connection [fConnectionId]="edge.id" [fSourceId]="'out-' + edge.from" [fTargetId]="'in-' + edge.to" fType="segment" [class.edge-pass]="edge.on === 'PASS'" [class.edge-fail]="edge.on === 'FAIL'" [class.edge-always]="edge.on === 'always'">
                                                    <f-connection-marker-arrow></f-connection-marker-arrow>
                                                    <div fConnectionContent [position]="0.5" class="flow-edge-chip" [class.edge-chip-fail]="edge.on === 'FAIL'" [class.edge-chip-always]="edge.on === 'always'">{{ edge.on }}</div>
                                                </f-connection>
                                            }
                                        </ng-container>
                                        <ng-container ngProjectAs="[fNodes]">
                                            @for (node of flow.nodes; track node.workerId) {
                                                <div fNode fDragHandle [fNodeId]="node.workerId" class="flow-node" [class.flow-node-gate]="workerLayer(node.workerId) === 'gate'" [class.flow-node-selected]="selectedNode() === node.workerId" [fNodePosition]="{ x: node.x, y: node.y }" (click)="selectedNode.set(node.workerId)">
                                                    <div class="flow-node-head">
                                                        <span class="flow-node-avatar">{{ workerInitial(node.workerId) }}</span>
                                                        <div class="flow-node-title"><strong>{{ workerLabel(node.workerId) }}</strong><small>{{ workerRole(node.workerId) }}</small></div>
                                                        <span class="flow-node-layer">{{ workerLayer(node.workerId) }}</span>
                                                    </div>
                                                    <div class="flow-node-foot"><span>{{ workerStatus(node.workerId) }}</span><span class="flow-node-scope">{{ workerScope(node.workerId) }}</span></div>
                                                    <div class="flow-port flow-port-in" fConnector fConnectorType="target" [fConnectorId]="'in-' + node.workerId"></div>
                                                    <div class="flow-port flow-port-out" fConnector fConnectorType="source" [fConnectorId]="'out-' + node.workerId"></div>
                                                </div>
                                            }
                                        </ng-container>
                                    </f-canvas>
                                </f-flow>
                            </div>

                            <aside class="flow-inspector">
                                <header><div><p class="eyebrow">Flow inspector</p><h3>Edges</h3></div><span class="muted">{{ flow.edges.length }}</span></header>
                                @if (flow.edges.length === 0) {
                                    <p class="muted">No edges. Drag from a source port to a target port.</p>
                                } @else {
                                    @for (edge of flow.edges; track edge.id) {
                                        <article class="flow-edge-card" [class.active]="selectedEdge() === edge.id" (click)="selectedEdge.set(edge.id)">
                                            <div class="flow-edge-head"><strong>{{ workerLabel(edge.from) }} → {{ workerLabel(edge.to) }}</strong><span class="flow-edge-actions"><code>{{ edge.id }}</code><button mat-button type="button" (click)="$event.stopPropagation(); removeEdge(edge.id)">Remove</button></span></div>
                                            <div class="flow-edge-condition">
                                                <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>On outcome</mat-label>
                                                    <mat-select [ngModel]="edge.on" (ngModelChange)="updateEdge(edge.id, 'on', $event)">
                                                        <mat-option value="PASS">PASS</mat-option>
                                                        <mat-option value="FAIL">FAIL</mat-option>
                                                        <mat-option value="always">always</mat-option>
                                                    </mat-select>
                                                </mat-form-field>
                                                <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Guard</mat-label>
                                                    <input matInput [ngModel]="edge.condition?.equals || ''" (ngModelChange)="updateGuard(edge.id, $event)" placeholder="optional">
                                                </mat-form-field>
                                            </div>
                                        </article>
                                    }
                                }
                                <div class="flow-inspector-note">
                                    <strong>Phase B</strong>
                                    <span>Drag nodes, connect ports, remove edges, undo/redo, then Save draft or Publish.</span>
                                </div>
                            </aside>
                        </div>
                    } @else if (!loading()) {
                        <section class="flow-empty"><h2>No flow selected</h2><p>Create a flow to start from the consumer's workers.</p></section>
                    }
                </section>
            </div>

            @if (error()) { <p class="flow-error" role="alert">{{ error() }}</p> }
        </main>
    `,
    styles: [`
        .flows-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); min-width: 0; }
        .flows-head { display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; min-width: 0; }
        .flows-head h1 { margin: 0 0 var(--space-1); }
        .flows-head-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .flows-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: var(--space-4); align-items: start; }
        .flow-list { display: grid; gap: var(--space-2); min-width: 0; }
        .flow-list > header { display: flex; justify-content: space-between; gap: var(--space-2); align-items: flex-start; }
        .flow-list h2 { margin: 0; font-size: var(--text-lg); }
        .flow-list-item { display: flex; justify-content: space-between; gap: var(--space-2); width: 100%; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); text-align: left; cursor: pointer; }
        .flow-list-item.active { border-color: var(--brand); background: color-mix(in srgb, var(--surface) 88%, var(--brand)); }
        .flow-list-item span:first-child { display: grid; gap: 2px; min-width: 0; }
        .flow-list-item small { color: var(--muted); font-size: var(--text-xs); }
        .flow-workspace { display: grid; gap: var(--space-3); min-width: 0; }
        .flow-toolbar { display: flex; justify-content: space-between; gap: var(--space-3); align-items: flex-start; min-width: 0; }
        .flow-toolbar h2 { margin: 0 0 2px; }
        .flow-toolbar-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
        .flow-proposal { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--brand); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--surface) 90%, var(--brand)); }
        .flow-proposal > div { display: grid; gap: 2px; }
        .flow-proposal span, .flow-proposal small { color: var(--muted); font-size: var(--text-xs); }
        .flow-validation { display: grid; gap: 2px; padding: var(--space-2) var(--space-3); border: 1px solid #f59e0b; border-radius: var(--radius-sm); font-size: var(--text-xs); }
        .flow-validation-ok { border-color: #22c55e; }
        .flow-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--space-3); min-width: 0; }
        .flow-canvas-wrap { min-width: 0; border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; background: var(--surface); }
        f-flow { display: block; height: 560px; }
        .flow-node { position: relative; display: grid; gap: var(--space-1); width: 170px; padding: var(--space-3); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-sm); background: var(--surface-raised, var(--surface)); color: var(--ink); cursor: pointer; }
        .flow-node-selected { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
        .flow-node-head { display: flex; justify-content: space-between; gap: var(--space-2); align-items: center; }
        .flow-node-head .badge { font-size: 10px; }
        .flow-node small { color: var(--muted); font-size: var(--text-xs); }
        .flow-port { position: absolute; top: 50%; width: 10px; height: 10px; border-radius: 50%; background: var(--brand); transform: translateY(-50%); }
        .flow-port-in { left: -6px; }
        .flow-port-out { right: -6px; }
        .flow-inspector { display: grid; gap: var(--space-2); min-width: 0; }
        .flow-inspector > header { display: flex; justify-content: space-between; gap: var(--space-2); align-items: flex-start; }
        .flow-inspector h3 { margin: 0; font-size: var(--text-md); }
        .flow-edge-card { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; }
        .flow-edge-card.active { border-color: var(--brand); }
        .flow-edge-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); align-items: start; }
        .flow-edge-head strong { font-size: var(--text-sm); }
        .flow-edge-head code { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
        .flow-edge-actions { display: grid; justify-items: end; gap: 2px; min-width: 0; }
        .flow-edge-condition { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
        .flow-inspector-note { display: grid; gap: 2px; padding: var(--space-3); border: 1px dashed var(--line); border-radius: var(--radius-sm); color: var(--muted); font-size: var(--text-xs); }
        .flow-empty { padding: var(--space-6); border: 1px dashed var(--line); border-radius: var(--radius-md); text-align: center; }
        .flow-empty h2 { margin: 0 0 var(--space-2); }
        .flow-error { margin: 0; color: #f87171; }
        @media (max-width: 1100px) { .flows-layout, .flow-body { grid-template-columns: minmax(0, 1fr); } .flow-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } .flow-list > header { grid-column: 1 / -1; } }
        @media (max-width: 700px) { .flows-head, .flow-toolbar { flex-direction: column; } .flow-list { grid-template-columns: minmax(0, 1fr); } .flow-edge-condition { grid-template-columns: minmax(0, 1fr); } f-flow { height: 420px; } }
    `],
})
export class FlowsPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly canvas = viewChild(FCanvasComponent);

    readonly consumerId = this.route.snapshot.paramMap.get('id') || '';
    readonly summaries = signal<FlowSummaryDto[]>([]);
    readonly active = signal<FlowDefinitionDto | null>(null);
    readonly workers = signal<WorkerConfigDto | null>(null);
    readonly selectedNode = signal<string | null>(null);
    readonly selectedEdge = signal<string | null>(null);
    readonly validation = signal<FlowValidationDto | null>(null);
    readonly error = signal('');
    readonly loading = signal(false);
    readonly creating = signal(false);
    readonly validating = signal(false);
    readonly publishing = signal(false);
    readonly proposal = signal<FlowProposalDto | null>(null);
    readonly proposalApplying = signal(false);
    readonly history = signal<FlowDefinitionDto[]>([]);
    readonly future = signal<FlowDefinitionDto[]>([]);

    ngOnInit(): void {
        void this.load();
    }

    activeId(): string {
        return this.active()?.id || '';
    }

    private load(): Promise<void> {
        this.loading.set(true);
        return Promise.all([this.service.getFlows(this.consumerId), this.service.getWorkers(this.consumerId), this.service.getFlowProposal(this.consumerId)])
            .then(([flows, workers, proposal]) => {
                this.summaries.set(flows);
                this.workers.set(workers);
                this.proposal.set(proposal.available ? proposal : null);
                if (flows.length > 0) return this.selectFlow(flows[0].id);
                return undefined;
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not load flows'))
            .finally(() => this.loading.set(false));
    }

    selectFlow(id: string): Promise<void> {
        this.error.set('');
        return this.service.getFlow(this.consumerId, id)
            .then((flow) => {
                this.active.set(flow);
                this.history.set([]);
                this.future.set([]);
                this.selectedEdge.set(flow.edges[0]?.id || null);
                this.validation.set(null);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not load flow'));
    }

    createFlow(): void {
        const workers = this.workers()?.workers || [];
        if (workers.length === 0) {
            this.error.set('Save workers first. A flow cannot reference an empty worker set.');
            return;
        }
        this.creating.set(true);
        const id = this.uniqueFlowId('flow-seven-star');
        const nodes = workers.map((worker, index) => ({ workerId: worker.id, x: 60 + (index % 3) * 230, y: 60 + Math.floor(index / 3) * 150 }));
        const edges = (this.workers()?.edges || []).map((edge, index) => ({ id: `e-${index + 1}`, from: edge.from, to: edge.to, on: edge.on || 'PASS' }));
        this.service.saveFlow(this.consumerId, id, { id, name: 'Seven-Star Formation', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } })
            .then(() => this.service.getFlows(this.consumerId))
            .then((flows) => {
                this.summaries.set(flows);
                return this.selectFlow(id);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not create flow'))
            .finally(() => this.creating.set(false));
    }

    private uniqueFlowId(base: string): string {
        const ids = new Set(this.summaries().map((flow) => flow.id));
        if (!ids.has(base)) return base;
        let index = 2;
        while (ids.has(`${base}-${index}`)) index++;
        return `${base}-${index}`;
    }

    private commit(next: FlowDefinitionDto): void {
        const current = this.active();
        if (!current) return;
        this.history.update((items) => [...items.slice(-49), current]);
        this.future.set([]);
        this.active.set(next);
    }

    undo(): void {
        const previous = this.history().at(-1);
        const current = this.active();
        if (!previous || !current) return;
        this.history.update((items) => items.slice(0, -1));
        this.future.update((items) => [current, ...items].slice(0, 50));
        this.active.set(previous);
    }

    redo(): void {
        const next = this.future()[0];
        const current = this.active();
        if (!next || !current) return;
        this.future.update((items) => items.slice(1));
        this.history.update((items) => [...items.slice(-49), current]);
        this.active.set(next);
    }

    onMoveNodes(event: FMoveNodesEvent): void {
        const flow = this.active();
        if (!flow) return;
        const positions = new Map(event.nodes.map((item) => [item.id, item.position]));
        let changed = false;
        const nodes = flow.nodes.map((node) => {
            const position = positions.get(node.workerId);
            if (!position) return node;
            if (position.x === node.x && position.y === node.y) return node;
            changed = true;
            return { ...node, x: Math.round(position.x), y: Math.round(position.y) };
        });
        if (changed) this.commit({ ...flow, nodes });
    }

    onCreateConnection(event: FCreateConnectionEvent): void {
        const flow = this.active();
        if (!flow || !event.targetId) return;
        const from = event.sourceId.replace(/^out-/, '');
        const to = event.targetId.replace(/^in-/, '');
        if (!flow.nodes.some((node) => node.workerId === from) || !flow.nodes.some((node) => node.workerId === to)) return;
        if (flow.edges.some((edge) => edge.from === from && edge.to === to)) return;
        const edge = { id: `e-${from}-${to}`, from, to, on: 'PASS', condition: { kind: 'outcome', equals: 'PASS' }, priority: 0 };
        this.commit({ ...flow, edges: [...flow.edges, edge] });
        this.selectedEdge.set(edge.id);
    }

    removeEdge(edgeId: string): void {
        const flow = this.active();
        if (!flow) return;
        this.commit({ ...flow, edges: flow.edges.filter((edge) => edge.id !== edgeId) });
        if (this.selectedEdge() === edgeId) this.selectedEdge.set(null);
    }

    updateEdge(edgeId: string, field: 'on', value: string): void {
        const flow = this.active();
        if (!flow) return;
        this.commit({ ...flow, edges: flow.edges.map((edge) => edge.id === edgeId ? { ...edge, [field]: value } : edge) });
    }

    updateGuard(edgeId: string, value: string): void {
        const flow = this.active();
        if (!flow) return;
        this.commit({ ...flow, edges: flow.edges.map((edge) => edge.id === edgeId ? { ...edge, condition: value ? { kind: 'guard', equals: value } : undefined } : edge) });
    }

    saveDraft(): Promise<void> {
        const flow = this.active();
        if (!flow) return Promise.resolve();
        this.error.set('');
        return this.service.saveFlow(this.consumerId, flow.id, flow)
            .then((saved) => Promise.all([this.service.getFlows(this.consumerId), Promise.resolve(saved)]))
            .then(([flows, saved]) => {
                this.summaries.set(flows);
                this.active.set(saved);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not save flow'));
    }

    validate(): void {
        const flow = this.active();
        if (!flow) return;
        this.validating.set(true);
        this.error.set('');
        this.service.validateFlow(this.consumerId, flow.id, flow)
            .then((result) => this.validation.set(result))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not validate flow'))
            .finally(() => this.validating.set(false));
    }

    publish(): void {
        const flow = this.active();
        if (!flow) return;
        this.publishing.set(true);
        this.error.set('');
        this.service.validateFlow(this.consumerId, flow.id, flow)
            .then((result) => {
                this.validation.set(result);
                if (!result.ok) return null;
                return this.saveDraft().then(() => this.service.publishFlow(this.consumerId, flow.id));
            })
            .then((result) => {
                if (!result) return;
                return this.load();
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not publish flow'))
            .finally(() => this.publishing.set(false));
    }

    applyProposal(): void {
        const proposal = this.proposal();
        if (!proposal) return;
        this.proposalApplying.set(true);
        this.service.applyFlowProposal(this.consumerId)
            .then(() => this.load())
            .then(() => this.proposal.set(null))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not apply SLP proposal'))
            .finally(() => this.proposalApplying.set(false));
    }

    isActiveDefault(): boolean {
        return Boolean(this.active() && this.summaries().find((flow) => flow.id === this.active()?.id)?.isDefault);
    }

    setDefault(): void {
        const flow = this.active();
        if (!flow || flow.status !== 'published') return;
        this.service.setDefaultFlow(this.consumerId, flow.id, flow.version)
            .then(() => this.load())
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not set default flow'));
    }

    fitCanvas(): void {
        setTimeout(() => this.canvas()?.fitToScreen({ x: 32, y: 32 }, false, false, 1), 80);
    }

    workerLabel(id: string): string {
        return this.workers()?.workers.find((worker) => worker.id === id)?.name || id;
    }

    workerRole(id: string): string {
        return this.workers()?.workers.find((worker) => worker.id === id)?.role || 'worker';
    }

    workerLayer(id: string): string {
        return this.workers()?.workers.find((worker) => worker.id === id)?.layer || 'peer';
    }

    workerStatus(id: string): string {
        return this.workers()?.workers.find((worker) => worker.id === id)?.status || 'declared';
    }

    workerScope(id: string): string {
        const scope = this.workers()?.workers.find((worker) => worker.id === id)?.scope || '';
        return scope.length > 28 ? scope.slice(0, 26) + '…' : scope;
    }

    workerInitial(id: string): string {
        return (this.workerLabel(id) || 'W').slice(0, 1).toUpperCase();
    }

    back(): void {
        void this.router.navigate(['/consumers', this.consumerId, 'settings'], { queryParams: { tab: 'workers' } });
    }
}
