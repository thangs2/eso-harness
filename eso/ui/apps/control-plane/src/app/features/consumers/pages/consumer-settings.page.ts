import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { ConsumerProfile, McpProviderDto } from '../../../../../../../libs/api-client/types.js';

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
    hostPluginId: string;
    stackVersion: number;
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
    hostBindingId: string;
    scope: string;
    status: 'declared' | 'active' | 'paused';
}

interface WorkerEdge {
    from: string;
    to: string;
    on: string;
}

interface WorkerDraft {
    name: string;
    role: string;
    hostBindingId: string;
    scope: string;
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
        { id: 'worker-scout', name: 'Scout', role: 'scout', layer: 'peer', hostBindingId: '', scope: 'read-only recon', status: 'declared' },
        { id: 'worker-plan', name: 'Plan', role: 'plan', layer: 'peer', hostBindingId: '', scope: '/tmp/slp/plan/', status: 'declared' },
        { id: 'worker-build', name: 'Build', role: 'build', layer: 'peer', hostBindingId: '', scope: 'slice.allowed_files', status: 'declared' },
        { id: 'worker-fixbug', name: 'Fixbug', role: 'fixbug', layer: 'peer', hostBindingId: '', scope: 'failure files only', status: 'declared' },
        { id: 'worker-verify', name: 'Verify', role: 'verify', layer: 'gate', hostBindingId: '', scope: '/tmp/slp/verify/', status: 'declared' },
        { id: 'worker-audit', name: 'Audit', role: 'audit', layer: 'gate', hostBindingId: '', scope: '/tmp/slp/audit/', status: 'declared' },
        { id: 'worker-qc', name: 'QC', role: 'qc', layer: 'gate', hostBindingId: '', scope: '/tmp/slp/qc/', status: 'declared' },
    ];
}

