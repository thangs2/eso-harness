import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { ConsumerProfile, HostDto, ObservationDto, KnowledgeSummaryDto, KnowledgeDocDto, KnowledgeFindingDto, KnowledgeDocDetailDto, KnowledgeCheckDto, KnowledgeRetrievalDto, KnowledgeEmbeddingStatusDto, McpProviderDto, WorkerConfigDto, EvidenceRequirementDto, FlowSummaryDto, FlowDefinitionDto, HostRuntimeDto, WorkerPlacementDto, WorkerModelTier, WorkerPlacementFallback, LegacyHarnessReportDto, HarnessMigrationPreviewDto, BoundaryViewDto, FolderPolicyDto, BoundaryPathType, BoundaryReadMode, BoundaryWriteMode, JudgmentResponseDto, JevDecisionDto } from '../../../../../../../libs/api-client/types.js';

/**
 * Only remaining occurrence of the pre-P0.3 host-binding key: settings saved by an older UI.
 * They are migrated to `hostId` once on load; everything new reads and writes `hostId` only.
 * The API, host discovery, and worker bindings all use `hostId`.
 */
const LEGACY_HOST_PLUGIN_KEY = 'hostPluginId' as const;

const HOST_TYPE_LABELS: Record<string, string> = { cursor: 'Cursor', agy: 'Antigravity', dsh: 'DSH', claude: 'Claude', codex: 'Codex', paseo: 'Paseo', orca: 'Orca' };
type LegacyHostProfile = HostProfile & { [LEGACY_HOST_PLUGIN_KEY]?: string };

type LayerId = 'multiAgent' | 'rules' | 'skills' | 'hooks' | 'memory' | 'codeGraph' | 'documentGraph' | 'topology';

interface StackLayer {
    id: LayerId;
    n: number;
    label: string;
    description: string;
    enabled: boolean;
    required?: boolean;
    allowedSources?: string[];
    files?: number;
    engine?: string;
    deferred?: boolean;
}

type StackVersionStatus = 'draft' | 'published' | 'retired';

interface StackVersion {
    version: number;
    status: StackVersionStatus;
    layers: StackLayer[];
    publishedAt?: string;
}

interface HostProfile {
    id: string;
    userId: string;
    hostId: string;
    stackVersion: number;
    flowId?: string;
    flowVersion?: number;
    memorySource: string;
    memoryProvider?: string;
    codeGraphSource: string;
    codeGraphProvider?: string;
    materialInstall?: string[];
    mcpConfigSource?: string;
    installState: 'pending' | 'detected' | 'installed' | 'partial' | 'error';
    detected?: boolean;
}

type WorkerLayer = 'peer' | 'gate';

interface WorkerEntry {
    id: string;
    name: string;
    role: string;
    layer: WorkerLayer;
    hostBindingIds: string[];
    scope: string;
    status: 'declared' | 'active' | 'paused' | 'retired';
    capabilities: string[];
    verbs: string[];
    bar: EvidenceRequirementDto[];
    escalation: string;
    instructions?: string;
    sourceFile?: string;
    sourceHash?: string;
    sourceType?: string;
}

interface WorkerEdge {
    from: string;
    to: string;
    on: string;
}

interface WorkerDraft {
    name: string;
    role: string;
    layer: WorkerLayer;
    scope: string;
    capabilities: string;
    verbs: string;
    bar: string;
    escalation: string;
}

interface PluginEntry {
    id: string;
    label: string;
    type: 'host' | 'source' | 'provider' | 'mcp';
    version: string;
    capabilities: string[];
    mcpSource?: string;
    status: 'installed' | 'available' | 'error';
}

function defaultWorkers(): WorkerEntry[] {
    return [
        { id: 'worker-scout', name: 'Scout', role: 'scout', layer: 'peer', hostBindingIds: [], scope: '/tmp/slp/recon/', status: 'declared', capabilities: ['scout'], verbs: ['read', 'write'], bar: [], escalation: 'stop+notify' },
        { id: 'worker-plan', name: 'Plan', role: 'plan', layer: 'peer', hostBindingIds: [], scope: '/tmp/slp/plan/', status: 'declared', capabilities: ['plan'], verbs: ['read', 'write'], bar: [], escalation: 'stop+notify' },
        { id: 'worker-build', name: 'Build', role: 'build', layer: 'peer', hostBindingIds: [], scope: 'agents/, scripts/, tools/', status: 'declared', capabilities: ['be', 'fe'], verbs: ['read', 'write', 'append'], bar: [], escalation: 'stop+notify' },
        { id: 'worker-fixbug', name: 'Fixbug', role: 'fixbug', layer: 'peer', hostBindingIds: [], scope: 'findings', status: 'declared', capabilities: ['be'], verbs: ['read', 'write'], bar: [], escalation: 'stop+notify' },
        { id: 'worker-verify', name: 'Verify', role: 'verify', layer: 'gate', hostBindingIds: [], scope: '/tmp/slp/verify/', status: 'declared', capabilities: ['verify'], verbs: ['read', 'write', 'approve'], bar: [{ kind: 'verify', metric: 'status', op: '==', value: 'PASS' }], escalation: 'stop+notify' },
        { id: 'worker-audit', name: 'Audit', role: 'audit', layer: 'gate', hostBindingIds: [], scope: '/tmp/slp/audit/', status: 'declared', capabilities: ['audit'], verbs: ['read', 'write', 'approve'], bar: [{ kind: 'audit', metric: 'rubric', op: '>=', value: 85 }, { kind: 'audit', metric: 'critical', op: '==', value: 0 }], escalation: 'stop+notify' },
        { id: 'worker-qc', name: 'QC', role: 'qc', layer: 'gate', hostBindingIds: [], scope: '/tmp/slp/qc/', status: 'declared', capabilities: ['qc'], verbs: ['read', 'write', 'append', 'approve'], bar: [{ kind: 'scenario', metric: 'executed', op: 'truthy', value: true }], escalation: 'stop+notify' },
    ];
}

const defaultWorkerPolicy = { capabilities: [] as string[], verbs: ['read', 'append'], bar: [] as EvidenceRequirementDto[], escalation: 'allow' };

function splitList(value: string): string[] {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function defaultStackLayers(): StackLayer[] {
    return [
        { id: 'multiAgent', n: 1, label: 'Multi-agent / SLP', description: 'Roles, workers, permissions, and workflows.', enabled: true },
        { id: 'rules', n: 2, label: 'Rules / law', description: 'Canonical rules installed as files.', enabled: true, files: 12 },
        { id: 'skills', n: 3, label: 'Skills', description: 'Canonical skills installed as files.', enabled: true, files: 8 },
        { id: 'hooks', n: 4, label: 'Hooks', description: 'Host hook scripts installed as files.', enabled: true, files: 4 },
        { id: 'memory', n: 5, label: 'Memory', description: 'Required capability; host binding resolves source and provider.', enabled: true, required: true, allowedSources: ['host-native', 'eso-native', 'market'] },
        { id: 'codeGraph', n: 6, label: 'Code graph', description: 'Required capability; host binding resolves source and provider.', enabled: true, required: true, allowedSources: ['host-native', 'eso-native', 'market'] },
        { id: 'documentGraph', n: 7, label: 'Document graph', description: 'ESO document structure and Postgres graph index.', enabled: true, engine: 'postgres' },
        { id: 'topology', n: 8, label: 'Topology', description: 'Service and message topology; deferred.', enabled: false, deferred: true },
    ];
}

function defaultPlugins(): PluginEntry[] {
    return [
        { id: 'cursor', label: 'Cursor', type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'hooks', 'mcp'], status: 'installed' },
        { id: 'agy', label: 'Antigravity', type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'mcp'], status: 'installed' },
        { id: 'claude', label: 'Claude', type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'mcp'], status: 'installed' },
        { id: 'codex', label: 'Codex', type: 'host', version: '0.1.0', capabilities: ['rules'], status: 'available' },
        { id: 'dsh', label: 'DSH', type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'hooks', 'mcp', 'memory'], status: 'installed' },
        { id: 'paseo', label: 'Paseo', type: 'host', version: '0.1.0', capabilities: ['orchestration', 'mcp'], status: 'available' },
        { id: 'orca', label: 'Orca', type: 'host', version: '0.1.0', capabilities: ['orchestration', 'mcp'], status: 'available' },
    ];
}

