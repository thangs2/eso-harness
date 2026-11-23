import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FCanvasComponent, FFlowModule, type FCreateConnectionEvent, type FMoveNodesEvent } from '@foblex/flow';
import { ActivatedRoute } from '@angular/router';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { FlowDefinitionDto, FlowProposalDto, FlowSummaryDto, FlowValidationDto, WorkerConfigDto } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-flows-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, FFlowModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="flows-page">
            <header class="flows-head">
                <div class="flows-title">
                    <p class="eyebrow">Consumer setup / Flows</p>
                    <div class="title-row">
                        <h1>Worker flow</h1>
                        @if (active(); as flow) {
                            <span class="title-badge" [class.title-badge-warn]="flow.status === 'draft'">{{ flow.status }} v{{ flow.version }}</span>
                            @if (isActiveDefault()) { <span class="title-badge title-badge-accent">default</span> }
                        }
                    </div>
                    <p class="subtitle">Define how workers hand work to each other. Flow versions are independent of Stack versions. Hosts execute flows; ESO only defines and publishes them.</p>
                </div>
                <div class="flows-head-actions">
                    <button mat-stroked-button type="button" [disabled]="!active()" (click)="saveDraft()">Save draft</button>
                    <button mat-flat-button color="primary" type="button" [disabled]="publishing() || !active()" (click)="publish()">{{ publishing() ? 'Publishing…' : 'Publish' }}</button>
                </div>
            </header>

            <section class="flow-picker" aria-label="Flows">
                <div class="picker-label"><p class="eyebrow">Flows</p><strong>{{ summaries().length }} defined</strong></div>
                <div class="picker-items">
                    @if (summaries().length === 0) {
                        <span class="muted">No flow yet.</span>
                    } @else {
                        @for (flow of summaries(); track flow.id) {
                            <button type="button" class="flow-pill" [class.active]="flow.id === activeId()" (click)="selectFlow(flow.id)">
                                <span class="flow-pill-main"><strong>{{ flow.name }}</strong><small>{{ flow.id }} · v{{ flow.version }}</small></span>
                                <span class="flow-pill-meta"><span class="status-dot" [class.draft]="flow.status === 'draft'"></span>{{ flow.status }}@if (flow.isDefault) { · default }</span>
                            </button>
                        }
                    }
                </div>
                <button mat-stroked-button class="new-flow" type="button" (click)="createFlow()" [disabled]="creating()">+ New flow</button>
            </section>

            @if (active(); as flow) {
                <section class="flow-workbench">
                    <header class="workbench-head">
                        <div class="workbench-title">
                            <span class="workbench-code">{{ flow.id }}</span>
                            @if (renaming()) {
                                <div class="rename-row">
                                    <input class="rename-input" [value]="renameDraft()" (input)="renameDraft.set($any($event.target).value)" (keydown.enter)="saveRename()" (keydown.escape)="cancelRename()" aria-label="Flow name" autofocus>
                                    <button mat-flat-button color="primary" type="button" (click)="saveRename()" [disabled]="renameSaving() || !renameDraft().trim()">{{ renameSaving() ? 'Saving…' : 'Save' }}</button>
                                    <button mat-stroked-button type="button" (click)="cancelRename()" [disabled]="renameSaving()">Cancel</button>
                                </div>
                            } @else {
                                <h2>{{ flow.name }} <button type="button" class="rename-trigger" (click)="startRename()">Rename</button></h2>
                            }
                            <div class="workbench-meta"><span>{{ flow.nodes.length }} nodes</span><span>{{ flow.edges.length }} edges</span><span>{{ flow.status }} v{{ flow.version }}</span></div>
                        </div>
                        <div class="workbench-actions">
                            <div class="tool-group">
                                <button mat-stroked-button type="button" (click)="undo()" [disabled]="history().length === 0">Undo</button>
                                <button mat-stroked-button type="button" (click)="redo()" [disabled]="future().length === 0">Redo</button>
                            </div>
                            <div class="tool-group">
                                <button mat-stroked-button type="button" (click)="fitCanvas()">Fit</button>
                                <button mat-stroked-button type="button" (click)="snapGrid()">Snap grid</button>
                                <button mat-stroked-button type="button" (click)="autoArrange()">Auto arrange</button>
                            </div>
                            <div class="tool-group">
                                <button mat-stroked-button type="button" (click)="setDefault()" [disabled]="isActiveDefault() || flow.status !== 'published'">{{ isActiveDefault() ? 'Default flow' : 'Set default' }}</button>
                                <button mat-stroked-button type="button" (click)="validate()" [disabled]="validating()">{{ validating() ? 'Validating…' : 'Validate' }}</button>
                                @if (flow.status === 'draft') { <button mat-stroked-button color="warn" type="button" (click)="deleteDraftConfirm.set(true)" [disabled]="deletingDraft()">Delete draft</button> }
                            </div>
                        </div>
                    </header>

                    @if (deleteDraftConfirm()) {
                        <div class="flow-delete-confirm" role="alert">
                            <span>Delete draft <strong>{{ flow.name }}</strong>? Published versions are not affected.</span>
                            <div class="flow-delete-actions">
                                <button mat-stroked-button type="button" (click)="deleteDraftConfirm.set(false)" [disabled]="deletingDraft()">Cancel</button>
                                <button mat-flat-button color="warn" type="button" (click)="deleteDraft()" [disabled]="deletingDraft()">{{ deletingDraft() ? 'Deleting…' : 'Delete draft' }}</button>
                            </div>
                        </div>
                    }

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

                    <div class="workbench-body">
                        <section class="canvas-area">
                            <div class="canvas-toolbar">
                                <span><strong>Flow canvas</strong> · drag nodes, drag a port to connect</span>
                                <span class="canvas-grid-note">grid 24px</span>
                            </div>
                            <div class="flow-canvas-wrap">
                                <f-flow fDraggable [hCellSize]="24" [vCellSize]="24" [fCellSizeWhileDragging]="true" (fFullRendered)="fitCanvas()" (fMoveNodes)="onMoveNodes($event)" (fCreateConnection)="onCreateConnection($event)">
                                    <f-canvas fZoom>
                                        <f-connection-for-create />
                                        <ng-container ngProjectAs="[fConnections]">
                                            @for (edge of flow.edges; track edge.id) {
                                                <f-connection [fConnectionId]="edge.id" [fSourceId]="'out-' + edge.from" [fTargetId]="'in-' + edge.to" fType="straight" fBehavior="fixed" [class.edge-pass]="edge.on === 'PASS'" [class.edge-fail]="edge.on === 'FAIL'" [class.edge-always]="edge.on === 'always'" [class.edge-dim]="isEdgeDimmed(edge)">
                                                    <f-connection-marker-arrow></f-connection-marker-arrow>
                                                    <div fConnectionContent [position]="0.5" class="flow-edge-chip" [class.edge-chip-fail]="edge.on === 'FAIL'" [class.edge-chip-always]="edge.on === 'always'">{{ edge.on }}</div>
                                                </f-connection>
                                            }
                                        </ng-container>
                                        <ng-container ngProjectAs="[fNodes]">
                                            @for (node of flow.nodes; track node.workerId) {
                                                <div fNode fDragHandle [fNodeId]="node.workerId" class="flow-node" [class.flow-node-gate]="workerLayer(node.workerId) === 'gate'" [class.flow-node-selected]="selectedNode() === node.workerId" [fNodePosition]="{ x: node.x, y: node.y }" (click)="selectedNode.set(node.workerId)" [title]="workerRole(node.workerId) + ' · ' + workerScope(node.workerId)">
                                                    <span class="flow-node-rail"></span>
                                                    <span class="flow-node-avatar">{{ workerInitial(node.workerId) }}</span>
                                                    <span class="flow-node-copy"><strong>{{ workerLabel(node.workerId) }}</strong><small>{{ workerLayer(node.workerId) }} · {{ workerStatus(node.workerId) }}</small></span>
                                                    <div class="flow-port flow-port-in" fConnector fConnectorType="target" [fConnectorId]="'in-' + node.workerId" title="Input"></div>
                                                    <div class="flow-port flow-port-out" fConnector fConnectorType="source" [fConnectorId]="'out-' + node.workerId" title="Drag to connect"></div>
                                                </div>
                                            }
                                        </ng-container>
                                    </f-canvas>
                                </f-flow>
                                <div class="flow-canvas-hint">Drag nodes · drag a port to connect · select an edge to edit</div>
                            </div>
                            <footer class="canvas-footer">
                                <div class="edge-legend"><span><i class="edge-dot pass"></i>PASS</span><span><i class="edge-dot fail"></i>FAIL</span><span><i class="edge-dot always"></i>always</span></div>
                                <span class="canvas-status">{{ flow.nodes.length }} workers · {{ flow.edges.length }} edges · {{ flow.status }}</span>
                            </footer>
                        </section>

                        <aside class="edge-panel">
                            @if (selectedNode(); as nodeId) {
                                <section class="node-card">
                                    <header><div><p class="eyebrow">Selected worker</p><h3>{{ workerLabel(nodeId) }}</h3></div><span class="layer-badge">{{ workerLayer(nodeId) === 'gate' ? 'GATE' : 'PEER' }}</span></header>
                                    <dl><div><dt>Role</dt><dd>{{ workerRole(nodeId) }}</dd></div><div><dt>Status</dt><dd>{{ workerStatus(nodeId) }}</dd></div><div><dt>Scope</dt><dd>{{ workerScope(nodeId) }}</dd></div></dl>
                                </section>
                            }
                            <header class="edge-panel-head"><div><p class="eyebrow">Inspector</p><h3>Edges <span>{{ flow.edges.length }}</span></h3></div><span class="muted">{{ selectedEdge() ? '1 selected' : 'select one' }}</span></header>
                            <div class="edge-list">
                                @if (flow.edges.length === 0) {
                                    <p class="muted">No edges. Drag from a source port to a target port.</p>
                                } @else {
                                    @for (edge of flow.edges; track edge.id; let i = $index) {
                                        <button type="button" class="edge-row" [class.active]="selectedEdge() === edge.id" (click)="selectedEdge.set(edge.id)">
                                            <span class="edge-index">{{ i + 1 }}</span>
                                            <span class="edge-route"><strong>{{ workerLabel(edge.from) }}</strong><i>→</i><strong>{{ workerLabel(edge.to) }}</strong></span>
                                            <span class="edge-badge" [class.fail]="edge.on === 'FAIL'" [class.always]="edge.on === 'always'">{{ edge.on }}</span>
                                        </button>
                                    }
                                }
                            </div>
                            @if (selectedEdgeView(); as edge) {
                                <section class="edge-editor">
                                    <header><div><p class="eyebrow">Selected edge</p><h4>{{ workerLabel(edge.from) }} → {{ workerLabel(edge.to) }}</h4></div><button mat-button type="button" (click)="removeEdge(edge.id)">Remove</button></header>
                                    <div class="edge-fields">
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Outcome</mat-label>
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
                                    <code class="edge-id">{{ edge.id }}</code>
                                </section>
                            }
                        </aside>
                    </div>
                </section>
            } @else if (!loading()) {
                <section class="flow-empty"><h2>No flow selected</h2><p>Create a flow to start from the consumer's workers.</p></section>
            }

            @if (error()) { <p class="flow-error" role="alert">@if (errorCode()) { <strong>{{ errorCode() }}</strong> — }{{ error() }}</p> }
        </main>
    `,
    styles: [`
        .flows-page { display: grid; gap: var(--space-5); max-width: var(--content-max); margin: 0 auto; min-width: 0; }
        .flows-head { display: flex; justify-content: space-between; gap: var(--space-6); align-items: flex-start; min-width: 0; }
        .flows-title { min-width: 0; }
        .flows-title h1 { margin: 0; font-size: var(--text-2xl); line-height: 1.15; letter-spacing: -.02em; }
        .title-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .title-badge { padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
        .title-badge-warn { border-color: rgba(224,179,65,.45); background: rgba(224,179,65,.08); color: #f5c76b; }
        .title-badge-accent { border-color: rgba(90,169,255,.4); background: rgba(90,169,255,.1); color: #7dd3fc; }
        .flows-title .subtitle { margin: var(--space-2) 0 0; max-width: 760px; color: var(--muted); font-size: var(--text-sm); line-height: 1.6; }
        .flows-head-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: 4px; }

        .flow-picker { display: flex; align-items: center; gap: var(--space-3); min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: linear-gradient(180deg, #131a26, #0f151f); box-shadow: 0 1px 0 rgba(255,255,255,.02); }
        .picker-label { display: grid; gap: 1px; min-width: 116px; padding-right: var(--space-3); border-right: 1px solid var(--line); }
        .picker-label .eyebrow { margin: 0; }
        .picker-label strong { font-size: var(--text-xs); color: var(--ink); font-weight: 600; }
        .picker-items { display: flex; align-items: center; gap: 8px; min-width: 0; overflow-x: auto; padding: 2px; scrollbar-width: thin; }
        .flow-pill { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-width: 218px; padding: 8px 11px; border: 1px solid #26384f; border-radius: 8px; background: #111925; color: var(--ink); text-align: left; cursor: pointer; transition: border-color .15s ease, background .15s ease; }
        .flow-pill:hover { border-color: #3d5876; background: #152030; }
        .flow-pill.active { border-color: var(--brand); background: color-mix(in srgb, #15243a 70%, var(--brand)); box-shadow: 0 0 0 1px rgba(90,169,255,.18); }
        .flow-pill-main { display: grid; gap: 2px; min-width: 0; }
        .flow-pill-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); }
        .flow-pill-main small { color: var(--muted); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .flow-pill-meta { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 10px; white-space: nowrap; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ec97a; }
        .status-dot.draft { background: #e0b341; }
        .new-flow { margin-left: auto; flex: 0 0 auto; }

        .flow-workbench { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,.16); }
        .workbench-head { display: flex; justify-content: space-between; gap: var(--space-3); align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, #141d2b, #101721); }
        .workbench-title { display: grid; gap: 1px; min-width: 0; }
        .workbench-code { color: #7f93a8; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .workbench-title h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--text-lg); font-weight: 650; letter-spacing: -.01em; }
        .rename-trigger { padding: 1px 6px; border: 1px solid #2b3b52; border-radius: 5px; background: transparent; color: #7f93a8; font: inherit; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; cursor: pointer; }
        .rename-trigger:hover { border-color: #5aa9ff; color: #7dd3fc; }
        .rename-row { display: flex; align-items: center; gap: 6px; }
        .rename-input { width: min(360px, 42vw); height: 30px; padding: 4px 8px; border: 1px solid #5aa9ff; border-radius: 6px; background: #0b111b; color: #e2e8f0; font: inherit; font-size: var(--text-md); }
        .rename-input:focus { outline: 2px solid rgba(90,169,255,.35); outline-offset: 1px; }
        .workbench-meta { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 10px; }
        .workbench-meta span + span::before { content: '·'; margin-right: 8px; color: #3b5168; }
        .workbench-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .tool-group { display: inline-flex; align-items: center; gap: 4px; padding-left: 8px; border-left: 1px solid var(--line); }
        .tool-group:first-child { border-left: 0; padding-left: 0; }

        .flow-delete-confirm { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin: 0 16px; padding: 10px 12px; border: 1px solid rgba(224,179,65,.55); border-radius: 7px; background: rgba(224,179,65,.07); color: #f5e5bd; font-size: var(--text-xs); }
        .flow-delete-actions { display: flex; gap: var(--space-2); }
        .flow-proposal { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); margin: 12px 16px 0; padding: 10px 12px; border: 1px solid rgba(90,169,255,.4); border-radius: 7px; background: rgba(90,169,255,.07); }
        .flow-proposal > div { display: grid; gap: 2px; }
        .flow-proposal strong { font-size: var(--text-sm); }
        .flow-proposal span, .flow-proposal small { color: var(--muted); font-size: 11px; }
        .flow-validation { display: grid; gap: 2px; margin: 12px 16px 0; padding: 8px 12px; border: 1px solid rgba(224,179,65,.5); border-radius: 7px; background: rgba(224,179,65,.06); font-size: 11px; }
        .flow-validation-ok { border-color: rgba(78,201,122,.45); background: rgba(78,201,122,.06); }

        .workbench-body { display: grid; grid-template-columns: minmax(0, 1fr) 310px; min-width: 0; min-height: 640px; }
        .canvas-area { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-width: 0; border-right: 1px solid var(--line); background: #0b111b; }
        .canvas-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: 8px 14px; border-bottom: 1px solid #1b2a3d; background: rgba(13,20,30,.9); color: var(--muted); font-size: 10px; }
        .canvas-toolbar strong { color: #cbd5e1; font-weight: 600; }
        .canvas-grid-note { padding: 1px 7px; border: 1px solid #24364c; border-radius: 999px; color: #7f93a8; font-size: 9px; }
        .flow-canvas-wrap { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #0b111b; }
        .flow-canvas-wrap::before { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(rgba(90,169,255,.13) 1px, transparent 1px); background-size: 24px 24px; opacity: .35; }
        f-flow { display: block; height: 640px; position: relative; z-index: 1; }
        .flow-canvas-hint { position: absolute; left: 12px; bottom: 10px; z-index: 2; padding: 3px 8px; border: 1px solid #223249; border-radius: 999px; background: rgba(11,17,27,.88); color: #7f93a8; font-size: 10px; pointer-events: none; }
        .canvas-footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: 8px 14px; border-top: 1px solid #1b2a3d; background: rgba(13,20,30,.9); color: var(--muted); font-size: 10px; }
        .edge-legend { display: inline-flex; align-items: center; gap: 12px; }
        .edge-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .edge-dot { width: 6px; height: 6px; border-radius: 50%; background: #5aa9ff; }
        .edge-dot.pass { background: #34d399; }
        .edge-dot.fail { background: #fbbf24; }
        .edge-dot.always { background: #60a5fa; }
        .canvas-status { white-space: nowrap; }

        .edge-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 707px; max-height: 707px; overflow: hidden; background: var(--surface); }
        .node-card { display: grid; gap: 8px; margin: 12px 12px 0; padding: 12px; border: 1px solid #26384f; border-radius: 8px; background: #111925; }
        .node-card header { display: flex; justify-content: space-between; gap: var(--space-2); align-items: flex-start; }
        .node-card h3 { margin: 0; font-size: var(--text-md); }
        .node-card .eyebrow { margin: 0 0 1px; }
        .layer-badge { padding: 1px 7px; border: 1px solid rgba(90,169,255,.35); border-radius: 999px; background: rgba(90,169,255,.08); color: #7dd3fc; font-size: 9px; letter-spacing: .06em; }
        .node-card dl { display: grid; gap: 4px; margin: 0; }
        .node-card dl div { display: grid; grid-template-columns: 52px minmax(0,1fr); gap: 8px; font-size: 11px; }
        .node-card dt { color: var(--muted); }
        .node-card dd { margin: 0; color: #cbd5e1; overflow-wrap: anywhere; }
        .edge-panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); padding: 14px 14px 8px; }
        .edge-panel-head h3 { margin: 0; font-size: var(--text-md); }
        .edge-panel-head h3 span { color: var(--muted); font-size: 11px; font-weight: 500; }
        .edge-panel-head .eyebrow { margin: 0 0 1px; }
        .edge-list { display: grid; align-content: start; gap: 3px; flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 0 8px 8px; scrollbar-color: #2b3b52 #0b1118; scrollbar-width: thin; }
        .edge-row { display: grid; grid-template-columns: 20px minmax(0,1fr) auto; align-items: center; gap: 8px; width: 100%; padding: 7px 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #cbd5e1; cursor: pointer; text-align: left; font: inherit; }
        .edge-row:hover { background: #141f2e; }
        .edge-row.active { border-color: rgba(90,169,255,.4); background: #132338; }
        .edge-index { display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid #2b3b52; border-radius: 50%; color: #7f93a8; font-size: 9px; }
        .edge-route { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 11px; }
        .edge-route strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
        .edge-route i { color: #5f7893; font-style: normal; }
        .edge-badge { padding: 1px 6px; border: 1px solid rgba(52,211,153,.35); border-radius: 999px; background: rgba(52,211,153,.08); color: #6ee7b7; font-size: 8px; font-weight: 700; letter-spacing: .03em; }
        .edge-badge.fail { border-color: rgba(251,191,36,.35); background: rgba(251,191,36,.08); color: #f5c76b; }
        .edge-badge.always { border-color: rgba(96,165,250,.35); background: rgba(96,165,250,.08); color: #93c5fd; }
        .edge-editor { display: grid; gap: 8px; padding: 12px 14px 14px; border-top: 1px solid var(--line); background: #101721; }
        .edge-editor header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); }
        .edge-editor h4 { margin: 0; font-size: var(--text-sm); }
        .edge-editor .eyebrow { margin: 0 0 1px; }
        .edge-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .edge-fields mat-form-field { width: 100%; min-width: 0; }
        .edge-id { color: #6f8096; font-size: 9px; overflow-wrap: anywhere; }

        .flow-node { position: relative; display: flex; align-items: center; gap: 10px; width: 184px; height: 64px; padding: 9px 10px 9px 14px; border: 1px solid #2b3b52; border-radius: 9px; background: linear-gradient(180deg, #151f2e, #0f1723); color: #e2e8f0; cursor: grab; box-shadow: 0 6px 14px rgba(0,0,0,.28); transition: border-color .15s ease, box-shadow .15s ease; }
        .flow-node:hover { border-color: rgba(90,169,255,.6); }
        .flow-node-selected { border-color: #5aa9ff; box-shadow: 0 0 0 1px rgba(90,169,255,.45), 0 8px 18px rgba(0,0,0,.4); }
        .flow-node-gate { border-color: rgba(224,179,65,.45); }
        .flow-node-gate.flow-node-selected { border-color: #e0b341; box-shadow: 0 0 0 1px rgba(224,179,65,.4); }
        .flow-node-rail { position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: #5aa9ff; }
        .flow-node-gate .flow-node-rail { background: #e0b341; }
        .flow-node-avatar { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; border: 1px solid rgba(90,169,255,.35); border-radius: 50%; background: #10243a; color: #7dd3fc; font-size: 11px; font-weight: 700; }
        .flow-node-gate .flow-node-avatar { border-color: rgba(224,179,65,.4); background: #2a2212; color: #f5c76b; }
        .flow-node-copy { display: grid; gap: 2px; min-width: 0; text-align: left; }
        .flow-node-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
        .flow-node-copy small { color: #8b97ab; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
        .flow-port { position: absolute; top: 50%; width: 12px; height: 12px; border: 2px solid #0b111b; border-radius: 50%; background: #5aa9ff; transform: translateY(-50%); cursor: crosshair; box-shadow: 0 0 0 1px rgba(90,169,255,.45); }
        .flow-node-gate .flow-port { background: #e0b341; box-shadow: 0 0 0 1px rgba(224,179,65,.45); }
        .flow-port-in { left: -7px; }
        .flow-port-out { right: -7px; }
        .flow-edge-chip { padding: 1px 6px; border: 1px solid rgba(78,201,122,.45); border-radius: 999px; background: #0d1c16; color: #6ee7b7; font-size: 9px; font-weight: 700; }
        .flow-edge-chip.edge-chip-fail { border-color: rgba(224,179,65,.5); background: #241d0f; color: #f5c76b; }
        .flow-edge-chip.edge-chip-always { border-color: rgba(90,169,255,.5); background: #10243a; color: #7dd3fc; }

        .flow-empty { padding: var(--space-7); border: 1px dashed var(--line); border-radius: var(--radius-md); text-align: center; }
        .flow-empty h2 { margin: 0 0 var(--space-2); }
        .flow-error { margin: 0; color: #f87171; }

        @media (max-width: 1200px) {
            .workbench-body { grid-template-columns: minmax(0, 1fr); }
            .canvas-area { border-right: 0; border-bottom: 1px solid var(--line); }
            .edge-panel { height: auto; max-height: none; }
            .edge-list { max-height: 280px; }
        }
        @media (max-width: 760px) {
            .flows-head, .workbench-head { flex-direction: column; align-items: stretch; }
            .flow-picker { flex-wrap: wrap; }
            .picker-label { border-right: 0; border-bottom: 1px solid var(--line); padding: 0 0 6px; }
            .new-flow { margin-left: 0; }
            .workbench-actions { justify-content: flex-start; }
            .tool-group { border-left: 0; padding-left: 0; }
            .edge-fields { grid-template-columns: minmax(0, 1fr); }
            f-flow { height: 520px; }
        }
    `],
})
export class FlowsPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);
    private readonly route = inject(ActivatedRoute);
    private readonly canvas = viewChild(FCanvasComponent);

    readonly consumerId = this.route.snapshot.paramMap.get('id') || '';
    readonly summaries = signal<FlowSummaryDto[]>([]);
    readonly active = signal<FlowDefinitionDto | null>(null);
    readonly workers = signal<WorkerConfigDto | null>(null);
    readonly selectedNode = signal<string | null>(null);
    readonly selectedEdge = signal<string | null>(null);
    readonly validation = signal<FlowValidationDto | null>(null);
    readonly error = signal('');
    readonly errorCode = signal('');
    readonly loading = signal(false);
    readonly creating = signal(false);
    readonly validating = signal(false);
    readonly publishing = signal(false);
    readonly proposal = signal<FlowProposalDto | null>(null);
    readonly proposalApplying = signal(false);
    readonly deleteDraftConfirm = signal(false);
    readonly deletingDraft = signal(false);
    readonly renaming = signal(false);
    readonly renameDraft = signal('');
    readonly renameSaving = signal(false);
    readonly history = signal<FlowDefinitionDto[]>([]);
    readonly future = signal<FlowDefinitionDto[]>([]);
    readonly selectedEdgeView = computed(() => {
        const flow = this.active();
        return flow?.edges.find((edge) => edge.id === this.selectedEdge()) || null;
    });


    ngOnInit(): void {
        void this.load();
    }

    /** Mã lỗi tầng UI cho page flows: 401/403 ⇒ FLOW_DENIED · 404 ⇒ FLOW_NOT_FOUND. */
    private fail(err: unknown, fallbackCode: string, fallbackMessage: string): void {
        const e = err as { status?: number; code?: string; detail?: string; message?: string };
        const code = e?.status === 401 || e?.status === 403
            ? 'FLOW_DENIED'
            : e?.status === 404
                ? 'FLOW_NOT_FOUND'
                : fallbackCode;
        this.errorCode.set(code);
        this.error.set(e?.detail || e?.message || fallbackMessage);
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
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not load flows'))
            .finally(() => this.loading.set(false));
    }

    selectFlow(id: string): Promise<void> {
        this.error.set('');
        return this.service.getFlow(this.consumerId, id)
            .then((flow) => {
                const arranged = flow.status === 'published' ? this.arrangeFlow(flow) : flow;
                this.active.set(arranged);
                this.history.set([]);
                this.future.set([]);
                this.selectedEdge.set(flow.edges[0]?.id || null);
                this.validation.set(null);
            })
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not load flow'));
    }

    createFlow(): void {
        const workers = this.workers()?.workers || [];
        if (workers.length === 0) {
            this.errorCode.set('FLOW_WORKERS_REQUIRED');
        this.error.set('Save workers first. A flow cannot reference an empty worker set.');
            return;
        }
        this.creating.set(true);
        const id = this.uniqueFlowId('flow-seven-star');
        this.service.getDefaultFlow(this.consumerId)
            .catch(() => null)
            .then((defaultFlow) => {
                const defaultIds = new Set((defaultFlow?.nodes || []).map((node) => node.workerId));
                const selected = defaultIds.size > 0 ? workers.filter((worker) => defaultIds.has(worker.id)) : workers.filter((worker) => worker.status === 'active');
                const nodes = selected.map((worker) => ({ workerId: worker.id, x: 0, y: 0 }));
                const edges = defaultFlow?.edges?.length
                    ? defaultFlow.edges.map((edge, index) => ({ id: `e-${index + 1}`, from: edge.from, to: edge.to, on: edge.on || 'PASS' }))
                    : (this.workers()?.edges || []).map((edge, index) => ({ id: `e-${index + 1}`, from: edge.from, to: edge.to, on: edge.on || 'PASS' }));
                const arranged = this.arrangeFlow({ id, name: 'Seven-Star Formation', version: 1, status: 'draft', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } } as FlowDefinitionDto);
                return this.service.saveFlow(this.consumerId, id, { ...arranged, viewport: { x: 0, y: 0, zoom: 1 } });
            })
            .then(() => this.service.getFlows(this.consumerId))
            .then((flows) => {
                this.summaries.set(flows);
                return this.selectFlow(id);
            })
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not create flow'))
            .finally(() => this.creating.set(false));
    }

    private arrangeFlow(flow: FlowDefinitionDto): FlowDefinitionDto {
        // Mirrors the worker formation used by the Observatory Worker graph:
        // scout/plan at the top, build/verify in the middle, audit left, qc left-bottom,
        // qc-2 right-bottom and fixbug on the returning branch.
        const formation: Record<string, { x: number; y: number }> = {
            'worker-scout': { x: 280, y: 40 },
            'worker-plan': { x: 500, y: 112 },
            'worker-build': { x: 280, y: 250 },
            'worker-verify': { x: 500, y: 322 },
            'worker-audit': { x: 130, y: 422 },
            'worker-fixbug': { x: 500, y: 482 },
            'worker-qc': { x: 50, y: 552 },
            'worker-qc-2': { x: 740, y: 552 },
        };
        const fallback = (index: number) => ({ x: 80 + (index % 3) * 210, y: 40 + Math.floor(index / 3) * 110 });
        return { ...flow, nodes: flow.nodes.map((node, index) => ({ ...node, ...(formation[node.workerId] || fallback(index)) })) };
    }

    autoArrange(): void {
        const flow = this.active();
        if (!flow) return;
        this.commit(this.arrangeFlow(flow));
        setTimeout(() => this.fitCanvas(), 50);
    }

    snapGrid(): void {
        const flow = this.active();
        if (!flow) return;
        const size = 24;
        const nodes = flow.nodes.map((node) => ({
            ...node,
            x: Math.round(node.x / size) * size,
            y: Math.round(node.y / size) * size,
        }));
        if (nodes.every((node, index) => node.x === flow.nodes[index].x && node.y === flow.nodes[index].y)) return;
        this.commit({ ...flow, nodes });
        setTimeout(() => this.fitCanvas(), 50);
    }

    isEdgeDimmed(edge: { id: string; from: string; to: string }): boolean {
        const selectedEdge = this.selectedEdge();
        if (selectedEdge) return selectedEdge !== edge.id;
        const selectedNode = this.selectedNode();
        return Boolean(selectedNode && edge.from !== selectedNode && edge.to !== selectedNode);
    }

    startRename(): void {
        const flow = this.active();
        if (!flow) return;
        this.renameDraft.set(flow.name);
        this.renaming.set(true);
    }

    cancelRename(): void {
        this.renaming.set(false);
        this.renameDraft.set('');
    }

    saveRename(): void {
        const flow = this.active();
        const name = this.renameDraft().trim();
        if (!flow || !name || name === flow.name) { this.cancelRename(); return; }
        this.renameSaving.set(true);
        this.commit({ ...flow, name });
        this.saveDraft()
            .then(() => {
                this.renaming.set(false);
                this.renameDraft.set('');
            })
            .finally(() => this.renameSaving.set(false));
    }

    deleteDraft(): void {
        const flow = this.active();
        if (!flow || flow.status !== 'draft') return;
        this.deletingDraft.set(true);
        this.service.deleteFlowDraft(this.consumerId, flow.id)
            .then(() => this.service.getFlows(this.consumerId))
            .then((flows) => {
                this.summaries.set(flows);
                this.deleteDraftConfirm.set(false);
                this.active.set(null);
                if (flows.length > 0) return this.selectFlow(flows[0].id);
                return undefined;
            })
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not delete draft'))
            .finally(() => this.deletingDraft.set(false));
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
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not save flow'));
    }

    validate(): void {
        const flow = this.active();
        if (!flow) return;
        this.validating.set(true);
        this.error.set('');
        this.service.validateFlow(this.consumerId, flow.id, flow)
            .then((result) => this.validation.set(result))
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not validate flow'))
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
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not publish flow'))
            .finally(() => this.publishing.set(false));
    }

    applyProposal(): void {
        const proposal = this.proposal();
        if (!proposal) return;
        this.proposalApplying.set(true);
        this.service.applyFlowProposal(this.consumerId)
            .then(() => this.load())
            .then(() => this.proposal.set(null))
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not apply SLP proposal'))
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
            .catch((err) => this.fail(err, 'FLOW_UPSTREAM_FAILED', 'Could not set default flow'));
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
}