function defaultWorkerEdges(): WorkerEdge[] {
    return [
        { from: 'worker-scout', to: 'worker-plan', on: 'context ready' },
        { from: 'worker-plan', to: 'worker-build', on: 'slice ready' },
        { from: 'worker-build', to: 'worker-verify', on: 'implemented' },
        { from: 'worker-verify', to: 'worker-audit', on: 'PASS' },
        { from: 'worker-verify', to: 'worker-fixbug', on: 'FAIL' },
        { from: 'worker-audit', to: 'worker-fixbug', on: 'findings' },
        { from: 'worker-fixbug', to: 'worker-verify', on: 'fixed' },
        { from: 'worker-audit', to: 'worker-qc', on: 'PASS · operator asks' },
    ];
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
                <button mat-stroked-button type="button" (click)="back()">Back to consumer</button>
            </header>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
            @if (saved()) { <p class="saved-banner" role="status">Settings saved.</p> }

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
                                                    <div class="layer-cell"><span>{{ layer.id === 'multiAgent' ? 'IAM policy' : 'Files' }}</span></div>
                                                    <div class="layer-cell layer-config">
                                                        @switch (layer.id) {
                                                            @case ('multiAgent') { <span>3 roles · 4 workers</span> }
                                                            @case ('rules') { <span>{{ layer.files }} files · ESO material</span> }
                                                            @case ('skills') { <span>{{ layer.files }} files · ESO material</span> }
                                                            @case ('hooks') { <span>{{ layer.files }} files · host hook plugin</span> }
                                                        }
                                                    </div>
                                                    <div class="layer-state"><mat-slide-toggle [ngModel]="layer.enabled" [disabled]="!isStackEditable()" (ngModelChange)="updateLayer(layer.id, 'enabled', $event)"></mat-slide-toggle></div>
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

                            </section>
                        }

                        @case ('hosts') {
                            <section class="tab-panel" role="tabpanel">
                                <header class="tab-intro">
                                    <p class="eyebrow">Host bindings</p>
                                    <h2>Who uses which host runtime</h2>
                                    <p>A host binding connects one developer, one host runtime, and one published Stack version. It answers where the stack runs and how Memory and Code graph resolve on that host. ESO is optional: unbound tools keep working unchanged.</p>
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
                                    <header class="hosts-section-head"><div><h3>Active bindings</h3><p class="muted">Developer → host runtime × pinned Stack version.</p></div><div class="developer-actions"><button mat-stroked-button type="button" (click)="openBulkUpgrade()">Bulk upgrade</button><button mat-flat-button color="primary" type="button" (click)="startNewBinding()">New host binding</button></div></header>
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
                                                            <button mat-stroked-button type="button" (click)="startAddHost(developer)">Add host binding</button>
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
                                                                        <tr class="host-row">
                                                                            <td><div class="host-name"><strong>{{ hostLabel(profile.hostPluginId) }}</strong><small>managed</small></div></td>
                                                                            <td>v{{ profile.stackVersion }}</td>
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
                                                            <div class="host-add-row">
                                                                <mat-form-field appearance="outline"><mat-label>Developer / user</mat-label>
                                                                    <input matInput [ngModel]="bindingDeveloper()" [disabled]="addingHostFor() !== '__new' || !!editingProfile()" (ngModelChange)="bindingDeveloper.set($event)" placeholder="dev1">
                                                                </mat-form-field>
                                                                <mat-form-field appearance="outline"><mat-label>Host plugin</mat-label>
                                                                    <mat-select [ngModel]="newHostPluginId()" [disabled]="!!editingProfile()" (ngModelChange)="changeHostPlugin($event)">
                                                                        @for (plugin of hostPlugins(); track plugin.id) { <mat-option [value]="plugin.id">{{ plugin.label }}</mat-option> }
                                                                    </mat-select>
                                                                </mat-form-field>
                                                                <mat-form-field appearance="outline"><mat-label>Stack version</mat-label>
                                                                    <mat-select [ngModel]="newStackVersion()" (ngModelChange)="newStackVersion.set($event)">
                                                                        @for (item of publishedStackVersions(); track item.version) { <mat-option [value]="item.version">v{{ item.version }} · {{ item.status }}</mat-option> }
                                                                    </mat-select>
                                                                    <mat-hint>Binding pins this version.</mat-hint>
                                                                </mat-form-field>
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
                                                                        <div class="mcp-binding"><span>MCP config</span><code>{{ mcpSourceForHost(newHostPluginId()) }}</code></div>
                                                                    </section>
                                                                </div>                                                            </details>
                                                        </div>
                                                    }

                                </section>

                                <section class="hosts-section">
                                    <header class="hosts-section-head"><div><h3>Detected host runtimes</h3><p class="muted">Markers exist in the repository, but no binding has been created. Detection is optional.</p></div></header>
                                    @if (unmanagedHosts().length > 0) {
                                        <div class="detected-grid">
                                            @for (host of unmanagedHosts(); track host.hostPluginId) {
                                                <article class="detected-card">
                                                    <div><strong>{{ host.label }}</strong><code>{{ host.markers.join(', ') }}</code></div>
                                                    <button mat-stroked-button type="button" (click)="manageDetectedHost(host.hostPluginId)">Bind with ESO</button>
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

                        @case ('plugins') {
                            <section class="tab-panel" role="tabpanel">
                                <p class="section-hint">Hosts, sources, providers, and MCP are plugins. The UI reads this registry instead of hardcoding host names.</p>
                                <div class="plugin-table-wrap">
                                    <table class="plugin-table">
                                        <thead><tr><th>Plugin</th><th>Type</th><th>Version</th><th>Capabilities</th><th>Status</th></tr></thead>
                                        <tbody>
                                            @for (plugin of plugins(); track plugin.id) {
                                                <tr><td><strong>{{ plugin.label }}</strong><br><code>{{ plugin.id }}</code></td><td>{{ plugin.type }}</td><td>{{ plugin.version }}</td><td><span class="cap-list">{{ plugin.capabilities.join(' · ') }}</span></td><td><span class="badge" [class.badge-warn]="plugin.status !== 'installed'">{{ plugin.status }}</span></td></tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        }

                        @case ('workers') {
                            <section class="tab-panel" role="tabpanel">
                                <header class="tab-intro">
                                    <p class="eyebrow">Multi-Agent (Workers)</p>
                                    <h2>Agent identities with a role and a host binding</h2>
                                    <p>A worker is an agent identity, not a model. Its role says what it may do; its host binding says where it runs. Credentials are never stored here.</p>
                                </header>

                                <div class="agent-stats worker-stats">
                                    <div><strong>{{ workers().length }}</strong><span>workers</span></div>
                                    <div><strong>{{ workerRoleCount() }}</strong><span>roles in use</span></div>
                                    <div><strong>{{ workerHostCoverage() }}</strong><span>host bindings used</span></div>
                                </div>

                                <section class="formation-panel">
                                    <div class="formation-head">
                                        <div><span class="scope-badge">DEFAULT</span><strong>Seven-Star Formation</strong><small>Seven positions, not seven names. Edges are the formation.</small></div>
                                        <button mat-stroked-button type="button" (click)="resetWorkers()">Reset to default</button>
                                    </div>
                                    <div class="formation-chain">
                                        @for (edge of workerEdges(); track edge.from + edge.to + edge.on) {
                                            <span class="formation-edge"><b>{{ workerName(edge.from) }}</b> → <b>{{ workerName(edge.to) }}</b><em>{{ edge.on }}</em></span>
                                        }
                                    </div>
                                    <button type="button" class="formation-flow" (click)="openDiagram.set('workers')">
                                        <span class="formation-flow-preview"><img src="assets/diagrams/that-tinh-tran-diagram.svg" alt="Thất Tinh Trận worker flow"></span>
                                        <span class="formation-flow-copy"><strong>View the worker flow</strong><small>Original Thất Tinh Trận diagram · click to open</small></span>
                                    </button>
                                </section>

                                <section class="workers-section">
                                    <h3>Register worker</h3>
                                    <div class="worker-form">
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Worker name</mat-label><input matInput [ngModel]="workerDraft().name" (ngModelChange)="setWorkerDraft('name', $event)" placeholder="quang-lead"></mat-form-field>
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Role</mat-label>
                                            <mat-select [ngModel]="workerDraft().role" (ngModelChange)="setWorkerDraft('role', $event)">
                                                @for (role of workerRoles; track role) { <mat-option [value]="role">{{ role }}</mat-option> }
                                            </mat-select>
                                        </mat-form-field>
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Host binding</mat-label>
                                            <mat-select [ngModel]="workerDraft().hostBindingId" (ngModelChange)="setWorkerDraft('hostBindingId', $event)">
                                                <mat-option value="">No binding yet</mat-option>
                                                @for (binding of hostProfiles(); track binding.id) { <mat-option [value]="binding.id">{{ bindingLabel(binding) }}</mat-option> }
                                            </mat-select>
                                        </mat-form-field>
                                        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Scope</mat-label><input matInput [ngModel]="workerDraft().scope" (ngModelChange)="setWorkerDraft('scope', $event)" placeholder="eso/ui/**"></mat-form-field>
                                        <button mat-flat-button color="primary" type="button" (click)="addWorker()">Add worker</button>
                                    </div>
                                    @if (workers().length === 0) {
                                        <p class="muted worker-empty">No workers registered. Add one to bind an agent role to a host binding.</p>
                                    } @else {
                                        <div class="worker-table-wrap">
                                            <table class="worker-table">
                                                <thead><tr><th>Worker</th><th>Role</th><th>Layer</th><th>Host binding</th><th>Scope</th><th>Status</th><th></th></tr></thead>
                                                <tbody>
                                                    @for (worker of workers(); track worker.id) {
                                                        <tr>
                                                            <td><strong>{{ worker.name }}</strong><br><code>{{ worker.id }}</code></td>
                                                            <td>{{ worker.role }}</td>
                                                            <td><span class="badge" [class.badge-warn]="worker.layer === 'gate'">{{ worker.layer }}</span></td>
                                                            <td>{{ workerBindingLabel(worker) }}</td>
                                                            <td><code>{{ worker.scope || 'not declared' }}</code></td>
                                                            <td><span class="badge" [class.badge-warn]="worker.status === 'paused'">{{ worker.status }}</span></td>
                                                            <td><button mat-stroked-button type="button" (click)="removeWorker(worker.id)">Remove</button></td>
                                                        </tr>
                                                    }
                                                </tbody>
                                            </table>
                                        </div>
                                    }
                                </section>

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
                                <header class="tab-intro">
                                    <p class="eyebrow">Knowledge &amp; Artifact Governance</p>
                                    <h2>How project knowledge is governed</h2>
                                    <p>SDLC is optional. Knowledge base holds artifacts; document graph indexes their relationships; providers such as Jira, Notion, or Confluence are optional sources of truth — never required.</p>
                                    <div class="actor-grid">
                                        <div><span>Who acts</span><strong>Operator / project owner</strong></div>
                                        <div><span>Decision</span><strong>SDLC mode · artifacts · providers</strong></div>
                                        <div><span>For whom</span><strong>Developers, auditors, hosts, and future readers</strong></div>
                                        <div><span>Result</span><strong>Knowledge is owned, classified, and traceable</strong></div>
                                    </div>
                                </header>

                                <div class="knowledge-layout">
                                    <div class="knowledge-main">
                                        <section class="knowledge-section knowledge-selectable" [class.active]="selectedKnowledgeTopic() === 'pipeline'" (click)="selectKnowledgeTopic('pipeline')">
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

                                        <section class="knowledge-section knowledge-selectable" [class.active]="selectedKnowledgeTopic() === 'document-status' || selectedKnowledgeTopic() === 'open-register' || selectedKnowledgeTopic() === 'cross-check' || selectedKnowledgeTopic() === 'build-enforcement' || selectedKnowledgeTopic() === 'preflight' || selectedKnowledgeTopic() === 'go-no-go' || selectedKnowledgeTopic() === 'pipeline-contract'">
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

                                        <section class="knowledge-section knowledge-selectable" [class.active]="selectedKnowledgeTopic() === 'quartet'" (click)="selectKnowledgeTopic('quartet')">
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

                                        <section class="knowledge-section knowledge-selectable" [class.active]="selectedKnowledgeTopic() === 'knowledge-base'" (click)="selectKnowledgeTopic('knowledge-base')">
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

                                        <section class="knowledge-section knowledge-selectable" [class.active]="selectedKnowledgeTopic() === 'agent-manifests'" (click)="selectKnowledgeTopic('agent-manifests')">
                                            <header class="knowledge-section-head"><div><h3>Agent manifest</h3><p>Machine-readable contract for this consumer's document structure.</p></div><span class="scope-badge">AI zone</span></header>
                                            <div class="agent-stats">
                                                <div><strong>7</strong><span>facets</span></div>
                                                <div><strong>6</strong><span>relations</span></div>
                                                <div><strong>6</strong><span>shared keys</span></div>
                                                <div><strong>5</strong><span>checks</span></div>
                                            </div>
                                            <div class="manifest-controls">
                                                <mat-slide-toggle [ngModel]="manifestEnabled()" (ngModelChange)="manifestEnabled.set($event)">Emit manifest</mat-slide-toggle>
                                                <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Manifest path</mat-label><input matInput [ngModel]="manifestPath()" (ngModelChange)="manifestPath.set($event)" placeholder=".harness/manifest.json"></mat-form-field>
                                            </div>
                                            <div class="knowledge-block">
                                                <span class="control-label">HUMAN header</span>
                                                <div class="knowledge-chips">
                                                    @for (key of manifestHumanHeaderOptions; track key) {
                                                        <button type="button" class="source-pill" [class.active]="manifestHumanHeaderKeys().includes(key)" (click)="toggleManifestHumanHeader(key); $event.stopPropagation()">{{ key }}</button>
                                                    }
                                                </div>
                                            </div>
                                            <div class="knowledge-block">
                                                <span class="control-label">AI header</span>
                                                <div class="knowledge-chips">
                                                    @for (key of manifestAiHeaderOptions; track key) {
                                                        <button type="button" class="source-pill" [class.active]="manifestAiHeaderKeys().includes(key)" (click)="toggleManifestAiHeader(key); $event.stopPropagation()">{{ key }}</button>
                                                    }
                                                </div>
                                            </div>
                                            <div class="knowledge-block">
                                                <span class="control-label">Facets</span>
                                                <div class="knowledge-chips">
                                                    @for (facet of manifestFacetOptions; track facet) {
                                                        <button type="button" class="source-pill" [class.active]="manifestFacets().includes(facet)" (click)="toggleManifestFacet(facet); $event.stopPropagation()">{{ facet }}</button>
                                                    }
                                                </div>
                                            </div>
                                            <div class="knowledge-block">
                                                <span class="control-label">Relations</span>
                                                <div class="knowledge-chips">
                                                    @for (relation of manifestRelationOptions; track relation) {
                                                        <button type="button" class="source-pill" [class.active]="manifestRelations().includes(relation)" (click)="toggleManifestRelation(relation); $event.stopPropagation()">{{ relation }}</button>
                                                    }
                                                </div>
                                            </div>
                                            <div class="knowledge-block">
                                                <span class="control-label">Checks</span>
                                                <div class="knowledge-chips">
                                                    @for (check of manifestCheckOptions; track check) {
                                                        <button type="button" class="source-pill" [class.active]="manifestChecks().includes(check)" (click)="toggleManifestCheck(check); $event.stopPropagation()">{{ check }}</button>
                                                    }
                                                </div>
                                            </div>
                                            <p class="knowledge-note">Configured for this consumer. <code>sdlc/01.agent-manifests</code> is a study sample, not testeso data.</p>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable" [class.active]="selectedKnowledgeTopic() === 'docgraph'" (click)="selectKnowledgeTopic('docgraph')">
                                            <header class="knowledge-section-head"><div><h3>Document graph</h3><p>Derived index of document relationships. Never the source of content.</p></div><mat-slide-toggle [ngModel]="docgraphIndex()" (ngModelChange)="docgraphIndex.set($event)">Index</mat-slide-toggle></header>
                                            <mat-form-field appearance="outline" class="full-width"><mat-label>Index scope</mat-label><input matInput [ngModel]="docgraphScope()" (ngModelChange)="docgraphScope.set($event)" placeholder="docs/**, sdlc/**, agents/**"></mat-form-field>
                                            <p class="knowledge-note">Generated files and provider copies are excluded by default.</p>
                                        </section>

                                        <section class="knowledge-section knowledge-selectable" [class.active]="selectedKnowledgeTopic() === 'providers'" (click)="selectKnowledgeTopic('providers')">
                                            <header class="knowledge-section-head"><div><h3>Providers</h3><p>Optional sources of truth. Each artifact kind has at most one provider.</p></div><span class="scope-badge muted-badge">optional</span></header>
                                            <div class="provider-list">
                                                <article class="provider-row">
                                                    <div><strong>Jira</strong><small>Task · story · bug</small></div>
                                                    <span class="provider-kind">task</span>
                                                    <mat-slide-toggle [ngModel]="jiraEnabled()" (ngModelChange)="jiraEnabled.set($event)">{{ jiraEnabled() ? 'connected' : 'not connected' }}</mat-slide-toggle>
                                                </article>
                                                @if (jiraEnabled()) {
                                                    <div class="provider-config">
                                                        <mat-form-field appearance="outline"><mat-label>Project key</mat-label><input matInput [ngModel]="jiraProject()" (ngModelChange)="jiraProject.set($event)" placeholder="FIN"></mat-form-field>
                                                        <mat-form-field appearance="outline"><mat-label>Sync mode</mat-label>
                                                            <mat-select [ngModel]="jiraSyncMode()" (ngModelChange)="jiraSyncMode.set($event)">
                                                                @for (mode of jiraModes; track mode) { <mat-option [value]="mode">{{ mode }}</mat-option> }
                                                            </mat-select>
                                                        </mat-form-field>
                                                    </div>
                                                }
                                                <article class="provider-row"><div><strong>Notion</strong><small>Knowledge · documents</small></div><span class="provider-kind">document</span><span class="provider-status">not connected</span></article>
                                                <article class="provider-row"><div><strong>Confluence</strong><small>Knowledge · documents</small></div><span class="provider-kind">document</span><span class="provider-status">not connected</span></article>
                                                <article class="provider-row"><div><strong>Figma</strong><small>Design · artifacts</small></div><span class="provider-kind">design</span><span class="provider-status">not connected</span></article>
                                            </div>
                                        </section>
                                    </div>

                                    <aside class="knowledge-detail" aria-live="polite">
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
                                                    <h4>HUMAN header</h4>
                                                    <div class="knowledge-chips">
                                                        @for (key of manifestHumanHeaderKeys(); track key) { <span class="source-pill active">{{ key }}</span> }
                                                    </div>
                                                </section>
                                                <section class="detail-section">
                                                    <h4>AI header</h4>
                                                    <div class="knowledge-chips">
                                                        @for (key of manifestAiHeaderKeys(); track key) { <span class="source-pill active">{{ key }}</span> }
                                                    </div>
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

                        @case ('observation') {
                            <section class="tab-panel" role="tabpanel">
                                <p class="section-hint">Only enabled events are recorded; no secrets, prompt bodies, or file content.</p>
                                <mat-slide-toggle [ngModel]="consent()" (ngModelChange)="consent.set($event)">Enable observation</mat-slide-toggle>
                                <div class="event-grid" [class.event-grid-disabled]="!consent()">
                                    @for (event of eventKinds; track event.id) {
                                        <mat-checkbox [checked]="events().includes(event.id)" [disabled]="!consent()" (change)="toggleEvent(event.id)">
                                            <span class="event-copy"><strong>{{ event.label }}</strong><small>{{ event.description }}</small></span>
                                        </mat-checkbox>
                                    }
                                </div>
                            </section>
                        }
                    }
                </div>

                <footer class="settings-actions">
                    <button mat-stroked-button type="button" (click)="back()">Cancel</button>
                    <div class="settings-footer-right">
                        <button mat-stroked-button type="button" [disabled]="saving()" (click)="save()">Save settings</button>
                        @if (activeTab() === lastTab) {
                            <button mat-flat-button color="primary" type="button" [disabled]="saving()" (click)="finish()">{{ saving() ? 'Saving…' : 'Finish' }}</button>
                        } @else {
                            <button mat-flat-button color="primary" type="button" (click)="nextTab()">Next</button>
                        }
                    </div>
                </footer>
            }
        </div>
    `,
    styles: [`
        .settings-page { display: grid; gap: var(--space-5); max-width: var(--container); margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; }
        .page-header h1 { margin: 0 0 var(--space-1); }
        .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: var(--text-xs); margin: 0 0 var(--space-1); }
        .subtitle { color: var(--muted); margin: 0; }
        .settings-tabs { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; }
        .settings-tab { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
        .settings-tab-copy { display: grid; gap: 2px; min-width: 0; }
        .settings-tab-copy strong { color: var(--ink); font-size: var(--text-sm); font-weight: 650; line-height: 1.2; }
        .settings-tab-copy small { color: var(--muted); font-size: 10px; line-height: 1.2; white-space: normal; }
        .settings-tab.active .settings-tab-copy strong, .settings-tab.active .settings-tab-copy small { color: var(--brand-ink); }
        .settings-tab:last-child { border-right: 0; }
        .settings-tab.active { background: var(--brand); color: var(--brand-ink); }
        .settings-tab:hover:not(.active) { background: color-mix(in srgb, var(--surface) 88%, var(--brand)); color: var(--ink); }
        .settings-tab:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
        .settings-step-no { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid currentColor; font-size: var(--text-xs); font-weight: 700; flex: none; }
        .settings-tab-content { border: 1px solid var(--line); border-top: 0; border-radius: 0 0 var(--radius-md) var(--radius-md); background: var(--surface); }
        .tab-panel { display: grid; gap: var(--space-4); padding: var(--space-5); }
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
        .settings-actions { display: flex; justify-content: space-between; gap: var(--space-3); padding-top: var(--space-1); }
        .settings-footer-right { display: flex; gap: var(--space-3); align-items: center; }
        .saved-banner { border-left: 4px solid var(--brand); background: color-mix(in srgb, var(--surface) 88%, var(--brand)); padding: var(--space-3); border-radius: var(--radius-sm); margin: 0; }
        .loading-label { color: var(--muted); margin: 0; }
        .settings-loading { border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-5); background: var(--surface); }
        @media (max-width: 1100px) { .settings-tabs { grid-template-columns: repeat(3, minmax(0, 1fr)); } .host-grid { grid-template-columns: 1fr; } .layer-row { grid-template-columns: minmax(200px, 1fr) minmax(120px, .6fr) minmax(180px, 1fr) auto; gap: var(--space-3); height: auto; min-height: 100px; } .layer-columns { display: none; } }
        @media (max-width: 700px) { .settings-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); } .form-grid, .event-grid, .stack-summary { grid-template-columns: 1fr; } .page-header { flex-direction: column; } .tab-panel { padding: var(--space-4); } .layer-row { grid-template-columns: 1fr; align-items: start; } .layer-state { justify-content: flex-start; } .group-head { flex-direction: column; } }
    `],
})
export class ConsumerSettingsPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);
    readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);

    readonly loading = signal(true);
    readonly saving = signal(false);
    readonly saved = signal(false);
    readonly error = signal<string | null>(null);
    private readonly current = signal<ConsumerProfile | null>(null);
    readonly activeTab = signal('profile');
    readonly lastTab = 'observation';
    readonly tabs = [
        { id: 'profile', n: 1, label: 'Profile', hint: 'Identity & metadata' },
        { id: 'stack', n: 2, label: 'Stack', hint: 'Policy & versions' },
        { id: 'hosts', n: 3, label: 'Host bindings', hint: 'Developer × host runtime' },
        { id: 'workers', n: 4, label: 'Multi-Agent (Workers)', hint: 'Agent identities & roles' },
        { id: 'knowledge', n: 5, label: 'Knowledge', hint: 'Knowledge & Artifact Governance' },
        { id: 'plugins', n: 6, label: 'Plugins', hint: 'Registry & adapters' },
        { id: 'observation', n: 7, label: 'Observatory', hint: 'Evidence capture' },
    ];

    private readonly consumerId = this.route.snapshot.paramMap.get('id') || 'unknown';
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
            workers: this.workers(),
            workerEdges: this.workerEdges(),
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
    });

    readonly name = signal('');
    readonly owner = signal('');
    readonly locale = signal('vi-VN');
    readonly tags = signal('');
    readonly description = signal('');
    readonly stackLayers = signal<StackLayer[]>(defaultStackLayers());
    readonly stackVersions = signal<StackVersion[]>([{ version: 1, status: 'published', layers: defaultStackLayers() }]);
    readonly activeStackVersion = signal(1);
    readonly newStackVersion = signal(1);
    readonly remoteStackVersions = signal<StackVersion[]>([]);
    readonly hostProfiles = signal<HostProfile[]>([]);
    readonly plugins = signal<PluginEntry[]>(defaultPlugins());
    readonly mcpProviders = signal<McpProviderDto[]>([]);
    readonly mcpSources = signal<string[]>([]);
    readonly mcpWarnings = signal<string[]>([]);
    readonly detectedHosts = signal<Array<{ hostPluginId: string; label: string; markers: string[] }>>([]);
    readonly developers = signal<string[]>([]);
    readonly workers = signal<WorkerEntry[]>(defaultWorkers());
    readonly workerEdges = signal<WorkerEdge[]>(defaultWorkerEdges());
    readonly workerDraft = signal<WorkerDraft>({ name: '', role: 'dev', hostBindingId: '', scope: '' });
    readonly workerRoles = ['scout', 'plan', 'build', 'fixbug', 'verify', 'audit', 'qc', 'lead', 'ba', 'dev', 'fe', 'be', 'qa', 'pm', 'review'];
    readonly newDeveloperId = signal('');
    readonly bindingDeveloper = signal('');
    readonly addingHostFor = signal<string | null>(null);
    readonly removingDeveloper = signal<string | null>(null);
    readonly expandedProfile = signal<string | null>(null);
    readonly editingProfile = signal<string | null>(null);
    readonly bulkUpgradeOpen = signal(false);
    readonly bulkUpgradeTarget = signal<number | null>(null);
    readonly deleteVersionConfirm = signal(false);
    readonly newHostPluginId = signal('cursor');
    readonly newMemorySource = signal('eso-native');
    readonly newMemoryProvider = signal('');
    readonly newCodeGraphSource = signal('eso-native');
    readonly newCodeGraphProvider = signal('');
    readonly jiraEnabled = signal(false);
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
    readonly manifestEnabled = signal(true);
    readonly manifestPath = signal('.harness/manifest.json');
    readonly manifestHumanHeaderKeys = signal<string[]>(['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'source_of_truth', 'phase']);
    readonly manifestAiHeaderKeys = signal<string[]>(['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'human_sot', 'refs']);
    readonly manifestFacets = signal<string[]>(['kind', 'origin', 'custodian', 'liveness', 'kt-state', 'owner', 'representation']);
    readonly manifestRelations = signal<string[]>(['derived_from', 'source_of_truth', 'human_sot', 'blocks', 'owns_kinds', 'references']);
    readonly manifestChecks = signal<string[]>(['links resolve', 'header shape', 'derived ⊆ source', 'no orphan document', 'kind has owner']);
    readonly selectedKnowledgeTopic = signal('pipeline');
    readonly openDiagram = signal<'main' | 'cr' | 'intent' | 'workers' | null>(null);
    readonly consent = signal(true);
    readonly events = signal<string[]>(['prompt.submitted', 'turn.completed', 'tool.called']);
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
        const tab = requestedTab === 'jira' ? 'knowledge' : requestedTab;
        if (tab && this.tabs.some((item) => item.id === tab)) this.activeTab.set(tab);
        Promise.all([
            this.service.get(id),
            this.service.getMcp(id).catch(() => ({ consumerId: id, root: '', sources: [], providers: [], warnings: [] })),
            this.service.getHosts(id).catch(() => ({ consumerId: id, root: '', detected: [] })),
            this.service.getStackVersions(id).catch(() => ({ consumerId: id, versions: [] })),
        ])
            .then(([profile, mcp, hosts, versions]) => {
                this.mcpProviders.set(mcp.providers);
                this.mcpSources.set(mcp.sources);
                this.mcpWarnings.set(mcp.warnings);
                this.detectedHosts.set(hosts.detected);
                this.remoteStackVersions.set(versions.versions.map((item: any) => ({
                    version: Number(item.version) || 1,
                    status: item.status,
                    layers: this.normalizeLayers(item.layers as StackLayer[]),
                    publishedAt: item.publishedAt ?? undefined,
                })));
                this.current.set(profile);
                this.hydrate(profile);
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
    hostLabel(pluginId: string): string { return this.plugins().find((plugin) => plugin.id === pluginId)?.label || pluginId; }

    setWorkerDraft<K extends keyof WorkerDraft>(key: K, value: WorkerDraft[K]): void {
        this.workerDraft.update((draft) => ({ ...draft, [key]: value }));
    }

    bindingLabel(binding: HostProfile): string {
        return `${binding.userId} · ${this.hostLabel(binding.hostPluginId)} · v${binding.stackVersion}`;
    }

    workerBindingLabel(worker: WorkerEntry): string {
        const binding = this.hostProfiles().find((item) => item.id === worker.hostBindingId);
        return binding ? this.bindingLabel(binding) : 'No binding yet';
    }

    workerRoleCount(): number {
        return new Set(this.workers().map((worker) => worker.role)).size;
    }

    workerHostCoverage(): number {
        return new Set(this.workers().map((worker) => worker.hostBindingId).filter(Boolean)).size;
    }

    addWorker(): void {
        const draft = this.workerDraft();
        const name = draft.name.trim();
        if (!name) return;
        const worker: WorkerEntry = {
            id: `worker-${Date.now().toString(36)}`,
            name,
            role: draft.role,
            layer: ['verify', 'audit', 'qc'].includes(draft.role) ? 'gate' : 'peer',
            hostBindingId: draft.hostBindingId,
            scope: draft.scope.trim(),
            status: 'declared',
        };
        this.workers.update((workers) => [...workers, worker]);
        this.workerDraft.set({ name: '', role: 'dev', hostBindingId: '', scope: '' });
    }

    removeWorker(id: string): void {
        this.workers.update((workers) => workers.filter((worker) => worker.id !== id));
        this.workerEdges.update((edges) => edges.filter((edge) => edge.from !== id && edge.to !== id));
    }

    resetWorkers(): void {
        this.workers.set(defaultWorkers());
        this.workerEdges.set(defaultWorkerEdges());
        this.workerDraft.set({ name: '', role: 'dev', hostBindingId: '', scope: '' });
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
            { id: 'multiAgent', label: 'Multi-agent', value: '3 roles · 4 workers', scope: 'stack' },
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

    unmanagedHosts(): Array<{ hostPluginId: string; label: string; markers: string[] }> {
        return this.detectedHosts().filter((host) => !this.hostProfiles().some((profile) => profile.hostPluginId === host.hostPluginId));
    }

    manageDetectedHost(hostPluginId: string): void {
        const userId = this.developers()[0] || 'operator';
        this.developers.update((developers) => (developers.includes(userId) ? developers : [...developers, userId]));
        if (this.hostProfiles().some((profile) => profile.userId === userId && profile.hostPluginId === hostPluginId)) return;
        const resolution = this.hostResolution(hostPluginId);
        this.hostProfiles.update((profiles) => [...profiles, {
            id: `hp-${Date.now()}`, userId, hostPluginId, stackVersion: this.newStackVersion(),
            ...resolution,
            mcpConfigSource: this.mcpSourceForHost(hostPluginId), installState: 'pending', detected: false,
        }]);
    }

    startNewBinding(): void {
        this.editingProfile.set(null);
        this.addingHostFor.set('__new');
        this.bindingDeveloper.set('');
        this.newStackVersion.set(this.latestPublishedVersion());
        this.useHostDefaults();
    }

    startAddHost(userId: string): void {
        this.editingProfile.set(null);
        this.addingHostFor.set(userId);
        this.bindingDeveloper.set(userId);
        this.newStackVersion.set(this.latestPublishedVersion());
        this.useHostDefaults();
    }

    changeHostPlugin(hostPluginId: string): void {
        this.newHostPluginId.set(hostPluginId);
        this.useHostDefaults();
    }

    useHostDefaults(): void {
        const resolution = this.hostResolution(this.newHostPluginId(), this.newStackVersion());
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
            { id: 'multiAgent', label: 'Multi-agent / SLP', value: 'IAM policy · 3 roles · 4 workers' },
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
        this.newHostPluginId.set(profile.hostPluginId);
        this.newStackVersion.set(profile.stackVersion);
        this.newMemorySource.set(profile.memorySource);
        this.newMemoryProvider.set(profile.memoryProvider || '');
        this.newCodeGraphSource.set(profile.codeGraphSource);
        this.newCodeGraphProvider.set(profile.codeGraphProvider || '');
    }

    saveHostBinding(): void {
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
                memorySource: this.newMemorySource(),
                memoryProvider: this.newMemorySource() === 'market' ? this.newMemoryProvider() : undefined,
                codeGraphSource: this.newCodeGraphSource(),
                codeGraphProvider: this.newCodeGraphSource() === 'market' ? this.newCodeGraphProvider() : undefined,
                mcpConfigSource: this.mcpSourceForHost(profile.hostPluginId),
            } : profile));
            this.cancelAddHost();
            return;
        }
        this.addHostToDeveloper(developer);
    }

    private hostResolution(hostPluginId: string, stackVersion = this.newStackVersion()): { memorySource: string; memoryProvider?: string; codeGraphSource: string; codeGraphProvider?: string } {
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
        const memory = resolve('memory', hostPluginId === 'dsh');
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

    mcpSourceForHost(hostPluginId: string): string {
        const sources: Record<string, string> = {
            cursor: '.cursor/mcp.json',
            agy: '.agents/mcp_config.json',
            claude: '.claude/settings.json',
            dsh: 'plugin config',
            paseo: 'plugin config',
            orca: 'plugin config',
        };
        return sources[hostPluginId] || 'host config';
    }

    addHostToDeveloper(userId: string): void {
        const hostPluginId = this.newHostPluginId();
        if (!hostPluginId) return;
        const exists = this.hostProfiles().some((profile) => profile.userId === userId && profile.hostPluginId === hostPluginId);
        if (exists) return;
        this.hostProfiles.update((profiles) => [...profiles, {
            id: `hp-${Date.now()}`, userId, hostPluginId, stackVersion: this.newStackVersion(),
            memorySource: this.newMemorySource(),
            memoryProvider: this.newMemorySource() === 'market' ? this.newMemoryProvider() : undefined,
            codeGraphSource: this.newCodeGraphSource(),
            codeGraphProvider: this.newCodeGraphSource() === 'market' ? this.newCodeGraphProvider() : undefined,
            mcpConfigSource: this.mcpSourceForHost(hostPluginId),
            installState: 'pending', detected: false,
        }]);
        this.addingHostFor.set(null);
    }

    removeHostProfile(id: string): void {
        this.hostProfiles.update((profiles) => profiles.filter((profile) => profile.id !== id));
        if (this.editingProfile() === id) this.cancelAddHost();
    }
    nextTab(): void {
        const index = this.tabs.findIndex((tab) => tab.id === this.activeTab());
        if (index >= 0 && index < this.tabs.length - 1) this.selectTab(this.tabs[index + 1].id);
    }

    finish(): void {
        this.save(true);
    }

    selectTab(id: string): void {
        this.activeTab.set(id);
        this.router.navigate([], { relativeTo: this.route, queryParams: { tab: id }, queryParamsHandling: 'merge', replaceUrl: true });
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
                    { label: 'Pain', value: 'P4 — decision before execution' },
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
                    description: 'Checks one slice before execution. It is narrower than Go/No-Go, which covers the whole increment.',
                    items: [
                        { label: 'Scope', value: 'one slice / one work package' },
                        { label: 'Reads', value: 'document status · BIP/FIP · SCN · marks' },
                        { label: 'Pass', value: 'all required slots OK or P with an open id' },
                        { label: 'Fail', value: 'no execution; gap must be named' },
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

    save(navigateAfter = false): void {
        const profile = this.current();
        if (!profile) return;
        this.saving.set(true); this.saved.set(false); this.error.set(null);
        const previous = (profile.profile || {}) as Record<string, unknown>;
        const nextProfile: Record<string, unknown> = {
            ...previous,
            observation: { consent: this.consent(), events: this.events() },
            settings: {
                general: { owner: this.owner().trim(), locale: this.locale().trim(), tags: this.tags().split(',').map((tag) => tag.trim()).filter(Boolean), description: this.description().trim() },
                harness: { stack: { version: this.activeStackVersion(), status: this.stackStatus(), layers: this.stackLayers(), versions: this.stackVersions() }, hostProfiles: this.hostProfiles(), developers: this.developers(), workers: this.workers(), workerEdges: this.workerEdges(), plugins: this.plugins() },
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
                    providers: { jira: { enabled: this.jiraEnabled(), projectKey: this.jiraProject().trim(), syncMode: this.jiraSyncMode() } },
                },
            },
        };
        this.service.updateSettings(profile.id, this.name().trim() || profile.name, nextProfile, profile.version || 1)
            .then(async (updated) => {
                await this.service.saveStackVersions(profile.id, this.stackVersions());
                this.current.set(updated);
                this.hydrate(updated);
                this.saved.set(true);
                if (navigateAfter) this.router.navigate(['/consumers', profile.id]);
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
        this.jiraEnabled.set(settings.jira?.enabled ?? false);
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
            ? harness.hostProfiles.filter((profile: HostProfile) => !profile.detected)
            : [];
        this.hostProfiles.set(savedProfiles);
        const savedDevelopers = Array.isArray(harness.developers) ? harness.developers : [];
        const developerIds = [...new Set([...savedDevelopers, ...savedProfiles.map((profile: HostProfile) => profile.userId)])];
        this.developers.set(developerIds);
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
        this.hydrated.set(true);
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
            if (Array.isArray(draft.hostProfiles)) {
                const profiles = draft.hostProfiles.filter((profile: HostProfile) => !profile.detected);
                this.hostProfiles.set(profiles);
                const developerIds = new Set<string>(this.developers());
                for (const profile of profiles) developerIds.add(profile.userId);
                this.developers.set([...developerIds]);
            }
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
            if (Array.isArray(draft.workers)) this.workers.set(draft.workers);
            if (Array.isArray(draft.workerEdges)) this.workerEdges.set(draft.workerEdges);
            if (typeof draft.consent === 'boolean') this.consent.set(draft.consent);
            if (Array.isArray(draft.events)) this.events.set(draft.events);
        } catch {
            // Ignore malformed drafts.
        }
    }
}