@Component({
    selector: 'eso-consumer-settings-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="settings-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Consumer settings</p>
                    <h1>{{ name() || route.snapshot.paramMap.get('id') }}</h1>
                    <p class="subtitle">Define the canonical stack; bind host runtimes to developers and published stack versions.</p>
                </div>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" density="-4" class="settings-consumer-picker">
                    <mat-label>Switch consumer</mat-label>
                    <mat-select [value]="consumerId" (selectionChange)="switchConsumer($event.value)" aria-label="Switch consumer">
                        @for (consumer of consumers(); track consumer.id) {
                            <mat-option [value]="consumer.id">{{ consumer.name || consumer.id }}</mat-option>
                        }
                    </mat-select>
                </mat-form-field>
            </header>


            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
            @if (saved()) { <p class="saved-banner" role="status">Settings saved.</p> }

            @if (legacyNotice(); as notice) { <p class="saved-banner" role="status">{{ notice }}</p> }
            @if (legacyError(); as legacyMessage) { <p class="form-error" role="alert">{{ legacyMessage }}</p> }
            @if (migrationNotice(); as migrationMessage) { <p class="saved-banner" role="status">{{ migrationMessage }}</p> }
            @if (migrationError(); as migrationErrorMessage) { <p class="form-error" role="alert">{{ migrationErrorMessage }}</p> }
            @if (migrationActionable()) {
                <section class="migration-panel" aria-label="Harness migration pipeline">
                    <div class="migration-copy">
                        <p class="eyebrow">Migration pipeline</p>
                        <h2>Legacy host assets detected</h2>
                        <p class="section-hint">Preview maps legacy rules, skills, agents, and hooks into ESO canonical <code>agents/</code>. Existing ESO files are never overwritten; conflicts are reported.</p>
                        @if (migrationPreview(); as preview) {
                            <div class="migration-metrics">
                                <div><span>Rules</span><strong>{{ preview.totals.rules.new }} new · {{ preview.totals.rules.same }} same · {{ preview.totals.rules.conflict }} conflict</strong></div>
                                <div><span>Skills</span><strong>{{ preview.totals.skills.new }} new · {{ preview.totals.skills.same }} same · {{ preview.totals.skills.conflict }} conflict</strong></div>
                                <div><span>Agents</span><strong>{{ preview.totals.agents.new }} new · {{ preview.totals.agents.same }} same · {{ preview.totals.agents.conflict }} conflict</strong></div>
                                <div><span>Hooks</span><strong>{{ preview.totals.hooks.new }} new · {{ preview.totals.hooks.same }} same · {{ preview.totals.hooks.conflict }} conflict</strong></div>
                            </div>
                            <code class="plan-hash">plan {{ preview.planHash.slice(0, 16) }}</code>
                            @if (migrationConflictCount() > 0) {
                                <p class="migration-conflict-note" role="status">{{ migrationConflictCount() }} conflict(s) cannot be migrated automatically. Apply will skip them; resolve canonical vs legacy first.</p>
                            }
                        }
                    </div>
                    @if (migrationConflicts().length > 0) {
                        <div class="conflict-list">
                            @for (entry of migrationConflicts(); track entry.id) {
                                <article class="conflict-row">
                                    <div class="conflict-copy">
                                        <code>{{ entry.target }}</code>
                                        <span>source: {{ entry.source }}</span>
                                        <small>{{ entry.reason }}</small>
                                    </div>
                                    <div class="conflict-actions">
                                        <button mat-stroked-button type="button" (click)="resolveMigrationConflict(entry.id, 'keep-eso')">Keep ESO</button>
                                        <button mat-flat-button color="primary" type="button" (click)="resolveMigrationConflict(entry.id, 'adopt-legacy')">Adopt legacy</button>
                                    </div>
                                </article>
                            }
                        </div>
                    }
                    <div class="migration-actions">
                        <button mat-stroked-button type="button" [disabled]="migrationLoading() || migrationApplying()" (click)="previewHarnessMigration()">{{ migrationLoading() ? 'Previewing…' : 'Refresh preview' }}</button>
                        <button mat-flat-button color="primary" type="button" [disabled]="migrationApplying() || migrationNewCount() === 0 || migrationConflictCount() > 0" (click)="applyHarnessMigration()">{{ migrationApplying() ? 'Migrating…' : (migrationConflictCount() > 0 ? 'Resolve conflicts first' : (migrationNewCount() > 0 ? 'Migrate ' + migrationNewCount() + ' new' : 'No new files to migrate')) }}</button>
                    </div>
                </section>
            }

            @if (finishPrompt()) {
                <section class="legacy-panel" aria-label="Finish migration prompt">
                    <div class="legacy-copy">
                        <p class="eyebrow">Finish · migration required</p>
                        <h2>Legacy harness detected</h2>
                        <p class="section-hint">This consumer still has legacy rules/skills/agents/hooks. Migrate them to ESO before finishing? <strong>No</strong> keeps the settings save but does not provision the consumer.</p>
                    </div>
                    <div class="legacy-actions">
                        <button mat-stroked-button type="button" [disabled]="finishing()" (click)="finishWithoutMigration()">No, save only</button>
                        <button mat-flat-button color="primary" type="button" [disabled]="finishing()" (click)="finishWithMigration()">{{ finishing() ? 'Migrating…' : 'Yes, migrate & finish' }}</button>
                    </div>
                </section>
            }
            @if (legacyHarness()?.detected) {
                <section class="legacy-panel" aria-label="Legacy harness archive">
                    <div class="legacy-copy">
                        <p class="eyebrow">Legacy harness</p>
                        <h2>Old harness state detected</h2>
                        <p class="section-hint">ESO can move known v1 harness state into this repo's <code>archive/</code> folder. Active host hooks and canonical ESO material are left untouched.</p>
                        <ul class="legacy-list">
                            @for (entry of legacyHarness()?.entries; track entry.path) {
                                <li><code>{{ entry.path }}</code><span>{{ entry.kind }} · {{ entry.bytes }} bytes</span></li>
                            }
                        </ul>
                        <p class="legacy-target">Archive target: <code>{{ legacyHarness()?.archivePath }}</code></p>
                    </div>
                    <div class="legacy-actions">
                        <button mat-stroked-button type="button" [disabled]="legacyLoading() || legacyArchiving() || migrationLoading()" (click)="refreshLegacyHarness()">{{ legacyLoading() ? 'Scanning…' : 'Re-scan' }}</button>
                        @if (legacyArchiveConfirm()) {
                            <button mat-stroked-button type="button" [disabled]="legacyArchiving()" (click)="legacyArchiveConfirm.set(false)">Cancel</button>
                            <button mat-flat-button color="warn" type="button" [disabled]="legacyArchiving()" (click)="archiveLegacyHarness()">{{ legacyArchiving() ? 'Archiving…' : 'Archive now' }}</button>
                        } @else {
                            <button mat-flat-button color="primary" type="button" [disabled]="legacyArchiving()" (click)="legacyArchiveConfirm.set(true)">Archive legacy</button>
                        }
                    </div>
                </section>
            }

            @if (loading()) {
                <section class="panel settings-loading"><p class="loading-label">Loading settings…</p></section>
            } @else {
                <nav class="settings-tabs" role="tablist" aria-label="Consumer settings sections">
                    @for (tab of tabs; track tab.id) {
                        <button type="button" role="tab" class="settings-tab" [class.active]="activeTab() === tab.id" [attr.aria-selected]="activeTab() === tab.id" [title]="tab.label + ' — ' + tab.hint" (click)="selectTab(tab.id)">
                            <span class="settings-step-no">{{ tab.n }}</span>
                            <span class="settings-tab-copy"><strong>{{ tab.label }}</strong><small>{{ tab.hint }}</small></span>
                        </button>
                    }
                </nav>

                <div class="settings-tab-content">
                    @switch (activeTab()) {
                        @case ('profile') {
                            <section class="tab-panel" role="tabpanel">
                                <p class="section-hint">Display and classification metadata for this consumer.</p>
                                <div class="form-grid">
                                    <mat-form-field appearance="outline"><mat-label>Consumer name</mat-label><input matInput [ngModel]="name()" (ngModelChange)="name.set($event)"></mat-form-field>
                                    <mat-form-field appearance="outline"><mat-label>Owner / team</mat-label><input matInput [ngModel]="owner()" (ngModelChange)="owner.set($event)" placeholder="finance-platform"></mat-form-field>
                                    <mat-form-field appearance="outline"><mat-label>Locale</mat-label><input matInput [ngModel]="locale()" (ngModelChange)="locale.set($event)" placeholder="vi-VN"></mat-form-field>
                                    <mat-form-field appearance="outline"><mat-label>Tags</mat-label><input matInput [ngModel]="tags()" (ngModelChange)="tags.set($event)" placeholder="finance, accounting"></mat-form-field>
                                </div>
                                <mat-form-field appearance="outline" class="full-width"><mat-label>Description</mat-label><textarea matInput rows="3" [ngModel]="description()" (ngModelChange)="description.set($event)"></textarea></mat-form-field>

                            </section>
                        }

                        @case ('stack') {
                            <section class="tab-panel" role="tabpanel">
                                <div class="stack-summary">
                                    <div><span>Stack version</span><strong>v{{ activeStackVersion() }} · {{ stackStatus() }}</strong></div>
                                    <div><span>Layers</span><strong>{{ enabledLayerCount() }} / {{ stackLayers().length }} active</strong></div>
                                    <div><span>Host bindings</span><strong>{{ hostProfiles().length }}</strong></div>
                                </div>
                                <div class="stack-version-bar">
                                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Version</mat-label>
                                        <mat-select [ngModel]="activeStackVersion()" (ngModelChange)="switchStackVersion($event)">
                                            @for (item of stackVersions(); track item.version) { <mat-option [value]="item.version">v{{ item.version }} · {{ item.status }}</mat-option> }
                                        </mat-select>
                                    </mat-form-field>
                                    <span class="version-status" [class.draft]="isStackEditable()">{{ stackStatus() }}</span>
                                    <button mat-stroked-button type="button" (click)="createStackVersion()">New version</button>
                                    @if (isStackEditable()) { <button mat-flat-button color="primary" type="button" (click)="publishStack()">Publish draft</button> }
                                    @if (canReopenStack()) { <button mat-stroked-button type="button" (click)="reopenStackVersion()">Reopen as draft</button> }
                                    @if (stackStatus() === 'published') { <button mat-stroked-button color="warn" type="button" (click)="retireStackVersion()">Retire version</button> }
                                    @if (canDeleteStackVersion()) { <button mat-stroked-button color="warn" type="button" (click)="askDeleteStackVersion()">Delete {{ stackStatus() === 'draft' ? 'draft' : 'version' }}</button> }
                                </div>
                                @if (deleteVersionConfirm()) {
                                    <div class="version-delete-confirm">
                                        <span>Delete <strong>v{{ activeStackVersion() }}</strong>? This cannot be undone.</span>
                                        <div class="developer-actions">
                                            <button mat-stroked-button type="button" (click)="cancelDeleteStackVersion()">Cancel</button>
                                            <button mat-flat-button color="warn" type="button" (click)="deleteStackVersion()">Delete</button>
                                        </div>
                                    </div>
                                }
                                <p class="section-hint">{{ isStackEditable() ? 'Draft version is editable. Publish to make it immutable and selectable by host bindings.' : 'Published version is immutable. Create a new version to change the stack.' }}</p>

                                <div class="layer-groups">
                                    <section class="layer-group">
                                        <header class="group-head">
                                            <div><h2>Agent system</h2><p>Roles, rules, skills, and hooks installed into hosts.</p></div>
                                            <span class="group-count">{{ agentLayers().length }} layers</span>
                                        </header>
                                        <div class="layer-columns"><span>Layer</span><span>Mechanism</span><span>Configuration</span><span>State</span></div>
                                        <div class="layer-list">
                                            @for (layer of agentLayers(); track layer.id) {
                                                <article class="layer-row" [class.layer-disabled]="!layer.enabled">
                                                    <div class="layer-ident"><span class="layer-no">{{ layer.n }}</span><div><strong>{{ layer.label }}</strong><small>{{ layer.description }}</small></div></div>
                                                    <div class="layer-cell" data-label="Mechanism"><span>{{ layer.id === 'multiAgent' ? 'Worker policy' : 'Files' }}</span></div>
                                                    <div class="layer-cell layer-config" data-label="Configuration">
                                                        @switch (layer.id) {
                                                            @case ('multiAgent') { <span>{{ workers().length }} workers · {{ workerRoleCount() }} roles</span> }
                                                            @case ('rules') { <span>{{ ruleFiles().length }} rule{{ ruleFiles().length === 1 ? '' : 's' }} · {{ ruleMdcCount() }} .mdc · {{ ruleMdCount() }} .md</span> }
                                                            @case ('skills') { <span>{{ materialCounts().skills }} files · installed</span> }
                                                            @case ('hooks') { <span>{{ materialCounts().hooks }} files · host hook plugin</span> }
                                                        }
                                                    </div>
                                                    <div class="layer-state" data-label="State"><mat-slide-toggle [ngModel]="layer.enabled" [disabled]="!isStackEditable()" (ngModelChange)="updateLayer(layer.id, 'enabled', $event)"></mat-slide-toggle></div>
                                                </article>
                                            }
                                        </div>
                                    </section>

                                    <section class="layer-group knowledge-group">
                                        <header class="group-head">
                                            <div><h2>Knowledge &amp; context</h2><p>Capability policy for memory, code, documents, and topology. Host bindings resolve the concrete source.</p></div>
                                            <span class="group-count">{{ knowledgeLayers().length }} layers</span>
                                        </header>
                                        <div class="knowledge-table">
                                            <div class="knowledge-header"><span>Layer</span><span>Policy</span><span>Resolution</span><span>State</span></div>
                                            @for (layer of knowledgeLayers(); track layer.id) {
                                                <div class="knowledge-row" [class.layer-disabled]="!layer.enabled">
                                                    <div class="knowledge-layer"><span class="layer-no">{{ layer.n }}</span><div><strong>{{ layer.label }}</strong><small>{{ layer.description }}</small></div></div>
                                                    <div class="knowledge-source">
                                                        <span class="cell-label knowledge-label">Policy</span>
                                                        @if (layer.id === 'memory' || layer.id === 'codeGraph') {
                                                            <div class="policy-stack">
                                                                <mat-checkbox [checked]="!!layer.required" [disabled]="!layer.enabled || !isStackEditable()" (change)="updateLayer(layer.id, 'required', $event.checked)">Required</mat-checkbox>
                                                                <div class="policy-sources">
                                                                    @for (source of policySources; track source) {
                                                                        <button type="button" class="source-pill" [class.active]="(layer.allowedSources || []).includes(source)" [disabled]="!layer.enabled || !isStackEditable()" (click)="toggleAllowedSource(layer.id, source, !(layer.allowedSources || []).includes(source))">{{ source }}</button>
                                                                    }
                                                                </div>
                                                            </div>
                                                        } @else if (layer.id === 'documentGraph') {
                                                            <span class="static-value">ESO-only · Postgres</span>
                                                        } @else {
                                                            <span class="muted">Deferred</span>
                                                        }
                                                    </div>
                                                    <div class="knowledge-provider">
                                                        <span class="cell-label knowledge-label">Resolution</span>
                                                        @if (layer.id === 'memory' || layer.id === 'codeGraph') {
                                                            <div class="resolution-note"><strong>Per host binding</strong><small>Source and provider are resolved for each host, not here.</small><span class="resolution-count">{{ hostProfiles().length }} binding{{ hostProfiles().length === 1 ? '' : 's' }}</span></div>
                                                        } @else if (layer.id === 'documentGraph') {
                                                            <div class="resolution-note"><strong>Postgres · graph schema</strong><small>ESO-owned engine, not host-specific.</small></div>
                                                        } @else {
                                                            <span class="muted">—</span>
                                                        }
                                                    </div>
                                                    <div class="knowledge-state">
                                                        <span class="cell-label knowledge-label">State</span>
                                                        <div class="state-control">
                                                            <span class="state-pill" [class.state-off]="!layer.enabled">{{ layer.deferred ? 'Deferred' : layer.enabled ? 'Active' : 'Off' }}</span>
                                                            <mat-slide-toggle [ngModel]="layer.enabled" [disabled]="!!layer.deferred || !isStackEditable()" (ngModelChange)="updateLayer(layer.id, 'enabled', $event)"></mat-slide-toggle>
                                                        </div>
                                                    </div>
                                                </div>
                                            }
                                        </div>
                                    </section>
                                </div>

                                <section class="rules-material">
                                <header class="rules-material-head">
                                    <div><p class="eyebrow">Rules material</p><h3>Rules source · .mdc / .md</h3><p>Both are canonical under <code>agents/rules/</code>. <code>.mdc</code> is Cursor format; <code>.md</code> is Markdown format. Host trees are projections elsewhere.</p></div>
                                    <div class="rules-actions">
                                        <input #ruleFileInput type="file" accept=".mdc,.md" multiple hidden (change)="onRuleFiles($event)">
                                        <input #ruleFolderInput type="file" accept=".mdc,.md" webkitdirectory directory multiple hidden (change)="onRuleFiles($event)">
                                        <button mat-stroked-button type="button" [disabled]="ruleImporting()" (click)="ruleFileInput.click()">{{ ruleImporting() ? 'Reading…' : 'Import .mdc' }}</button>
                                        <button mat-stroked-button type="button" [disabled]="ruleImporting()" (click)="ruleFolderInput.click()">Import folder</button>
                                    </div>
                                </header>
                                @if (ruleImportPreview(); as preview) {
                                    <div class="rule-import-preview">
                                        <header><div><h4>Rule import preview</h4><p>{{ preview.candidates.length }} rule(s) · {{ preview.skipped.length }} skipped</p></div><button mat-button type="button" (click)="closeRuleImport()">Cancel</button></header>
                                        @if (preview.candidates.length > 0) {
                                            <div class="worker-table-wrap">
                                                <table class="worker-table">
                                                    <thead><tr><th>Import</th><th>Source</th><th>Rule</th><th>Globs</th><th>Always</th><th>Action</th></tr></thead>
                                                    <tbody>
                                                        @for (candidate of preview.candidates; track candidate.sourceHash) {
                                                            <tr>
                                                                <td><mat-checkbox [checked]="ruleSelectedHashes().includes(candidate.sourceHash)" (change)="toggleRuleImport(candidate.sourceHash, $event.checked)"></mat-checkbox></td>
                                                                <td><code>{{ candidate.sourceFile }}</code><br><small>{{ candidate.sourceType }}</small>@if (candidate.warnings?.length) { <br><small class="import-warning">{{ candidate.warnings.join(' · ') }}</small> }</td>
                                                                <td><strong>{{ candidate.rule.id }}</strong><br><small>{{ candidate.rule.description || 'no description' }}</small></td>
                                                                <td><code>{{ candidate.rule.globs || '—' }}</code></td>
                                                                <td>{{ candidate.rule.alwaysApply ? 'yes' : 'no' }}</td>
                                                                <td>
                                                                    @if (candidate.conflict) {
                                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="import-action-field"><mat-label>Conflict</mat-label>
                                                                            <mat-select [ngModel]="ruleAction(candidate.sourceHash)" (ngModelChange)="setRuleAction(candidate.sourceHash, $event)">
                                                                                <mat-option value="skip">skip</mat-option>
                                                                                <mat-option value="replace">replace</mat-option>
                                                                                <mat-option value="copy">copy</mat-option>
                                                                            </mat-select>
                                                                        </mat-form-field>
                                                                    } @else { <span class="badge">import</span> }
                                                                </td>
                                                            </tr>
                                                        }
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div class="import-actions"><button mat-flat-button color="primary" type="button" [disabled]="importableRuleCount() === 0" (click)="applyRuleImport()">Import {{ importableRuleCount() }} selected</button></div>
                                        }
                                        @if (preview.skipped.length > 0) {
                                            <div class="import-skipped">
                                                <h4>Skipped</h4>
                                                @for (item of preview.skipped; track item.sourceFile + item.reason) { <div><code>{{ item.sourceFile }}</code><span>{{ item.reason }}</span></div> }
                                            </div>
                                        }
                                    </div>
                                }
                                @if (ruleFiles().length === 0) {
                                    <p class="muted">No .mdc rules yet. Import a Cursor rule or folder.</p>
                                } @else {
                                    <div class="worker-table-wrap">
                                        <table class="worker-table rules-table">
                                            <thead><tr><th>Rule</th><th>Description</th><th>Globs</th><th>Always apply</th><th></th></tr></thead>
                                            <tbody>
                                                @for (rule of ruleFiles(); track rule.id) {
                                                    <tr><td data-label="Rule"><strong>{{ rule.id }}</strong><br><code>{{ rule.sourceFile || 'agents/rules/' + rule.id + '.mdc' }}</code></td><td data-label="Description">{{ rule.description || '—' }}</td><td data-label="Globs"><code>{{ rule.globs || '—' }}</code></td><td data-label="Always apply">{{ rule.alwaysApply ? 'yes' : 'no' }}</td><td data-label="Action"><button mat-button type="button" (click)="deleteRule(rule)">Remove</button></td></tr>
                                                }
                                            </tbody>
                                        </table>
                                    </div>
                                }
                                </section>
                            </section>
                        }

                        @case ('hosts') {
                            <section class="tab-panel" role="tabpanel">
                                <header class="tab-intro">
                                    <p class="eyebrow">Host bindings</p>
                                    <h2>Who uses which host runtime</h2>
                                    <p>A host binding connects one developer, one <strong>registered host runtime</strong>, and one published Stack version. It answers where the stack runs and how Memory and Code graph resolve on that host. ESO is optional: unbound tools keep working unchanged.</p>
                                    <p class="host-source-note">Hosts are registered in <button mat-button type="button" (click)="openHosts()">Hosts</button>. This tab only assigns a registered host; it does not create a host.</p>
                                    <div class="actor-grid">
                                        <div><span>Who acts</span><strong>Operator / repository owner</strong></div>
                                        <div><span>Decision</span><strong>Developer × host runtime × Stack version</strong></div>
                                        <div><span>For whom</span><strong>Each developer using Cursor, AGY, DSH, Claude, Paseo, or Orca</strong></div>
                                        <div><span>Result</span><strong>ESO projects the Stack; the host owns its runtime</strong></div>
                                    </div>
                                </header>

                                <div class="hosts-summary">
                                    <div><span>Developers</span><strong>{{ developers().length }}</strong></div>
                                    <div><span>Host bindings</span><strong>{{ hostProfiles().length }}</strong></div>
                                    <div><span>Detected hosts</span><strong>{{ unmanagedHosts().length }}</strong></div>
                                </div>

                                <section class="hosts-section">
                                    <header class="hosts-section-head"><div><h3>Active bindings</h3><p class="muted">Developer → host runtime × pinned Stack version.</p></div><div class="developer-actions"><button mat-stroked-button type="button" (click)="openBulkUpgrade()">Bulk upgrade</button><button mat-flat-button color="primary" type="button" [disabled]="activeHosts().length === 0" (click)="startNewBinding()">New host binding</button></div></header>
                                    @if (bulkUpgradeOpen()) {
                                        <div class="bulk-upgrade-panel">
                                            <mat-form-field appearance="outline"><mat-label>Target Stack version</mat-label>
                                                <mat-select [ngModel]="bulkUpgradeTarget()" (ngModelChange)="bulkUpgradeTarget.set($event)">
                                                    @for (item of publishedStackVersions(); track item.version) { <mat-option [value]="item.version">v{{ item.version }} · {{ item.status }}</mat-option> }
                                                </mat-select>
                                            </mat-form-field>
                                            <span class="muted">{{ affectedBindings() }} binding(s) will move to the target version.</span>
                                            <div class="developer-actions"><button mat-stroked-button type="button" (click)="closeBulkUpgrade()">Cancel</button><button mat-flat-button color="primary" type="button" [disabled]="!bulkUpgradeTarget() || affectedBindings() === 0" (click)="applyBulkUpgrade()">Upgrade bindings</button></div>
                                        </div>
                                    }
                                    @if (developers().length === 0) {
                                        <div class="empty-state"><h3>No host bindings yet</h3><p class="muted">Nothing is required. Add a developer only when ESO should project a Stack into that host.</p></div>
                                    } @else {
                                        <div class="developer-groups">
                                            @for (developer of developers(); track developer) {
                                                <article class="developer-card">
                                                    <header class="developer-head">
                                                        <div><h3>{{ developer }}</h3><span>{{ hostProfileCount(developer) }}</span></div>
                                                        <div class="developer-actions">
                                                            <button mat-stroked-button type="button" [disabled]="activeHosts().length === 0" (click)="startAddHost(developer)">Add host binding</button>
                                                            <button mat-stroked-button color="warn" type="button" (click)="askRemoveDeveloper(developer)">Remove developer</button>
                                                        </div>
                                                    </header>
                                                    @if (removingDeveloper() === developer) {
                                                        <div class="remove-confirm" role="alert">
                                                            <span>Remove <strong>{{ developer }}</strong> and {{ hostProfileCount(developer) }}?</span>
                                                            <div class="remove-confirm-actions">
                                                                <button mat-stroked-button type="button" (click)="cancelRemoveDeveloper()">Cancel</button>
                                                                <button mat-flat-button color="warn" type="button" (click)="removeDeveloper(developer)">Remove</button>
                                                            </div>
                                                        </div>
                                                    }
                                                    @if (managedProfilesFor(developer).length > 0) {
                                                        <div class="host-table-wrap">
                                                            <table class="host-table">
                                                                <thead><tr><th>Host</th><th>Stack</th><th>Sources</th><th>Resolution</th><th class="actions-col">Actions</th></tr></thead>
                                                                <tbody>
                                                                    @for (profile of managedProfilesFor(developer); track profile.id) {
                                                                        <tr class="host-row" [class.host-unavailable]="!hostAvailable(profile.hostId)">
                                                                            <td><div class="host-name"><strong>{{ hostLabel(profile.hostId) }}</strong><small>{{ hostAvailable(profile.hostId) ? hostHealth(profile.hostId) : 'host unavailable' }}</small></div></td>
                                                                            <td>v{{ profile.stackVersion }}@if (profile.flowId) { <small class="flow-pin">flow {{ profile.flowId }} · v{{ profile.flowVersion || 1 }}</small> }</td>
                                                                            <td class="host-sources">{{ hostSourcesSummary(profile) }}</td>
                                                                            <td class="host-overrides">{{ resolutionSummary(profile) }}</td>
                                                                            <td><div class="host-row-actions">
                                                                                <button mat-stroked-button type="button" (click)="toggleProfile(profile.id)">{{ expandedProfile() === profile.id ? 'Hide' : 'View' }}</button>
                                                                                <button mat-stroked-button type="button" (click)="startEditHost(profile)">Edit</button>
                                                                                <button mat-stroked-button color="warn" type="button" (click)="removeHostProfile(profile.id)">Remove</button>
                                                                            </div></td>
                                                                        </tr>
                                                                        @if (expandedProfile() === profile.id) {
                                                                            <tr class="effective-row">
                                                                                <td colspan="5">
                                                                                    <div class="effective-profile">
                                                                                        <header><strong>Effective binding</strong><span>Stack v{{ profile.stackVersion }} + host resolution</span></header>
                                                                                        <div class="effective-grid">
                                                                                            @for (layer of effectiveLayers(profile); track layer.id) {
                                                                                                <div class="effective-item">
                                                                                                    <span>{{ layer.label }}</span>
                                                                                                    <strong>{{ layer.value }}</strong>
                                                                                                    <em [class.overridden]="layer.scope === 'override'">{{ layer.scope }}</em>
                                                                                                </div>
                                                                                            }
                                                                                        </div>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        }
                                                                    }
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    }
                                                </article>
                                            }
                                        </div>
                                    }
                                                    @if (addingHostFor()) {
                                                        <div class="host-add-panel">
                                                            <div class="host-add-heading">{{ editingProfile() ? 'Edit host binding' : 'New host binding' }}</div>
                                                            @if (activeHosts().length === 0) {
                                                                <div class="host-add-blocked" role="alert">
                                                                    <span>No active host runtime. Register one in Hosts before creating a binding.</span>
                                                                    <button mat-stroked-button type="button" (click)="openHosts()">Open Hosts</button>
                                                                </div>
                                                            }
                                                            <div class="host-add-row">
                                                                <mat-form-field appearance="outline"><mat-label>Developer / user</mat-label>
                                                                    <input matInput [ngModel]="bindingDeveloper()" [disabled]="addingHostFor() !== '__new' || !!editingProfile()" (ngModelChange)="bindingDeveloper.set($event)" placeholder="dev1">
                                                                </mat-form-field>
                                                                <mat-form-field appearance="outline"><mat-label>Registered host</mat-label>
                                                                    <mat-select [ngModel]="newHostId()" [disabled]="!!editingProfile()" (ngModelChange)="changeHost($event)">
                                                                        @for (host of activeHosts(); track host.hostId) { <mat-option [value]="host.hostId">{{ host.hostId }} · {{ hostTypeLabel(host.hostType) }} · {{ host.label || 'no label' }}</mat-option> }
                                                                    </mat-select>
                                                                    <mat-hint>Only active registered hosts are assignable. Bindings target hostId.</mat-hint>
                                                                </mat-form-field>
                                                                <mat-form-field appearance="outline"><mat-label>Stack version</mat-label>
                                                                    <mat-select [ngModel]="newStackVersion()" (ngModelChange)="newStackVersion.set($event)">
                                                                        @for (item of publishedStackVersions(); track item.version) { <mat-option [value]="item.version">v{{ item.version }} · {{ item.status }}</mat-option> }
                                                                    </mat-select>
                                                                    <mat-hint>Binding pins this version.</mat-hint>
                                                                </mat-form-field>
                                                                <mat-form-field appearance="outline"><mat-label>Flow</mat-label>
                                                                    <mat-select [ngModel]="newFlowId()" (ngModelChange)="changeFlow($event)">
                                                                        <mat-option value="">No flow</mat-option>
                                                                        @for (flow of flowSummaries(); track flow.id) { <mat-option [value]="flow.id">{{ flow.name }} · {{ flow.id }}</mat-option> }
                                                                    </mat-select>
                                                                    <mat-hint>Optional flow pin.</mat-hint>
                                                                </mat-form-field>
                                                                @if (newFlowId()) {
                                                                    <mat-form-field appearance="outline"><mat-label>Flow version</mat-label>
                                                                        <mat-select [ngModel]="newFlowVersion()" (ngModelChange)="newFlowVersion.set($event)">
                                                                            @for (version of flowVersionOptions(); track version) { <mat-option [value]="version">v{{ version }}</mat-option> }
                                                                        </mat-select>
                                                                    </mat-form-field>
                                                                }
                                                                <div class="host-add-actions">
                                                                    <button mat-stroked-button type="button" (click)="cancelAddHost()">Cancel</button>
                                                                    <button mat-flat-button color="primary" type="button" (click)="saveHostBinding()">{{ editingProfile() ? 'Save binding' : 'Add host binding' }}</button>
                                                                </div>
                                                            </div>
                                                            <details class="profile-overrides">
                                                                <summary>
                                                                    <div><strong>Capability resolution</strong><span>How this host resolves Stack policy</span></div>
                                                                    <span class="summary-action">Configure</span>
                                                                </summary>
                                                                <div class="overrides-body">
                                                                    <div class="resolution-toolbar">
                                                                        <p>Stack sets <strong>policy</strong>. This binding resolves <strong>source and provider</strong> for this host.</p>
                                                                        <button mat-stroked-button type="button" (click)="useHostDefaults()">Use host defaults</button>
                                                                    </div>

                                                                    <section class="capability-group">
                                                                        <header class="capability-group-head">
                                                                            <div><h4>Memory context</h4><p>Session and long-term memory for this host.</p></div>
                                                                            <span class="scope-badge" [class.disabled]="!isResolutionLayerEnabled('memory')">{{ isResolutionLayerEnabled('memory') ? 'resolved' : 'disabled' }}</span>
                                                                        </header>
                                                                        @if (isResolutionLayerEnabled('memory')) {
                                                                            <div class="resolution-control">
                                                                                <span class="control-label">Source</span>
                                                                                <mat-form-field appearance="outline"><mat-label>Memory source</mat-label>
                                                                                    <mat-select [ngModel]="newMemorySource()" (ngModelChange)="newMemorySource.set($event)">
                                                                                        @for (source of sourceOptionsFor('memory'); track source) { <mat-option [value]="source">{{ source }}</mat-option> }
                                                                                    </mat-select>
                                                                                </mat-form-field>
                                                                                @if (newMemorySource() === 'market') {
                                                                                    @if (marketProviders('memory').length === 0) {
                                                                                        <span class="control-note">No provider configured in MCP.</span>
                                                                                    } @else {
                                                                                        <mat-form-field appearance="outline"><mat-label>Provider</mat-label>
                                                                                            <mat-select [ngModel]="newMemoryProvider()" (ngModelChange)="newMemoryProvider.set($event)">
                                                                                                @for (provider of marketProviders('memory'); track provider.id) { <mat-option [value]="provider.id">{{ provider.label }}</mat-option> }
                                                                                            </mat-select>
                                                                                        </mat-form-field>
                                                                                    }
                                                                                } @else {
                                                                                    <span class="control-note">Uses the host or ESO-native implementation.</span>
                                                                                }
                                                                            </div>
                                                                        } @else {
                                                                            <div class="group-disabled">Memory is disabled by Stack v{{ newStackVersion() }}.</div>
                                                                        }
                                                                    </section>

                                                                    <section class="capability-group">
                                                                        <header class="capability-group-head">
                                                                            <div><h4>Graph context</h4><p>Code relationships and document structure.</p></div>
                                                                            <span class="scope-badge" [class.disabled]="!isResolutionLayerEnabled('codeGraph')">{{ isResolutionLayerEnabled('codeGraph') ? 'resolved' : 'disabled' }}</span>
                                                                        </header>
                                                                        @if (isResolutionLayerEnabled('codeGraph')) {
                                                                            <div class="resolution-control">
                                                                                <span class="control-label">Code graph</span>
                                                                                <mat-form-field appearance="outline"><mat-label>Code graph source</mat-label>
                                                                                    <mat-select [ngModel]="newCodeGraphSource()" (ngModelChange)="newCodeGraphSource.set($event)">
                                                                                        @for (source of sourceOptionsFor('codeGraph'); track source) { <mat-option [value]="source">{{ source }}</mat-option> }
                                                                                    </mat-select>
                                                                                </mat-form-field>
                                                                                @if (newCodeGraphSource() === 'market') {
                                                                                    @if (marketProviders('codeGraph').length === 0) {
                                                                                        <span class="control-note">No provider configured in MCP.</span>
                                                                                    } @else {
                                                                                        <mat-form-field appearance="outline"><mat-label>Provider</mat-label>
                                                                                            <mat-select [ngModel]="newCodeGraphProvider()" (ngModelChange)="newCodeGraphProvider.set($event)">
                                                                                                @for (provider of marketProviders('codeGraph'); track provider.id) { <mat-option [value]="provider.id">{{ provider.label }}</mat-option> }
                                                                                            </mat-select>
                                                                                        </mat-form-field>
                                                                                    }
                                                                                } @else {
                                                                                    <span class="control-note">Uses the ESO-native graph.</span>
                                                                                }
                                                                            </div>
                                                                        } @else {
                                                                            <div class="group-disabled">Code graph is disabled by Stack v{{ newStackVersion() }}.</div>
                                                                        }
                                                                        <div class="capability-list">
                                                                            @for (capability of graphCapabilities(); track capability.id) {
                                                                                <div class="capability-row"><span>{{ capability.label }}</span><strong>{{ capability.value }}</strong><em>stack</em></div>
                                                                            }
                                                                        </div>
                                                                    </section>

                                                                    <section class="capability-group">
                                                                        <header class="capability-group-head">
                                                                            <div><h4>Agent system</h4><p>Inherited from Stack v{{ newStackVersion() }}.</p></div>
                                                                            <span class="scope-badge muted-badge">stack</span>
                                                                        </header>
                                                                        <div class="capability-list">
                                                                            @for (capability of agentCapabilities(); track capability.id) {
                                                                                <div class="capability-row"><span>{{ capability.label }}</span><strong>{{ capability.value }}</strong><em>stack</em></div>
                                                                            }
                                                                        </div>
                                                                    </section>

                                                                    <section class="capability-group">
                                                                        <header class="capability-group-head">
                                                                            <div><h4>Material</h4><p>Files projected to this host.</p></div>
                                                                            <span class="scope-badge muted-badge">stack</span>
                                                                        </header>
                                                                        <div class="capability-row"><span>Material install</span><strong>rules · skills · hooks</strong><em>stack</em></div>
                                                                    </section>

                                                                    <section class="capability-group">
                                                                        <header class="capability-group-head">
                                                                            <div><h4>Host binding</h4><p>Host-owned configuration surface.</p></div>
                                                                            <span class="scope-badge muted-badge">read-only</span>
                                                                        </header>
                                                                        <div class="mcp-binding"><span>MCP config</span><code>{{ mcpSourceForHost(newHostId()) }}</code></div>
                                                                    </section>
                                                                </div>                                                            </details>
                                                        </div>
                                                    }

                                </section>

                                <section class="hosts-section">
                                    <header class="hosts-section-head"><div><h3>Detected host runtimes</h3><p class="muted">Markers exist in the repository, but no binding has been created. Detection is optional.</p></div></header>
                                    @if (unmanagedHosts().length > 0) {
                                        <div class="detected-grid">
                                            @for (host of unmanagedHosts(); track host.hostId) {
                                                <article class="detected-card">
                                                    <div><strong>{{ host.label }}</strong><code>{{ host.markers.join(', ') }}</code></div>
                                                    <button mat-stroked-button type="button" (click)="manageDetectedHost(host.hostId)">{{ hostAvailable(host.hostId) ? 'Bind with ESO' : 'Register in Hosts' }}</button>
                                                </article>
                                            }
                                        </div>
                                    } @else {
                                        <p class="muted">No unmanaged host detected.</p>
                                    }
                                </section>

                                <section class="hosts-section unmanaged-note">
                                    <h3>Unmanaged tools</h3>
                                    <p class="muted">Tools without an ESO adapter are not affected. No host binding, no marker, no registration is required; the tool keeps working as-is.</p>
                                </section>

                            </section>
                        }

                        @case ('workers') {
                            <section class="tab-panel" role="tabpanel">
                                <header class="tab-intro">
                                    <p class="eyebrow">Multi-Agent (Workers)</p>
                                    <h2>Agent identities, separate from deployment</h2>
                                    <p>A worker is a host-neutral identity: name, role, layer, scope. Its host placement is a separate deployment step. Credentials are never stored here.</p>
                                </header>

                                <section class="slp-orchestration">
                                    <div class="orchestration-node supervisor"><span>Supervisor</span><strong>Operator</strong><small>approve · escalate · sign Done</small></div>
                                    <span class="orchestration-arrow">→</span>
                                    <div class="orchestration-node lead"><span>Lead</span><strong>Main chat agent</strong><small>split · dispatch · roll up</small></div>
                                    <span class="orchestration-arrow">→</span>
                                    <div class="orchestration-node workers"><span>Workers</span><strong>7 positions</strong><small>peer · gate</small></div>
                                    <p>Lead is not a worker; no layer; not dispatchable. Workers below are the only rows with peer/gate.</p>
                                </section>

                                <div class="agent-stats worker-stats">
                                    <div><strong>{{ workers().length }}</strong><span>workers</span></div>
                                    <div><strong>{{ workerRoleCount() }}</strong><span>roles in use</span></div>
                                    <div><strong>{{ workerHostCoverage() }}</strong><span>host bindings</span></div>
                                    <div><strong>{{ workerPlacementCount() }}</strong><span>host placements</span></div>
                                </div>

                                <section class="formation-panel">
                                    <div class="formation-head">
                                        <div><span class="scope-badge">DEFAULT FLOW</span><strong>{{ defaultFlow()?.name || 'No default flow' }}</strong><small>@if (defaultFlow(); as flow) { {{ flow.id }} · v{{ flow.version }} · {{ flow.status }} · edges are read-only here } @else { Publish a flow and set it as default. }</small></div>
                                        <button mat-stroked-button type="button" (click)="openFlows()">Open flow editor</button>
                                    </div>
                                    @if (workerEdges().length === 0) {
                                        <p class="muted">No default flow edges. Open the flow editor to create and publish one.</p>
                                    } @else {
                                        <div class="formation-chain">
                                            @for (edge of workerEdges(); track edge.from + edge.to + edge.on) {
                                                <span class="formation-edge"><b>{{ workerName(edge.from) }}</b> → <b>{{ workerName(edge.to) }}</b><em>{{ edge.on }}</em></span>
                                            }
                                        </div>
                                    }
                                    <button type="button" class="formation-flow" (click)="openDiagram.set('workers')">
                                        <span class="formation-flow-preview"><img src="assets/diagrams/that-tinh-tran-diagram.svg" alt="Seven-Star Formation worker flow"></span>
                                        <span class="formation-flow-copy"><strong>View the worker flow</strong><small>Original Seven-Star Formation diagram · click to open</small></span>
                                    </button>

                                </section>

                                <section class="workers-section">
                                    <header class="workers-head">
                                        <div><h3>Worker definitions</h3><p class="section-hint">Identity, policy, then deployment. Select a worker to inspect it. This is host-neutral.</p></div>
                                        <div class="workers-head-actions">
                                            <input #workerFileInput type="file" accept=".md,.mdc" multiple hidden (change)="onWorkerFiles($event)">
                                            <input #workerFolderInput type="file" accept=".md,.mdc" webkitdirectory directory multiple hidden (change)="onWorkerFiles($event)">
                                            <button mat-stroked-button type="button" (click)="openFlows()">Flows</button>
                                            <button mat-stroked-button type="button" [disabled]="workerSyncing()" (click)="syncWorkerSources()">{{ workerSyncing() ? 'Syncing…' : 'Sync sources' }}</button>
                                            <button mat-stroked-button type="button" [disabled]="workerImporting()" (click)="workerFileInput.click()">{{ workerImporting() ? 'Reading…' : 'Import agents' }}</button>
                                            <button mat-stroked-button type="button" [disabled]="workerImporting()" (click)="workerFolderInput.click()">Import folder</button>
                                            <button mat-flat-button color="primary" type="button" (click)="addWorker()">Add worker</button>
                                        </div>
                                    </header>
                                    <div class="worker-source-status">
                                        <span><strong>{{ workerSourceStatus().source }}</strong> source files · <strong>{{ workerSourceStatus().projections }}</strong> projections</span>
                                        @if (workerSourceStatus().drift.length > 0) {
                                            <span class="worker-drift-count">{{ workerSourceStatus().drift.length }} external change(s)</span>
                                        } @else {
                                            <span class="muted">sources and projections in sync</span>
                                        }
                                    </div>
                                    @if (workerSourceStatus().drift.length > 0) {
                                        <div class="worker-drift">
                                            @for (item of workerSourceStatus().drift; track item.file + item.kind) {
                                                <div><code>{{ item.file }}</code><span>{{ item.kind }}</span>@if (item.kind === 'projection_changed') { <button mat-button type="button" (click)="promoteProjection(item.file)">Promote</button> }</div>
                                            }
                                        </div>
                                    }
                                    @if (workerImportPreview(); as preview) {
                                        <section class="worker-import-preview">
                                            <header><div><h3>Import preview</h3><p>{{ preview.candidates.length }} agent file(s) · {{ preview.skipped.length }} skipped</p></div><button mat-button type="button" (click)="closeImportPreview()">Cancel</button></header>
                                            @if (preview.candidates.length > 0) {
                                                <div class="worker-table-wrap">
                                                    <table class="worker-table">
                                                        <thead><tr><th>Import</th><th>Source</th><th>Detected</th><th>Mapped worker</th><th>Action</th><th>Warnings</th></tr></thead>
                                                        <tbody>
                                                            @for (candidate of preview.candidates; track candidate.sourceHash) {
                                                                <tr>
                                                                    <td><mat-checkbox [checked]="importSelectedHashes().includes(candidate.sourceHash)" (change)="toggleImport(candidate.sourceHash, $event.checked)"></mat-checkbox></td>
                                                                    <td><code>{{ candidate.sourceFile }}</code></td>
                                                                    <td><span class="badge">{{ candidate.sourceType }}</span></td>
                                                                    <td><strong>{{ candidate.worker.name }}</strong><br><code>{{ candidate.worker.id }} · {{ candidate.worker.role }} · {{ candidate.worker.layer }}</code></td>
                                                                    <td>
                                                                        @if (candidate.conflict) {
                                                                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="import-action-field"><mat-label>Conflict</mat-label>
                                                                                <mat-select [ngModel]="importAction(candidate.sourceHash)" (ngModelChange)="setImportAction(candidate.sourceHash, $event)">
                                                                                    <mat-option value="skip">skip</mat-option>
                                                                                    <mat-option value="replace">replace</mat-option>
                                                                                    <mat-option value="copy">copy</mat-option>
                                                                                </mat-select>
                                                                            </mat-form-field>
                                                                        } @else { <span class="badge">import</span> }
                                                                    </td>
                                                                    <td>@if (candidate.warnings.length) { <small class="import-warning">{{ candidate.warnings.join(' · ') }}</small> } @else { <small class="muted">none</small> }</td>
                                                                </tr>
                                                            }
                                                        </tbody>
                                                    </table>
                                                </div>
                                                <div class="import-actions"><button mat-flat-button color="primary" type="button" [disabled]="importSelectedHashes().length === 0" (click)="importWorkers()">Import {{ importableCount() }} selected</button></div>
                                            }
                                            @if (preview.skipped.length > 0) {
                                                <div class="import-skipped">
                                                    <h4>Skipped</h4>
                                                    @for (item of preview.skipped; track item.sourceFile + item.reason) { <div><code>{{ item.sourceFile }}</code><span>{{ item.reason }}</span></div> }
                                                </div>
                                            }
                                        </section>
                                    }
                                    @if (workerImportDirty()) {
                                        <div class="import-dirty">
                                            <div><strong>Imported workers are not saved.</strong><span>Review the inspector, then Save settings.</span></div>
                                            <button mat-flat-button color="primary" type="button" (click)="save()">Save settings</button>
                                        </div>
                                    }
                                    <div class="workers-layout">
                                        <div class="workers-list">
                                            @if (workers().length === 0) {
                                                <p class="muted worker-empty">No workers registered. Add a worker to start the formation.</p>
                                            } @else {
                                                @for (worker of workers(); track worker.id) {
                                                    <button type="button" class="worker-card" [class.active]="selectedWorker()?.id === worker.id" (click)="selectWorker(worker.id)">
                                                        <span class="worker-avatar">{{ worker.name.slice(0, 1).toUpperCase() }}</span>
                                                        <span class="worker-card-copy"><strong>{{ worker.name }}</strong><small>{{ worker.role }} · {{ worker.layer }}</small><small>{{ worker.hostBindingIds.length === 0 ? 'Not deployed' : worker.hostBindingIds.length + ' binding' + (worker.hostBindingIds.length === 1 ? '' : 's') }}</small><small class="worker-placement-summary">{{ placementSummary(worker.id) }}</small></span>
                                                        <span class="badge" [class.badge-warn]="worker.layer === 'gate'">{{ worker.status }}</span>
                                                    </button>
                                                }
                                            }
                                        </div>
                                        <div class="worker-inspector">
                                            @if (selectedWorker(); as worker) {
                                                <header class="inspector-head">
                                                    <div><p class="eyebrow">Worker</p><h3>{{ worker.name || 'Unnamed worker' }}</h3><small>{{ worker.id }}</small>@if (worker.sourceFile) { <small class="source-badge">imported · {{ worker.sourceFile }}</small> }</div>
                                                    <span class="badge" [class.badge-warn]="worker.layer === 'gate'">{{ worker.layer }}</span>
                                                </header>
                                                <section class="inspector-block">
                                                    <h4>Identity</h4>
                                                    <div class="inspector-grid">
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Name</mat-label><input matInput [ngModel]="worker.name" (ngModelChange)="updateWorkerField(worker.id, 'name', $event)"></mat-form-field>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Role</mat-label>
                                                            <mat-select [ngModel]="worker.role" (ngModelChange)="updateWorkerField(worker.id, 'role', $event)">
                                                                @for (role of workerRoles; track role) { <mat-option [value]="role">{{ role }}</mat-option> }
                                                            </mat-select>
                                                        </mat-form-field>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Layer</mat-label>
                                                            <mat-select [ngModel]="worker.layer" (ngModelChange)="updateWorkerField(worker.id, 'layer', $event)">
                                                                <mat-option value="peer">peer</mat-option>
                                                                <mat-option value="gate">gate</mat-option>
                                                            </mat-select>
                                                        </mat-form-field>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Status</mat-label>
                                                            <mat-select [ngModel]="worker.status" (ngModelChange)="setWorkerStatus(worker.id, $event)">
                                                                @for (status of workerStatuses; track status) { <mat-option [value]="status">{{ status }}</mat-option> }
                                                            </mat-select>
                                                        </mat-form-field>
                                                    </div>
                                                    <details class="instructions-panel" [open]="!!worker.instructions">
                                                        <summary>Instructions — prompt body @if (worker.instructions) { <span class="badge">set</span> }</summary>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full"><mat-label>Prompt body</mat-label><textarea matInput rows="4" [ngModel]="worker.instructions || ''" (ngModelChange)="updateWorkerField(worker.id, 'instructions', $event)"></textarea></mat-form-field>
                                                        <p class="field-help">Imported subagent prompt. Kept in the worker file; not shown to the host until a host runtime executes it.</p>
                                                    </details>
                                                    @if (worker.status !== 'active') {
                                                        <div class="worker-status-hint"><span>Declared workers cannot be checked or executed.</span><button mat-stroked-button type="button" (click)="activateWorker(worker.id)">Activate worker</button></div>
                                                    }
                                                </section>
                                                <section class="inspector-block policy-block">
                                                    <div class="inspector-block-head">
                                                        <h4>Permissions &amp; evidence</h4>
                                                        <p>What this worker may do, where it may do it, and what it must prove.</p>
                                                    </div>
                                                    <details class="policy-help">
                                                        <summary>What do these mean?</summary>
                                                        <dl>
                                                            <div><dt>Capability</dt><dd>A skill label. It describes what kind of work the worker can take. It is not a permission and is not enforced today.</dd></div>
                                                            <div><dt>Verb</dt><dd>An enforced action: read · write · append · approve · configure · handoff. A worker can only do what its verbs allow.</dd></div>
                                                            <div><dt>Scope</dt><dd>The path or glob where the verb may act. A write outside scope is denied.</dd></div>
                                                            <div><dt>Required evidence</dt><dd>Proof the worker must supply before write, append, approve, or handoff. It is a label the caller passes, not a file upload.</dd></div>
                                                            <div><dt>Escalation</dt><dd>What the caller should do when the check denies: report, stop and notify, or continue with a warning.</dd></div>
                                                        </dl>
                                                    </details>
                                                    <div class="policy-field">
                                                        <span class="field-label">Scopes — where it may act</span>
                                                        <div class="tag-list">
                                                            @for (scope of workerScopeList(worker); track scope) {
                                                                <span class="tag" [class.tag-invalid]="!scopeIsValid(scope)"><code>{{ scope }}</code><button type="button" aria-label="Remove scope" (click)="removeWorkerScope(worker.id, scope)">×</button></span>
                                                            } @empty {
                                                                <span class="tag-empty">No scope. Write actions will be denied.</span>
                                                            }
                                                        </div>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                                            <mat-label>Add scope</mat-label>
                                                            <input matInput [ngModel]="newScope()" (ngModelChange)="newScope.set($event)" (keyup.enter)="addWorkerScope(worker.id)" placeholder="/tmp/slp/build/ or agents/**">
                                                            <button mat-button matSuffix type="button" (click)="addWorkerScope(worker.id)">Add</button>
                                                        </mat-form-field>
                                                        @if (scopeInputError(); as inputError) { <p class="field-error">{{ inputError }}</p> }
                                                        <p class="field-help">Path prefix, glob, or symbolic scope. Use <code>agents/**</code> for a tree. Invalid paths are rejected.</p>
                                                    </div>
                                                    <div class="policy-field">
                                                        <span class="field-label">Capabilities — skills this worker has</span>
                                                        <div class="tag-list">
                                                            @for (capability of worker.capabilities; track capability) {
                                                                <span class="tag">{{ capability }}<button type="button" aria-label="Remove capability" (click)="removeWorkerCapability(worker.id, capability)">×</button></span>
                                                            } @empty {
                                                                <span class="tag-empty">No capabilities. Optional, descriptive only.</span>
                                                            }
                                                        </div>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                                            <mat-label>Add capability</mat-label>
                                                            <input matInput [ngModel]="newCapability()" (ngModelChange)="newCapability.set($event)" (keyup.enter)="addWorkerCapability(worker.id)" placeholder="be, fe, qc">
                                                            <button mat-button matSuffix type="button" (click)="addWorkerCapability(worker.id)">Add</button>
                                                        </mat-form-field>
                                                        @if (capabilityInputError(); as inputError) { <p class="field-error">{{ inputError }}</p> }
                                                        <div class="tag-suggestions">
                                                            @for (suggestion of ['be','fe','qc','review','design','pm']; track suggestion) { <button type="button" (click)="quickCapability(worker.id, suggestion)">{{ suggestion }}</button> }
                                                        </div>
                                                        <p class="field-help">Lowercase slug only. Capability is a skill label, not a permission.</p>
                                                    </div>
                                                    <div class="policy-field">
                                                        <span class="field-label">Allowed actions — verbs it may use</span>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                                            <mat-select multiple [ngModel]="worker.verbs" (ngModelChange)="setWorkerVerbs(worker.id, $event)">
                                                                <mat-option value="read">read — inspect files</mat-option>
                                                                <mat-option value="write">write — create or replace files</mat-option>
                                                                <mat-option value="append">append — add to files or logs</mat-option>
                                                                <mat-option value="approve">approve — pass a gate</mat-option>
                                                                <mat-option value="configure">configure — change settings</mat-option>
                                                                <mat-option value="handoff">handoff — pass work to another worker</mat-option>
                                                            </mat-select>
                                                        </mat-form-field>
                                                        <p class="field-help">Verb is an enforced permission. Gate workers may write only inside their evidence scope; <code>configure</code> is always denied.</p>
                                                    </div>
                                                    <div class="policy-field">
                                                        <span class="field-label">Required evidence — proof before acting</span>
                                                        <div class="tag-list">
                                                            @for (requirement of worker.bar; track $index) {
                                                                <span class="tag tag-evidence">{{ evidenceLabel(requirement) }}<button type="button" aria-label="Remove evidence" (click)="removeWorkerEvidence(worker.id, $index)">×</button></span>
                                                            } @empty {
                                                                <span class="tag-empty">No evidence required.</span>
                                                            }
                                                        </div>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                                            <mat-label>Evidence type</mat-label>
                                                            <mat-select [ngModel]="newEvidenceKind()" (ngModelChange)="newEvidenceKind.set($event)">
                                                                <mat-option value="test">Tests pass</mat-option>
                                                                <mat-option value="verify">Verify result</mat-option>
                                                                <mat-option value="audit">Audit score</mat-option>
                                                                <mat-option value="audit-critical">Audit critical findings = 0</mat-option>
                                                                <mat-option value="scenario">Scenario executed</mat-option>
                                                            </mat-select>
                                                        </mat-form-field>
                                                        @if (newEvidenceKind() === 'audit' || newEvidenceKind() === 'verify') {
                                                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                                                <mat-label>{{ newEvidenceKind() === 'audit' ? 'Minimum rubric score' : 'Required verify result' }}</mat-label>
                                                                <input matInput type="number" [ngModel]="newEvidenceValue()" (ngModelChange)="newEvidenceValue.set($event)" [placeholder]="newEvidenceKind() === 'audit' ? '85' : 'PASS'">
                                                            </mat-form-field>
                                                        }
                                                        @if (evidenceInputError(); as inputError) { <p class="field-error">{{ inputError }}</p> }
                                                        <button mat-stroked-button type="button" (click)="addWorkerEvidence(worker.id)">Add requirement</button>
                                                        <p class="field-help">Checked as a typed value, not a text label. Audit compares rubric score; verify compares status; test/scenario require a pass flag.</p>
                                                    </div>
                                                    <div class="policy-field">
                                                        <span class="field-label">When policy blocks — escalation</span>
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                                            <mat-select [ngModel]="worker.escalation" (ngModelChange)="updateWorkerField(worker.id, 'escalation', $event)">
                                                                <mat-option value="allow">allow — report the denial</mat-option>
                                                                <mat-option value="stop+notify">stop + notify — stop and tell the operator</mat-option>
                                                                <mat-option value="run+warn+notify">run + warn + notify — continue with warning</mat-option>
                                                            </mat-select>
                                                        </mat-form-field>
                                                    </div>
                                                    @if (workerValidationErrors().length > 0) {
                                                        @for (error of workerValidationErrors(); track error) { <p class="field-error">{{ error }}</p> }
                                                    }

                                                </section>
                                                <section class="inspector-block">
                                                    <h4>Deployment</h4>
                                                    @if (hostProfiles().length === 0) {
                                                        <div class="formation-empty compact"><div><strong>No host bindings yet</strong><span>Create one in Host bindings first.</span></div><button mat-stroked-button type="button" (click)="selectTab('hosts')">Open Host bindings</button></div>
                                                    } @else {
                                                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full"><mat-label>Host bindings · {{ worker.hostBindingIds.length }} selected</mat-label>
                                                            <mat-select multiple [ngModel]="worker.hostBindingIds" (ngModelChange)="setWorkerHostBindings(worker.id, $event)">
                                                                @for (binding of hostProfiles(); track binding.id) { <mat-option [value]="binding.id">{{ bindingLabel(binding) }}</mat-option> }
                                                            </mat-select>
                                                        </mat-form-field>
                                                        <p class="field-help">Optional deployment association. The host placement below controls which runtime may execute this worker.</p>
                                                    }
                                                </section>
                                                <section class="inspector-block placement-block">
                                                    <div class="inspector-block-head">
                                                        <h4>Host placement</h4>
                                                        <p>Where this worker may be hosted, which model tier it requests, and the native agent each allowed host should use. ESO stores the placement policy; the host applies it.</p>
                                                    </div>
                                                    @if (hostRuntimes().length === 0) {
                                                        <div class="formation-empty compact">
                                                            <div><strong>No host runtimes registered</strong><span>Register a host runtime before placing this worker.</span></div>
                                                            <button mat-stroked-button type="button" (click)="openHosts()">Open Hosts</button>
                                                        </div>
                                                    } @else {
                                                        <div class="policy-field">
                                                            <span class="field-label">Allowed runtimes — {{ placementDraftFor(worker.id).allowedHosts.length }} selected</span>
                                                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                                                <mat-select multiple [ngModel]="placementDraftFor(worker.id).allowedHosts" (ngModelChange)="setPlacementHosts(worker.id, $event)">
                                                                    @for (option of runtimeOptionsFor(worker.id); track option.value) {
                                                                        <mat-option [value]="option.value">{{ option.label }}</mat-option>
                                                                    }
                                                                </mat-select>
                                                            </mat-form-field>
                                                            <p class="field-help">Placement targets a runtime key. Empty means this worker has no allowed runtime.</p>
                                                            @if (legacyPlacementKeys(worker.id).length > 0) {
                                                                <p class="field-error">Legacy host id without a runtime: {{ legacyPlacementKeys(worker.id).join(', ') }} — pick a runtime key to replace it before saving.</p>
                                                            }
                                                        </div>
                                                        <div class="placement-grid">
                                                            <mat-form-field appearance="outline" subscriptSizing="dynamic">
                                                                <mat-label>Model tier</mat-label>
                                                                <mat-select [ngModel]="placementDraftFor(worker.id).modelTier" (ngModelChange)="setPlacementModelTier(worker.id, $event)">
                                                                    <mat-option value="fast">Fast — cheapest capable model</mat-option>
                                                                    <mat-option value="balanced">Balanced — default</mat-option>
                                                                    <mat-option value="reasoning">Reasoning — deepest model</mat-option>
                                                                </mat-select>
                                                            </mat-form-field>
                                                            <mat-form-field appearance="outline" subscriptSizing="dynamic">
                                                                <mat-label>Fallback</mat-label>
                                                                <mat-select [ngModel]="placementDraftFor(worker.id).fallback" (ngModelChange)="setPlacementFallback(worker.id, $event)">
                                                                    <mat-option value="block">Block — do not fall back</mat-option>
                                                                    <mat-option value="next-host">Next host — try another allowed host</mat-option>
                                                                    <mat-option value="next-tier">Next tier — drop to a cheaper tier</mat-option>
                                                                </mat-select>
                                                            </mat-form-field>
                                                        </div>
                                                        <div class="policy-field">
                                                            <span class="field-label">Native agent mapping — per allowed runtime</span>
                                                            @if (placementDraftFor(worker.id).allowedHosts.length === 0) {
                                                                <span class="tag-empty">Select at least one allowed runtime to map a native agent.</span>
                                                            } @else {
                                                                @for (runtimeKey of placementDraftFor(worker.id).allowedHosts; track runtimeKey) {
                                                                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                                                        <mat-label>Native agent · {{ runtimeKey }}</mat-label>
                                                                        <input matInput [ngModel]="placementDraftFor(worker.id).nativeAgent[runtimeKey] || ''" (ngModelChange)="setNativeAgent(worker.id, runtimeKey, $event)" placeholder="cursor / agy / claude">
                                                                    </mat-form-field>
                                                                }
                                                            }
                                                            <p class="field-help">Host-native agent name this runtime uses for the worker — Cursor, AGY, or another installed agent id.</p>
                                                        </div>
                                                        @if (placementNotice(); as message) { <p class="placement-feedback" role="status">{{ message }}</p> }
                                                        @if (placementError(); as message) { <p class="field-error" role="alert">{{ message }}</p> }
                                                        <div class="placement-actions">
                                                            <button mat-stroked-button type="button" [disabled]="!placementDirty(worker.id)" (click)="resetPlacement(worker.id)">Reset</button>
                                                            <button mat-flat-button color="primary" type="button" [disabled]="placementSaving() || !placementDirty(worker.id)" (click)="savePlacement(worker.id)">{{ placementSaving() ? 'Saving…' : 'Save placement' }}</button>
                                                        </div>
                                                    }
                                                </section>
                                                <section class="inspector-actions">
                                                    <button mat-stroked-button type="button" [disabled]="worker.status !== 'active'" (click)="openPolicyCheck(worker)">Test policy</button>
                                                    <button mat-stroked-button type="button" (click)="removeWorker(worker.id)">Remove</button>
                                                </section>
                                                @if (policyWorker()?.id === worker.id) {
                                                    <section class="worker-policy-check inspector-policy">
                                                        <header><div><p class="eyebrow">Policy check</p><small>{{ worker.scope || 'no scope' }} · {{ worker.verbs.join(', ') || 'no verbs' }}</small></div><button mat-button type="button" (click)="closePolicyCheck()">Close</button></header>
                                                        <div class="policy-check-form">
                                                            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Verb</mat-label>
                                                                <mat-select [ngModel]="policyVerb()" (ngModelChange)="policyVerb.set($event)">
                                                                    @for (verb of ['read','write','append','approve','configure','handoff']; track verb) { <mat-option [value]="verb">{{ verb }}</mat-option> }
                                                                </mat-select>
                                                            </mat-form-field>
                                                            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Path</mat-label><input matInput [ngModel]="policyPath()" (ngModelChange)="policyPath.set($event)" placeholder="agents/rules/core.md"></mat-form-field>
                                                            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Evidence type</mat-label>
                                                                <mat-select [ngModel]="policyEvidenceKind()" (ngModelChange)="policyEvidenceKind.set($event)">
                                                                    <mat-option value="test">Tests pass</mat-option>
                                                                    <mat-option value="verify">Verify result</mat-option>
                                                                    <mat-option value="audit">Audit score</mat-option>
                                                                    <mat-option value="audit-critical">Audit critical findings = 0</mat-option>
                                                                    <mat-option value="scenario">Scenario executed</mat-option>
                                                                </mat-select>
                                                            </mat-form-field>
                                                            @if (policyEvidenceKind() === 'audit' || policyEvidenceKind() === 'verify') {
                                                                <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ policyEvidenceKind() === 'audit' ? 'Rubric score' : 'Verify result' }}</mat-label><input matInput [ngModel]="policyEvidenceValue()" (ngModelChange)="policyEvidenceValue.set($event)" placeholder="90"></mat-form-field>
                                                            }
                                                            <button mat-flat-button color="primary" type="button" [disabled]="policyChecking()" (click)="runPolicyCheck()">{{ policyChecking() ? 'Checking…' : 'Run check' }}</button>
                                                        </div>
                                                        @if (policyResult(); as result) {
                                                            <div class="policy-result" [class.policy-deny]="result.decision === 'DENY'"><strong>{{ result.decision }}</strong>@if (result.reasons?.length) { <span>{{ result.reasons.join(' · ') }}</span> } @else { <span>policy satisfied</span> }</div>
                                                        }
                                                    </section>
                                                }
                                            } @else {
                                                <p class="muted worker-empty">Select a worker or add one.</p>
                                            }
                                        </div>
                                    </div>
                                </section>

                                @if (workerImports().length > 0) {
                                    <details class="import-history">
                                        <summary>Import history · {{ workerImports().length }}</summary>
                                        <div class="worker-table-wrap">
                                            <table class="worker-table">
                                                <thead><tr><th>Source</th><th>Worker</th><th>Action</th><th>At</th></tr></thead>
                                                <tbody>
                                                    @for (record of workerImports(); track record.import_id) {
                                                        <tr><td><code>{{ record.source_file }}</code><br><small>{{ record.source_type }}</small></td><td><code>{{ record.worker_id }}</code></td><td><span class="badge">{{ record.action }}</span></td><td>{{ record.imported_at }}</td></tr>
                                                    }
                                                </tbody>
                                            </table>
                                        </div>
                                    </details>
                                }

                                <section class="workers-section">
                                    <h3>What a worker does not own</h3>
                                    <p class="muted">A worker does not own the Stack, the host runtime, or the knowledge base. Those stay with the consumer, the host, and the artifact owner. The worker only carries a role and scope into a turn.</p>
                                </section>

                                @if (openDiagram(); as diagram) {
                                    <div class="diagram-lightbox" role="dialog" aria-modal="true" (click)="openDiagram.set(null)">
                                        <div class="diagram-lightbox-panel" (click)="$event.stopPropagation()">
                                            <header><strong>{{ diagramTitle() }}</strong><button mat-stroked-button type="button" (click)="openDiagram.set(null)">Close</button></header>
                                            <div class="diagram-lightbox-body"><img [src]="diagramSrc()" [alt]="diagramTitle()"></div>
                                        </div>
                                    </div>
                                }
                            </section>
                        }

                        @case ('knowledge') {
                            <section class="tab-panel knowledge-page" role="tabpanel">
                                <header class="knowledge-hero">
                                    <div>
                                        <p class="eyebrow">Knowledge &amp; Artifact Governance</p>
                                        <h2>Make project knowledge findable, owned, and traceable</h2>
                                        <p>Files are the source. The index and graph are derived. Providers are optional and selected per work area. Read/index authority lives in <strong>Boundaries</strong>.</p>
                                        <div class="knowledge-hero-meta">
                                            <span><strong>{{ knowledgeSummary()?.docs || 0 }}</strong> documents</span>
                                            <span><strong>{{ knowledgeSummary()?.edges || 0 }}</strong> graph edges</span>
                                            <span><strong>{{ knowledgeSummary()?.findings || 0 }}</strong> open findings</span>
                                            <span><strong>{{ knowledgeEmbeddingStatus()?.embedded || 0 }}/{{ knowledgeEmbeddingStatus()?.chunks || 0 }}</strong> embedded</span>
                                        </div>
                                    </div>
                                    <div class="knowledge-hero-actions">
                                        <button mat-stroked-button type="button" [disabled]="knowledgeChecking()" (click)="runKnowledgeCheck()">{{ knowledgeChecking() ? 'Checking…' : 'Run check' }}</button>
                                        <button mat-flat-button color="primary" type="button" [disabled]="knowledgeIndexing()" (click)="indexKnowledge()">{{ knowledgeIndexing() ? 'Indexing…' : 'Index now' }}</button>
                                    </div>
                                </header>

                                <nav class="knowledge-nav" role="tablist" aria-label="Knowledge sections">
                                    <button type="button" role="tab" [attr.aria-selected]="knowledgeSection() === 'overview'" [class.active]="knowledgeSection() === 'overview'" (click)="showKnowledgeSection('overview')">Overview</button>
                                    <button type="button" role="tab" [attr.aria-selected]="knowledgeSection() === 'sources'" [class.active]="knowledgeSection() === 'sources'" (click)="showKnowledgeSection('sources')">Sources</button>
                                    <button type="button" role="tab" [attr.aria-selected]="knowledgeSection() === 'contract'" [class.active]="knowledgeSection() === 'contract'" (click)="showKnowledgeSection('contract')">Contract</button>
                                    <button type="button" role="tab" [attr.aria-selected]="knowledgeSection() === 'index'" [class.active]="knowledgeSection() === 'index'" (click)="showKnowledgeSection('index')">Index &amp; health</button>
                                    <button type="button" role="tab" [attr.aria-selected]="knowledgeSection() === 'manifest'" [class.active]="knowledgeSection() === 'manifest'" (click)="showKnowledgeSection('manifest')">Manifest</button>
                                </nav>

                                @if (knowledgeSection() === 'overview') {
                                    <section class="knowledge-overview">
                                        <div class="knowledge-overview-cards">
                                            <button type="button" class="knowledge-card" (click)="showKnowledgeSection('sources')"><span class="eyebrow">Sources</span><strong>{{ providerRouteSummary() }}</strong><small>Files first; providers optional</small></button>
                                            <button type="button" class="knowledge-card" (click)="showKnowledgeSection('contract')"><span class="eyebrow">Contract</span><strong>{{ sdlcEnabled() ? 'SDLC enforced' : 'Lightweight' }}</strong><small>{{ governanceEnabledCount() }} governance checks</small></button>
                                            <button type="button" class="knowledge-card" (click)="showKnowledgeSection('index')"><span class="eyebrow">Index &amp; health</span><strong>{{ knowledgeSummary()?.docs || 0 }} docs · {{ knowledgeSummary()?.findings || 0 }} findings</strong><small>{{ knowledgeEmbeddingStatus()?.embedded || 0 }}/{{ knowledgeEmbeddingStatus()?.chunks || 0 }} chunks embedded</small></button>
                                            <button type="button" class="knowledge-card" (click)="showKnowledgeSection('manifest')"><span class="eyebrow">Manifest</span><strong>{{ manifestEnabled() ? 'Emit enabled' : 'Manifest off' }}</strong><small>Machine-readable contract</small></button>
                                        </div>
                                        <div class="knowledge-overview-grid">
                                            <section class="knowledge-section">
                                                <header class="knowledge-section-head"><div><h3>Preflight</h3><p>Checks that must pass before the index is trusted.</p></div>@if (knowledgeCheck(); as check) { <span class="badge" [class.badge-warn]="check.status === 'FAIL'">{{ check.status }}</span> }</header>
                                                @if (knowledgeCheck(); as check) {
                                                    @for (item of check.checks.slice(0, 4); track item.id) { <div class="knowledge-overview-row"><span>{{ item.id }}</span><strong>{{ item.label }}</strong><span class="badge" [class.badge-warn]="item.status === 'FAIL'">{{ item.status }}</span></div> }
                                                } @else {
                                                    <div class="knowledge-rule-row"><b>01</b><span>Links resolve</span><small>no dangling document reference</small></div>
                                                    <div class="knowledge-rule-row"><b>02</b><span>Derived sources labelled</span><small>manifest and graph are not sources</small></div>
                                                    <div class="knowledge-rule-row"><b>03</b><span>Provider boundaries respected</span><small>optional providers never become required</small></div>
                                                }
                                            </section>
                                            <section class="knowledge-section">
                                                <header class="knowledge-section-head"><div><h3>Current source routing</h3><p>No provider means files are managed directly.</p></div><button mat-button type="button" (click)="openConsumerPlugins()">Providers</button></header>
                                                <div class="knowledge-route-row"><span>Work management</span><strong>{{ providerRouting().work === 'md' ? '.md files' : providerRouting().work }}</strong></div>
                                                <div class="knowledge-route-row"><span>Design management</span><strong>{{ providerRouting().design === 'md' ? '.md files' : providerRouting().design }}</strong></div>
                                                <div class="knowledge-route-row"><span>Content management</span><strong>{{ providerRouting().content === 'md' ? '.md files' : providerRouting().content }}</strong></div>
                                            </section>
                                        </div>
                                    </section>
                                }

                                <section class="knowledge-index-panel" [class.zone-hidden]="knowledgeSection() !== 'index'">
                                    <div>
                                        <span class="eyebrow">Knowledge index</span>
                                        <strong>{{ knowledgeSummary()?.docs || 0 }} docs · {{ knowledgeSummary()?.edges || 0 }} edges · {{ knowledgeSummary()?.findings || 0 }} findings</strong>
                                        <small>{{ knowledgeSummary()?.manifest ? 'Manifest v' + knowledgeSummary()?.manifest?.manifest_version + ' · source ' + (knowledgeSummary()?.manifest?.build_id || 'not indexed') : 'No index run yet. Index files to build manifest + graph.' }}</small>
                                        <small>{{ knowledgeEmbeddingStatus()?.model || 'BAAI/bge-m3' }} · {{ knowledgeEmbeddingStatus()?.embedded || 0 }}/{{ knowledgeEmbeddingStatus()?.chunks || 0 }} chunks embedded</small>
                                    </div>
                                    <div class="knowledge-index-actions">
                                        <button mat-stroked-button type="button" [disabled]="knowledgeEmbedding() || !knowledgeEmbeddingStatus()?.chunks || (knowledgeEmbeddingStatus()?.embedded || 0) >= (knowledgeEmbeddingStatus()?.chunks || 0)" (click)="embedKnowledge()">{{ knowledgeEmbedding() ? 'Embedding…' : ((knowledgeEmbeddingStatus()?.embedded || 0) >= (knowledgeEmbeddingStatus()?.chunks || 0) ? 'Embedded' : 'Embed pending') }}</button>
                                    </div>
                                </section>
                                @if (knowledgeCheck(); as check) {
                                    <section class="knowledge-check-result" [class.check-fail]="check.status === 'FAIL'" [class.zone-hidden]="knowledgeSection() !== 'index'">
                                        <header><strong>Preflight · {{ check.status }}</strong><span>{{ check.checks.length }} checks</span></header>
                                        @for (item of check.checks; track item.id) {
                                            <div><span class="badge" [class.badge-warn]="item.status === 'FAIL'">{{ item.status }}</span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div>
                                        }
                                    </section>
                                }

                                <section class="knowledge-index-detail" [class.zone-hidden]="knowledgeSection() !== 'index'">
                                    <header class="knowledge-detail-head">
                                        <div><h3>Indexed documents · {{ knowledgeDocs().length }}</h3><p>Read from Postgres. Content remains in files. All rows shown.</p></div>
                                        <div class="knowledge-search">
                                            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Search indexed docs</mat-label><input matInput [ngModel]="knowledgeQuery()" (ngModelChange)="knowledgeQuery.set($event)" (keyup.enter)="searchKnowledge()" placeholder="requirement, manifest…"></mat-form-field>
                                            <button mat-stroked-button type="button" (click)="searchKnowledge()">Search</button>
                                        </div>
                                    </header>
                                    @if (knowledgeDocs().length === 0) {
                                        <p class="muted">No indexed documents yet. Click Index now.</p>
                                    } @else {
                                        <div class="worker-table-wrap knowledge-doc-table">
                                            <table class="worker-table">
                                                <thead><tr><th>Document</th><th>Type</th><th>Status</th><th>Sections</th></tr></thead>
                                                <tbody>
                                                    @for (doc of knowledgeDocs(); track doc.doc_id) {
                                                        <tr class="knowledge-doc-row" (click)="selectKnowledgeDoc(doc)"><td><strong>{{ doc.title || doc.path }}</strong><br><code>{{ doc.path }}</code></td><td>{{ doc.type }}</td><td>{{ doc.status }}</td><td>{{ doc.sections }}</td></tr>
                                                    }
                                                </tbody>
                                            </table>
                                        </div>
                                    }
                                    @if (knowledgeFindings().length > 0) {
                                        <div class="knowledge-findings">
                                            <h4>Open findings · {{ knowledgeFindings().length }}</h4>
                                            @for (finding of knowledgeFindings(); track finding.finding_id) {
                                                <div><span class="badge badge-warn">{{ finding.code }}</span><code>{{ finding.path || finding.doc_id || 'index' }}</code></div>
                                            }
                                        </div>
                                    }
                                    @if (knowledgeRetrieval(); as retrieval) {
                                        <div class="knowledge-retrieval">
                                            <header><strong>Hybrid retrieval</strong><span>{{ retrieval.results.length }} results · FTS {{ retrieval.counts.fts }} · graph {{ retrieval.counts.graph }} · vector {{ retrieval.vector.enabled ? 'on' : 'off' }}</span></header>
                                            @if (!retrieval.vector.enabled) { <small>{{ retrieval.vector.reason }}</small> }
                                            @if (retrieval.results.length === 0) {
                                                <p class="muted">No match for “{{ retrieval.query }}”.</p>
                                            } @else {
                                                <div class="worker-table-wrap">
                                                    <table class="worker-table">
                                                        <thead><tr><th>#</th><th>Document</th><th>Why</th><th>RRF</th></tr></thead>
                                                        <tbody>
                                                            @for (hit of retrieval.results; track hit.doc.doc_id) {
                                                                <tr class="knowledge-doc-row" (click)="selectKnowledgeDoc(hit.doc)"><td>{{ hit.rank }}</td><td><strong>{{ hit.doc.title || hit.doc.path }}</strong><br><code>{{ hit.doc.path }}</code></td><td>{{ hit.why.join(' · ') }}</td><td>{{ hit.score }}</td></tr>
                                                            }
                                                        </tbody>
                                                    </table>
                                                </div>
                                            }
                                        </div>
                                    }
                                    @if (knowledgeCheck()?.coverage?.length) {
                                        <div class="knowledge-coverage">
                                            <h4>Coverage by type</h4>
                                            <div class="worker-table-wrap">
                                                <table class="worker-table">
                                                    <thead><tr><th>Type</th><th>Docs</th><th>Sections</th><th>Findings</th></tr></thead>
                                                    <tbody>
                                                        @for (row of knowledgeCheck()?.coverage; track row.type) {
                                                            <tr><td>{{ row.type }}</td><td>{{ row.docs }}</td><td>{{ row.sections }}</td><td>{{ row.findings }}</td></tr>
                                                        }
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    }
                                    @if (knowledgeDocDetail(); as detail) {
                                        <div class="knowledge-graph-panel">
                                            <header><div><h4>{{ detail.doc?.title || 'Document' }}</h4><code>{{ detail.doc?.path }}</code></div><button mat-button type="button" (click)="knowledgeDocDetail.set(null)">Close</button></header>
                                            <div class="knowledge-graph-columns">
                                                <div><span>Outgoing</span>
                                                    @if (detail.outgoing.length === 0) { <small>No outgoing edges</small> }
                                                    @for (edge of detail.outgoing; track edge.edge_id) { <div><em>{{ edge.kind }}</em><code>{{ edge.path }}</code></div> }
                                                </div>
                                                <div><span>Incoming</span>
                                                    @if (detail.incoming.length === 0) { <small>No incoming edges</small> }
                                                    @for (edge of detail.incoming; track edge.edge_id) { <div><em>{{ edge.kind }}</em><code>{{ edge.path }}</code></div> }
                                                </div>
                                                <div><span>Transitive · {{ detail.descendants.length }}</span>
                                                    @if (detail.descendants.length === 0) { <small>No transitive edges</small> }
                                                    @for (relative of detail.descendants; track relative.doc_id + relative.depth) { <div><em>depth {{ relative.depth }}</em><code>{{ relative.path }}</code></div> }
                                                </div>
                                                <div><span>Sections · {{ detail.sections.length }}</span>
                                                    @for (section of detail.sections.slice(0, 8); track section.section_id) { <div><code>{{ section.anchor }}</code><small>{{ section.heading }}</small></div> }
                                                </div>
                                            </div>
                                        </div>
                                    }
                                </section>

                                <div class="knowledge-layout" [class.zone-hidden]="knowledgeSection() === 'overview' || knowledgeSection() === 'index'" [class.knowledge-layout-single]="knowledgeSection() === 'sources'">
                                    <div class="knowledge-main">
                                        <section class="knowledge-section knowledge-selectable knowledge-contract-section" [class.zone-hidden]="knowledgeSection() !== 'contract'" [class.active]="selectedKnowledgeTopic() === 'pipeline'" (click)="selectKnowledgeTopic('pipeline')">
                                            <header class="knowledge-section-head"><div><h3>Project mode</h3><p>Choose whether this consumer follows an SDLC artifact contract.</p></div><span class="scope-badge" [class.muted-badge]="!sdlcEnabled()">{{ sdlcEnabled() ? 'SDLC' : 'Lightweight' }}</span></header>
                                            <div class="project-mode-grid">
                                                <div class="project-mode-item">
                                                    <span class="control-label">Standard</span>
                                                    <mat-slide-toggle [ngModel]="sdlcEnabled()" (ngModelChange)="sdlcEnabled.set($event)">Apply SDLC</mat-slide-toggle>
                                                    <small>{{ sdlcEnabled() ? 'Artifact contract enforced' : 'Lightweight project' }}</small>
                                                </div>
                                                <div class="project-mode-item" [class.item-disabled]="!sdlcEnabled()">
                                                    <span class="control-label">Pipeline</span>
                                                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Preset</mat-label>
                                                        <mat-select [ngModel]="sdlcPipeline()" [disabled]="!sdlcEnabled()" (ngModelChange)="sdlcPipeline.set($event)">
                                                            @for (pipeline of pipelineOptions; track pipeline.id) { <mat-option [value]="pipeline.id">{{ pipeline.label }}</mat-option> }
                                                        </mat-select>
                                                    </mat-form-field>
                                                    <small>{{ pipelineHint() }}</small>
                                                </div>
                                                <div class="project-mode-item" [class.item-disabled]="!sdlcEnabled()">
                                                    <span class="control-label">Change management</span>
                                                    <mat-checkbox [checked]="crProcess()" [disabled]="!sdlcEnabled()" (change)="crProcess.set($event.checked)">CR process</mat-checkbox>
                                                    <small>Reopen the affected stage with version+1.</small>
                                                </div>
                                            </div>
                                            <p class="knowledge-note">{{ sdlcEnabled() ? 'SDLC artifact contract applies. Root: sdlc/ (managed artifacts).' : 'No sdlc/ folder. Knowledge base still indexes README, docs, and decisions.' }}</p>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable knowledge-contract-section" [class.zone-hidden]="knowledgeSection() !== 'contract'" [class.active]="selectedKnowledgeTopic() === 'document-status' || selectedKnowledgeTopic() === 'open-register' || selectedKnowledgeTopic() === 'cross-check' || selectedKnowledgeTopic() === 'build-enforcement' || selectedKnowledgeTopic() === 'preflight' || selectedKnowledgeTopic() === 'go-no-go' || selectedKnowledgeTopic() === 'pipeline-contract'">
                                            <header class="knowledge-section-head"><div><h3>Governance</h3><p>What must be true before work moves forward.</p></div><span class="scope-badge" [class.muted-badge]="!sdlcEnabled()">{{ sdlcEnabled() ? 'enforced' : 'off' }}</span></header>
                                            <div class="governance-controls">
                                                <div class="governance-row" [class.active]="selectedKnowledgeTopic() === 'document-status'" (click)="selectKnowledgeTopic('document-status')">
                                                    <mat-checkbox [checked]="documentStatusRequired()" [disabled]="!sdlcEnabled()" (change)="documentStatusRequired.set($event.checked)">Document status register</mat-checkbox>
                                                    <small>exists · conforms · connected</small>
                                                </div>
                                                <div class="governance-row" [class.active]="selectedKnowledgeTopic() === 'open-register'" (click)="selectKnowledgeTopic('open-register')">
                                                    <mat-checkbox [checked]="openRegisterRequired()" [disabled]="!sdlcEnabled()" (change)="openRegisterRequired.set($event.checked)">OPEN register</mat-checkbox>
                                                    <small>question · owner · unblock</small>
                                                </div>
                                                <div class="governance-row" [class.active]="selectedKnowledgeTopic() === 'cross-check'" (click)="selectKnowledgeTopic('cross-check')">
                                                    <mat-checkbox [checked]="crossCheckRequired()" [disabled]="!sdlcEnabled()" (change)="crossCheckRequired.set($event.checked)">Cross-check catalogue</mat-checkbox>
                                                    <small>47 checks · X1…X42</small>
                                                </div>
                                                <div class="governance-row" [class.active]="selectedKnowledgeTopic() === 'build-enforcement'" (click)="selectKnowledgeTopic('build-enforcement')">
                                                    <mat-checkbox [checked]="buildEnforcementRequired()" [disabled]="!sdlcEnabled()" (change)="buildEnforcementRequired.set($event.checked)">Build enforcement</mat-checkbox>
                                                    <small>E1–E10 · READY only</small>
                                                </div>
                                                <div class="governance-row" [class.active]="selectedKnowledgeTopic() === 'preflight'" (click)="selectKnowledgeTopic('preflight')">
                                                    <mat-checkbox [checked]="preflightRequired()" [disabled]="!sdlcEnabled()" (change)="preflightRequired.set($event.checked)">Preflight before slice</mat-checkbox>
                                                    <small>one work package</small>
                                                </div>
                                                <div class="governance-row" [class.active]="selectedKnowledgeTopic() === 'go-no-go'" (click)="selectKnowledgeTopic('go-no-go')">
                                                    <mat-checkbox [checked]="goNoGoRequired()" [disabled]="!sdlcEnabled()" (change)="goNoGoRequired.set($event.checked)">Go / No-Go before increment</mat-checkbox>
                                                    <small>whole increment · marks OK/P/OUT/—</small>
                                                </div>
                                                <div class="governance-row" [class.active]="selectedKnowledgeTopic() === 'pipeline-contract'" (click)="selectKnowledgeTopic('pipeline-contract')">
                                                    <mat-checkbox [checked]="pipelineContractRequired()" [disabled]="!sdlcEnabled()" (change)="pipelineContractRequired.set($event.checked)">Pipeline contract gates</mat-checkbox>
                                                    <small>S1–S14 · G1–G13 · CR loop</small>
                                                </div>
                                            </div>
                                            <p class="knowledge-note">Lifecycle: <code>raw → proposed → approved → retired</code>. Catalogue index says 47 checks; the file title says 29 — title is stale and must be fixed.</p>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable knowledge-contract-section" [class.zone-hidden]="knowledgeSection() !== 'contract'" [class.active]="selectedKnowledgeTopic() === 'quartet'" (click)="selectKnowledgeTopic('quartet')">
                                            <header class="knowledge-section-head"><div><h3>Task quartet</h3><p>Task decomposition for work management. Provider-independent.</p></div></header>
                                            <mat-form-field appearance="outline"><mat-label>Quartet profile</mat-label>
                                                <mat-select [ngModel]="quartetProfile()" (ngModelChange)="quartetProfile.set($event)">
                                                    <mat-option value="standard">Standard · unit · impl · coverage · qc</mat-option>
                                                    <mat-option value="extended">Extended · add load · stress</mat-option>
                                                </mat-select>
                                            </mat-form-field>
                                            <div class="quartet-list">
                                                @for (type of quartetTypes(); track type.id) {
                                                    <div class="quartet-row" [class.quartet-out]="!type.included">
                                                        <code>{{ type.id }}</code>
                                                        <span>{{ type.note }}</span>
                                                        <em>{{ type.included ? 'included' : 'out' }}</em>
                                                    </div>
                                                }
                                            </div>
                                            <p class="knowledge-note">BA is OUT when acceptance criteria are clear. Jira is optional; tasks can live in the repo.</p>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable knowledge-source-section" [class.zone-hidden]="knowledgeSection() !== 'sources'" [class.active]="selectedKnowledgeTopic() === 'knowledge-base'" (click)="selectKnowledgeTopic('knowledge-base')">
                                            <header class="knowledge-section-head"><div><h3>Knowledge base</h3><p>Artifacts held for this consumer, by kind and reader.</p></div></header>
                                            <div class="knowledge-block">
                                                <span class="control-label">Artifact kinds</span>
                                                <div class="knowledge-chips">
                                                    @for (kind of artifactKindOptions; track kind) {
                                                        <button type="button" class="source-pill" [class.active]="artifactKinds().includes(kind)" (click)="toggleArtifactKind(kind); $event.stopPropagation()">{{ kind }}</button>
                                                    }
                                                </div>
                                            </div>
                                            <div class="knowledge-block">
                                                <span class="control-label">Representations</span>
                                                <div class="knowledge-chips">
                                                    @for (representation of representationOptions; track representation) {
                                                        <button type="button" class="source-pill" [class.active]="representations().includes(representation)" (click)="toggleRepresentation(representation); $event.stopPropagation()">{{ representation }}</button>
                                                    }
                                                </div>
                                                <p class="knowledge-note">human-readable · agent-readable · machine manifest. Derived representations must reference a source.</p>
                                            </div>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable manifest-section knowledge-manifest-section" [class.zone-hidden]="knowledgeSection() !== 'manifest'" [class.active]="selectedKnowledgeTopic() === 'agent-manifests'" (click)="selectKnowledgeTopic('agent-manifests')">
                                            <header class="knowledge-section-head"><div><h3>Agent manifest</h3><p>Machine-readable contract for this consumer's document structure.</p></div><span class="badge" [class.badge-warn]="!manifestEnabled()">{{ manifestEnabled() ? 'Emit enabled' : 'Emit off' }}</span></header>
                                            <div class="agent-stats">
                                                <div><strong>{{ manifestFacetCount() }}</strong><span>facets</span></div>
                                                <div><strong>{{ manifestRelationCount() }}</strong><span>relations</span></div>
                                                <div><strong>{{ manifestSharedKeys() }}</strong><span>shared keys</span></div>
                                                <div><strong>{{ manifestCheckCount() }}</strong><span>checks</span></div>
                                            </div>
                                            <div class="manifest-emit">
                                                <mat-slide-toggle [ngModel]="manifestEnabled()" (ngModelChange)="manifestEnabled.set($event)">Emit manifest</mat-slide-toggle>
                                                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="manifest-path"><mat-label>Manifest path</mat-label><input matInput [ngModel]="manifestPath()" (ngModelChange)="manifestPath.set($event)" placeholder=".harness/manifest.json"><mat-hint>Relative to the consumer root; generated, never hand-edited.</mat-hint></mat-form-field>
                                            </div>
                                            <div class="manifest-groups">
                                                <section class="manifest-group">
                                                    <div class="manifest-group-head"><span>HUMAN header</span><small>{{ manifestHumanHeaderKeys().length }} selected · required shape for people</small></div>
                                                    <div class="knowledge-chips">
                                                        @for (key of manifestHumanHeaderOptions; track key) {
                                                            <button type="button" class="source-pill" [class.active]="manifestHumanHeaderKeys().includes(key)" (click)="toggleManifestHumanHeader(key); $event.stopPropagation()">{{ key }}</button>
                                                        }
                                                    </div>
                                                </section>
                                                <section class="manifest-group">
                                                    <div class="manifest-group-head"><span>AI header</span><small>{{ manifestAiHeaderKeys().length }} selected · extra keys for agents</small></div>
                                                    <div class="knowledge-chips">
                                                        @for (key of manifestAiHeaderOptions; track key) {
                                                            <button type="button" class="source-pill" [class.active]="manifestAiHeaderKeys().includes(key)" (click)="toggleManifestAiHeader(key); $event.stopPropagation()">{{ key }}</button>
                                                        }
                                                    </div>
                                                </section>
                                                <section class="manifest-group">
                                                    <div class="manifest-group-head"><span>Facets</span><small>{{ manifestFacets().length }} selected · classification dimensions</small></div>
                                                    <div class="knowledge-chips">
                                                        @for (facet of manifestFacetOptions; track facet) {
                                                            <button type="button" class="source-pill" [class.active]="manifestFacets().includes(facet)" (click)="toggleManifestFacet(facet); $event.stopPropagation()">{{ facet }}</button>
                                                        }
                                                    </div>
                                                </section>
                                                <section class="manifest-group">
                                                    <div class="manifest-group-head"><span>Relations</span><small>{{ manifestRelations().length }} selected · allowed edge kinds</small></div>
                                                    <div class="knowledge-chips">
                                                        @for (relation of manifestRelationOptions; track relation) {
                                                            <button type="button" class="source-pill" [class.active]="manifestRelations().includes(relation)" (click)="toggleManifestRelation(relation); $event.stopPropagation()">{{ relation }}</button>
                                                        }
                                                    </div>
                                                </section>
                                                <section class="manifest-group">
                                                    <div class="manifest-group-head"><span>Checks</span><small>{{ manifestChecks().length }} selected · validation before publish</small></div>
                                                    <div class="knowledge-chips">
                                                        @for (check of manifestCheckOptions; track check) {
                                                            <button type="button" class="source-pill" [class.active]="manifestChecks().includes(check)" (click)="toggleManifestCheck(check); $event.stopPropagation()">{{ check }}</button>
                                                        }
                                                    </div>
                                                </section>
                                            </div>
                                            <p class="knowledge-note">Configured for this consumer. <code>sdlc/01.agent-manifests</code> is a study sample, not testeso data.</p>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable knowledge-source-section" [class.zone-hidden]="knowledgeSection() !== 'sources'" [class.active]="selectedKnowledgeTopic() === 'docgraph'" (click)="selectKnowledgeTopic('docgraph')">
                                            <header class="knowledge-section-head"><div><h3>Document graph</h3><p>Derived index of document relationships. Never the source of content.</p></div><mat-slide-toggle [ngModel]="docgraphIndex()" (ngModelChange)="docgraphIndex.set($event)">Index</mat-slide-toggle></header>
                                            <p class="field-help">Index authority is <strong>Boundaries</strong>: a folder is indexed only when read=allow and index=yes. <button type="button" class="link-button" (click)="selectTab('boundaries')">Open Boundaries</button></p>
                                            <p class="knowledge-note">Generated files and provider copies are excluded by default.</p>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable knowledge-source-section" [class.zone-hidden]="knowledgeSection() !== 'sources'" [class.active]="selectedKnowledgeTopic() === 'providers'" (click)="selectKnowledgeTopic('providers')">
                                            <header class="knowledge-section-head"><div><h3>Provider routing</h3><p>One provider per work area. No provider means manage directly in <code>.md</code> files.</p></div><span class="scope-badge muted-badge">optional</span></header>
                                            <div class="provider-routing">
                                                <article class="provider-domain">
                                                    <div class="provider-domain-copy"><strong>Work management</strong><small>Tasks · stories · bugs</small></div>
                                                    <div class="provider-options">
                                                        <button type="button" class="source-pill" [class.active]="providerRouting().work === 'jira'" (click)="setProviderRoute('work', 'jira'); $event.stopPropagation()">Jira</button>
                                                        <button type="button" class="source-pill" [class.active]="providerRouting().work === 'md'" (click)="setProviderRoute('work', 'md'); $event.stopPropagation()">None · .md</button>
                                                    </div>
                                                    <div class="provider-route-state">
                                                        @if (providerRouting().work === 'jira') { <span class="badge" [class.badge-warn]="providerStatus('jira') !== 'configured'">{{ providerStatus('jira') }}</span><button mat-button type="button" (click)="openConsumerPlugins(); $event.stopPropagation()">Configure Jira</button> } @else { <span class="muted">repo files</span> }
                                                    </div>
                                                </article>
                                                <article class="provider-domain">
                                                    <div class="provider-domain-copy"><strong>Design management</strong><small>Design artifacts · specs</small></div>
                                                    <div class="provider-options">
                                                        <button type="button" class="source-pill" [class.active]="providerRouting().design === 'figma'" (click)="setProviderRoute('design', 'figma'); $event.stopPropagation()">Figma</button>
                                                        <button type="button" class="source-pill" [class.active]="providerRouting().design === 'penpot'" (click)="setProviderRoute('design', 'penpot'); $event.stopPropagation()">Penpot</button>
                                                        <button type="button" class="source-pill" [class.active]="providerRouting().design === 'md'" (click)="setProviderRoute('design', 'md'); $event.stopPropagation()">None · .md</button>
                                                    </div>
                                                    <div class="provider-route-state">
                                                        @if (providerRouting().design === 'md') { <span class="muted">repo files</span> } @else { <span class="badge" [class.badge-warn]="providerStatus(providerRouting().design) !== 'configured'">{{ providerStatus(providerRouting().design) }}</span><button mat-button type="button" (click)="openConsumerPlugins(); $event.stopPropagation()">Configure</button> }
                                                    </div>
                                                </article>
                                                <article class="provider-domain">
                                                    <div class="provider-domain-copy"><strong>Content management</strong><small>Knowledge · documents</small></div>
                                                    <div class="provider-options">
                                                        <button type="button" class="source-pill" [class.active]="providerRouting().content === 'notion'" (click)="setProviderRoute('content', 'notion'); $event.stopPropagation()">Notion</button>
                                                        <button type="button" class="source-pill" [class.active]="providerRouting().content === 'confluence'" (click)="setProviderRoute('content', 'confluence'); $event.stopPropagation()">Confluence</button>
                                                        <button type="button" class="source-pill" [class.active]="providerRouting().content === 'md'" (click)="setProviderRoute('content', 'md'); $event.stopPropagation()">None · .md</button>
                                                    </div>
                                                    <div class="provider-route-state">
                                                        @if (providerRouting().content === 'md') { <span class="muted">repo files</span> } @else { <span class="badge" [class.badge-warn]="providerStatus(providerRouting().content) !== 'configured'">{{ providerStatus(providerRouting().content) }}</span><button mat-button type="button" (click)="openConsumerPlugins(); $event.stopPropagation()">Configure</button> }
                                                    </div>
                                                </article>
                                            </div>
                                            <p class="knowledge-note">Provider availability and credentials live in <button mat-button type="button" (click)="openConsumerPlugins(); $event.stopPropagation()">Plugins</button>.</p>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable knowledge-source-section" [class.zone-hidden]="knowledgeSection() !== 'sources'">
                                            <header class="knowledge-section-head"><div><h3>External references</h3><p>Read-only projection from providers. Files remain the source of content.</p></div><button mat-button type="button" (click)="openConsumerPlugins()">Manage providers</button></header>
                                            @if (referenceSummary().length === 0) {
                                                <p class="muted">No provider references yet. Enable a provider and run Sync.</p>
                                            } @else {
                                                <div class="reference-list">
                                                    @for (reference of referenceSummary(); track reference.id) {
                                                        <div class="reference-row"><div><strong>{{ reference.label }}</strong><small>{{ reference.id }}</small></div><span>{{ reference.count }} records</span><span class="muted">{{ reference.lastSyncedAt ? 'last sync ' + reference.lastSyncedAt : 'not synced' }}</span></div>
                                                    }
                                                </div>
                                            }
                                        </section>
                                    </div>

                                    <aside class="knowledge-detail" aria-live="polite" [class.zone-hidden]="knowledgeSection() !== 'contract' && knowledgeSection() !== 'manifest'">
                                        @if (knowledgeDetail(); as detail) {
                                            <p class="eyebrow">{{ detail.eyebrow }}</p>
                                            <h3>{{ detail.title }}</h3>
                                            <p class="knowledge-detail-desc">{{ detail.description }}</p>

                                            <section class="detail-section">
                                                <h4>Trace</h4>
                                                <dl class="trace-list">
                                                    @for (trace of knowledgeTrace(); track trace.label) {
                                                        <div><dt>{{ trace.label }}</dt><dd>{{ trace.value }}</dd></div>
                                                    }
                                                </dl>
                                            </section>

                                            @if (selectedKnowledgeTopic() === 'pipeline') {
                                                <section class="detail-section">
                                                    <h4>Pipeline flow · S1…S14</h4>
                                                    <div class="pipeline-flow">
                                                        @for (group of pipelineGroups(); track group.id) {
                                                            <div class="pipeline-group">
                                                                <div class="pipeline-group-title"><span>{{ group.id }}</span><strong>{{ group.title }}</strong></div>
                                                                <div class="pipeline-stages">
                                                                    @for (stage of group.stages; track stage.id) {
                                                                        <div class="pipeline-stage"><b>{{ stage.id }}</b><span>{{ stage.label }}</span><em>{{ stage.gate }}</em></div>
                                                                    }
                                                                </div>
                                                            </div>
                                                        }
                                                    </div>
                                                    <p class="detail-note">Dashed CR edges reopen S6 / S7 / S8 / S11; gates G1–G13 are document conditions.</p>
                                                </section>

                                                <section class="detail-section">
                                                    <h4>Definition of Ready / Done</h4>
                                                    <div class="definition-grid">
                                                        <div class="definition-card">
                                                            <strong>DoR</strong>
                                                            <small>Allowed to start?</small>
                                                            <ul>
                                                                @for (condition of dorConditions; track condition) { <li>{{ condition }}</li> }
                                                            </ul>
                                                            <em>Fail → Backlog + needs-dor</em>
                                                        </div>
                                                        <div class="definition-card">
                                                            <strong>DoD</strong>
                                                            <small>Done?</small>
                                                            <ul>
                                                                @for (condition of dodConditions; track condition) { <li>{{ condition }}</li> }
                                                            </ul>
                                                            <em>Fail → remains In Progress</em>
                                                        </div>
                                                    </div>
                                                    <p class="detail-note">DoR applies to Story and Task only. Epic is a container; Subtask inherits from parent; Bug must be reproducible. DoR is a gate, not a Jira status.</p>
                                                </section>

                                                <section class="detail-section">
                                                    <h4>Diagrams</h4>
                                                    <div class="diagram-grid">
                                                        <button type="button" class="diagram-card" (click)="openDiagram.set('main')">
                                                            <img src="assets/diagrams/01.main-pipeline.png" alt="Main SDLC pipeline">
                                                            <strong>Main pipeline</strong>
                                                            <small>14 stages · 13 gates</small>
                                                        </button>
                                                        <button type="button" class="diagram-card" (click)="openDiagram.set('cr')">
                                                            <img src="assets/diagrams/02.cr-pipeline.png" alt="CR pipeline">
                                                            <strong>CR pipeline</strong>
                                                            <small>change request flow</small>
                                                        </button>
                                                        <button type="button" class="diagram-card" (click)="openDiagram.set('intent')">
                                                            <img src="assets/diagrams/03.intent-pipeline.png" alt="Intent pipeline">
                                                            <strong>Intent pipeline</strong>
                                                            <small>P → G → BRD/PRD</small>
                                                        </button>
                                                    </div>
                                                </section>
                                            }

                                            @if (selectedKnowledgeTopic() === 'cross-check') {
                                                <section class="detail-section">
                                                    <h4>Catalogue groups</h4>
                                                    <div class="check-groups">
                                                        @for (group of crossCheckGroups(); track group.label) {
                                                            <div><strong>{{ group.label }}</strong><span>{{ group.ids }}</span></div>
                                                        }
                                                    </div>
                                                </section>
                                            }

                                            @if (selectedKnowledgeTopic() === 'quartet') {
                                                <section class="detail-section">
                                                    <h4>Work hierarchy</h4>
                                                    <div class="hierarchy-list">
                                                        @for (row of taskHierarchy(); track row.model) {
                                                            <div><strong>{{ row.model }}</strong><span>{{ row.detail }}</span></div>
                                                        }
                                                    </div>
                                                </section>
                                            }

                                            @if (selectedKnowledgeTopic() === 'knowledge-base') {
                                                <section class="detail-section">
                                                    <h4>WBS artifacts</h4>
                                                    <div class="hierarchy-list">
                                                        <div><strong>WBS</strong><span>deliverable tree · 100% rule</span></div>
                                                        <div><strong>WBS dictionary</strong><span>scope · owner · acceptance per node</span></div>
                                                        <div><strong>Atomic WBS</strong><span>leaf work package; leaf owns AC</span></div>
                                                    </div>
                                                </section>
                                            }

                                            @if (selectedKnowledgeTopic() === 'knowledge-base') {
                                                <section class="detail-section">
                                                    <h4>Artifact model</h4>
                                                    <div class="hierarchy-list">
                                                        @for (row of artifactModelRows(); track row.label) {
                                                            <div><strong>{{ row.label }}</strong><span>{{ row.value }}</span></div>
                                                        }
                                                    </div>
                                                </section>
                                            }

                                            @if (selectedKnowledgeTopic() === 'agent-manifests') {
                                                <section class="detail-section">
                                                    <h4>Manifest contract</h4>
                                                    <div class="hierarchy-list">
                                                        <div><strong>Identity</strong><span>consumer_id · root · manifest_version</span></div>
                                                        <div><strong>Documents</strong><span>path · id · kind · status · owner · representation</span></div>
                                                        <div><strong>Kinds</strong><span>required header keys · required sections · owner</span></div>
                                                        <div><strong>Relations</strong><span>derived_from · source_of_truth · human_sot · blocks · owns_kinds · references</span></div>
                                                        <div><strong>Paths</strong><span>relative locators; path is not identity</span></div>
                                                        <div><strong>Checks</strong><span>links resolve · header shape · derived ⊆ source · no orphan · kind has owner</span></div>
                                                    </div>
                                                </section>
                                                <section class="detail-section">
                                                    <h4>Emitted shape</h4>
                                                    <pre class="manifest-preview">{{ manifestPreview() }}</pre>
                                                </section>
                                                <section class="detail-section">
                                                    <h4>Study reference</h4>
                                                    <div class="manifest-note">
                                                        <strong>Do not copy sample data</strong>
                                                        <span><code>sdlc/01.agent-manifests</code> shows the shape of domain/capability specs in eso-harness. For testeso this section defines the manifest contract; it does not import that inventory.</span>
                                                    </div>
                                                    <p class="detail-note">A manifest lets an AI find the right document and understand its structure without crawling the whole repo.</p>
                                                </section>
                                            }

                                            @if (selectedKnowledgeTopic() !== 'pipeline') {
                                                <dl class="knowledge-detail-list">
                                                    @for (item of detail.items; track item.label) {
                                                        <div><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
                                                    }
                                                </dl>
                                            }
                                        }
                                    </aside>
                                </div>

                                @if (openDiagram(); as diagram) {
                                    <div class="diagram-lightbox" role="dialog" aria-modal="true" (click)="openDiagram.set(null)">
                                        <div class="diagram-lightbox-panel" (click)="$event.stopPropagation()">
                                            <header><strong>{{ diagramTitle() }}</strong><button mat-stroked-button type="button" (click)="openDiagram.set(null)">Close</button></header>
                                            <div class="diagram-lightbox-body"><img [src]="diagramSrc()" [alt]="diagramTitle()"></div>
                                        </div>
                                    </div>
                                }
                            </section>
                        }

                        @case ('boundaries') {
                            <section class="tab-panel" role="tabpanel">
                                <header class="tab-intro">
                                    <p class="eyebrow">Boundaries</p>
                                    <h2>Read, write, and index policy</h2>
                                    <p>Default policy is deny outside the repo root. Gated writes and external reads need an operator grant. Host hooks enforce; ESO publishes policy and records observations.</p>
                                </header>
                                @if (boundaryError(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
                                @if (boundaryNotice(); as notice) { <p class="saved-banner" role="status">{{ notice }}</p> }
                                <div class="boundary-mode">
                                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Enforcement</mat-label>
                                        <mat-select [ngModel]="boundaryEnforcement()" (ngModelChange)="boundaryEnforcement.set($event)">
                                            <mat-option value="audit">audit only — allow + record</mat-option>
                                            <mat-option value="enforce">enforce — host hook denies</mat-option>
                                        </mat-select>
                                    </mat-form-field>
                                </div>
                                <div class="boundary-list">
                                    @for (policy of boundaryPolicies(); track policy.id; let i = $index) {
                                        <article class="boundary-row">
                                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="boundary-path"><mat-label>Path</mat-label><input matInput [ngModel]="policy.path" (ngModelChange)="updateBoundary(i, 'path', $event)"></mat-form-field>
                                            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Type</mat-label>
                                                <mat-select [ngModel]="policy.pathType" (ngModelChange)="updateBoundary(i, 'pathType', $event)">
                                                    <mat-option value="file">file</mat-option><mat-option value="directory">directory</mat-option><mat-option value="glob">glob</mat-option>
                                                </mat-select>
                                            </mat-form-field>
                                            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Read</mat-label>
                                                <mat-select [ngModel]="policy.read" (ngModelChange)="updateBoundary(i, 'read', $event)">
                                                    <mat-option value="allow">allow</mat-option><mat-option value="deny">deny</mat-option>
                                                </mat-select>
                                            </mat-form-field>
                                            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Write</mat-label>
                                                <mat-select [ngModel]="policy.write" (ngModelChange)="updateBoundary(i, 'write', $event)">
                                                    <mat-option value="bypass">bypass</mat-option><mat-option value="gated">gated</mat-option><mat-option value="warn">warn</mat-option><mat-option value="deny">deny</mat-option>
                                                </mat-select>
                                            </mat-form-field>
                                            <mat-checkbox [checked]="policy.index" (change)="updateBoundary(i, 'index', $event.checked)">Index</mat-checkbox>
                                            <button mat-button type="button" color="warn" (click)="removeBoundary(i)" aria-label="Remove policy">Remove</button>
                                        </article>
                                    }
                                </div>
                                <div class="boundary-actions">
                                    <button mat-stroked-button type="button" (click)="addBoundary()">Add policy</button>
                                    <button mat-flat-button color="primary" type="button" [disabled]="boundarySaving()" (click)="saveBoundaries()">{{ boundarySaving() ? 'Saving…' : 'Save boundaries' }}</button>
                                </div>
                                <section class="boundary-grants">
                                    <header><h3>Grants</h3><p>Write grants are single-use and expire. Read grants can be once or always.</p></header>
                                    <div class="grant-create">
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Target prefix</mat-label><input matInput [ngModel]="grantTarget()" (ngModelChange)="grantTarget.set($event)" placeholder="data-lake/**"></mat-form-field>
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Kind</mat-label><mat-select [ngModel]="grantKind()" (ngModelChange)="grantKind.set($event)"><mat-option value="write">write</mat-option><mat-option value="read">read</mat-option></mat-select></mat-form-field>
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Mode</mat-label><mat-select [ngModel]="grantMode()" (ngModelChange)="grantMode.set($event)"><mat-option value="once">once</mat-option><mat-option value="always">always (read only)</mat-option></mat-select></mat-form-field>
                                        <button mat-stroked-button type="button" [disabled]="!grantTarget().trim()" (click)="createBoundaryGrant()">Create grant</button>
                                    </div>
                                    @if (boundaryGrants().length === 0) { <p class="muted">No active grants.</p> } @else {
                                        <div class="grant-list">
                                            @for (grant of boundaryGrants(); track grant.grantId) {
                                                <div class="grant-row"><code>{{ grant.kind }} · {{ grant.targetPrefix }}</code><span>{{ grant.mode }}{{ grant.expiresAt ? ' · expires ' + grant.expiresAt : '' }}</span><button mat-button type="button" color="warn" (click)="revokeBoundaryGrant(grant.grantId)">Revoke</button></div>
                                            }
                                        </div>
                                    }
                                </section>
                            </section>
                        }

                        @case ('observation') {
                            <section class="tab-panel" role="tabpanel">
                                <p class="section-hint">Only enabled events are recorded; no secrets, prompt bodies, or file content. JEV decides on evidence, so its mode and consent live here.</p>
                                <mat-slide-toggle [ngModel]="consent()" (ngModelChange)="consent.set($event)">Enable observation</mat-slide-toggle>
                                <div class="event-grid" [class.event-grid-disabled]="!consent()">
                                    @for (event of eventKinds; track event.id) {
                                        <mat-checkbox [checked]="events().includes(event.id)" [disabled]="!consent()" (change)="toggleEvent(event.id)">
                                            <span class="event-copy"><strong>{{ event.label }}</strong><small>{{ event.description }}</small></span>
                                        </mat-checkbox>
                                    }
                                </div>

                                <header class="observatory-hero">
                                    <div>
                                        <p class="eyebrow">Evidence plane</p>
                                        <h2>Observatory</h2>
                                        <p class="section-hint">Host-reported evidence only. ESO stores, scores and displays; it never executes.</p>
                                    </div>
                                    <button mat-stroked-button type="button" [disabled]="observationsLoading()" (click)="refreshObservations()">{{ observationsLoading() ? 'Refreshing…' : 'Refresh evidence' }}</button>
                                </header>
                                <div class="observatory-kpis">
                                    <div class="observatory-kpi"><span>Observations</span><strong>{{ observations().length }}</strong><small>{{ observationTraceCount() }} traces</small></div>
                                    <div class="observatory-kpi"><span>Hosts</span><strong>{{ observationHostCount() }}</strong><small>{{ observationWorkerCount() }} workers</small></div>
                                    <div class="observatory-kpi"><span>Last evidence</span><strong>{{ lastObservationAt() || '—' }}</strong><small>host-reported</small></div>
                                    <div class="observatory-kpi"><span>Gate</span><strong>unknown ≠ absent</strong><small>cannot-judge blocks</small></div>
                                </div>
                                <div class="observatory-grid">
                                    <div class="observatory-column">
                                <section class="judgment-panel" aria-label="Judgment sufficiency">
                                    <header class="jev-head">
                                        <div>
                                            <h3>Judgment / sufficiency</h3>
                                            <p class="section-hint">Verdict evidence only. Host executes the gate; ESO computes and displays the verdict. unknown is not absent; cannot-judge never allows.</p>
                                        </div>
                                        @if (judgmentResult(); as result) { <span class="tag" [class.tag-muted]="result.decision === 'allow'">{{ result.verdict.level }}</span> }
                                    </header>
                                    <mat-form-field appearance="outline" class="full">
                                        <mat-label>Verdict input JSON</mat-label>
                                        <textarea matInput rows="7" [ngModel]="judgmentInput()" (ngModelChange)="judgmentInput.set($event)"></textarea>
                                    </mat-form-field>
                                    <div class="judgment-actions">
                                        <button mat-flat-button color="primary" type="button" [disabled]="judgmentLoading()" (click)="runJudgment()">{{ judgmentLoading() ? 'Judging…' : 'Run verdict' }}</button>
                                        @if (judgmentResult(); as result) {
                                            <span class="judgment-summary">{{ result.verdict.level }} · basis {{ result.verdict.basis }} · mode {{ result.verdict.mode }} · decision {{ result.decision }}<br>{{ result.gaps.total_gaps || 0 }} gap(s) · wouldBlock {{ result.wouldBlock }}</span>
                                        }
                                    </div>
                                    @if (judgmentError(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
                                </section>

                                <section class="jev-panel" aria-label="JEV integration">
                                    <header class="jev-head">
                                        <div>
                                            <h3>JEV integration</h3>
                                            <p class="section-hint">Decision facade config only. ESO stores the policy; the host owns JEV execution and evidence.</p>
                                        </div>
                                        <span class="tag" [class.tag-muted]="jevMode() === 'off'">{{ jevMode() }}</span>
                                    </header>
                                    <div class="form-grid">
                                        <mat-form-field appearance="outline">
                                            <mat-label>JEV mode</mat-label>
                                            <mat-select [ngModel]="jevMode()" (ngModelChange)="jevMode.set($event)">
                                                <mat-option value="off">Off — no JEV</mat-option>
                                                <mat-option value="shadow">Shadow — evaluate only</mat-option>
                                                <mat-option value="active">Active — decide within band</mat-option>
                                            </mat-select>
                                        </mat-form-field>
                                        <mat-form-field appearance="outline">
                                            <mat-label>Auto threshold (0–1)</mat-label>
                                            <input matInput type="number" min="0" max="1" step="0.01" [ngModel]="jevAutoThreshold()" (ngModelChange)="jevAutoThreshold.set($event)" [disabled]="jevMode() === 'off'">
                                        </mat-form-field>
                                        <mat-form-field appearance="outline">
                                            <mat-label>Confirm threshold (0–1)</mat-label>
                                            <input matInput type="number" min="0" max="1" step="0.01" [ngModel]="jevConfirmThreshold()" (ngModelChange)="jevConfirmThreshold.set($event)" [disabled]="jevMode() === 'off'">
                                        </mat-form-field>
                                    </div>
                                    @if (jevMode() !== 'off' && !consent()) {
                                        <p class="form-error" role="alert">JEV shadow/active requires observation consent (Observatory tab).</p>
                                    } @else {
                                        <p class="section-hint">Threshold rule: auto ≥ confirm. Empty thresholds leave the host default.</p>
                                    }
                                    <div class="jev-evaluate">
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Confidence (0–1)</mat-label><input matInput type="number" min="0" max="1" step="0.01" [ngModel]="jevConfidence()" (ngModelChange)="jevConfidence.set($event)"></mat-form-field>
                                        <button mat-stroked-button type="button" [disabled]="jevDecisionLoading()" (click)="evaluateJev()">{{ jevDecisionLoading() ? 'Evaluating…' : 'Evaluate decision' }}</button>
                                        @if (jevDecision(); as decision) {
                                            <span class="judgment-summary">{{ decision.mode }} · {{ decision.band || '—' }} → {{ decision.decision }}<br>{{ decision.reason }}</span>
                                        }
                                    </div>
                                    @if (jevDecisionError(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
                                </section>

                                    </div>
                                <section class="observation-timeline" aria-label="Observation timeline">
                                    <header class="observation-head">
                                        <div>
                                            <p class="eyebrow">Observations</p>
                                            <h3>Observation timeline</h3>
                                            <p class="section-hint">Host-reported observations. ESO stores and displays them only.</p>
                                        </div>
                                        <button mat-stroked-button type="button" [disabled]="observationsLoading()" (click)="refreshObservations()">{{ observationsLoading() ? 'Refreshing…' : 'Refresh' }}</button>
                                    </header>
                                    @if (observationsError(); as message) { <p class="field-error" role="alert">{{ message }}</p> }
                                    @if (observationsLoading() && observations().length === 0) {
                                        <p class="loading-label" role="status">Loading observations…</p>
                                    } @else if (observations().length === 0) {
                                        <div class="observation-empty">
                                            <strong>No observations yet</strong>
                                            <span>Hosts post observations when an enabled event fires. Nothing is editable here.</span>
                                        </div>
                                    } @else {
                                        <ol class="observation-list" role="list">
                                            @for (observation of observations(); track observation.observationId) {
                                                <li class="observation-row">
                                                    <div class="observation-row-head">
                                                        <span class="observation-event"><code>{{ observation.event }}</code></span>
                                                        @if (observation.outcome) { <span class="badge">{{ observation.outcome }}</span> }
                                                        <time class="observation-time" [attr.datetime]="observation.at">{{ observation.at }}</time>
                                                    </div>
                                                    <div class="observation-meta">
                                                        <span><small>Worker</small>{{ observation.workerId || '—' }}</span>
                                                        <span><small>Runtime</small>{{ observation.runtimeKey || '—' }}</span>
                                                        <span><small>Host</small>{{ observation.hostId }}</span>
                                                        <span><small>Trace</small><code>{{ observation.traceId }}</code></span>
                                                        <span><small>Received</small>{{ observation.receivedAt }}</span>
                                                    </div>
                                                    <details class="observation-evidence">
                                                        <summary>Evidence</summary>
                                                        <pre>{{ evidenceText(observation.evidence) }}</pre>
                                                    </details>
                                                </li>
                                            }
                                        </ol>
                                    }
                                </section>
                                </div>
                            </section>
                        }
                    }
                </div>

                <footer class="settings-actions">
                    <button mat-stroked-button type="button" (click)="back()">Back</button>
                    <div class="settings-footer-right">
                        <span class="dirty-state" role="status" aria-live="polite" [class.dirty-state-on]="dirty() || workerImportDirty()">
                            {{ dirty() || workerImportDirty() ? 'Unsaved changes' : 'All changes saved' }}
                        </span>
                        <button mat-stroked-button type="button" [disabled]="saving() || (!dirty() && !workerImportDirty()) || (activeTab() === 'workers' && workerValidationErrors().length > 0)" (click)="save()">Save changes</button>
                        @if (activeTab() === lastTab) {
                            <button mat-flat-button color="primary" type="button" [disabled]="saving()" (click)="finish()">{{ saving() ? 'Saving…' : 'Finish' }}</button>
                        } @else {
                            <button mat-stroked-button type="button" (click)="nextTab()">Next →</button>
                        }
                    </div>
                </footer>
            }
        </div>
    `,
    styles: [`
        .settings-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); width: 100%; max-width: var(--content-max); min-width: 0; margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; min-width: 0; margin: 0; }
        .page-header h1 { margin: 0; font-size: var(--text-2xl); line-height: 1.15; letter-spacing: -.02em; }
        .settings-consumer-picker { width: 210px; }
        .settings-consumer-picker ::ng-deep .mat-mdc-text-field-wrapper { background: var(--surface); border-radius: 6px; }
        .settings-consumer-picker ::ng-deep .mdc-notched-outline__leading, .settings-consumer-picker ::ng-deep .mdc-notched-outline__notch, .settings-consumer-picker ::ng-deep .mdc-notched-outline__trailing { border-color: var(--line); }
        .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: var(--text-xs); margin: 0 0 var(--space-1); }
        .subtitle { max-width: 760px; margin: var(--space-2) 0 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.6; }
        .settings-tabs { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); min-width: 0; gap: 2px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow-x: auto; scrollbar-width: thin; }
        .settings-tab { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-2) var(--space-3); border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
        .settings-tab-copy { display: grid; gap: 2px; min-width: 0; }
        .settings-tab-copy strong { overflow: hidden; color: var(--ink); font-size: var(--text-sm); font-weight: 650; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
        .settings-tab-copy small { overflow: hidden; color: var(--muted); font-size: 10px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
        .settings-tab.active .settings-tab-copy strong, .settings-tab.active .settings-tab-copy small { color: var(--brand-ink); }
        .settings-tab:last-child { border-right: 0; }
        .settings-tab.active { background: var(--brand); color: var(--brand-ink); }
        .settings-tab:hover:not(.active) { background: color-mix(in srgb, var(--surface) 88%, var(--brand)); color: var(--ink); }
        .settings-tab:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
        .settings-step-no { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid currentColor; font-size: var(--text-xs); font-weight: 700; flex: none; }
        .settings-tab-content { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .tab-panel { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: var(--space-4); padding: var(--space-5); }
        .migration-panel { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--brand); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 94%, var(--brand)); }
        .migration-copy { display: grid; gap: var(--space-2); }
        .migration-copy h2 { margin: 0; font-size: var(--text-md); }
        .migration-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
        .migration-metrics div { display: grid; gap: 2px; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
        .migration-metrics span { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .migration-metrics strong { font-size: var(--text-sm); }
        .migration-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; justify-content: flex-end; }
        .plan-hash { color: var(--muted); font-size: var(--text-xs); }
        .migration-conflict-note { margin: 0; color: var(--warning, #f5a524); font-size: var(--text-sm); }
        .conflict-list { display: grid; gap: var(--space-2); }
        .conflict-row { display: flex; gap: var(--space-3); align-items: center; justify-content: space-between; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .conflict-copy { display: grid; gap: 2px; min-width: 0; }
        .conflict-copy code { overflow-wrap: anywhere; }
        .conflict-copy span, .conflict-copy small { color: var(--muted); font-size: var(--text-xs); }
        .conflict-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        @media (max-width: 700px) { .conflict-row { flex-direction: column; align-items: stretch; } }
        .boundary-mode { margin-bottom: var(--space-3); }
        .link-button { border: 0; background: transparent; color: var(--brand); font: inherit; cursor: pointer; padding: 0; text-decoration: underline; }
        .boundary-list { display: grid; gap: var(--space-2); }
        .boundary-row { display: grid; grid-template-columns: minmax(220px, 2fr) 120px 110px 110px auto auto; gap: var(--space-2); align-items: center; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .boundary-path { min-width: 0; }
        .boundary-actions { display: flex; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-3); }
        .boundary-grants { margin-top: var(--space-5); padding-top: var(--space-4); border-top: 1px solid var(--line); display: grid; gap: var(--space-3); }
        .boundary-grants h3 { margin: 0; }
        .boundary-grants p { margin: 0; color: var(--muted); font-size: var(--text-sm); }
        .grant-create { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
        .grant-list { display: grid; gap: 2px; }
        .grant-row { display: flex; gap: var(--space-3); align-items: center; justify-content: space-between; padding: var(--space-2); border-bottom: 1px solid var(--line); }
        .grant-row span { color: var(--muted); font-size: var(--text-xs); }
        .legacy-panel { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--warn-ink); border-radius: var(--radius-md); background: var(--warn-bg); }
        .legacy-copy { display: grid; gap: var(--space-2); }
        .legacy-copy h2 { margin: 0; font-size: var(--text-md); }
        .legacy-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; justify-content: flex-end; }
        .legacy-list { display: grid; gap: 2px; margin: 0; padding-left: var(--space-4); }
        .legacy-list li { display: flex; gap: var(--space-2); justify-content: space-between; font-size: var(--text-sm); }
        .legacy-list li span { color: var(--muted); font-size: var(--text-xs); }
        .legacy-target { margin: 0; font-size: var(--text-sm); }
        .migration-preview { display: grid; gap: 2px; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); font-size: var(--text-sm); }
        .migration-preview span { color: var(--muted); font-size: var(--text-xs); }
        .judgment-panel { display: grid; gap: var(--space-3); margin-bottom: var(--space-5); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .judgment-actions { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
        .judgment-summary { color: var(--muted); font-size: var(--text-sm); line-height: 1.5; }
        .jev-evaluate { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-top: var(--space-3); }
        .jev-panel { margin-top: var(--space-5); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); }
        .jev-head { display: flex; justify-content: space-between; gap: var(--space-3); align-items: flex-start; margin-bottom: var(--space-3); }
        .jev-head h3 { margin: 0 0 var(--space-1); }
        .section-hint { color: var(--muted); margin: 0; }
        .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
        .form-grid mat-form-field { width: 100%; }
        .full-width { width: 100%; }
        .stack-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
        .stack-summary > div { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-3); display: grid; gap: var(--space-1); }
        .stack-summary span { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .layer-groups { display: grid; gap: var(--space-4); }
        .layer-group { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; }
        .group-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-4); padding: var(--space-4); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 92%, var(--brand)); }
        .group-head h2 { margin: 0 0 var(--space-1); font-size: var(--text-md); text-transform: uppercase; letter-spacing: .04em; }
        .group-head p { margin: 0; color: var(--muted); font-size: var(--text-sm); }
        .group-count { flex: none; color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .layer-columns { display: grid; grid-template-columns: minmax(240px, 1.4fr) minmax(160px, .8fr) minmax(200px, 1fr) minmax(110px, auto); gap: var(--space-4); padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 96%, var(--brand)); color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .layer-list { display: grid; }
        .layer-row { display: grid; grid-template-columns: minmax(240px, 1.4fr) minmax(160px, .8fr) minmax(200px, 1fr) minmax(110px, auto); gap: var(--space-4); align-items: center; height: 100px; min-height: 100px; padding: 0 var(--space-4); border-bottom: 1px solid var(--line); }
        .layer-row:last-child { border-bottom: 0; }
        .layer-row:hover { background: color-mix(in srgb, var(--surface) 94%, var(--brand)); }
        .layer-disabled { opacity: .55; }
        .layer-ident { display: flex; align-items: center; gap: var(--space-3); min-width: 0; height: 100%; }
        .layer-ident > div { display: grid; gap: 2px; min-width: 0; }
        .layer-ident small { color: var(--muted); font-size: var(--text-sm); }
        .layer-no { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--brand); color: var(--brand-ink); font-weight: 700; flex: none; }
        .layer-cell { display: grid; align-content: center; gap: 2px; font-size: var(--text-sm); min-width: 0; height: 100%; }
        .cell-label { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .layer-config { align-items: start; }
        .layer-field { width: 100%; }
        .inline-config { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
        .market-picker { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); align-items: center; width: 100%; }
        .mcp-source { color: var(--muted); font-size: var(--text-xs); }
        .mcp-empty { margin: 0; color: var(--muted); font-size: var(--text-sm); }
        .layer-state { display: flex; justify-content: flex-end; align-items: center; height: 100%; }
        .badge { display: inline-flex; align-items: center; padding: 2px var(--space-2); border: 1px solid var(--line); border-radius: 999px; font-size: var(--text-xs); background: color-mix(in srgb, var(--surface) 90%, var(--brand)); }
        .badge-muted, .badge-warn { color: var(--muted); }
        .muted { color: var(--muted); font-size: var(--text-sm); }
        .detected-banner { border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-4); display: grid; gap: var(--space-2); background: color-mix(in srgb, var(--surface) 92%, var(--brand)); }
        .detected-list { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .form-actions { display: flex; justify-content: flex-end; }
        .host-card dl { margin: 0; display: grid; gap: var(--space-2); }
        .host-card dl div { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: var(--space-2); }
        .host-card dt { color: var(--muted); }
        .host-card dd { margin: 0; }
        .host-actions { display: flex; justify-content: flex-end; }
        .empty-state { border: 1px dashed var(--line); border-radius: var(--radius-md); padding: var(--space-5); text-align: center; }
        .empty-state h3 { margin: 0 0 var(--space-1); }
        .plugin-table-wrap { overflow-x: auto; }
        .plugin-table { width: 100%; border-collapse: collapse; }
        .plugin-table th { text-align: left; color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; padding: var(--space-2); border-bottom: 1px solid var(--line); }
        .plugin-table td { padding: var(--space-3) var(--space-2); border-bottom: 1px solid var(--line); vertical-align: top; }
        .cap-list { color: var(--muted); font-size: var(--text-sm); }
        .toggle-row { display: flex; flex-wrap: wrap; gap: var(--space-4) var(--space-5); align-items: center; }
        .event-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
        .event-grid-disabled { opacity: .55; }
        .event-copy { display: grid; gap: 2px; white-space: normal; }
        .event-copy small { color: var(--muted); }
        .observatory-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
        .observatory-hero h2 { margin: 0; font-size: var(--text-xl); }
        .observatory-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
        .observatory-kpi { display: grid; gap: 2px; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .observatory-kpi span { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
        .observatory-kpi strong { font-size: var(--text-lg); line-height: 1.2; }
        .observatory-kpi small { color: var(--muted); font-size: var(--text-xs); }
        .observatory-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .85fr); gap: var(--space-4); align-items: start; }
        .observatory-column { display: grid; gap: var(--space-4); }
        @media (max-width: 1100px) { .observatory-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .observatory-grid { grid-template-columns: 1fr; } }
        .settings-actions { position: sticky; bottom: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); min-width: 0; padding: var(--space-3) var(--space-4); margin: 0; border: 1px solid var(--line); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 94%, #000); backdrop-filter: blur(8px); }
        .dirty-state { font-size: var(--text-xs); color: var(--muted); }
        .dirty-state-on { color: var(--warn-ink); font-weight: 600; }
        .settings-footer-right { display: flex; gap: var(--space-3); align-items: center; }
        .saved-banner { border-left: 4px solid var(--brand); background: color-mix(in srgb, var(--surface) 88%, var(--brand)); padding: var(--space-3); border-radius: var(--radius-sm); margin: 0; }
        .loading-label { color: var(--muted); margin: 0; }
        .settings-loading { border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-5); background: var(--surface); }
        @media (max-width: 1100px) { .settings-tabs { grid-auto-columns: minmax(180px, 1fr); } .host-grid { grid-template-columns: 1fr; } .layer-row { grid-template-columns: minmax(200px, 1fr) minmax(120px, .6fr) minmax(180px, 1fr) auto; gap: var(--space-3); height: auto; min-height: 100px; } .layer-columns { display: none; } }
        @media (max-width: 700px) { .boundary-row { grid-template-columns: 1fr; } .migration-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .settings-tabs { grid-auto-columns: minmax(170px, 1fr); width: 100%; } .settings-tabs .settings-tab { min-width: 0; overflow: hidden; } .form-grid, .event-grid, .stack-summary { grid-template-columns: 1fr; } .page-header { flex-direction: column; align-items: stretch; } .tab-panel { padding: var(--space-4); } .layer-row { grid-template-columns: 1fr; align-items: start; } .layer-state { justify-content: flex-start; } .group-head { flex-direction: column; } .settings-actions { position: static; flex-wrap: wrap; } }
    `],
})
export class ConsumerSettingsPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);
    readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);

    readonly loading = signal(true);
    readonly saving = signal(false);
    readonly saved = signal(false);
    readonly currentDraft = signal('');
    readonly lastSaved = signal<string | null>(null);
    readonly baselineReady = signal(false);
    readonly dirty = computed(() => this.baselineReady() && this.lastSaved() !== null && this.currentDraft() !== this.lastSaved());
    readonly error = signal<string | null>(null);
    private readonly current = signal<ConsumerProfile | null>(null);
    readonly activeTab = signal('profile');
    readonly lastTab = 'observation';
    readonly tabs = [
        { id: 'profile', n: 1, label: 'Profile', hint: 'Identity & metadata' },
        { id: 'stack', n: 2, label: 'Stack', hint: 'Policy & versions' },
        { id: 'hosts', n: 3, label: 'Host Bindings', hint: 'Developer × host runtime' },
        { id: 'workers', n: 4, label: 'Agent Workers', hint: 'Agent identities & roles' },
        { id: 'knowledge', n: 5, label: 'Knowledge', hint: 'Knowledge & Artifact Governance' },
        { id: 'boundaries', n: 6, label: 'Boundaries', hint: 'Read / write / index policy' },
        { id: 'observation', n: 7, label: 'Observatory', hint: 'Evidence & JEV' },
    ];

    readonly consumerId = this.route.snapshot.paramMap.get('id') || 'unknown';
    readonly consumers = signal<{ id: string; name?: string }[]>([]);
    private readonly hydrated = signal(false);
    private readonly draftEffect = effect(() => {
        if (!this.hydrated()) return;
        const draft = {
            name: this.name(),
            owner: this.owner(),
            locale: this.locale(),
            tags: this.tags(),
            description: this.description(),
            stackLayers: this.stackLayers(),
            stackVersions: this.stackVersions(),
            activeStackVersion: this.activeStackVersion(),
            newStackVersion: this.newStackVersion(),
            hostProfiles: this.hostProfiles(),
            developers: this.developers(),
            formationHostIds: this.formationHostIds(),
            jiraEnabled: this.jiraEnabled(),
            jiraProject: this.jiraProject(),
            jiraSyncMode: this.jiraSyncMode(),
            sdlcEnabled: this.sdlcEnabled(),
            sdlcPipeline: this.sdlcPipeline(),
            crProcess: this.crProcess(),
            artifactKinds: this.artifactKinds(),
            representations: this.representations(),
            docgraphIndex: this.docgraphIndex(),
            docgraphScope: this.docgraphScope(),
            documentStatusRequired: this.documentStatusRequired(),
            preflightRequired: this.preflightRequired(),
            goNoGoRequired: this.goNoGoRequired(),
            crossCheckRequired: this.crossCheckRequired(),
            pipelineContractRequired: this.pipelineContractRequired(),
            openRegisterRequired: this.openRegisterRequired(),
            buildEnforcementRequired: this.buildEnforcementRequired(),
            quartetProfile: this.quartetProfile(),
            manifestEnabled: this.manifestEnabled(),
            manifestPath: this.manifestPath(),
            manifestHumanHeaderKeys: this.manifestHumanHeaderKeys(),
            manifestAiHeaderKeys: this.manifestAiHeaderKeys(),
            manifestFacets: this.manifestFacets(),
            manifestRelations: this.manifestRelations(),
            manifestChecks: this.manifestChecks(),
            consent: this.consent(),
            events: this.events(),
        };
        try {
            localStorage.setItem(`eso.consumer-settings.${this.consumerId}`, JSON.stringify(draft));
        } catch {
            // Storage may be unavailable; the in-memory draft still works.
        }
        this.currentDraft.set(JSON.stringify(draft));
    });

    readonly name = signal('');
    readonly owner = signal('');
    readonly locale = signal('vi-VN');
    readonly tags = signal('');
    readonly description = signal('');
    readonly jevMode = signal<'off' | 'shadow' | 'active'>('off');
    readonly jevConfidence = signal('0.9');
    readonly jevDecision = signal<JevDecisionDto | null>(null);
    readonly jevDecisionLoading = signal(false);
    readonly jevDecisionError = signal('');
    readonly judgmentInput = signal(JSON.stringify({ requirements: [], answers: [], enforcement: 'shadow' }, null, 2));
    readonly judgmentResult = signal<JudgmentResponseDto | null>(null);
    readonly judgmentLoading = signal(false);
    readonly judgmentError = signal('');
    readonly legacyHarness = signal<LegacyHarnessReportDto | null>(null);
    readonly legacyLoading = signal(false);
    readonly legacyArchiving = signal(false);
    readonly legacyArchiveConfirm = signal(false);
    readonly legacyNotice = signal('');
    readonly legacyError = signal('');
    readonly migrationPreview = signal<HarnessMigrationPreviewDto | null>(null);
    readonly migrationLoading = signal(false);
    readonly migrationApplying = signal(false);
    readonly migrationNotice = signal('');
    readonly migrationError = signal('');
    readonly boundaryPolicies = signal<FolderPolicyDto[]>([]);
    readonly boundaryGrants = signal<BoundaryViewDto['grants']>([]);
    readonly boundarySaving = signal(false);
    readonly boundaryEnforcement = signal<'audit' | 'enforce'>('audit');
    readonly boundaryNotice = signal('');
    readonly boundaryError = signal('');
    readonly grantTarget = signal('');
    readonly grantKind = signal<'read' | 'write'>('write');
    readonly grantMode = signal<'once' | 'always'>('once');
    readonly migrationActionable = computed(() => {
        const preview = this.migrationPreview();
        return Boolean(preview && preview.entries.some((entry) => entry.status === 'new' || entry.status === 'conflict'));
    });
    readonly migrationNewCount = computed(() => (this.migrationPreview()?.entries || []).filter((entry) => entry.status === 'new').length);
    readonly migrationConflictCount = computed(() => (this.migrationPreview()?.entries || []).filter((entry) => entry.status === 'conflict').length);
    readonly migrationConflicts = computed(() => (this.migrationPreview()?.entries || []).filter((entry) => entry.status === 'conflict'));
    readonly finishPrompt = signal(false);
    readonly finishing = signal(false);
    readonly jevAutoThreshold = signal('');
    readonly jevConfirmThreshold = signal('');
    readonly stackLayers = signal<StackLayer[]>(defaultStackLayers());
    readonly stackVersions = signal<StackVersion[]>([{ version: 1, status: 'published', layers: defaultStackLayers() }]);
    readonly activeStackVersion = signal(1);
    readonly newStackVersion = signal(1);
    readonly flowSummaries = signal<FlowSummaryDto[]>([]);
    readonly newFlowId = signal('');
    readonly newFlowVersion = signal(1);
    readonly remoteStackVersions = signal<StackVersion[]>([]);
    readonly hostProfiles = signal<HostProfile[]>([]);
    readonly plugins = signal<PluginEntry[]>(defaultPlugins());
    readonly mcpProviders = signal<McpProviderDto[]>([]);
    readonly mcpSources = signal<string[]>([]);
    readonly mcpWarnings = signal<string[]>([]);
    readonly detectedHosts = signal<Array<{ hostId: string; label: string; markers: string[] }>>([]);
    readonly developers = signal<string[]>([]);
    readonly workers = signal<WorkerEntry[]>(defaultWorkers());
    readonly selectedWorkerId = signal('');
    readonly selectedWorker = computed(() =>
        this.workers().find((worker) => worker.id === this.selectedWorkerId()) || this.workers()[0] || null
    );
    readonly hostRuntimes = signal<HostRuntimeDto[]>([]);
    readonly hosts = signal<HostDto[]>([]);
    readonly workerPlacements = signal<Record<string, WorkerPlacementDto>>({});
    readonly placementDrafts = signal<Record<string, WorkerPlacementDto>>({});
    readonly placementSaving = signal(false);
    readonly placementNotice = signal('');
    readonly placementError = signal('');

    readonly workerValidationErrors = computed(() => {
        const errors: string[] = [];
        for (const worker of this.workers()) {
            for (const scope of this.workerScopeList(worker)) {
                if (!this.scopeIsValid(scope)) errors.push(`${worker.name}: invalid scope "${scope}"`);
            }
            for (const capability of worker.capabilities) {
                if (!/^[a-z][a-z0-9-]{0,31}$/.test(capability)) errors.push(`${worker.name}: invalid capability "${capability}"`);
            }
            for (const requirement of worker.bar) {
                if (!this.requirementIsValid(requirement)) errors.push(`${worker.name}: invalid evidence requirement "${this.evidenceLabel(requirement)}"`);
            }
        }
        return errors;
    });
    readonly workerEdges = signal<WorkerEdge[]>([]);
    readonly defaultFlow = signal<FlowDefinitionDto | null>(null);
    readonly policyWorker = signal<WorkerEntry | null>(null);
    readonly policyVerb = signal('read');
    readonly policyPath = signal('');
    readonly policyEvidenceKind = signal<'test' | 'verify' | 'audit' | 'audit-critical' | 'scenario'>('test');
    readonly policyEvidenceValue = signal('');
    readonly policyResult = signal<any | null>(null);
    readonly policyChecking = signal(false);
    readonly workerImporting = signal(false);
    readonly workerImportPreview = signal<any | null>(null);
    readonly importSelectedHashes = signal<string[]>([]);
    readonly importActions = signal<Record<string, 'import' | 'replace' | 'copy' | 'skip'>>({});
    readonly workerImportDirty = signal(false);
    readonly workerImports = signal<any[]>([]);
    readonly ruleFiles = signal<any[]>([]);
    readonly workerSourceStatus = signal<any>({ source: 0, projections: 0, drift: [] });
    readonly workerSyncing = signal(false);
    readonly materialCounts = signal<{ skills: number; hooks: number; subagents: number; rules: number }>({ skills: 0, hooks: 0, subagents: 0, rules: 0 });
    readonly ruleImporting = signal(false);
    readonly ruleImportPreview = signal<any | null>(null);
    readonly ruleSelectedHashes = signal<string[]>([]);
    readonly ruleImportActions = signal<Record<string, 'skip' | 'replace' | 'copy'>>({});
    readonly newCapability = signal('');
    readonly newEvidenceKind = signal<'test' | 'verify' | 'audit' | 'audit-critical' | 'scenario'>('test');
    readonly newEvidenceValue = signal('85');
    readonly newScope = signal('');
    readonly scopeInputError = signal('');
    readonly capabilityInputError = signal('');
    readonly evidenceInputError = signal('');
    readonly formationHostIds = signal<string[]>([]);
    readonly workerDraft = signal<WorkerDraft>({ name: '', role: 'dev', layer: 'peer', scope: '', capabilities: '', verbs: 'read,append', bar: '', escalation: 'allow' });
    readonly workerRoles = ['scout', 'plan', 'build', 'fixbug', 'verify', 'audit', 'qc', 'lead', 'ba', 'dev', 'fe', 'be', 'qa', 'pm', 'review'];
    readonly workerStatuses: Array<'declared' | 'active' | 'paused' | 'retired'> = ['declared', 'active', 'paused', 'retired'];
    readonly newDeveloperId = signal('');
    readonly bindingDeveloper = signal('');
    readonly addingHostFor = signal<string | null>(null);
    readonly removingDeveloper = signal<string | null>(null);
    readonly expandedProfile = signal<string | null>(null);
    readonly editingProfile = signal<string | null>(null);
    readonly bulkUpgradeOpen = signal(false);
    readonly bulkUpgradeTarget = signal<number | null>(null);
    readonly deleteVersionConfirm = signal(false);
    readonly newHostId = signal('cursor');
    readonly newMemorySource = signal('eso-native');
    readonly newMemoryProvider = signal('');
    readonly newCodeGraphSource = signal('eso-native');
    readonly newCodeGraphProvider = signal('');
    readonly jiraEnabled = signal(false);
    readonly providerRouting = signal<Record<'work' | 'design' | 'content', string>>({ work: 'md', design: 'md', content: 'md' });
    readonly consumerPlugins = signal<any[]>([]);
    readonly knowledgeProviderRecords = signal<any[]>([]);
    readonly jiraProject = signal('');
    readonly jiraSyncMode = signal('off');
    readonly sdlcEnabled = signal(false);
    readonly sdlcPipeline = signal('full');
    readonly crProcess = signal(false);
    readonly artifactKinds = signal<string[]>(['BRD', 'PRD', 'ADR']);
    readonly representations = signal<string[]>(['human', 'agent', 'machine']);
    readonly docgraphIndex = signal(true);
    readonly docgraphScope = signal('docs/**, sdlc/**, agents/**');
    readonly documentStatusRequired = signal(true);
    readonly preflightRequired = signal(true);
    readonly goNoGoRequired = signal(true);
    readonly crossCheckRequired = signal(true);
    readonly pipelineContractRequired = signal(true);
    readonly openRegisterRequired = signal(true);
    readonly buildEnforcementRequired = signal(true);
    readonly quartetProfile = signal<'standard' | 'extended'>('standard');
    readonly knowledgeSummary = signal<KnowledgeSummaryDto | null>(null);
    readonly knowledgeDocs = signal<KnowledgeDocDto[]>([]);
    readonly knowledgeFindings = signal<KnowledgeFindingDto[]>([]);
    readonly knowledgeDocDetail = signal<KnowledgeDocDetailDto | null>(null);
    readonly knowledgeCheck = signal<KnowledgeCheckDto | null>(null);
    readonly knowledgeRetrieval = signal<KnowledgeRetrievalDto | null>(null);
    readonly knowledgeEmbeddingStatus = signal<KnowledgeEmbeddingStatusDto | null>(null);
    readonly knowledgeEmbedding = signal(false);
    readonly knowledgeChecking = signal(false);
    readonly knowledgeQuery = signal('');
    readonly knowledgeIndexing = signal(false);
    readonly manifestEnabled = signal(true);
    readonly manifestPath = signal('.harness/manifest.json');
    readonly manifestHumanHeaderKeys = signal<string[]>(['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'source_of_truth', 'phase']);
    readonly manifestAiHeaderKeys = signal<string[]>(['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'human_sot', 'refs']);
    readonly manifestFacets = signal<string[]>(['kind', 'origin', 'custodian', 'liveness', 'kt-state', 'owner', 'representation']);
    readonly manifestRelations = signal<string[]>(['derived_from', 'source_of_truth', 'human_sot', 'blocks', 'owns_kinds', 'references']);
    readonly manifestChecks = signal<string[]>(['links resolve', 'header shape', 'derived ⊆ source', 'no orphan document', 'kind has owner']);
    readonly selectedKnowledgeTopic = signal('pipeline');
    readonly knowledgeSection = signal<'overview' | 'sources' | 'contract' | 'index' | 'manifest'>('overview');
    readonly openDiagram = signal<'main' | 'cr' | 'intent' | 'workers' | null>(null);
    readonly consent = signal(true);
    readonly events = signal<string[]>(['prompt.submitted', 'turn.completed', 'tool.called']);
    readonly observations = signal<ObservationDto[]>([]);
    readonly observationTraceCount = computed(() => new Set(this.observations().map((item) => item.traceId).filter(Boolean)).size);
    readonly observationHostCount = computed(() => new Set(this.observations().map((item) => item.hostId).filter(Boolean)).size);
    readonly observationWorkerCount = computed(() => new Set(this.observations().map((item) => item.workerId).filter(Boolean)).size);
    readonly lastObservationAt = computed(() => this.observations().map((item) => item.at).filter(Boolean).sort().at(-1)?.slice(0, 19).replace('T', ' ') || '');
    readonly observationsLoading = signal(false);
    readonly observationsError = signal<string | null>(null);
    private observationsLoaded = false;
    readonly sourceOptions = ['eso-native', 'host-native', 'market', 'none'];
    readonly policySources = ['host-native', 'eso-native', 'market'];
    readonly jiraModes = ['off', 'push', 'two-way'];
    readonly artifactKindOptions = ['BRD', 'PRD', 'FRD', 'SRS', 'ADR', 'Spec', 'Runbook', 'Manifest', 'WBS', 'WBS dictionary', 'Atomic WBS', 'Decision', 'Open register'];
    readonly representationOptions = ['human', 'agent', 'machine'];
    readonly manifestFacetOptions = ['kind', 'origin', 'custodian', 'liveness', 'kt-state', 'owner', 'representation'];
    readonly manifestRelationOptions = ['derived_from', 'source_of_truth', 'human_sot', 'blocks', 'owns_kinds', 'references'];
    readonly manifestHumanHeaderOptions = ['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'source_of_truth', 'phase'];
    readonly manifestAiHeaderOptions = ['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'human_sot', 'refs'];
    readonly manifestCheckOptions = ['links resolve', 'header shape', 'derived ⊆ source', 'no orphan document', 'kind has owner'];
    readonly dorConditions = [
        '4 relations declared: subtasks · relates · blocks · blockedBy',
        'Packet §9 = READY',
        'Work package has all 7 fields',
        'AC cited from the source of truth',
        'One verify line: how QC proves the AC',
        'Named dependencies',
    ];
    readonly dodConditions = [
        'SCN run and evidence recorded',
        'DoD evidence complete',
        'Human signs Done',
        'Agent is forbidden to sign Done',
    ];
    readonly pipelineOptions = [
        { id: 'full', label: 'Full pipeline' },
        { id: 'ba-dev', label: 'BA → DEV' },
        { id: 'dev-qc', label: 'DEV → QC' },
        { id: 'qc', label: 'QC only' },
    ];
    readonly eventKinds = [
        { id: 'prompt.submitted', label: 'Prompt request', description: 'Request sent by the user to the host.' },
        { id: 'turn.completed', label: 'Turn result', description: 'Turn result and status.' },
        { id: 'tool.called', label: 'Tool call', description: 'Tool/MCP call and result.' },
        { id: 'file.changed', label: 'File change', description: 'File changed during the turn.' },
    ];

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('id')!;
        const requestedTab = this.route.snapshot.queryParamMap.get('tab');
        if (requestedTab === 'plugins') {
            void this.router.navigate(['/consumers', id, 'plugins'], { replaceUrl: true });
            return;
        }
        const tab = requestedTab === 'jira' ? 'knowledge' : requestedTab;
        if (tab && this.tabs.some((item) => item.id === tab)) this.activeTab.set(tab);
        this.route.queryParamMap.subscribe((params) => {
            const next = params.get('tab');
            if (next && this.tabs.some((item) => item.id === next)) this.activeTab.set(next);
        });
        const requestedSection = this.route.snapshot.queryParamMap.get('section');
        if (tab === 'knowledge' && ['overview', 'sources', 'contract', 'index', 'manifest'].includes(requestedSection || '')) {
            this.knowledgeSection.set(requestedSection as 'overview' | 'sources' | 'contract' | 'index' | 'manifest');
        }
        this.service.list().then((result) => this.consumers.set((result.items ?? []).map((item) => ({ id: item.id, name: item.name })))).catch(() => this.consumers.set([]));
        Promise.all([
            this.service.get(id),
            this.service.getMcp(id).catch(() => ({ consumerId: id, root: '', sources: [], providers: [], warnings: [] })),
            this.service.getDetectedHosts(id).catch(() => ({ consumerId: id, root: '', detected: [] })),
            this.service.getStackVersions(id).catch(() => ({ consumerId: id, versions: [] })),
            this.service.getHostRuntimes().catch(() => [] as HostRuntimeDto[]),
            this.service.getHosts().catch(() => [] as HostDto[]),
        ])
            .then(([profile, mcp, detectedHosts, versions, hostRuntimes, hosts]) => {
                this.mcpProviders.set(mcp.providers);
                this.mcpSources.set(mcp.sources);
                this.mcpWarnings.set(mcp.warnings);
                this.detectedHosts.set(detectedHosts.detected);
                this.hostRuntimes.set(hostRuntimes);
                this.hosts.set(hosts);
                const activeHosts = hosts.filter((host) => host.runtimes.some((runtime) => runtime.health !== 'offline'));
                if (!activeHosts.some((host) => host.hostId === this.newHostId()) && activeHosts.length > 0) {
                    this.newHostId.set(activeHosts[0].hostId);
                }
                this.remoteStackVersions.set(versions.versions.map((item: any) => ({
                    version: Number(item.version) || 1,
                    status: item.status,
                    layers: this.normalizeLayers(item.layers as StackLayer[]),
                    publishedAt: item.publishedAt ?? undefined,
                })));
                this.current.set(profile);
                this.hydrate(profile);
                void this.refreshLegacyHarness();
                void this.loadMigrationPreview();
                void this.loadBoundaries();
                if (this.activeTab() === 'observation') this.loadObservations();
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Unable to load consumer'))
            .finally(() => this.loading.set(false));
    }

    layersForVersion(version: number): StackLayer[] {
        return this.stackVersions().find((item) => item.version === version)?.layers || defaultStackLayers();
    }

    stackStatus(): StackVersionStatus {
        return this.stackVersions().find((item) => item.version === this.activeStackVersion())?.status || 'draft';
    }

    isStackEditable(): boolean {
        return this.stackStatus() === 'draft';
    }

    publishedStackVersions(): StackVersion[] {
        return this.stackVersions().filter((item) => item.status === 'published').sort((a, b) => b.version - a.version);
    }

    latestPublishedVersion(): number {
        return this.publishedStackVersions()[0]?.version || this.activeStackVersion();
    }

    switchStackVersion(version: number): void {
        const target = this.stackVersions().find((item) => item.version === version);
        if (!target || target.version === this.activeStackVersion()) return;
        this.persistActiveLayers();
        this.activeStackVersion.set(target.version);
        this.stackLayers.set(target.layers.map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
    }

    createStackVersion(): void {
        this.persistActiveLayers();
        const next = Math.max(...this.stackVersions().map((item) => item.version), 0) + 1;
        const draft: StackVersion = { version: next, status: 'draft', layers: this.stackLayers().map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })) };
        this.stackVersions.update((versions) => [...versions, draft]);
        this.activeStackVersion.set(next);
    }

    publishStack(): void {
        if (!this.isStackEditable()) return;
        this.persistActiveLayers();
        this.stackVersions.update((versions) => versions.map((item) => item.version === this.activeStackVersion() ? { ...item, status: 'published' as const, publishedAt: new Date().toISOString(), layers: this.stackLayers().map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })) } : item));
    }

    canDeleteStackVersion(): boolean {
        return this.stackStatus() !== 'published'
            && this.stackVersions().length > 1
            && !this.hostProfiles().some((profile) => profile.stackVersion === this.activeStackVersion());
    }

    askDeleteStackVersion(): void {
        if (this.canDeleteStackVersion()) this.deleteVersionConfirm.set(true);
    }

    cancelDeleteStackVersion(): void {
        this.deleteVersionConfirm.set(false);
    }

    deleteStackVersion(): void {
        if (!this.canDeleteStackVersion()) return;
        const deleted = this.activeStackVersion();
        const remaining = this.stackVersions().filter((item) => item.version !== deleted);
        this.stackVersions.set(remaining);
        const published = remaining.filter((item) => item.status === 'published').sort((a, b) => b.version - a.version);
        const fallback = published[0] || remaining[remaining.length - 1];
        this.activeStackVersion.set(fallback.version);
        this.stackLayers.set(this.layersForVersion(fallback.version).map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
        this.deleteVersionConfirm.set(false);
    }

    canReopenStack(): boolean {
        return this.stackStatus() === 'published' && !this.hostProfiles().some((profile) => profile.stackVersion === this.activeStackVersion());
    }

    reopenStackVersion(): void {
        if (!this.canReopenStack()) return;
        this.stackVersions.update((versions) => versions.map((item) => item.version === this.activeStackVersion() ? { ...item, status: 'draft' as const } : item));
    }

    retireStackVersion(): void {
        if (this.stackStatus() !== 'published') return;
        this.persistActiveLayers();
        this.stackVersions.update((versions) => versions.map((item) => item.version === this.activeStackVersion() ? { ...item, status: 'retired' as const } : item));
    }

    openBulkUpgrade(): void {
        this.bulkUpgradeOpen.set(true);
        this.bulkUpgradeTarget.set(this.latestPublishedVersion());
    }

    closeBulkUpgrade(): void {
        this.bulkUpgradeOpen.set(false);
        this.bulkUpgradeTarget.set(null);
    }

    affectedBindings(): number {
        const target = this.bulkUpgradeTarget();
        return target ? this.hostProfiles().filter((profile) => profile.stackVersion !== target).length : 0;
    }

    applyBulkUpgrade(): void {
        const target = this.bulkUpgradeTarget();
        if (!target) return;
        this.hostProfiles.update((profiles) => profiles.map((profile) => ({ ...profile, stackVersion: target })));
        this.closeBulkUpgrade();
    }

    private persistActiveLayers(): void {
        const version = this.activeStackVersion();
        this.stackVersions.update((versions) => versions.map((item) => item.version === version ? { ...item, layers: this.stackLayers().map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })) } : item));
    }

    hostPlugins(): PluginEntry[] { return this.plugins().filter((plugin) => plugin.type === 'host'); }
    activeHostRuntimes(): HostRuntimeDto[] { return this.hostRuntimes().filter((host) => host.health !== 'offline'); }
    activeHosts(): HostDto[] { return this.hosts().filter((host) => host.runtimes.some((runtime) => runtime.health !== 'offline')); }
    hostTypeLabel(type: string): string { return HOST_TYPE_LABELS[type] || type; }
    runtimeOptionsFor(workerId: string): Array<{ value: string; label: string; legacy: boolean }> {
        const allowed = this.placementDraftFor(workerId).allowedHosts;
        const runtimeKeys = new Set(this.hostRuntimes().map((runtime) => runtime.runtimeKey));
        const options = this.hostRuntimes().map((runtime) => ({ value: runtime.runtimeKey, label: `${runtime.runtimeKey} · ${runtime.hostType}`, legacy: false }));
        for (const key of allowed) {
            if (!runtimeKeys.has(key)) options.push({ value: key, label: `${key} · legacy host id (no runtime)`, legacy: true });
        }
        return options.sort((left, right) => left.value.localeCompare(right.value));
    }
    legacyPlacementKeys(workerId: string): string[] {
        const runtimeKeys = new Set(this.hostRuntimes().map((runtime) => runtime.runtimeKey));
        return this.placementDraftFor(workerId).allowedHosts.filter((key) => !runtimeKeys.has(key));
    }
    hostAvailable(hostId: string): boolean { return this.hostRuntimes().some((host) => host.hostId === hostId && host.health !== 'offline'); }
    hostHealth(hostId: string): string { return this.hostRuntimes().find((host) => host.hostId === hostId)?.health || 'unregistered'; }
    hostTypeFor(hostId: string): string {
        const hostType = this.hosts().find((host) => host.hostId === hostId)?.hostType;
        if (hostType) return hostType;
        const runtimeId = this.hostRuntimes().find((host) => host.hostId === hostId)?.runtimeId || hostId;
        const value = String(runtimeId || hostId).toLowerCase();
        if (value.includes('cursor')) return 'cursor';
        if (value.includes('agy') || value.includes('antigravity')) return 'agy';
        if (value.includes('dsh')) return 'dsh';
        if (value.includes('claude')) return 'claude';
        return hostId;
    }
    enabledLayerCount(): number { return this.stackLayers().filter((layer) => layer.enabled).length; }
    agentLayers(): StackLayer[] { return this.stackLayers().filter((layer) => ['multiAgent', 'rules', 'skills', 'hooks'].includes(layer.id)); }
    knowledgeLayers(): StackLayer[] { return this.stackLayers().filter((layer) => ['memory', 'codeGraph', 'documentGraph', 'topology'].includes(layer.id)); }
    isLayerEnabled(layerId: LayerId, version = this.activeStackVersion()): boolean {
        return this.layersForVersion(version).find((item) => item.id === layerId)?.enabled ?? false;
    }

    isResolutionLayerEnabled(layerId: LayerId): boolean {
        return this.isLayerEnabled(layerId, this.newStackVersion());
    }

    sourceOptionsFor(layerId: LayerId): string[] {
        if (!this.isResolutionLayerEnabled(layerId)) return [];
        const layer = this.layersForVersion(this.newStackVersion()).find((item) => item.id === layerId);
        return layer?.allowedSources?.length ? layer.allowedSources : this.policySources;
    }
    toggleAllowedSource(layerId: LayerId, source: string, checked: boolean): void {
        if (!this.isStackEditable()) return;
        this.stackLayers.update((layers) => layers.map((layer) => {
            if (layer.id !== layerId) return layer;
            const current = layer.allowedSources || [];
            const next = checked ? [...new Set([...current, source])] : current.filter((item) => item !== source);
            return { ...layer, allowedSources: next };
        }));
        this.persistActiveLayers();
    }

    marketProviders(layerId: 'memory' | 'codeGraph'): PluginEntry[] {
        const capability = layerId === 'memory' ? 'memory' : 'code-graph';
        return this.plugins().filter((plugin) => plugin.type === 'provider' && plugin.capabilities.includes(capability));
    }
    providersForLayer(layer: StackLayer): PluginEntry[] {
        return this.marketProviders(layer.id === 'memory' ? 'memory' : 'codeGraph');
    }

    mcpSource(providerId: string | undefined): string {
        return this.plugins().find((plugin) => plugin.id === providerId)?.mcpSource || 'host MCP config';
    }
    hostLabel(pluginId: string): string {
        const host = this.hostRuntimes().find((item) => item.hostId === pluginId);
        if (host) return `${host.hostId} · ${this.hostTypeFor(host.hostId)}`;
        return this.plugins().find((plugin) => plugin.id === pluginId)?.label || pluginId;
    }

    normalizeWorker(worker: any): WorkerEntry {
        const hostBindingIds = Array.isArray(worker?.hostBindingIds)
            ? worker.hostBindingIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
            : worker?.hostBindingId ? [String(worker.hostBindingId)] : [];
        return {
            id: String(worker?.id || `worker-${Date.now().toString(36)}`),
            name: String(worker?.name || 'Unnamed worker'),
            role: String(worker?.role || 'dev'),
            layer: worker?.layer === 'gate' ? 'gate' : 'peer',
            hostBindingIds,
            scope: String(worker?.scope || ''),
            status: ['active', 'paused', 'retired'].includes(worker?.status) ? worker.status : 'declared',
            capabilities: Array.isArray(worker?.capabilities) ? worker.capabilities : [],
            verbs: Array.isArray(worker?.verbs) ? worker.verbs : ['read', 'append'],
            bar: Array.isArray(worker?.bar) ? worker.bar.map((item: any) => typeof item === 'string' ? { kind: 'manual', label: item } : item) : [],
            escalation: String(worker?.escalation || 'allow'),
            instructions: String(worker?.instructions || ''),
            sourceFile: worker?.sourceFile ? String(worker.sourceFile) : undefined,
            sourceHash: worker?.sourceHash ? String(worker.sourceHash) : undefined,
            sourceType: worker?.sourceType ? String(worker.sourceType) : undefined,
        };
    }

    setWorkerDraft<K extends keyof WorkerDraft>(key: K, value: WorkerDraft[K]): void {
        this.workerDraft.update((draft) => ({ ...draft, [key]: value }));
    }

    setWorkerRole(role: string): void {
        this.workerDraft.update((draft) => ({
            ...draft,
            role,
            layer: ['verify', 'audit', 'qc'].includes(role) ? 'gate' : 'peer',
        }));
    }

    bindingLabel(binding: HostProfile): string {
        return `${binding.userId} · ${this.hostLabel(binding.hostId)} · v${binding.stackVersion}`;
    }

    formationBindingLabel(id: string): string {
        const binding = this.hostProfiles().find((item) => item.id === id);
        return binding ? this.bindingLabel(binding) : 'Missing binding';
    }

    workerBindingLabel(worker: WorkerEntry): string {
        const labels = worker.hostBindingIds
            .map((id) => this.hostProfiles().find((item) => item.id === id))
            .filter((binding): binding is HostProfile => Boolean(binding))
            .map((binding) => this.bindingLabel(binding));
        return labels.length > 0 ? labels.join(' · ') : 'No binding yet';
    }

    workerRoleCount(): number {
        return new Set(this.workers().map((worker) => worker.role)).size;
    }

    workerHostCoverage(): number {
        return new Set(this.workers().flatMap((worker) => worker.hostBindingIds)).size;
    }

    workerPlacementCount(): number {
        return this.workers().reduce((sum, worker) => sum + worker.hostBindingIds.length, 0);
    }

    validFormationHostIds(): string[] {
        const valid = new Set(this.hostProfiles().map((profile) => profile.id));
        return this.formationHostIds().filter((id) => valid.has(id));
    }

    canApplyFormation(): boolean {
        return this.workers().length > 0 && this.validFormationHostIds().length > 0;
    }

    formationApplyReason(): string {
        if (this.workers().length === 0) return 'No workers in the formation. Use Reset to default or add a worker.';
        if (this.hostProfiles().length === 0) return 'No host bindings exist. Create one in Host bindings first.';
        if (this.formationHostIds().length === 0) return 'Select at least one host binding above.';
        if (this.validFormationHostIds().length === 0) return 'Selected host bindings no longer exist. Select again.';
        return '';
    }

    clearFormationPlacements(): void {
        this.workers.update((workers) => workers.map((worker) => ({ ...worker, hostBindingIds: [] })));
    }

    applyFormationHosts(): void {
        const hostBindingIds = this.validFormationHostIds();
        if (hostBindingIds.length === 0) return;
        this.workers.update((workers) => workers.map((worker) => ({ ...worker, hostBindingIds: [...hostBindingIds] })));
    }

    private loadFlowSummaries(id: string): void {
        this.service.getFlows(id)
            .then((flows) => this.flowSummaries.set(flows))
            .catch(() => this.flowSummaries.set([]));
    }

    flowVersionOptions(): number[] {
        const flow = this.flowSummaries().find((item) => item.id === this.newFlowId());
        return flow?.publishedVersions?.length ? flow.publishedVersions : (flow ? [flow.version] : []);
    }

    changeFlow(id: string): void {
        this.newFlowId.set(id);
        this.newFlowVersion.set(this.flowVersionOptions().at(-1) || 1);
    }

    private loadWorkerSourceStatus(id: string): void {
        this.service.getWorkerSourceStatus(id)
            .then((status) => this.workerSourceStatus.set(status))
            .catch(() => this.workerSourceStatus.set({ source: 0, projections: 0, drift: [] }));
    }

    syncWorkerSources(): void {
        this.workerSyncing.set(true);
        this.service.syncWorkerSources(this.consumerId)
            .then((status) => this.workerSourceStatus.set(status))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Worker sync failed'))
            .finally(() => this.workerSyncing.set(false));
    }

    promoteProjection(file: string): void {
        const id = file.replace(/\.md$/, '');
        this.service.promoteWorkerProjection(this.consumerId, id)
            .then(() => {
                this.loadWorkerFiles(this.consumerId);
                this.loadWorkerSourceStatus(this.consumerId);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Promote failed'));
    }

    private loadDefaultFlow(id: string): void {
        this.service.getDefaultFlow(id)
            .then((flow) => {
                this.defaultFlow.set(flow);
                this.workerEdges.set(flow?.edges.map((edge) => ({ from: edge.from, to: edge.to, on: edge.on })) || []);
            })
            .catch(() => {
                this.defaultFlow.set(null);
                this.workerEdges.set([]);
            });
    }

    private loadRuleFiles(id: string): void {
        Promise.all([this.service.getRules(id), this.service.getMaterialSummary(id)])
            .then(([rules, material]) => {
                this.ruleFiles.set(rules);
                this.materialCounts.set(material);
                this.stackLayers.update((layers) => layers.map((layer) => layer.id === 'rules' ? { ...layer, files: rules.length } : layer));
            })
            .catch(() => {
                this.ruleFiles.set([]);
                this.materialCounts.set({ skills: 0, hooks: 0, subagents: 0, rules: 0 });
            });
    }

    ruleMdcCount(): number {
        return this.ruleFiles().filter((rule) => String(rule.sourceFile || '').toLowerCase().endsWith('.mdc')).length;
    }

    ruleMdCount(): number {
        return this.ruleFiles().length - this.ruleMdcCount();
    }

    onRuleFiles(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length === 0) return;
        this.ruleImporting.set(true);
        Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() })))
            .then((payload) => this.service.previewRuleImport(this.consumerId, payload))
            .then((preview) => {
                this.ruleImportPreview.set(preview);
                this.ruleSelectedHashes.set(preview.candidates.map((candidate: any) => candidate.sourceHash));
                this.ruleImportActions.set(Object.fromEntries(preview.candidates.map((candidate: any) => [candidate.sourceHash, candidate.conflict ? 'skip' : 'replace'])));
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Rule import preview failed'))
            .finally(() => this.ruleImporting.set(false));
    }

    ruleAction(hash: string): 'skip' | 'replace' | 'copy' {
        return this.ruleImportActions()[hash] || 'skip';
    }

    setRuleAction(hash: string, action: 'skip' | 'replace' | 'copy'): void {
        this.ruleImportActions.update((actions) => ({ ...actions, [hash]: action }));
    }

    toggleRuleImport(hash: string, checked: boolean): void {
        this.ruleSelectedHashes.update((hashes) => checked ? [...new Set([...hashes, hash])] : hashes.filter((item) => item !== hash));
    }

    importableRuleCount(): number {
        const preview = this.ruleImportPreview();
        if (!preview) return 0;
        const selected = new Set(this.ruleSelectedHashes());
        return preview.candidates.filter((candidate: any) => selected.has(candidate.sourceHash) && this.ruleAction(candidate.sourceHash) !== 'skip').length;
    }

    applyRuleImport(): void {
        const preview = this.ruleImportPreview();
        if (!preview) return;
        const selected = new Set(this.ruleSelectedHashes());
        const candidates = preview.candidates
            .filter((candidate: any) => selected.has(candidate.sourceHash) && this.ruleAction(candidate.sourceHash) !== 'skip')
            .map((candidate: any) => ({ ...candidate, action: this.ruleAction(candidate.sourceHash) }));
        if (candidates.length === 0) return;
        this.service.applyRuleImport(this.consumerId, candidates)
            .then(() => this.loadRuleFiles(this.consumerId))
            .then(() => {
                this.ruleImportPreview.set(null);
                this.ruleSelectedHashes.set([]);
                this.ruleImportActions.set({});
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Rule import failed'));
    }

    deleteRule(rule: any): void {
        if (!window.confirm(`Remove ${rule.id} from agents/rules?`)) return;
        this.service.deleteRule(this.consumerId, rule.id)
            .then(() => this.loadRuleFiles(this.consumerId))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Rule delete failed'));
    }

    closeRuleImport(): void {
        this.ruleImportPreview.set(null);
        this.ruleSelectedHashes.set([]);
        this.ruleImportActions.set({});
    }

    onWorkerFiles(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length === 0) return;
        this.workerImporting.set(true);
        Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() })))
            .then((payload) => this.service.previewWorkerImport(this.consumerId, payload))
            .then((preview) => {
                this.workerImportPreview.set(preview);
                this.importSelectedHashes.set(preview.candidates.map((candidate: any) => candidate.sourceHash));
                this.importActions.set(Object.fromEntries(preview.candidates.map((candidate: any) => [candidate.sourceHash, candidate.conflict ? 'skip' : 'import'])));
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Import preview failed'))
            .finally(() => this.workerImporting.set(false));
    }

    toggleImport(hash: string, checked: boolean): void {
        this.importSelectedHashes.update((hashes) => checked
            ? [...new Set([...hashes, hash])]
            : hashes.filter((item) => item !== hash));
    }

    importAction(hash: string): 'import' | 'replace' | 'copy' | 'skip' {
        return this.importActions()[hash] || 'import';
    }

    setImportAction(hash: string, action: 'import' | 'replace' | 'copy' | 'skip'): void {
        this.importActions.update((actions) => ({ ...actions, [hash]: action }));
    }

    importableCount(): number {
        const preview = this.workerImportPreview();
        if (!preview) return 0;
        const selected = new Set(this.importSelectedHashes());
        return preview.candidates.filter((candidate: any) => selected.has(candidate.sourceHash) && this.importAction(candidate.sourceHash) !== 'skip').length;
    }

    importWorkers(): void {
        const preview = this.workerImportPreview();
        if (!preview) return;
        const selected = new Set(this.importSelectedHashes());
        const imported: WorkerEntry[] = [];
        for (const candidate of preview.candidates) {
            if (!selected.has(candidate.sourceHash)) continue;
            const action = this.importAction(candidate.sourceHash);
            if (action === 'skip') continue;
            const worker = this.normalizeWorker(candidate.worker);
            let targetId = worker.id;
            if (action === 'replace' && candidate.conflictWith) {
                this.workers.update((workers) => workers.filter((item) => item.id !== candidate.conflictWith));
                targetId = candidate.conflictWith;
            }
            if (action === 'copy') {
                let suffix = 2;
                targetId = `${worker.id}-copy`;
                while (this.workers().some((item) => item.id === targetId)) targetId = `${worker.id}-copy-${suffix++}`;
            }
            const next = { ...worker, id: targetId };
            this.workers.update((workers) => [...workers.filter((item) => item.id !== targetId), next]);
            imported.push(next);
            void this.service.recordWorkerImport(this.consumerId, {
                sourceFile: candidate.sourceFile,
                sourceHash: candidate.sourceHash,
                sourceType: candidate.sourceType,
                workerId: targetId,
                action: action === 'import' ? 'import' : action,
            }).catch(() => undefined);
        }
        if (imported.length === 0) return;
        this.selectedWorkerId.set(imported[0].id);
        this.workerImportPreview.set(null);
        this.importSelectedHashes.set([]);
        this.importActions.set({});
        this.workerImportDirty.set(true);
        this.saved.set(false);
        this.loadWorkerImports();
    }

    loadWorkerImports(): void {
        this.service.getWorkerImports(this.consumerId)
            .then((records) => this.workerImports.set(records))
            .catch(() => this.workerImports.set([]));
    }

    closeImportPreview(): void {
        this.workerImportPreview.set(null);
        this.importSelectedHashes.set([]);
    }

    selectWorker(id: string): void {
        this.selectedWorkerId.set(id);
        this.newEvidenceValue.set('85');
        this.evidenceInputError.set('');
        this.placementNotice.set('');
        this.placementError.set('');
    }

    updateWorkerField<K extends 'name' | 'role' | 'layer' | 'scope' | 'escalation' | 'instructions'>(id: string, key: K, value: WorkerEntry[K]): void {
        this.workers.update((workers) => workers.map((worker) => worker.id === id ? { ...worker, [key]: value } : worker));
    }

    setWorkerVerbs(id: string, verbs: string[]): void {
        this.workers.update((workers) => workers.map((worker) => worker.id === id ? { ...worker, verbs: [...verbs] } : worker));
    }

    workerScopeList(worker: WorkerEntry): string[] {
        return worker.scope.split(',').map((item) => item.trim()).filter(Boolean);
    }

    scopeIsValid(scope: string): boolean {
        return /^(\/|\.\.?\/)?[A-Za-z0-9._*/-]+$/.test(scope);
    }

    evidenceLabel(requirement: EvidenceRequirementDto): string {
        if (requirement.kind === 'audit') return `Audit ${requirement.metric || 'rubric'} ${requirement.op || '>='} ${requirement.value ?? 0}`;
        if (requirement.kind === 'verify') return `Verify ${requirement.value || 'PASS'}`;
        if (requirement.kind === 'test') return 'Tests pass';
        if (requirement.kind === 'scenario') return 'Scenario executed';
        return requirement.label || requirement.kind;
    }

    requirementIsValid(requirement: EvidenceRequirementDto): boolean {
        if (requirement.kind === 'audit') return Number.isFinite(Number(requirement.value));
        if (requirement.kind === 'verify') return String(requirement.value || 'PASS').length > 0;
        return requirement.kind === 'test' || requirement.kind === 'scenario';
    }

    addWorkerScope(id: string): void {
        const values = this.newScope().split(',').map((item) => item.trim()).filter(Boolean);
        if (values.length === 0) return;
        const invalid = values.find((value) => !/^(\/|\.\.?\/)?[A-Za-z0-9._*/-]+$/.test(value));
        if (invalid) {
            this.scopeInputError.set(`Scope must be a path or glob: ${invalid}`);
            return;
        }
        this.scopeInputError.set('');
        this.workers.update((workers) => workers.map((worker) => {
            if (worker.id !== id) return worker;
            const existing = new Set(this.workerScopeList(worker));
            values.forEach((value) => existing.add(value));
            return { ...worker, scope: [...existing].join(', ') };
        }));
        this.newScope.set('');
    }

    removeWorkerScope(id: string, value: string): void {
        this.workers.update((workers) => workers.map((worker) => worker.id === id
            ? { ...worker, scope: this.workerScopeList(worker).filter((item) => item !== value).join(', ') }
            : worker));
    }

    addWorkerCapability(id: string): void {
        const values = this.newCapability().split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
        if (values.length === 0) return;
        const invalid = values.find((value) => !/^[a-z][a-z0-9-]{0,31}$/.test(value));
        if (invalid) {
            this.capabilityInputError.set(`Capability must be a lowercase slug: ${invalid}`);
            return;
        }
        this.capabilityInputError.set('');
        this.workers.update((workers) => workers.map((worker) => {
            if (worker.id !== id) return worker;
            const existing = new Set(worker.capabilities);
            values.forEach((value) => existing.add(value));
            return { ...worker, capabilities: [...existing] };
        }));
        this.newCapability.set('');
    }

    removeWorkerCapability(id: string, capability: string): void {
        this.workers.update((workers) => workers.map((worker) => worker.id === id
            ? { ...worker, capabilities: worker.capabilities.filter((item) => item !== capability) }
            : worker));
    }

    addWorkerEvidence(id: string): void {
        const kind = this.newEvidenceKind();
        let requirement: EvidenceRequirementDto;
        if (kind === 'audit') {
            const value = Number(this.newEvidenceValue());
            if (!Number.isFinite(value)) {
                this.evidenceInputError.set('Audit threshold must be a number.');
                return;
            }
            requirement = { kind: 'audit', metric: 'rubric', op: '>=', value };
        } else if (kind === 'verify') {
            requirement = { kind: 'verify', metric: 'status', op: '==', value: this.newEvidenceValue().trim().toUpperCase() || 'PASS' };
        } else if (kind === 'audit-critical') {
            requirement = { kind: 'audit', metric: 'critical', op: '==', value: 0 };
        } else if (kind === 'scenario') {
            requirement = { kind: 'scenario', metric: 'executed', op: 'truthy', value: true };
        } else {
            requirement = { kind: 'test', metric: 'passed', op: 'truthy', value: true };
        }
        this.evidenceInputError.set('');
        this.workers.update((workers) => workers.map((worker) => {
            if (worker.id !== id) return worker;
            const label = this.evidenceLabel(requirement);
            if (worker.bar.some((item) => this.evidenceLabel(item) === label)) return worker;
            return { ...worker, bar: [...worker.bar, requirement] };
        }));
    }

    removeWorkerEvidence(id: string, index: number): void {
        this.workers.update((workers) => workers.map((worker) => worker.id === id
            ? { ...worker, bar: worker.bar.filter((_, itemIndex) => itemIndex !== index) }
            : worker));
    }

    quickCapability(id: string, value: string): void {
        this.newCapability.set(value);
        this.addWorkerCapability(id);
    }

    setWorkerList(id: string, key: 'capabilities' | 'verbs', value: string): void {
        const items = splitList(value);
        this.workers.update((workers) => workers.map((worker) => worker.id === id ? { ...worker, [key]: items } : worker));
    }

    setWorkerHostBindings(id: string, hostBindingIds: string[]): void {
        this.workers.update((workers) => workers.map((worker) => worker.id === id ? { ...worker, hostBindingIds: [...hostBindingIds] } : worker));
    }

    addWorker(): void {
        const id = `worker-${Date.now().toString(36)}`;
        const worker: WorkerEntry = {
            id,
            name: 'New worker',
            role: 'dev',
            layer: 'peer',
            hostBindingIds: [],
            scope: '',
            status: 'declared',
            capabilities: [],
            verbs: ['read', 'append'],
            bar: [],
            escalation: 'allow',
        };
        this.workers.update((workers) => [...workers, worker]);
        this.selectedWorkerId.set(id);
    }

    setWorkerStatus(id: string, status: WorkerEntry['status']): void {
        this.workers.update((workers) => workers.map((worker) => worker.id === id ? { ...worker, status } : worker));
    }

    activateWorker(id: string): void {
        this.setWorkerStatus(id, 'active');
    }

    openPolicyCheck(worker: WorkerEntry): void {
        this.policyWorker.set(worker);
        this.policyResult.set(null);
        this.policyPath.set('');
        this.policyEvidenceValue.set('');
    }

    closePolicyCheck(): void {
        this.policyWorker.set(null);
        this.policyResult.set(null);
    }

    buildPolicyEvidence(): any {
        const kind = this.policyEvidenceKind();
        if (kind === 'audit' || kind === 'audit-critical') return { kind: 'audit', rubric: Number(this.policyEvidenceValue()) || 0, critical: 0 };
        if (kind === 'verify') return { kind: 'verify', status: this.policyEvidenceValue().trim().toUpperCase() || 'PASS' };
        if (kind === 'scenario') return { kind: 'scenario', executed: true };
        return { kind: 'test', passed: true };
    }

    runPolicyCheck(): void {
        const profile = this.current();
        const worker = this.policyWorker();
        if (!profile || !worker || this.policyChecking()) return;
        this.policyChecking.set(true);
        this.service.checkWorker(profile.id, worker.id, {
            verb: this.policyVerb(),
            path: this.policyPath().trim() || undefined,
            evidence: [this.buildPolicyEvidence()],
        })
            .then((result) => this.policyResult.set(result))
            .catch((err) => this.policyResult.set({ decision: 'DENY', reasons: [err?.detail || err?.message || 'Policy check failed'] }))
            .finally(() => this.policyChecking.set(false));
    }

    removeWorker(id: string): void {
        this.workers.update((workers) => workers.filter((worker) => worker.id !== id));
        if (this.selectedWorkerId() === id) this.selectedWorkerId.set('');
        if (this.policyWorker()?.id === id) this.closePolicyCheck();
    }

    workerName(id: string): string {
        return this.workers().find((worker) => worker.id === id)?.name || id;
    }

    updateLayer(id: LayerId, field: 'enabled' | 'required' | 'allowedSources', value: unknown): void {
        if (!this.isStackEditable()) return;
        this.stackLayers.update((layers) => layers.map((layer) => (layer.id === id ? { ...layer, [field]: value } : layer)));
        this.persistActiveLayers();
    }

    managedProfilesFor(userId: string): HostProfile[] {
        return this.hostProfiles().filter((profile) => profile.userId === userId && !profile.detected);
    }

    hostProfileCount(userId: string): string {
        const count = this.managedProfilesFor(userId).length;
        return `${count} host binding${count === 1 ? '' : 's'}`;
    }

    toggleProfile(profileId: string): void {
        this.expandedProfile.set(this.expandedProfile() === profileId ? null : profileId);
    }

    effectiveLayers(profile: HostProfile): Array<{ id: string; label: string; value: string; scope: string }> {
        const stack = this.layersForVersion(profile.stackVersion);
        const layer = (id: LayerId) => stack.find((item) => item.id === id);
        const memory = !this.isResolutionLayerEnabled('memory') ? 'Disabled by Stack' : (profile.memoryProvider ? `${profile.memorySource} · ${profile.memoryProvider}` : profile.memorySource);
        const codeGraph = !this.isResolutionLayerEnabled('codeGraph') ? 'Disabled by Stack' : (profile.codeGraphProvider ? `${profile.codeGraphSource} · ${profile.codeGraphProvider}` : profile.codeGraphSource);
        return [
            { id: 'multiAgent', label: 'Multi-agent', value: `${this.workers().length} workers · ${this.workers().length} roles`, scope: 'stack' },
            { id: 'rules', label: 'Rules', value: (layer('rules')?.files ?? 0) + ' files', scope: 'stack' },
            { id: 'skills', label: 'Skills', value: (layer('skills')?.files ?? 0) + ' files', scope: 'stack' },
            { id: 'hooks', label: 'Hooks', value: (layer('hooks')?.files ?? 0) + ' files', scope: 'stack' },
            { id: 'memory', label: 'Memory', value: memory, scope: this.isResolutionLayerEnabled('memory') ? 'resolved' : 'disabled' },
            { id: 'codeGraph', label: 'Code graph', value: codeGraph, scope: this.isResolutionLayerEnabled('codeGraph') ? 'resolved' : 'disabled' },
            { id: 'documentGraph', label: 'Document graph', value: 'ESO-only · Postgres', scope: 'stack' },
            { id: 'topology', label: 'Topology', value: 'Deferred', scope: 'stack' },
            { id: 'material', label: 'Material', value: 'rules · skills · hooks', scope: 'stack' },
        ];
    }

    unmanagedHosts(): Array<{ hostId: string; label: string; markers: string[] }> {
        return this.detectedHosts().filter((host) => !this.hostProfiles().some((profile) => profile.hostId === host.hostId));
    }

    manageDetectedHost(hostId: string): void {
        if (!this.hostAvailable(hostId)) { this.error.set('No active host runtime. Register it in Hosts first.'); this.openHosts(); return; }
        const userId = this.developers()[0] || 'operator';
        this.developers.update((developers) => (developers.includes(userId) ? developers : [...developers, userId]));
        if (this.hostProfiles().some((profile) => profile.userId === userId && profile.hostId === hostId)) return;
        const resolution = this.hostResolution(hostId);
        this.hostProfiles.update((profiles) => [...profiles, {
            id: `hp-${Date.now()}`, userId, hostId, stackVersion: this.newStackVersion(),
            flowId: this.newFlowId() || undefined, flowVersion: this.newFlowId() ? this.newFlowVersion() : undefined,
            ...resolution,
            mcpConfigSource: this.mcpSourceForHost(hostId), installState: 'pending', detected: false,
        }]);
    }

    startNewBinding(): void {
        if (this.activeHosts().length === 0) { this.error.set('Register an active host runtime in Hosts first.'); return; }
        this.editingProfile.set(null);
        this.addingHostFor.set('__new');
        this.bindingDeveloper.set('');
        this.newStackVersion.set(this.latestPublishedVersion());
        this.newFlowId.set('');
        this.newFlowVersion.set(1);
        this.useHostDefaults();
    }

    startAddHost(userId: string): void {
        if (this.activeHosts().length === 0) { this.error.set('Register an active host runtime in Hosts first.'); return; }
        this.editingProfile.set(null);
        this.addingHostFor.set(userId);
        this.bindingDeveloper.set(userId);
        this.newStackVersion.set(this.latestPublishedVersion());
        this.newFlowId.set('');
        this.newFlowVersion.set(1);
        this.useHostDefaults();
    }

    changeHost(hostId: string): void {
        this.newHostId.set(hostId);
        this.useHostDefaults();
    }

    useHostDefaults(): void {
        const resolution = this.hostResolution(this.newHostId(), this.newStackVersion());
        this.newMemorySource.set(resolution.memorySource);
        this.newMemoryProvider.set(resolution.memoryProvider || '');
        this.newCodeGraphSource.set(resolution.codeGraphSource);
        this.newCodeGraphProvider.set(resolution.codeGraphProvider || '');
    }

    agentCapabilities(): Array<{ id: string; label: string; value: string }> {
        return this.inheritedCapabilities().filter((item) => ['multiAgent', 'rules', 'skills', 'hooks'].includes(item.id));
    }

    graphCapabilities(): Array<{ id: string; label: string; value: string }> {
        return this.inheritedCapabilities().filter((item) => ['documentGraph', 'topology'].includes(item.id));
    }

    inheritedCapabilities(): Array<{ id: string; label: string; value: string }> {
        const layers = this.layersForVersion(this.newStackVersion());
        const layer = (id: LayerId) => layers.find((item) => item.id === id);
        return [
            { id: 'multiAgent', label: 'Multi-agent / SLP', value: `${this.workers().length} workers · ${this.workers().length} roles` },
            { id: 'rules', label: 'Rules / law', value: `${layer('rules')?.files ?? 0} files` },
            { id: 'skills', label: 'Skills', value: `${layer('skills')?.files ?? 0} files` },
            { id: 'hooks', label: 'Hooks', value: `${layer('hooks')?.files ?? 0} files` },
            { id: 'documentGraph', label: 'Document graph', value: 'ESO-only · Postgres · graph schema' },
            { id: 'topology', label: 'Topology', value: 'Deferred' },
            { id: 'material', label: 'Material', value: 'rules · skills · hooks' },
        ];
    }

    startEditHost(profile: HostProfile): void {
        this.editingProfile.set(profile.id);
        this.addingHostFor.set(profile.userId);
        this.bindingDeveloper.set(profile.userId);
        this.newHostId.set(profile.hostId);
        this.newStackVersion.set(profile.stackVersion);
        this.newFlowId.set(profile.flowId || '');
        this.newFlowVersion.set(profile.flowVersion || 1);
        this.newMemorySource.set(profile.memorySource);
        this.newMemoryProvider.set(profile.memoryProvider || '');
        this.newCodeGraphSource.set(profile.codeGraphSource);
        this.newCodeGraphProvider.set(profile.codeGraphProvider || '');
    }

    saveHostBinding(): void {
        if (!this.hostAvailable(this.newHostId())) { this.error.set('Selected host is not registered or offline.'); return; }
        const editing = this.editingProfile();
        const developer = this.bindingDeveloper().trim();
        if (!developer) return;
        if (!this.developers().includes(developer)) {
            this.developers.update((developers) => [...developers, developer]);
        }
        if (editing) {
            this.hostProfiles.update((profiles) => profiles.map((profile) => profile.id === editing ? {
                ...profile,
                stackVersion: this.newStackVersion(),
                flowId: this.newFlowId() || undefined,
                flowVersion: this.newFlowId() ? this.newFlowVersion() : undefined,
                memorySource: this.newMemorySource(),
                memoryProvider: this.newMemorySource() === 'market' ? this.newMemoryProvider() : undefined,
                codeGraphSource: this.newCodeGraphSource(),
                codeGraphProvider: this.newCodeGraphSource() === 'market' ? this.newCodeGraphProvider() : undefined,
                mcpConfigSource: this.mcpSourceForHost(profile.hostId),
            } : profile));
            this.cancelAddHost();
            return;
        }
        this.addHostToDeveloper(developer);
    }

    private hostResolution(hostId: string, stackVersion = this.newStackVersion()): { memorySource: string; memoryProvider?: string; codeGraphSource: string; codeGraphProvider?: string } {
        const layers = this.layersForVersion(stackVersion);
        const policy = (id: LayerId) => layers.find((layer) => layer.id === id);
        const resolve = (id: LayerId, hostNative: boolean): { source: string; provider?: string } => {
            const layer = policy(id);
            if (!layer?.enabled) return { source: 'none' };
            const allowed = layer.allowedSources?.length ? layer.allowedSources : this.policySources;
            const preferred = hostNative ? 'host-native' : 'eso-native';
            const source = allowed.includes(preferred) ? preferred : (allowed[0] || 'eso-native');
            const provider = source === 'market' ? this.marketProviders(id === 'memory' ? 'memory' : 'codeGraph')[0]?.id : undefined;
            return { source, provider };
        };
        const memory = resolve('memory', this.hostTypeFor(hostId) === 'dsh');
        const codeGraph = resolve('codeGraph', false);
        return {
            memorySource: memory.source,
            memoryProvider: memory.provider,
            codeGraphSource: codeGraph.source,
            codeGraphProvider: codeGraph.provider,
        };
    }

    cancelAddHost(): void {
        this.addingHostFor.set(null);
        this.editingProfile.set(null);
    }

    askRemoveDeveloper(userId: string): void {
        this.removingDeveloper.set(userId);
    }

    cancelRemoveDeveloper(): void {
        this.removingDeveloper.set(null);
    }

    removeDeveloper(userId: string): void {
        this.developers.update((developers) => developers.filter((developer) => developer !== userId));
        this.hostProfiles.update((profiles) => profiles.filter((profile) => profile.userId !== userId));
        if (this.addingHostFor() === userId) this.addingHostFor.set(null);
        this.removingDeveloper.set(null);
    }

    hostSourcesSummary(profile: HostProfile): string {
        const memory = this.isResolutionLayerEnabled('memory') ? `Memory ${profile.memorySource}` : 'Memory disabled';
        const code = this.isResolutionLayerEnabled('codeGraph') ? `Code ${profile.codeGraphSource}` : 'Code disabled';
        return `${memory} · ${code}`;
    }

    resolutionSummary(profile: HostProfile): string {
        if (!this.isResolutionLayerEnabled('memory') && !this.isResolutionLayerEnabled('codeGraph')) return 'disabled';
        const parts: string[] = [];
        if (profile.memoryProvider) parts.push('memory: ' + profile.memoryProvider);
        if (profile.codeGraphProvider) parts.push('code: ' + profile.codeGraphProvider);
        if (profile.memorySource === 'market' && !profile.memoryProvider) parts.push('memory: missing provider');
        if (profile.codeGraphSource === 'market' && !profile.codeGraphProvider) parts.push('code: missing provider');
        return parts.length ? parts.join(' · ') : 'auto';
    }

    mcpSourceForHost(hostId: string): string {
        const hostType = this.hostTypeFor(hostId);
        const sources: Record<string, string> = {
            cursor: '.cursor/mcp.json',
            agy: '.agents/mcp_config.json',
            claude: '.claude/settings.json',
            dsh: 'plugin config',
            paseo: 'plugin config',
            orca: 'plugin config',
        };
        return sources[hostType] || sources[hostId] || 'host config';
    }

    addHostToDeveloper(userId: string): void {
        const hostId = this.newHostId();
        if (!hostId) return;
        if (!this.hostAvailable(hostId)) { this.error.set('Selected host is not registered or offline.'); return; }
        const exists = this.hostProfiles().some((profile) => profile.userId === userId && profile.hostId === hostId);
        if (exists) return;
        this.hostProfiles.update((profiles) => [...profiles, {
            id: `hp-${Date.now()}`, userId, hostId, stackVersion: this.newStackVersion(),
            memorySource: this.newMemorySource(),
            memoryProvider: this.newMemorySource() === 'market' ? this.newMemoryProvider() : undefined,
            codeGraphSource: this.newCodeGraphSource(),
            codeGraphProvider: this.newCodeGraphSource() === 'market' ? this.newCodeGraphProvider() : undefined,
            mcpConfigSource: this.mcpSourceForHost(hostId),
            installState: 'pending', detected: false,
        }]);
        this.addingHostFor.set(null);
    }

    removeHostProfile(id: string): void {
        this.hostProfiles.update((profiles) => profiles.filter((profile) => profile.id !== id));
        this.formationHostIds.update((ids) => ids.filter((item) => item !== id));
        this.workers.update((workers) => workers.map((worker) => ({
            ...worker,
            hostBindingIds: worker.hostBindingIds.filter((item) => item !== id),
        })));
        if (this.editingProfile() === id) this.cancelAddHost();
    }
    nextTab(): void {
        const index = this.tabs.findIndex((tab) => tab.id === this.activeTab());
        if (index >= 0 && index < this.tabs.length - 1) this.selectTab(this.tabs[index + 1].id);
    }

    finish(): void {
        this.finishing.set(true);
        this.save(true);
    }

    selectTab(id: string): void {
        this.activeTab.set(id);
        if (id === 'observation') this.loadObservations();
        this.router.navigate([], { relativeTo: this.route, queryParams: { tab: id }, queryParamsHandling: 'merge', replaceUrl: true });
    }

    openConsumerPlugins(): void {
        void this.router.navigate(['/consumers', this.consumerId, 'plugins']);
    }

    setProviderRoute(area: 'work' | 'design' | 'content', provider: string): void {
        this.providerRouting.update((routing) => ({ ...routing, [area]: provider }));
        if (area === 'work') this.jiraEnabled.set(provider === 'jira');
    }

    providerStatus(providerId: string): string {
        const plugin = this.consumerPlugins().find((item) => item.id === providerId);
        return plugin?.health || (plugin?.enabled ? 'enabled' : 'not configured');
    }

    openFlows(): void {
        void this.router.navigate(['/consumers', this.consumerId, 'flows']);
    }

    switchConsumer(id: string): void {
        if (!id || id === this.consumerId) return;
        const tab = this.activeTab();
        void this.router.navigate(['/consumers', id, 'settings'], { queryParams: tab === 'profile' ? {} : { tab } });
    }

    back(): void { const id = this.route.snapshot.paramMap.get('id'); this.router.navigate(['/consumers', id]); }
    pipelineGroups(): Array<{ id: string; title: string; stages: Array<{ id: string; label: string; gate: string }> }> {
        return [
            { id: 'A', title: 'Requirements', stages: [
                { id: 'S1', label: 'Pain / vision', gate: 'G1' },
                { id: 'S2', label: 'BRD', gate: 'G2' },
                { id: 'S3', label: 'PRD', gate: 'G3' },
                { id: 'S4', label: 'FRD', gate: 'G4' },
                { id: 'S5', label: 'SRS', gate: 'G5' },
            ] },
            { id: 'B', title: 'Criteria', stages: [
                { id: 'S6', label: 'US / AC', gate: 'G6' },
                { id: 'S7', label: 'Planes B/C/D + UI', gate: 'G7' },
            ] },
            { id: 'C', title: 'Breakdown', stages: [
                { id: 'S8', label: 'WBS', gate: 'G8' },
                { id: 'S9', label: 'BIP / FIP', gate: 'G9' },
                { id: 'S10', label: 'SCN', gate: 'G10' },
            ] },
            { id: 'D', title: 'Delivery', stages: [
                { id: 'S11', label: 'Code', gate: 'G11' },
                { id: 'S12', label: 'Run SCN', gate: 'G12' },
                { id: 'S13', label: 'DoD', gate: 'G13' },
                { id: 'S14', label: 'Done', gate: '—' },
            ] },
        ];
    }

    crossCheckGroups(): Array<{ label: string; ids: string }> {
        return [
            { label: 'Links & provenance', ids: 'X1 · X28 · X40' },
            { label: 'Shape & identity', ids: 'X2 · X6 · X7 · X21 · X25 · X26 · X32' },
            { label: 'Traceability', ids: 'X3 · X3b · X4 · X11–X20 · X30 · X31 · X41' },
            { label: 'Packets & delivery', ids: 'X8 · X8a · X22 · X33–X39 · X42' },
            { label: 'Records & metrics', ids: 'X23 · X24 · X27 · X35 · X37' },
            { label: 'Engineering', ids: 'X5 · X9 · X9b · X10' },
            { label: 'UI', ids: 'X14 · X15' },
        ];
    }

    taskHierarchy(): Array<{ model: string; detail: string }> {
        return [
            { model: 'Epic / Feature → Story → Subtask', detail: 'subtask types: fe · be · qa · qc · pm' },
            { model: 'Epic / Feature → Task → Subtask', detail: 'task decomposition for implementation work' },
            { model: 'Epic → Bug', detail: 'defect track; no quartet required' },
        ];
    }

    manifestFacetCount(): number { return this.manifestFacets().length; }
    manifestRelationCount(): number { return this.manifestRelations().length; }
    manifestCheckCount(): number { return this.manifestChecks().length; }

    manifestSharedKeys(): number {
        const ai = new Set(this.manifestAiHeaderKeys());
        return this.manifestHumanHeaderKeys().filter((key) => ai.has(key)).length;
    }

    manifestPreview(): string {
        return JSON.stringify({
            enabled: this.manifestEnabled(),
            path: this.manifestPath(),
            human_header: this.manifestHumanHeaderKeys(),
            ai_header: this.manifestAiHeaderKeys(),
            facets: this.manifestFacets(),
            relations: this.manifestRelations(),
            checks: this.manifestChecks(),
        }, null, 2);
    }

    toggleManifestHumanHeader(key: string): void {
        this.manifestHumanHeaderKeys.update((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
    }

    toggleManifestAiHeader(key: string): void {
        this.manifestAiHeaderKeys.update((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
    }

    toggleManifestFacet(facet: string): void {
        this.manifestFacets.update((items) => items.includes(facet) ? items.filter((item) => item !== facet) : [...items, facet]);
    }

    toggleManifestRelation(relation: string): void {
        this.manifestRelations.update((items) => items.includes(relation) ? items.filter((item) => item !== relation) : [...items, relation]);
    }

    toggleManifestCheck(check: string): void {
        this.manifestChecks.update((items) => items.includes(check) ? items.filter((item) => item !== check) : [...items, check]);
    }

    artifactModelRows(): Array<{ label: string; value: string }> {
        return [
            { label: 'Facets', value: 'kind · origin · custodian · liveness · kt-state · owner' },
            { label: 'Relations', value: 'derived_from · owns-kinds · blocks' },
            { label: 'Authority', value: 'derived if derived_from; source if human or approved; else derived' },
            { label: 'Tiers', value: 'standard · template · instance · ledger · render' },
            { label: 'Owner rule', value: 'if missing/wrong, who is asked — not who writes' },
        ];
    }

    knowledgeTrace(): Array<{ label: string; value: string }> {
        switch (this.selectedKnowledgeTopic()) {
            case 'pipeline':
            case 'preflight':
            case 'go-no-go':
            case 'pipeline-contract':
            case 'build-enforcement':
                return [
                    { label: 'Pain', value: 'P4 — decision before build' },
                    { label: 'Goal', value: 'G-K — verdict before write' },
                    { label: 'Objective', value: 'No objective registered — gap to close' },
                    { label: 'BRD', value: 'BR-10 · BR-11 · BR-12' },
                    { label: 'PRD', value: 'F-09 · F-10 · F-11' },
                ];
            case 'document-status':
            case 'cross-check':
                return [
                    { label: 'Pain', value: 'P7 — knowledge sufficiency' },
                    { label: 'Goal', value: 'G-G artifacts · G-H sufficiency · G-Q HUMAN/AI' },
                    { label: 'Objective', value: 'No dedicated objective yet — gap to close' },
                    { label: 'BRD', value: 'BR-14 · BR-15 · BR-16 · BR-17' },
                    { label: 'PRD', value: 'F-14 · F-15 · F-27' },
                ];
            case 'quartet':
                return [
                    { label: 'Pain', value: 'No direct product pain registered' },
                    { label: 'Goal', value: 'No direct goal; task taxonomy is provider-facing' },
                    { label: 'Objective', value: 'Not registered' },
                    { label: 'BRD', value: 'BR-05 · BR-15' },
                    { label: 'PRD', value: 'F-33 provider sync' },
                ];
            case 'agent-manifests':
                return [
                    { label: 'Pain', value: 'P7 — artifact sufficiency · P8 HUMAN/AI docs' },
                    { label: 'Goal', value: 'G-G visible artifacts · G-H content · G-Q HUMAN/AI' },
                    { label: 'Objective', value: 'No dedicated objective yet — gap to close' },
                    { label: 'BRD', value: 'BR-14 · BR-16 · BR-17' },
                    { label: 'PRD', value: 'F-14 · F-15 · F-27' },
                ];
            case 'knowledge-base':
                return [
                    { label: 'Pain', value: 'P7 — artifact sufficiency' },
                    { label: 'Goal', value: 'G-G visible · G-H content · G-I transfer · G-N freshness' },
                    { label: 'Objective', value: 'No dedicated objective yet — gap to close' },
                    { label: 'BRD', value: 'BR-14 · BR-16 · BR-17 · BR-18' },
                    { label: 'PRD', value: 'F-14 · F-15 · F-17 · F-27' },
                ];
            case 'docgraph':
                return [
                    { label: 'Pain', value: 'P2 architecture · P7 knowledge' },
                    { label: 'Goal', value: 'G-B1/G-B2 · G-H' },
                    { label: 'Objective', value: 'No dedicated objective yet — gap to close' },
                    { label: 'BRD', value: 'BR-17 · BR-18' },
                    { label: 'PRD', value: 'F-20 · F-21' },
                ];
            case 'providers':
                return [
                    { label: 'Pain', value: 'P1 host portability · P7 knowledge' },
                    { label: 'Goal', value: 'G-C additive · G-G ownership' },
                    { label: 'Objective', value: 'O-8 stack/host · provider binding pending' },
                    { label: 'BRD', value: 'BR-18 · BR-31' },
                    { label: 'PRD', value: 'F-22 · F-33' },
                ];
            default:
                return [];
        }
    }

    diagramSrc(): string {
        if (this.openDiagram() === 'cr') return 'assets/diagrams/02.cr-pipeline.png';
        if (this.openDiagram() === 'intent') return 'assets/diagrams/03.intent-pipeline.png';
        if (this.openDiagram() === 'workers') return 'assets/diagrams/that-tinh-tran-diagram.svg';
        return 'assets/diagrams/01.main-pipeline.png';
    }

    diagramTitle(): string {
        if (this.openDiagram() === 'cr') return 'CR pipeline';
        if (this.openDiagram() === 'intent') return 'Intent pipeline';
        if (this.openDiagram() === 'workers') return 'Seven-Star Formation';
        return 'Main SDLC pipeline';
    }

    selectedPipelineLabel(): string {
        return this.pipelineOptions.find((pipeline) => pipeline.id === this.sdlcPipeline())?.label || 'Custom pipeline';
    }

    pipelineHint(): string {
        switch (this.sdlcPipeline()) {
            case 'ba-dev': return 'Requirements → implementation';
            case 'dev-qc': return 'Implementation → verification';
            case 'qc': return 'Verification only';
            default: return '14 stages · 13 gates';
        }
    }

    referenceSummary(): Array<{ id: string; label: string; count: number; lastSyncedAt: string | null }> {
        const groups = new Map<string, any[]>();
        for (const record of this.knowledgeProviderRecords()) {
            const list = groups.get(record.provider_id) || [];
            list.push(record);
            groups.set(record.provider_id, list);
        }
        return [...groups.entries()].map(([id, records]) => {
            const plugin = this.consumerPlugins().find((item) => item.id === id);
            const dates = records.map((record) => record.synced_at).filter(Boolean).sort();
            return {
                id,
                label: plugin?.label || id,
                count: records.length,
                lastSyncedAt: dates.length ? new Date(dates[dates.length - 1]).toLocaleString() : null,
            };
        });
    }

    providerRouteSummary(): string {
        const routing = this.providerRouting();
        const selected = [routing.work, routing.design, routing.content].filter((value) => value !== 'md');
        return selected.length === 0 ? 'Files (.md)' : selected.join(' · ');
    }

    governanceEnabledCount(): number {
        return [this.documentStatusRequired(), this.openRegisterRequired(), this.crossCheckRequired(), this.buildEnforcementRequired(), this.preflightRequired(), this.goNoGoRequired(), this.pipelineContractRequired()].filter(Boolean).length;
    }

    showKnowledgeSection(section: 'overview' | 'sources' | 'contract' | 'index' | 'manifest'): void {
        this.knowledgeSection.set(section);
        if (section === 'contract') this.selectedKnowledgeTopic.set('pipeline');
        if (section === 'manifest') this.selectedKnowledgeTopic.set('agent-manifests');
        if (section === 'sources') this.selectedKnowledgeTopic.set('knowledge-base');
    }

    selectKnowledgeTopic(topic: string): void {
        this.selectedKnowledgeTopic.set(topic);
    }

    knowledgeDetail(): { eyebrow: string; title: string; description: string; items: Array<{ label: string; value: string }> } {
        switch (this.selectedKnowledgeTopic()) {
            case 'document-status':
                return {
                    eyebrow: 'Governance · document status',
                    title: 'Document status register',
                    description: 'The register is a precondition, not a report. Without it, "documented" is an opinion.',
                    items: [
                        { label: 'Levels', value: 'exists · conforms · connected' },
                        { label: 'Lifecycle', value: 'raw → proposed → approved → retired' },
                        { label: 'Marks', value: 'OK · P (gap named) · OUT (reason) · — (nothing)' },
                        { label: 'Why', value: 'Every downstream gate reads the register.' },
                    ],
                };
            case 'open-register':
                return {
                    eyebrow: 'Governance · open register',
                    title: 'OPEN register',
                    description: 'The single place for questions that are not decided. A missing register means unknowns become opinions.',
                    items: [
                        { label: 'Contains', value: 'open id · question · owner · what unblocks · decision link' },
                        { label: 'Rule', value: 'No OPEN item without an owner and a decision path.' },
                        { label: 'Close', value: 'A decision closes it; the decision must cite the open id.' },
                        { label: 'Status', value: 'OPEN · DECIDED · DROPPED (reason)' },
                    ],
                };
            case 'build-enforcement':
                return {
                    eyebrow: 'Governance · build enforcement',
                    title: 'Build enforcement',
                    description: 'A standard without enforcement is advice. E1–E10 make the gates bite before code.',
                    items: [
                        { label: 'E-series', value: 'E1…E10: packet, test-first, gate machine, verify, audit, human Done' },
                        { label: 'Ready', value: 'Only READY packets build; READY-SPLIT/DRAFT/OPEN do not.' },
                        { label: 'Fail', value: 'Build stops with a named OPEN id and owner.' },
                        { label: 'Evidence', value: 'Independent verify + audit; agent never signs Done.' },
                    ],
                };
            case 'cross-check':
                return {
                    eyebrow: 'Governance · cross-check',
                    title: 'Cross-check catalogue',
                    description: 'A status claim is invalid unless the catalogue passes. The current source title says 29; the table contains 47 checks — that discrepancy must be reconciled.',
                    items: [
                        { label: 'Catalogue', value: 'X1…X42 · 47 checks' },
                        { label: 'Links', value: 'X1 · X28 · X40' },
                        { label: 'Trace & shape', value: 'X3 · X4 · X7 · X8a · X11–X20' },
                        { label: 'Delivery', value: 'X8 · X22 · X33–X39 · X42' },
                        { label: 'UI', value: 'X14 prototype · X15 reachable flow' },
                        { label: 'Rule', value: 'Missing check = no status claim.' },
                    ],
                };
            case 'preflight':
                return {
                    eyebrow: 'Governance · preflight',
                    title: 'Preflight before a slice',
                    description: 'Checks one slice before implementation. It is narrower than Go/No-Go, which covers the whole increment.',
                    items: [
                        { label: 'Scope', value: 'one slice / one work package' },
                        { label: 'Reads', value: 'document status · BIP/FIP · SCN · marks' },
                        { label: 'Pass', value: 'all required slots OK or P with an open id' },
                        { label: 'Fail', value: 'no work proceeds; gap must be named' },
                    ],
                };
            case 'go-no-go':
                return {
                    eyebrow: 'Governance · go / no-go',
                    title: 'Go / No-Go for an increment',
                    description: 'Dashboard over the whole increment. It answers what blocks the epic — not what blocks one slice.',
                    items: [
                        { label: 'Scope', value: 'increment / epic' },
                        { label: 'Requires', value: 'register exists + X checks run with a date' },
                        { label: 'Marks', value: 'OK · P with open_id · OUT with reason · — blocks' },
                        { label: 'Docs Ready', value: 'REQ ∩ US/AC ∩ SCN ∩ IF ∩ DATA' },
                        { label: 'Packets', value: 'BIP for be · FIP for fe · mixed needs both' },
                    ],
                };
            case 'pipeline-contract':
                return {
                    eyebrow: 'Governance · pipeline contract',
                    title: 'Pipeline contract',
                    description: 'The contract makes each stage consume the previous stage by reference. Gates are document conditions, not task-tool statuses.',
                    items: [
                        { label: 'Stages', value: 'S1 Requirements → S14 Done' },
                        { label: 'Gates', value: 'G1…G13' },
                        { label: 'Authority', value: 'REQ → US/AC → WBS → BIP/FIP → SCN → code' },
                        { label: 'Change', value: 'CR reopens the affected earlier stage; it never reverses authority' },
                        { label: 'Done', value: 'human signs; agent never signs Done' },
                    ],
                };
            case 'quartet':
                return {
                    eyebrow: 'Task management · quartet',
                    title: 'Task quartet',
                    description: 'Decomposition of a task into test-first work. It is a work structure, not a provider feature.',
                    items: [
                        { label: 'Standard', value: 'tdd-unit · tdd-impl · tdd-coverage · tdd-qc' },
                        { label: 'Extended', value: 'add tdd-load · tdd-stress for runtime slices' },
                        { label: 'BA', value: 'OUT when acceptance criteria are already clear' },
                        { label: 'Provider', value: 'Jira · repo · another task tool — optional' },
                        { label: 'Rule', value: 'Quartet does not depend on task provider.' },
                    ],
                };
            case 'agent-manifests':
                return {
                    eyebrow: 'Knowledge · agent manifest',
                    title: 'Agent manifest standard',
                    description: 'A machine-readable map of this consumer\'s documents: identity, header shape, facets, relations, paths, and checks. The agent reads the manifest instead of crawling the tree.',
                    items: [
                        { label: 'Identity', value: 'consumer · root · manifest_version' },
                        { label: 'Documents', value: 'path · id · kind · status · owner · representation' },
                        { label: 'Kinds', value: 'HUMAN 8 keys · AI 8 keys · required sections · owner' },
                        { label: 'Relations', value: 'derived_from · source_of_truth · human_sot · blocks · owns_kinds · references' },
                        { label: 'Paths', value: 'relative locators, never identity' },
                        { label: 'Checks', value: 'links resolve · header shape · derived ⊆ source · no orphan · owner exists' },
                        { label: 'Study reference', value: 'sdlc/01.agent-manifests is an eso-harness sample, not testeso data' },
                    ],
                };
            case 'knowledge-base':
                return {
                    eyebrow: 'Knowledge · base',
                    title: 'Knowledge base',
                    description: 'Artifacts held for the consumer, classified by kind and representation.',
                    items: [
                        { label: 'Facets', value: 'kind · origin · custodian · liveness · kt-state · owner' },
                        { label: 'Add', value: 'representation: human / agent / machine' },
                        { label: 'WBS', value: 'WBS tree · WBS dictionary · atomic work package' },
                        { label: 'Rule', value: '100% rule; leaf owns AC; no orphan work' },
                        { label: 'No copy', value: 'derived ⊆ source' },
                    ],
                };
            case 'docgraph':
                return {
                    eyebrow: 'Knowledge · document graph',
                    title: 'Document graph',
                    description: 'A derived index of relationships. It never owns document content.',
                    items: [
                        { label: 'Indexes', value: 'docs · sdlc · agents · external refs' },
                        { label: 'Owns', value: 'edges + provenance, not content' },
                        { label: 'Scope', value: 'docs/**, sdlc/**, agents/**' },
                        { label: 'Excludes', value: 'generated files and provider copies by default' },
                    ],
                };
            case 'providers':
                return {
                    eyebrow: 'Knowledge · providers',
                    title: 'Optional providers',
                    description: 'Jira, Notion, Confluence, Figma are sources of truth only for the kinds they declare.',
                    items: [
                        { label: 'Jira', value: 'task · story · bug' },
                        { label: 'Notion / Confluence', value: 'knowledge · documents' },
                        { label: 'Figma', value: 'design · artifacts' },
                        { label: 'Rule', value: 'one SoT per kind; sync one-way; no two-way' },
                    ],
                };
            default:
                return {
                    eyebrow: 'Project mode · pipeline',
                    title: 'SDLC pipeline',
                    description: 'Fourteen stages and thirteen gates. Apply the full pipeline or a subset; CR reopens the affected stage.',
                    items: [
                        { label: 'Intent', value: 'P1–P8 → mission/vision → goals → BRD/PRD → FRD/SRS → US/AC' },
                        { label: 'Stages', value: 'S1…S14 · 14 stages' },
                        { label: 'Phase folders', value: '12.phases/phase-1…n · global vs phase' },
                        { label: 'A · requirements', value: 'S1 pain/vision · S2 BRD · S3 PRD · S4 FRD · S5 SRS' },
                        { label: 'B · criteria', value: 'S6 US/AC · S7 planes B/C/D + UI' },
                        { label: 'C · breakdown', value: 'S8 WBS · S9 BIP/FIP · S10 SCN' },
                        { label: 'D · delivery', value: 'S11 code · S12 run SCN · S13 DoD · S14 Done' },
                        { label: 'Gates', value: 'G1…G13 · document conditions, not task status' },
                        { label: 'Preconditions', value: 'P0.1 SDLC root · P0.3 document status · P0.6 gate instruments' },
                        { label: 'CR', value: 'reopens S6 / S7 / S8 / S11; authority never reverses' },
                        { label: 'Done', value: 'human signs; agent is forbidden' },
                    ],
                };
        }
    }

    quartetTypes(): Array<{ id: string; label: string; note: string; included: boolean }> {
        const extended = this.quartetProfile() === 'extended';
        return [
            { id: 'tdd-unit', label: 'unit', note: 'test first', included: true },
            { id: 'tdd-impl', label: 'impl', note: 'DEV', included: true },
            { id: 'tdd-coverage', label: 'coverage', note: 'gate', included: true },
            { id: 'tdd-qc', label: 'qc', note: 'SCN + evidence', included: true },
            { id: 'tdd-load', label: 'load', note: 'extended', included: extended },
            { id: 'tdd-stress', label: 'stress', note: 'extended', included: extended },
            { id: 'tdd-ba', label: 'ba', note: 'OUT when AC clear', included: false },
        ];
    }

    toggleArtifactKind(kind: string): void {
        this.artifactKinds.update((kinds) => kinds.includes(kind) ? kinds.filter((item) => item !== kind) : [...kinds, kind]);
    }

    toggleRepresentation(representation: string): void {
        this.representations.update((items) => items.includes(representation) ? items.filter((item) => item !== representation) : [...items, representation]);
    }

    toggleEvent(id: string): void { this.events.set(this.events().includes(id) ? this.events().filter((event) => event !== id) : [...this.events(), id]); }

    refreshObservations(): void { this.loadObservations(true); }

    loadObservations(force = false): void {
        if (this.observationsLoading()) return;
        if (this.observationsLoaded && !force) return;
        this.observationsLoading.set(true);
        this.observationsError.set(null);
        this.service.getObservations(this.consumerId)
            .then((items) => {
                this.observations.set([...items].sort((left, right) => this.observationTime(right) - this.observationTime(left)));
                this.observationsLoaded = true;
            })
            .catch((err) => this.observationsError.set(err?.detail || err?.message || 'Could not load observations'))
            .finally(() => this.observationsLoading.set(false));
    }

    private observationTime(observation: ObservationDto): number {
        const time = new Date(observation.at || observation.receivedAt).getTime();
        return Number.isFinite(time) ? time : 0;
    }

    evidenceText(evidence: unknown): string {
        try { return JSON.stringify(evidence ?? null, null, 2); } catch { return String(evidence); }
    }

    private pruneWorkerBindings(): void {
        const valid = new Set(this.hostProfiles().map((profile) => profile.id));
        this.formationHostIds.update((ids) => ids.filter((id) => valid.has(id)));
        this.workers.update((workers) => workers.map((worker) => ({
            ...worker,
            hostBindingIds: worker.hostBindingIds.filter((id) => valid.has(id)),
        })));
    }

    private loadKnowledgeIndex(id: string): void {
        this.service.getKnowledge(id)
            .then((summary) => this.knowledgeSummary.set(summary))
            .catch(() => this.knowledgeSummary.set(null));
        this.loadKnowledgeDetails(id);
    }

    loadKnowledgeDetails(id: string): void {
        this.service.getKnowledgeDocs(id, this.knowledgeQuery())
            .then((docs) => this.knowledgeDocs.set(docs))
            .catch(() => this.knowledgeDocs.set([]));
        this.service.getKnowledgeFindings(id)
            .then((findings) => this.knowledgeFindings.set(findings))
            .catch(() => this.knowledgeFindings.set([]));
        this.service.getKnowledgeEmbeddings(id)
            .then((status) => this.knowledgeEmbeddingStatus.set(status))
            .catch(() => this.knowledgeEmbeddingStatus.set(null));
    }

    selectKnowledgeDoc(doc: KnowledgeDocDto): void {
        const profile = this.current();
        if (!profile) return;
        this.service.getKnowledgeDoc(profile.id, doc.doc_id)
            .then((detail) => this.knowledgeDocDetail.set(detail))
            .catch(() => this.knowledgeDocDetail.set(null));
    }

    searchKnowledge(): void {
        const profile = this.current();
        if (!profile) return;
        const query = this.knowledgeQuery().trim();
        if (!query) {
            this.knowledgeRetrieval.set(null);
            this.loadKnowledgeDetails(profile.id);
            return;
        }
        this.service.retrieveKnowledge(profile.id, query)
            .then((result) => this.knowledgeRetrieval.set(result))
            .catch(() => this.knowledgeRetrieval.set(null));
    }

    embedKnowledge(): void {
        const profile = this.current();
        if (!profile || this.knowledgeEmbedding()) return;
        this.knowledgeEmbedding.set(true);
        this.service.embedKnowledge(profile.id)
            .then(() => this.loadKnowledgeDetails(profile.id))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Embedding failed'))
            .finally(() => this.knowledgeEmbedding.set(false));
    }

    runKnowledgeCheck(): void {
        const profile = this.current();
        if (!profile || this.knowledgeChecking()) return;
        this.knowledgeChecking.set(true);
        this.service.checkKnowledge(profile.id)
            .then((result) => this.knowledgeCheck.set(result))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Knowledge check failed'))
            .finally(() => this.knowledgeChecking.set(false));
    }

    indexKnowledge(): void {
        const profile = this.current();
        if (!profile || this.knowledgeIndexing()) return;
        this.knowledgeIndexing.set(true);
        this.error.set(null);
        this.service.indexKnowledge(profile.id)
            .then((summary) => {
                this.knowledgeSummary.set(summary);
                this.loadKnowledgeDetails(profile.id);
                this.saved.set(true);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Knowledge index failed'))
            .finally(() => this.knowledgeIndexing.set(false));
    }

    private loadWorkerFiles(id: string): void {
        Promise.all([
            this.service.getWorkers(id).catch(() => null),
            this.service.getWorkerPlacement(id).catch(() => [] as WorkerPlacementDto[]),
        ])
            .then(([config, placements]) => {
                if (config && Array.isArray(config.workers) && config.workers.length > 0) {
                    this.workers.set(config.workers.map((worker) => this.normalizeWorker(worker)));
                    // Defensive default: if the server has no deployment association yet, show the
                    // configured formation so the Deployment selector is never silently empty.
                    const formationIds = this.validFormationHostIds();
                    if (formationIds.length > 0 && this.workers().every((worker) => worker.hostBindingIds.length === 0)) {
                        this.applyFormationHosts();
                    }
                }
                this.applyWorkerPlacements(placements);
                this.pruneWorkerBindings();
                this.loadWorkerImports();
            })
            .catch(() => {
                // No worker files yet; the default formation remains visible.
            });
    }

    private applyWorkerPlacements(placements: WorkerPlacementDto[]): void {
        const saved: Record<string, WorkerPlacementDto> = {};
        for (const placement of placements) {
            if (placement && typeof placement.workerId === 'string' && placement.workerId) {
                saved[placement.workerId] = this.normalizePlacement(placement);
            }
        }
        this.workerPlacements.set(saved);
        // Pre-seed every worker's draft so template reads keep a stable object identity between
        // change-detection passes (a new object per pass loops Material select writeValue).
        const drafts: Record<string, WorkerPlacementDto> = {};
        for (const worker of this.workers()) drafts[worker.id] = saved[worker.id] || this.defaultPlacement(worker.id);
        this.placementDrafts.set(drafts);
        this.placementNotice.set('');
        this.placementError.set('');
    }

    private normalizePlacement(placement: WorkerPlacementDto): WorkerPlacementDto {
        const tiers: WorkerModelTier[] = ['fast', 'balanced', 'reasoning'];
        const fallbacks: WorkerPlacementFallback[] = ['block', 'next-host', 'next-tier'];
        const nativeAgent: Record<string, string> = {};
        if (placement.nativeAgent && typeof placement.nativeAgent === 'object') {
            for (const [hostId, agent] of Object.entries(placement.nativeAgent)) {
                if (typeof agent === 'string' && agent.trim()) nativeAgent[hostId] = agent.trim();
            }
        }
        return {
            workerId: placement.workerId,
            allowedHosts: Array.isArray(placement.allowedHosts) ? placement.allowedHosts.filter((hostId): hostId is string => typeof hostId === 'string' && hostId.length > 0) : [],
            modelTier: tiers.includes(placement.modelTier) ? placement.modelTier : 'balanced',
            nativeAgent,
            fallback: fallbacks.includes(placement.fallback) ? placement.fallback : 'block',
        };
    }

    private readonly placementDefaults = new Map<string, WorkerPlacementDto>();

    private defaultPlacement(workerId: string): WorkerPlacementDto {
        const cached = this.placementDefaults.get(workerId);
        if (cached) return cached;
        const created: WorkerPlacementDto = { workerId, allowedHosts: [], modelTier: 'balanced', nativeAgent: {}, fallback: 'block' };
        this.placementDefaults.set(workerId, created);
        return created;
    }

    placementDraftFor(workerId: string): WorkerPlacementDto {
        return this.placementDrafts()[workerId] || this.workerPlacements()[workerId] || this.defaultPlacement(workerId);
    }

    private placementSignature(placement: WorkerPlacementDto): string {
        return JSON.stringify({
            allowedHosts: [...placement.allowedHosts].sort(),
            modelTier: placement.modelTier,
            fallback: placement.fallback,
            nativeAgent: Object.entries(placement.nativeAgent)
                .filter(([hostId]) => placement.allowedHosts.includes(hostId))
                .sort(([left], [right]) => left.localeCompare(right)),
        });
    }

    placementDirty(workerId: string): boolean {
        const saved = this.workerPlacements()[workerId] || this.defaultPlacement(workerId);
        return this.placementSignature(this.placementDraftFor(workerId)) !== this.placementSignature(saved);
    }

    placementSummary(workerId: string): string {
        const saved = this.workerPlacements()[workerId];
        if (!saved) return 'No placement';
        if (saved.allowedHosts.length === 0) return `Not placed · ${saved.modelTier}`;
        return `${saved.allowedHosts.length} runtime${saved.allowedHosts.length === 1 ? '' : 's'} · ${saved.modelTier}`;
    }

    private patchPlacementDraft(workerId: string, patch: Partial<WorkerPlacementDto>): void {
        this.placementDrafts.update((drafts) => ({
            ...drafts,
            [workerId]: { ...this.placementDraftFor(workerId), ...patch, workerId },
        }));
        this.placementNotice.set('');
        this.placementError.set('');
    }

    setPlacementHosts(workerId: string, allowedHosts: string[]): void {
        const current = this.placementDraftFor(workerId);
        const nativeAgent: Record<string, string> = {};
        for (const runtimeKey of allowedHosts) {
            const agent = current.nativeAgent[runtimeKey];
            if (agent) nativeAgent[runtimeKey] = agent;
        }
        this.patchPlacementDraft(workerId, { allowedHosts: [...allowedHosts], nativeAgent });
    }

    setPlacementModelTier(workerId: string, tier: WorkerModelTier): void {
        this.patchPlacementDraft(workerId, { modelTier: tier });
    }

    setPlacementFallback(workerId: string, fallback: WorkerPlacementFallback): void {
        this.patchPlacementDraft(workerId, { fallback });
    }

    setNativeAgent(workerId: string, runtimeKey: string, value: string): void {
        const nativeAgent = { ...this.placementDraftFor(workerId).nativeAgent };
        if (value.trim()) nativeAgent[runtimeKey] = value.trim();
        else delete nativeAgent[runtimeKey];
        this.patchPlacementDraft(workerId, { nativeAgent });
    }

    resetPlacement(workerId: string): void {
        this.placementDrafts.update((drafts) => {
            const next = { ...drafts };
            delete next[workerId];
            return next;
        });
        this.placementNotice.set('');
        this.placementError.set('');
    }

    savePlacement(workerId: string): void {
        if (this.placementSaving()) return;
        const placement: WorkerPlacementDto = { ...this.placementDraftFor(workerId), workerId };
        this.placementSaving.set(true);
        this.placementNotice.set('');
        this.placementError.set('');
        this.service.saveWorkerPlacement(this.consumerId, workerId, placement)
            .then((saved) => {
                const normalized = this.normalizePlacement({ ...placement, ...saved, workerId });
                this.workerPlacements.update((placements) => ({ ...placements, [workerId]: normalized }));
                this.placementDrafts.update((drafts) => {
                    const next = { ...drafts };
                    delete next[workerId];
                    return next;
                });
                this.placementNotice.set(`Host placement saved for ${this.workerName(workerId)}.`);
            })
            .catch((err) => this.placementError.set(err?.detail || err?.message || 'Could not save host placement'))
            .finally(() => this.placementSaving.set(false));
    }

    openHosts(): void {
        void this.router.navigate(['/hosts']);
    }

    loadMigrationPreview(): void {
        if (this.migrationLoading()) return;
        this.migrationLoading.set(true);
        this.service.previewHarnessMigration(this.consumerId)
            .then((preview) => this.migrationPreview.set(preview))
            .catch(() => this.migrationPreview.set(null))
            .finally(() => this.migrationLoading.set(false));
    }

    resolveMigrationConflict(entryId: string, strategy: 'keep-eso' | 'adopt-legacy'): void {
        if (strategy === 'adopt-legacy' && !window.confirm('Adopt legacy will overwrite the canonical file after backing it up. Continue?')) return;
        this.migrationError.set('');
        this.migrationNotice.set('');
        this.service.resolveMigrationConflict(this.consumerId, entryId, strategy)
            .then((result) => {
                this.migrationPreview.set(result.preview);
                this.migrationNotice.set(result.backupPath ? `Conflict resolved (${strategy}); canonical backup: ${result.backupPath}.` : `Conflict resolved (${strategy}).`);
            })
            .catch((err) => this.migrationError.set(err?.detail || err?.message || 'Could not resolve migration conflict'));
    }

    previewHarnessMigration(): void {
        if (this.migrationLoading() || this.migrationApplying()) return;
        this.migrationLoading.set(true);
        this.migrationError.set('');
        this.migrationNotice.set('');
        this.service.previewHarnessMigration(this.consumerId)
            .then((preview) => {
                this.migrationPreview.set(preview);
                if (!preview.detected) this.migrationNotice.set('No legacy host assets found.');
                else if (!preview.entries.some((entry) => entry.status === 'new' || entry.status === 'conflict')) this.migrationNotice.set('Legacy host assets already match ESO canonical; nothing to migrate.');
            })
            .catch((err) => this.migrationError.set(err?.detail || err?.message || 'Could not preview migration'))
            .finally(() => this.migrationLoading.set(false));
    }

    applyHarnessMigration(): void {
        if (this.migrationApplying()) return;
        this.migrationApplying.set(true);
        this.migrationError.set('');
        this.migrationNotice.set('');
        this.service.applyHarnessMigration(this.consumerId)
            .then((result) => {
                this.migrationNotice.set(`Migration applied: ${result.applied.length} new, ${result.skipped.length} unchanged/conflict kept. Manifest: ${result.manifestPath}.`);
                this.migrationPreview.set(null);
                this.refreshLegacyHarness();
                this.loadMigrationPreview();
            })
            .catch((err) => this.migrationError.set(err?.detail || err?.message || 'Could not apply migration'))
            .finally(() => this.migrationApplying.set(false));
    }

    finishWithoutMigration(): void {
        this.finishPrompt.set(false);
        this.finishing.set(false);
        this.legacyNotice.set('Settings saved. Finish blocked: legacy harness remains. Migrate it when ready, then Finish again.');
    }

    finishWithMigration(): void {
        if (this.finishing()) return;
        this.finishing.set(true);
        this.migrationError.set('');
        this.service.applyHarnessMigration(this.consumerId)
            .then(() => this.provisionAndLeave())
            .catch((err) => {
                this.migrationError.set(err?.detail || err?.message || 'Could not migrate before finish');
                this.finishing.set(false);
            });
    }

    private provisionAndLeave(): void {
        this.service.provision(this.consumerId)
            .then(() => this.router.navigate(['/consumers', this.consumerId]))
            .catch((err) => {
                this.error.set(err?.detail || err?.message || 'Could not provision consumer');
                this.finishing.set(false);
            });
    }

    private completeFinish(): void {
        Promise.all([
            this.service.getLegacyHarness(this.consumerId),
            this.service.previewHarnessMigration(this.consumerId),
        ])
            .then(([legacy, migration]) => {
                this.legacyHarness.set(legacy);
                this.migrationPreview.set(migration);
                if (migration.entries.some((entry) => entry.status === 'conflict')) {
                    this.error.set('Resolve migration conflicts before finishing.');
                    this.finishing.set(false);
                    return;
                }
                const pendingMigration = migration.entries.some((entry) => entry.status === 'new');
                if (legacy.detected || pendingMigration) {
                    this.finishPrompt.set(true);
                    this.finishing.set(false);
                    return;
                }
                this.provisionAndLeave();
            })
            .catch((err) => {
                this.error.set(err?.detail || err?.message || 'Could not inspect legacy harness before finish');
                this.finishing.set(false);
            });
    }

    loadBoundaries(): void {
        this.service.getBoundaries(this.consumerId)
            .then((view) => { this.boundaryPolicies.set(view.policies); this.boundaryGrants.set(view.grants); this.boundaryEnforcement.set(view.enforcement); })
            .catch((err) => this.boundaryError.set(err?.detail || err?.message || 'Could not load boundaries'));
    }

    updateBoundary(index: number, field: keyof FolderPolicyDto, value: unknown): void {
        this.boundaryPolicies.update((policies) => policies.map((policy, i) => i === index ? { ...policy, [field]: value } : policy));
    }

    addBoundary(): void {
        this.boundaryPolicies.update((policies) => [...policies, {
            id: `policy-${Date.now()}`, path: '', pathType: 'glob', read: 'deny', write: 'deny', index: false, priority: 50,
        }]);
    }

    removeBoundary(index: number): void {
        this.boundaryPolicies.update((policies) => policies.filter((_, i) => i !== index));
    }

    saveBoundaries(): void {
        if (this.boundarySaving()) return;
        this.boundarySaving.set(true);
        this.boundaryError.set('');
        this.boundaryNotice.set('');
        this.service.saveBoundaries(this.consumerId, this.boundaryPolicies(), this.boundaryEnforcement())
            .then((view) => { this.boundaryPolicies.set(view.policies); this.boundaryGrants.set(view.grants); this.boundaryEnforcement.set(view.enforcement); this.boundaryNotice.set('Boundaries saved.'); })
            .catch((err) => this.boundaryError.set(err?.detail || err?.message || 'Could not save boundaries'))
            .finally(() => this.boundarySaving.set(false));
    }

    createBoundaryGrant(): void {
        this.boundaryError.set('');
        this.service.createBoundaryGrant(this.consumerId, {
            kind: this.grantKind(), targetPrefix: this.grantTarget().trim(), mode: this.grantKind() === 'write' ? 'once' : this.grantMode(),
        }).then(() => { this.grantTarget.set(''); this.loadBoundaries(); })
            .catch((err) => this.boundaryError.set(err?.detail || err?.message || 'Could not create grant'));
    }

    revokeBoundaryGrant(grantId: string): void {
        this.service.revokeBoundaryGrant(this.consumerId, grantId)
            .then(() => this.loadBoundaries())
            .catch((err) => this.boundaryError.set(err?.detail || err?.message || 'Could not revoke grant'));
    }

    refreshLegacyHarness(): void {
        if (this.legacyLoading()) return;
        this.legacyLoading.set(true);
        this.legacyError.set('');
        this.service.getLegacyHarness(this.consumerId)
            .then((report) => this.legacyHarness.set(report))
            .catch((err) => this.legacyError.set(err?.detail || err?.message || 'Could not inspect legacy harness'))
            .finally(() => this.legacyLoading.set(false));
    }

    archiveLegacyHarness(): void {
        if (this.legacyArchiving()) return;
        this.legacyArchiving.set(true);
        this.legacyError.set('');
        this.service.archiveLegacyHarness(this.consumerId)
            .then((result) => {
                this.legacyArchiveConfirm.set(false);
                this.legacyNotice.set(`Legacy harness archived to ${result.archivePath}.`);
                this.legacyHarness.set({ consumerId: result.consumerId, detected: false, entries: [], archivePath: null });
            })
            .catch((err) => this.legacyError.set(err?.detail || err?.message || 'Could not archive legacy harness'))
            .finally(() => this.legacyArchiving.set(false));
    }

    evaluateJev(): void {
        const confidence = Number(this.jevConfidence());
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            this.jevDecisionError.set('Confidence must be between 0 and 1.');
            return;
        }
        this.jevDecisionLoading.set(true);
        this.jevDecisionError.set('');
        this.service.decideJev(this.consumerId, confidence)
            .then((decision) => this.jevDecision.set(decision))
            .catch((err) => this.jevDecisionError.set(err?.detail || err?.message || 'Could not evaluate JEV decision'))
            .finally(() => this.jevDecisionLoading.set(false));
    }

    runJudgment(): void {
        this.judgmentError.set('');
        let body: Record<string, unknown>;
        try {
            body = JSON.parse(this.judgmentInput());
        } catch {
            this.judgmentError.set('Verdict input must be valid JSON.');
            return;
        }
        this.judgmentLoading.set(true);
        this.service.evaluateSufficiency(this.consumerId, body)
            .then((result) => this.judgmentResult.set(result))
            .catch((err) => this.judgmentError.set(err?.detail || err?.message || 'Could not compute verdict'))
            .finally(() => this.judgmentLoading.set(false));
    }

    save(navigateAfter = false): void {
        const profile = this.current();
        if (!profile) return;
        this.saving.set(true); this.saved.set(false); this.error.set(null);
        if (this.jevMode() !== 'off' && !this.consent()) { this.saving.set(false); this.error.set('JEV shadow/active requires observation consent.'); return; }
        const auto = this.jevAutoThreshold().trim() === '' ? undefined : Number(this.jevAutoThreshold());
        const confirm = this.jevConfirmThreshold().trim() === '' ? undefined : Number(this.jevConfirmThreshold());
        if ((auto !== undefined && (!Number.isFinite(auto) || auto < 0 || auto > 1)) || (confirm !== undefined && (!Number.isFinite(confirm) || confirm < 0 || confirm > 1))) { this.saving.set(false); this.error.set('JEV thresholds must be between 0 and 1.'); return; }
        if (auto !== undefined && confirm !== undefined && auto < confirm) { this.saving.set(false); this.error.set('JEV auto threshold must be >= confirm threshold.'); return; }
        const previous = (profile.profile || {}) as Record<string, unknown>;
        const previousSettings = (previous.settings as Record<string, unknown> | undefined) || {};
        const nextProfile: Record<string, unknown> = {
            ...previous,
            observation: { consent: this.consent(), events: this.events() },
            integration: {
                ...((previous.integration as Record<string, unknown> | undefined) || {}),
                jev: {
                    mode: this.jevMode(),
                    consent: this.consent(),
                    ...(auto !== undefined ? { autoThreshold: auto } : {}),
                    ...(confirm !== undefined ? { confirmThreshold: confirm } : {}),
                },
            },
            settings: {
                ...previousSettings,
                general: { owner: this.owner().trim(), locale: this.locale().trim(), tags: this.tags().split(',').map((tag) => tag.trim()).filter(Boolean), description: this.description().trim() },
                harness: { stack: { version: this.activeStackVersion(), status: this.stackStatus(), layers: this.stackLayers(), versions: this.stackVersions() }, hostProfiles: this.hostProfiles(), developers: this.developers(), formationHostIds: this.formationHostIds(), plugins: this.plugins() },
                jira: { enabled: this.jiraEnabled(), projectKey: this.jiraProject().trim(), syncMode: this.jiraSyncMode() },
                knowledge: {
                    sdlc: { enabled: this.sdlcEnabled(), pipeline: this.sdlcPipeline(), crProcess: this.crProcess() },
                    artifactKinds: this.artifactKinds(),
                    representations: this.representations(),
                    docgraph: { enabled: this.docgraphIndex(), scope: this.docgraphScope().trim() },
                    governance: {
                        documentStatus: this.documentStatusRequired(),
                        preflight: this.preflightRequired(),
                        goNoGo: this.goNoGoRequired(),
                        crossCheck: this.crossCheckRequired(),
                        openRegister: this.openRegisterRequired(),
                        buildEnforcement: this.buildEnforcementRequired(),
                        pipelineContract: this.pipelineContractRequired(),
                    },
                    taskQuartet: this.quartetProfile(),
                    manifest: {
                        enabled: this.manifestEnabled(),
                        path: this.manifestPath().trim(),
                        humanHeaderKeys: this.manifestHumanHeaderKeys(),
                        aiHeaderKeys: this.manifestAiHeaderKeys(),
                        facets: this.manifestFacets(),
                        relations: this.manifestRelations(),
                        checks: this.manifestChecks(),
                    },
                    providers: { jira: { enabled: this.jiraEnabled(), projectKey: this.jiraProject().trim(), syncMode: this.jiraSyncMode() }, routing: this.providerRouting() },
                },
            },
        };
        const workerConfig: WorkerConfigDto = {
            workers: this.workers().map((worker) => ({
                id: worker.id,
                name: worker.name,
                role: worker.role,
                layer: worker.layer,
                scope: worker.scope,
                status: worker.status,
                hostBindingIds: [...worker.hostBindingIds],
                capabilities: [...worker.capabilities],
                verbs: [...worker.verbs],
                bar: [...worker.bar],
                escalation: worker.escalation,
                instructions: worker.instructions || '',
                sourceFile: worker.sourceFile,
                sourceHash: worker.sourceHash,
                sourceType: worker.sourceType,
            })),
            edges: [],
            bindings: this.hostProfiles().map((binding) => ({
                id: binding.id,
                developer: binding.userId,
                hostId: binding.hostId,
                stackVersion: binding.stackVersion,
                memorySource: binding.memorySource,
                codeGraphSource: binding.codeGraphSource,
                installState: binding.installState,
            })),
        };
        this.service.saveWorkers(profile.id, workerConfig)
            .then(() => this.service.updateSettings(profile.id, this.name().trim() || profile.name, nextProfile, profile.version || 1))
            .then(async (updated) => {
                await this.service.saveStackVersions(profile.id, this.stackVersions());
                this.current.set(updated);
                this.hydrate(updated);
                this.saved.set(true);
                setTimeout(() => { this.lastSaved.set(this.currentDraft()); this.baselineReady.set(true); }, 0);
                this.workerImportDirty.set(false);
                if (navigateAfter) void this.completeFinish();
                else { void this.loadMigrationPreview(); void this.refreshLegacyHarness(); }
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Unable to save settings'))
            .finally(() => this.saving.set(false));
    }

    private normalizeLayers(savedLayers: StackLayer[]): StackLayer[] {
        const defaults = defaultStackLayers();
        return defaults.map((layer) => {
            const saved = (savedLayers.find((item) => item.id === layer.id) || {}) as Partial<StackLayer> & { source?: string; provider?: string };
            const merged = { ...layer, ...saved };
            delete (merged as { source?: string }).source;
            delete (merged as { provider?: string }).provider;
            if (!Array.isArray(merged.allowedSources) || merged.allowedSources.length === 0) {
                merged.allowedSources = [...(layer.allowedSources || [])];
            }
            return merged;
        });
    }

    private hydrate(profile: ConsumerProfile): void {
        const prof = (profile.profile || {}) as any;
        const settings = (prof.settings || {}) as any;
        const harness = (settings.harness || {}) as any;
        this.name.set(profile.name || '');
        this.owner.set(settings.general?.owner || '');
        this.locale.set(settings.general?.locale || 'vi-VN');
        this.tags.set((settings.general?.tags || []).join(', '));
        this.description.set(prof.description || settings.general?.description || '');
        const jev = prof.integration?.jev ?? prof.profile?.integration?.jev ?? (profile as any).integration?.jev;
        this.jevMode.set(jev?.mode === 'shadow' || jev?.mode === 'active' ? jev.mode : 'off');
        this.jevAutoThreshold.set(jev?.autoThreshold === undefined ? '' : String(jev.autoThreshold));
        this.jevConfirmThreshold.set(jev?.confirmThreshold === undefined ? '' : String(jev.confirmThreshold));
        this.jiraEnabled.set(settings.jira?.enabled ?? false);
        const routing = settings.knowledge?.providers?.routing;
        if (routing && typeof routing === 'object') {
            this.providerRouting.set({ work: routing.work || 'md', design: routing.design || 'md', content: routing.content || 'md' });
        } else {
            this.providerRouting.set({ work: this.jiraEnabled() ? 'jira' : 'md', design: 'md', content: 'md' });
        }
        this.jiraProject.set(settings.jira?.projectKey || '');
        this.jiraSyncMode.set(settings.jira?.syncMode || 'off');
        const knowledge = settings.knowledge || {};
        this.sdlcEnabled.set(knowledge.sdlc?.enabled ?? false);
        this.sdlcPipeline.set(knowledge.sdlc?.pipeline || 'full');
        this.crProcess.set(knowledge.sdlc?.crProcess ?? false);
        this.artifactKinds.set(Array.isArray(knowledge.artifactKinds) ? knowledge.artifactKinds : ['BRD', 'PRD', 'ADR']);
        this.representations.set(Array.isArray(knowledge.representations) ? knowledge.representations : ['human', 'agent', 'machine']);
        this.docgraphIndex.set(knowledge.docgraph?.enabled ?? true);
        this.docgraphScope.set(knowledge.docgraph?.scope || 'docs/**, sdlc/**, agents/**');
        this.documentStatusRequired.set(knowledge.governance?.documentStatus ?? true);
        this.preflightRequired.set(knowledge.governance?.preflight ?? true);
        this.goNoGoRequired.set(knowledge.governance?.goNoGo ?? true);
        this.crossCheckRequired.set(knowledge.governance?.crossCheck ?? true);
        this.pipelineContractRequired.set(knowledge.governance?.pipelineContract ?? true);
        this.openRegisterRequired.set(knowledge.governance?.openRegister ?? true);
        this.buildEnforcementRequired.set(knowledge.governance?.buildEnforcement ?? true);
        this.quartetProfile.set(knowledge.taskQuartet === 'extended' ? 'extended' : 'standard');
        this.manifestEnabled.set(knowledge.manifest?.enabled ?? true);
        this.manifestPath.set(knowledge.manifest?.path || '.harness/manifest.json');
        this.manifestHumanHeaderKeys.set(Array.isArray(knowledge.manifest?.humanHeaderKeys) ? knowledge.manifest.humanHeaderKeys : this.manifestHumanHeaderOptions);
        this.manifestAiHeaderKeys.set(Array.isArray(knowledge.manifest?.aiHeaderKeys) ? knowledge.manifest.aiHeaderKeys : this.manifestAiHeaderOptions);
        this.manifestFacets.set(Array.isArray(knowledge.manifest?.facets) ? knowledge.manifest.facets : this.manifestFacetOptions);
        this.manifestRelations.set(Array.isArray(knowledge.manifest?.relations) ? knowledge.manifest.relations : this.manifestRelationOptions);
        this.manifestChecks.set(Array.isArray(knowledge.manifest?.checks) ? knowledge.manifest.checks : this.manifestCheckOptions);
        this.consent.set(prof.observation?.consent ?? true);
        this.events.set(prof.observation?.events || ['prompt.submitted', 'turn.completed', 'tool.called']);
        const remoteVersions = this.remoteStackVersions();
        const savedVersions = remoteVersions.length > 0 ? remoteVersions : (Array.isArray(harness.stack?.versions) ? harness.stack.versions : []);
        const legacyLayers = Array.isArray(harness.stack?.layers) ? harness.stack.layers : [];
        let versions: StackVersion[];
        if (savedVersions.length > 0) {
            versions = savedVersions.map((item: StackVersion) => ({
                version: Number(item.version) || 1,
                status: item.status === 'draft' || item.status === 'retired' ? item.status : 'published',
                layers: this.normalizeLayers(item.layers),
                publishedAt: item.publishedAt,
            }));
        } else {
            versions = [{ version: Number(harness.stack?.version) || 1, status: 'published', layers: this.normalizeLayers(legacyLayers) }];
        }
        this.stackVersions.set(versions);
        const requestedVersion = Number(harness.stack?.version) || versions[versions.length - 1].version;
        const active = versions.some((item) => item.version === requestedVersion) ? requestedVersion : versions[versions.length - 1].version;
        this.activeStackVersion.set(active);
        this.stackLayers.set(this.layersForVersion(active).map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
        this.newStackVersion.set(this.latestPublishedVersion());
        const savedProfiles = Array.isArray(harness.hostProfiles)
            ? (harness.hostProfiles as LegacyHostProfile[])
                .map((profile) => {
                    const { [LEGACY_HOST_PLUGIN_KEY]: legacyHostId, ...rest } = profile;
                    return { ...rest, hostId: rest.hostId || legacyHostId || '' } as HostProfile;
                })
                .filter((profile) => !profile.detected)
            : [];
        this.hostProfiles.set(savedProfiles);
        const savedDevelopers = Array.isArray(harness.developers) ? harness.developers : [];
        const developerIds = [...new Set([...savedDevelopers, ...savedProfiles.map((profile: HostProfile) => profile.userId)])];
        this.developers.set(developerIds);
        this.workers.set(defaultWorkers());
        this.workerEdges.set([]);
        this.formationHostIds.set(Array.isArray(harness.formationHostIds) ? harness.formationHostIds : []);
        const savedPlugins = Array.isArray(harness.plugins)
            ? harness.plugins.filter((plugin: PluginEntry) => plugin.type !== 'provider')
            : defaultPlugins();
        const discoveredProviders: PluginEntry[] = this.mcpProviders().map((provider) => ({
            id: provider.id,
            label: provider.label,
            type: 'provider',
            version: 'detected',
            capabilities: provider.capabilities,
            mcpSource: provider.source,
            status: 'installed',
        }));
        this.plugins.set([...savedPlugins, ...discoveredProviders]);
        this.restoreDraft();
        this.pruneWorkerBindings();
        this.hydrated.set(true);
        setTimeout(() => { this.lastSaved.set(this.currentDraft()); this.baselineReady.set(true); }, 500);
        void this.loadWorkerFiles(profile.id);
        void this.loadWorkerSourceStatus(profile.id);
        void this.loadDefaultFlow(profile.id);
        void this.loadRuleFiles(profile.id);
        void this.loadFlowSummaries(profile.id);
        this.service.getConsumerPlugins(profile.id).then((plugins) => this.consumerPlugins.set(plugins)).catch(() => this.consumerPlugins.set([]));
        this.service.getProviderRecords(profile.id).then((records) => this.knowledgeProviderRecords.set(records)).catch(() => this.knowledgeProviderRecords.set([]));
        void this.loadKnowledgeIndex(profile.id);
    }

    private restoreDraft(): void {
        try {
            const raw = localStorage.getItem(`eso.consumer-settings.${this.consumerId}`);
            if (!raw) return;
            const draft = JSON.parse(raw) as Record<string, any>;
            if (typeof draft.name === 'string') this.name.set(draft.name);
            if (typeof draft.owner === 'string') this.owner.set(draft.owner);
            if (typeof draft.locale === 'string') this.locale.set(draft.locale);
            if (typeof draft.tags === 'string') this.tags.set(draft.tags);
            if (typeof draft.description === 'string') this.description.set(draft.description);
            if (Array.isArray(draft.stackVersions) && draft.stackVersions.length) {
                const versions: StackVersion[] = draft.stackVersions.map((item: StackVersion) => ({
                    version: Number(item.version) || 1,
                    status: item.status === 'draft' || item.status === 'retired' ? item.status : 'published',
                    layers: this.normalizeLayers(item.layers),
                    publishedAt: item.publishedAt,
                }));
                this.stackVersions.set(versions);
                const active = versions.some((item) => item.version === draft.activeStackVersion) ? Number(draft.activeStackVersion) : versions[versions.length - 1].version;
                this.activeStackVersion.set(active);
                this.stackLayers.set(this.layersForVersion(active).map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
                this.newStackVersion.set(this.latestPublishedVersion());
            } else if (Array.isArray(draft.stackLayers) && draft.stackLayers.length) {
                const layers = this.normalizeLayers(draft.stackLayers);
                this.stackVersions.set([{ version: 1, status: 'published', layers }]);
                this.activeStackVersion.set(1);
                this.stackLayers.set(layers.map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
                this.newStackVersion.set(1);
            }
            if (typeof draft.newStackVersion === 'number') this.newStackVersion.set(draft.newStackVersion);
            // Host profiles and formation IDs are server-owned deployment data, not form drafts.
            // Restoring them from localStorage kept stale hp-* IDs alive after provisioning and
            // made every worker lose its binding via pruneWorkerBindings().
            if (Array.isArray(draft.developers)) {
                const developerIds = new Set<string>([...this.developers(), ...draft.developers]);
                for (const profile of this.hostProfiles()) developerIds.add(profile.userId);
                this.developers.set([...developerIds]);
            }
            if (typeof draft.jiraEnabled === 'boolean') this.jiraEnabled.set(draft.jiraEnabled);
            if (typeof draft.jiraProject === 'string') this.jiraProject.set(draft.jiraProject);
            if (typeof draft.jiraSyncMode === 'string') this.jiraSyncMode.set(draft.jiraSyncMode);
            if (typeof draft.sdlcEnabled === 'boolean') this.sdlcEnabled.set(draft.sdlcEnabled);
            if (typeof draft.sdlcPipeline === 'string') this.sdlcPipeline.set(draft.sdlcPipeline);
            if (typeof draft.crProcess === 'boolean') this.crProcess.set(draft.crProcess);
            if (Array.isArray(draft.artifactKinds)) this.artifactKinds.set(draft.artifactKinds);
            if (Array.isArray(draft.representations)) this.representations.set(draft.representations);
            if (typeof draft.docgraphIndex === 'boolean') this.docgraphIndex.set(draft.docgraphIndex);
            if (typeof draft.docgraphScope === 'string') this.docgraphScope.set(draft.docgraphScope);
            if (typeof draft.documentStatusRequired === 'boolean') this.documentStatusRequired.set(draft.documentStatusRequired);
            if (typeof draft.preflightRequired === 'boolean') this.preflightRequired.set(draft.preflightRequired);
            if (typeof draft.goNoGoRequired === 'boolean') this.goNoGoRequired.set(draft.goNoGoRequired);
            if (typeof draft.crossCheckRequired === 'boolean') this.crossCheckRequired.set(draft.crossCheckRequired);
            if (typeof draft.pipelineContractRequired === 'boolean') this.pipelineContractRequired.set(draft.pipelineContractRequired);
            if (typeof draft.openRegisterRequired === 'boolean') this.openRegisterRequired.set(draft.openRegisterRequired);
            if (typeof draft.buildEnforcementRequired === 'boolean') this.buildEnforcementRequired.set(draft.buildEnforcementRequired);
            if (draft.quartetProfile === 'extended' || draft.quartetProfile === 'standard') this.quartetProfile.set(draft.quartetProfile);
            if (typeof draft.manifestEnabled === 'boolean') this.manifestEnabled.set(draft.manifestEnabled);
            if (typeof draft.manifestPath === 'string') this.manifestPath.set(draft.manifestPath);
            if (Array.isArray(draft.manifestHumanHeaderKeys)) this.manifestHumanHeaderKeys.set(draft.manifestHumanHeaderKeys);
            if (Array.isArray(draft.manifestAiHeaderKeys)) this.manifestAiHeaderKeys.set(draft.manifestAiHeaderKeys);
            if (Array.isArray(draft.manifestFacets)) this.manifestFacets.set(draft.manifestFacets);
            if (Array.isArray(draft.manifestRelations)) this.manifestRelations.set(draft.manifestRelations);
            if (Array.isArray(draft.manifestChecks)) this.manifestChecks.set(draft.manifestChecks);
            if (typeof draft.consent === 'boolean') this.consent.set(draft.consent);
            if (Array.isArray(draft.events)) this.events.set(draft.events);
        } catch {
            // Ignore malformed drafts.
        }
    }
}
