import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import { HostModelSheetComponent } from '../components/host-model-sheet.component.js';
import type { HostDto, HostRuntimeDto, HostRuntimeHealth, HostRuntimeKind } from '../../../../../../../libs/api-client/types.js';

const RUNTIME_KINDS: Array<{ value: HostRuntimeKind; label: string }> = [
    { value: 'ide-native', label: 'IDE native' },
    { value: 'cli', label: 'CLI' },
    { value: 'acp', label: 'ACP' },
];

const HEALTH_STATES: HostRuntimeHealth[] = ['unknown', 'healthy', 'degraded', 'offline'];

const HOST_CATALOG: Array<{ type: string; label: string; runtimeId: string; kind: HostRuntimeKind }> = [
    { type: 'cursor', label: 'Cursor', runtimeId: 'cursor-agent', kind: 'cli' },
    { type: 'agy', label: 'Antigravity', runtimeId: 'agy', kind: 'acp' },
    { type: 'dsh', label: 'DSH', runtimeId: 'dsh', kind: 'cli' },
    { type: 'claude', label: 'Claude', runtimeId: 'claude', kind: 'cli' },
    { type: 'codex', label: 'Codex', runtimeId: 'codex', kind: 'cli' },
    { type: 'paseo', label: 'Paseo', runtimeId: 'paseo', kind: 'acp' },
    { type: 'orca', label: 'Orca', runtimeId: 'orca', kind: 'acp' },
];

type DialogMode = 'register' | 'host' | 'runtime';

@Component({
    selector: 'eso-hosts-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, HostModelSheetComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="hosts-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">System · hosts</p>
                    <h1>Hosts</h1>
                    <p class="subtitle">Hosts are shared across consumers. A consumer binds a host in Settings → Host Bindings. ESO stores configuration and observations only. The host runtime executes in the session where the user prompts.</p>
                </div>
                <div class="hosts-head-actions">
                    <button mat-flat-button color="primary" type="button" (click)="openRegister()">Register host</button>
                </div>
            </header>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
            @if (notice(); as message) { <p class="saved-banner" role="status">{{ message }}</p> }

            @if (loading()) {
                <p class="loading-label">Loading hosts…</p>
            } @else {
                <section class="host-summary" aria-label="Host summary">
                    <div class="stat"><span class="stat-label">Hosts</span><strong class="stat-value">{{ summary().hosts }}</strong></div>
                    <div class="stat"><span class="stat-label">Runtimes</span><strong class="stat-value">{{ summary().runtimes }}</strong></div>
                    <div class="stat"><span class="stat-label">Healthy</span><strong class="stat-value">{{ summary().healthy }}</strong></div>
                    <div class="stat"><span class="stat-label">Models</span><strong class="stat-value">{{ summary().models }}</strong></div>
                </section>

                @if (hosts().length === 0) {
                    <section class="empty-state">
                        <h3>No host registered</h3>
                        <p class="muted">Register a machine and its first runtime. Consumers can bind the host from Settings → Host Bindings.</p>
                        <button mat-stroked-button type="button" (click)="openRegister()">Register host</button>
                    </section>
                } @else {
                    <section class="host-grid" aria-label="Registered hosts">
                        @for (host of hosts(); track host.hostId) {
                            <article class="host-group">
                                <header class="host-group-head">
                                    <div class="host-group-title">
                                        <code>{{ host.hostId }}</code>
                                        <span class="host-type-badge">{{ hostTypeLabel(host.hostType) }}</span>
                                        <span class="host-label">{{ host.label || 'No label' }}</span>
                                    </div>
                                    <div class="host-group-actions">
                                        <button mat-stroked-button type="button" (click)="openEditHost(host)">Edit host</button>
                                        <button mat-stroked-button type="button" (click)="openAddRuntime(host)">Add runtime</button>
                                    </div>
                                </header>

                                <div class="runtime-grid">
                                    @for (runtime of host.runtimes; track runtime.runtimeKey) {
                                        <article class="runtime-card">
                                            <header class="runtime-head">
                                                <div class="runtime-title">
                                                    <code>{{ runtime.runtimeId }}</code>
                                                    <span class="runtime-key">{{ runtime.runtimeKey }}</span>
                                                    @if (runtime.remoteUrl) { <span class="runtime-remote" [attr.title]="runtime.remoteUrl">remote {{ runtime.remoteUrl }}</span> }
                                                </div>
                                                <span class="health-badge"
                                                      [class.health-healthy]="runtime.health === 'healthy'"
                                                      [class.health-degraded]="runtime.health === 'degraded'"
                                                      [class.health-offline]="runtime.health === 'offline'">{{ healthLabel(runtime.health) }}</span>
                                            </header>
                                            <dl class="host-card-facts">
                                                <div><dt>Runtime kind</dt><dd>{{ kindLabel(runtime.runtimeKind) }}</dd></div>
                                                <div>
                                                    <dt>Models</dt>
                                                    <dd>
                                                        @if (runtime.models.length > 0) {
                                                            <span class="host-default-model-row">
                                                                <button type="button" class="host-default-model" (click)="openModels(runtime)">{{ defaultModelOf(runtime) }}</button>
                                                                <button type="button" class="host-model-count" (click)="openModels(runtime)">{{ runtime.models.length }} model{{ runtime.models.length === 1 ? '' : 's' }} · view all</button>
                                                            </span>
                                                        } @else { <span class="host-models-pending">Waiting for host runtime model report</span> }
                                                    </dd>
                                                </div>
                                                <div><dt>Lead eligible</dt><dd>{{ runtime.leadEligible ? 'Yes' : 'No' }}</dd></div>
                                                <div><dt>Last heartbeat</dt><dd [attr.title]="runtime.lastHeartbeat || 'Never'">{{ heartbeatLabel(runtime.lastHeartbeat) }}</dd></div>
                                            </dl>
                                            <footer class="host-card-actions">
                                                <button mat-stroked-button type="button" [disabled]="heartbeatBusy() === runtime.runtimeKey" (click)="sendHeartbeat(runtime)">{{ heartbeatBusy() === runtime.runtimeKey ? 'Sending…' : 'Heartbeat' }}</button>
                                                <button mat-stroked-button type="button" (click)="openEditRuntime(host, runtime)">Edit runtime</button>
                                            </footer>
                                        </article>
                                    } @empty {
                                        <p class="muted">No runtime registered on this host yet. Add one to place workers here.</p>
                                    }
                                </div>
                            </article>
                        }
                    </section>
                }

                <section class="host-catalog" aria-label="Host catalog">
                    <header class="host-catalog-head">
                        <div><h3>Host catalog</h3><p class="muted">Known host types without a global registration are dimmed. Register a runtime when installed.</p></div>
                    </header>
                    <div class="host-catalog-grid">
                        @for (item of catalogEntries(); track item.type) {
                            <article class="host-catalog-card" [class.host-catalog-dim]="item.state === 'not-registered'">
                                <div class="host-catalog-title"><strong>{{ item.label }}</strong><code>{{ item.type }}</code><span class="host-catalog-state">{{ item.state === 'active' ? 'Registered · active' : 'Not registered' }}</span></div>
                                <p class="muted">{{ item.state === 'active' ? 'A global registration exists. Every consumer can bind this host.' : 'No global registration yet. If the host is installed, register its runtime.' }}</p>
                                @if (item.host; as host) {
                                    <div class="host-catalog-actions">
                                        <button mat-stroked-button type="button" (click)="openEditHost(host)">Edit host</button>
                                        <button mat-stroked-button type="button" (click)="openAddRuntime(host)">Add runtime</button>
                                    </div>
                                } @else {
                                    <button mat-stroked-button type="button" (click)="openRegisterFor(item.type)">Register host</button>
                                }
                            </article>
                        }
                    </div>
                </section>
            }

            @if (modelsDialogRuntime(); as runtime) {
                <eso-host-model-sheet [host]="runtime" [search]="modelsSearch()" (searchChange)="modelsSearch.set($event)" (closed)="closeModels()"></eso-host-model-sheet>
            }

            @if (dialogOpen()) {
                <div class="host-dialog-backdrop" (click)="closeDialog()">
                    <section #dialogPanel class="host-dialog" role="dialog" aria-modal="true" aria-labelledby="host-dialog-title" (click)="$event.stopPropagation()" (keydown)="trapFocus($event)">
                        <header class="host-dialog-head">
                            <div>
                                <p class="eyebrow">{{ dialogEyebrow() }}</p>
                                <h2 id="host-dialog-title">{{ dialogTitle() }}</h2>
                            </div>
                            <button mat-button type="button" (click)="closeDialog()">Cancel</button>
                        </header>
                        <div class="host-form">
                            <div class="dialog-section full">
                                <strong>Host</strong>
                                <span>{{ dialogMode() === 'register' ? 'One machine. It can host several runtimes.' : 'Machine metadata. Host ID cannot change.' }}</span>
                            </div>
                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                <mat-label>Host ID</mat-label>
                                <input matInput #hostIdInput [ngModel]="formHostId()" (ngModelChange)="formHostId.set($event)" [readOnly]="dialogMode() !== 'register'" placeholder="host-mac-01">
                                <mat-hint>{{ dialogMode() === 'register' ? 'Global identity for this machine, e.g. host-mac-01.' : 'Host ID is the identity key and cannot change.' }}</mat-hint>
                            </mat-form-field>
                            <mat-form-field appearance="outline" subscriptSizing="dynamic">
                                <mat-label>Host type</mat-label>
                                <mat-select [ngModel]="formHostType()" (ngModelChange)="formHostType.set($event)">
                                    @for (item of hostCatalog; track item.type) { <mat-option [value]="item.type">{{ item.label }}</mat-option> }
                                </mat-select>
                            </mat-form-field>
                            <mat-form-field appearance="outline" subscriptSizing="dynamic">
                                <mat-label>Host label</mat-label>
                                <input matInput [ngModel]="formHostLabel()" (ngModelChange)="formHostLabel.set($event)" placeholder="MacBook Pro · office">
                            </mat-form-field>

                            @if (dialogMode() !== 'host') {
                                <div class="dialog-section full">
                                    <strong>Runtime</strong>
                                    <span>A runtime is one agent surface on this host. One host can run Cursor and AGY side by side.</span>
                                </div>
                                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                    <mat-label>Runtime ID</mat-label>
                                    <input matInput [ngModel]="formRuntimeId()" (ngModelChange)="formRuntimeId.set($event)" [readOnly]="dialogMode() === 'runtime' && !!editingRuntimeId()" placeholder="cursor-agent">
                                    <mat-hint>Runtime key is <code>{{ runtimeKeyPreview() }}</code> — the placement target for workers.</mat-hint>
                                </mat-form-field>
                                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                                    <mat-label>Runtime kind</mat-label>
                                    <mat-select [ngModel]="formRuntimeKind()" (ngModelChange)="formRuntimeKind.set($event)">
                                        @for (kind of runtimeKinds; track kind.value) { <mat-option [value]="kind.value">{{ kind.label }}</mat-option> }
                                    </mat-select>
                                    <mat-hint>CLI = one-shot process · ACP = persistent JSON-RPC stdio · IDE native = session only</mat-hint>
                                </mat-form-field>
                                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                                    <mat-label>Health</mat-label>
                                    <mat-select [ngModel]="formHealth()" (ngModelChange)="formHealth.set($event)">
                                        @for (state of healthStates; track state) { <mat-option [value]="state">{{ healthLabel(state) }}</mat-option> }
                                    </mat-select>
                                </mat-form-field>
                                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                    <mat-label>Remote endpoint</mat-label>
                                    <input matInput type="url" [ngModel]="formRemoteUrl()" (ngModelChange)="formRemoteUrl.set($event)" placeholder="http://127.0.0.1:8788">
                                    <mat-hint>Optional HTTP endpoint for host-to-host Mode B. ESO stores config only.</mat-hint>
                                </mat-form-field>
                                <div class="host-model-note full">
                                    <strong>Models are reported by the host runtime</strong>
                                    <span>ESO never asks you to type a model catalog. The host runtime sends its available models on registration or heartbeat.</span>
                                </div>
                                <mat-checkbox class="full" [checked]="formLeadEligible()" (change)="formLeadEligible.set($event.checked)">Lead eligible — this runtime may run the Lead turn</mat-checkbox>
                            }
                            @if (submitted() && formError(); as message) { <p class="form-error form-error-full" role="alert">{{ message }}</p> }
                        </div>
                        <footer class="host-dialog-actions">
                            <button mat-stroked-button type="button" (click)="closeDialog()">Cancel</button>
                            <button mat-flat-button color="primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : saveLabel() }}</button>
                        </footer>
                    </section>
                </div>
            }
        </main>
    `,
    styles: [`
        .hosts-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); max-width: var(--container); min-width: 0; margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; min-width: 0; }
        .page-header h1 { margin: 0 0 var(--space-1); }
        .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: var(--text-xs); margin: 0 0 var(--space-1); }
        .subtitle { color: var(--muted); margin: 0; max-width: 82ch; }
        .hosts-head-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; flex: none; }
        .host-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
        .host-summary .stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); display: grid; gap: 2px; min-width: 0; }
        .stat-label { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .stat-value { font-size: var(--text-xl); font-weight: 700; letter-spacing: -.02em; }
        .host-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); min-width: 0; }
        .host-group { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); min-width: 0; }
        .host-group-head { display: flex; justify-content: space-between; gap: var(--space-3); align-items: flex-start; flex-wrap: wrap; min-width: 0; }
        .host-group-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; }
        .host-group-title code { color: var(--ink); font-size: var(--text-sm); font-weight: 650; overflow-wrap: anywhere; }
        .host-type-badge { border: 1px solid color-mix(in srgb, var(--brand) 55%, var(--line)); border-radius: 999px; padding: 1px var(--space-2); font-size: var(--text-xs); color: var(--brand); background: color-mix(in srgb, var(--surface) 90%, var(--brand)); white-space: nowrap; }
        .host-label { color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
        .host-group-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .runtime-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-3); min-width: 0; }
        .runtime-card { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--surface) 96%, var(--brand)); min-width: 0; }
        .runtime-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); min-width: 0; }
        .runtime-title { display: grid; gap: 2px; min-width: 0; }
        .runtime-title code { color: var(--ink); font-size: var(--text-sm); font-weight: 600; overflow-wrap: anywhere; }
        .runtime-key { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
        .host-catalog { display: grid; gap: var(--space-3); padding-top: var(--space-4); border-top: 1px solid var(--line); }
        .host-catalog-head h3 { margin: 0 0 2px; }
        .host-catalog-head p { margin: 0; }
        .host-catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-3); }
        .host-catalog-card { display: grid; gap: var(--space-2); padding: var(--space-4); border: 1px dashed var(--line); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 94%, var(--brand)); }
        .host-catalog-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        .host-catalog-title code { color: var(--muted); font-size: var(--text-xs); }
        .host-catalog-state { margin-left: auto; color: var(--muted); font-size: var(--text-xs); }
        .host-catalog-card p { margin: 0; font-size: var(--text-xs); }
        .host-catalog-card button, .host-catalog-actions { justify-self: start; }
        .host-catalog-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .host-catalog-dim { opacity: .55; }
        .health-badge { display: inline-flex; align-items: center; gap: var(--space-1); padding: 2px var(--space-2); border: 1px solid var(--line); border-radius: 999px; font-size: var(--text-xs); text-transform: capitalize; background: color-mix(in srgb, var(--surface) 90%, var(--brand)); color: var(--muted); flex: none; }
        .health-healthy { background: var(--ok-bg); border-color: color-mix(in srgb, var(--ok-ink) 45%, transparent); color: var(--ok-ink); }
        .health-degraded { background: var(--warn-bg); border-color: color-mix(in srgb, var(--warn-ink) 45%, transparent); color: var(--warn-ink); }
        .health-offline { background: var(--danger-bg); border-color: color-mix(in srgb, var(--danger-ink) 45%, transparent); color: var(--danger-ink); }
        .host-card-facts { display: grid; gap: var(--space-2); margin: 0; }
        .host-card-facts > div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: var(--space-2); align-items: start; }
        .host-card-facts dt { color: var(--muted); font-size: var(--text-xs); }
        .host-card-facts dd { margin: 0; font-size: var(--text-sm); min-width: 0; overflow-wrap: anywhere; }
        .host-default-model-row { display: grid; gap: 2px; justify-items: start; }
        .host-default-model { padding: 2px var(--space-2); border: 1px solid var(--brand); border-radius: 999px; background: color-mix(in srgb, var(--brand) 12%, var(--surface)); color: var(--ink); font: inherit; font-size: var(--text-xs); cursor: pointer; }
        .host-default-model:hover { background: color-mix(in srgb, var(--brand) 22%, var(--surface)); }
        .host-model-count { padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: var(--text-xs); cursor: pointer; text-align: left; }
        .host-model-count:hover { color: var(--ink); text-decoration: underline; }
        .host-models-pending { color: var(--warn-ink); font-size: var(--text-xs); }
        .host-model-note { display: grid; gap: 2px; padding: var(--space-2) var(--space-3); border: 1px dashed var(--line); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--surface) 94%, var(--brand)); }
        .host-model-note strong { font-size: var(--text-sm); }
        .host-model-note span { color: var(--muted); font-size: var(--text-xs); }
        .host-model-note.full { grid-column: 1 / -1; }
        .dialog-section { display: grid; gap: 2px; padding: var(--space-2) var(--space-3); border-left: 2px solid var(--brand); background: color-mix(in srgb, var(--surface) 95%, var(--brand)); border-radius: var(--radius-sm); }
        .dialog-section strong { font-size: var(--text-sm); }
        .dialog-section span { color: var(--muted); font-size: var(--text-xs); }
        .host-card-actions { display: flex; justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line); flex-wrap: wrap; }
        .empty-state { border: 1px dashed var(--line); border-radius: var(--radius-md); padding: var(--space-6); text-align: center; display: grid; gap: var(--space-2); justify-items: center; }
        .empty-state h3 { margin: 0; }
        .empty-state p { margin: 0; max-width: 60ch; }
        .loading-label { color: var(--muted); margin: 0; }
        .saved-banner { border-left: 4px solid var(--brand); background: color-mix(in srgb, var(--surface) 88%, var(--brand)); padding: var(--space-3); border-radius: var(--radius-sm); margin: 0; }
        .form-error { margin: 0; color: var(--danger-ink); background: var(--danger-bg); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); font-size: var(--text-sm); }
        .host-dialog-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: var(--space-4); background: color-mix(in srgb, #000 55%, transparent); overflow-y: auto; }
        .host-dialog { display: grid; gap: var(--space-4); width: min(680px, 100%); max-height: calc(100dvh - var(--space-7)); overflow-y: auto; padding: var(--space-5); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }
        .host-dialog-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); }
        .host-dialog-head h2 { margin: 0; font-size: var(--text-lg); }
        .host-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); min-width: 0; }
        .host-form .full, .host-form .form-error-full { grid-column: 1 / -1; }
        .host-form mat-form-field { width: 100%; min-width: 0; }
        .host-form .mat-mdc-checkbox { align-self: center; }
        .host-dialog-actions { display: flex; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
        @media (max-width: 900px) {
            .host-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .runtime-grid { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 600px) {
            .page-header, .host-group-head { flex-direction: column; }
            .host-form { grid-template-columns: minmax(0, 1fr); }
            .host-card-facts > div { grid-template-columns: minmax(0, 1fr); gap: 0; }
            .host-dialog { padding: var(--space-4); }
        }
    `],
})
export class HostsPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);

    readonly runtimeKinds = RUNTIME_KINDS;
    readonly healthStates = HEALTH_STATES;
    readonly hostCatalog = HOST_CATALOG;

    readonly loading = signal(true);
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);
    readonly notice = signal<string | null>(null);
    readonly hosts = signal<HostDto[]>([]);
    readonly heartbeatBusy = signal<string | null>(null);
    readonly modelsDialogRuntime = signal<HostRuntimeDto | null>(null);
    readonly modelsSearch = signal('');

    readonly dialogOpen = signal(false);
    readonly dialogMode = signal<DialogMode>('register');
    readonly editingHostId = signal<string | null>(null);
    readonly editingRuntimeId = signal<string | null>(null);
    readonly submitted = signal(false);
    readonly formHostId = signal('');
    readonly formHostType = signal('cursor');
    readonly formHostLabel = signal('');
    readonly formRuntimeId = signal('');
    readonly formRuntimeKind = signal<HostRuntimeKind>('cli');
    readonly formLeadEligible = signal(false);
    readonly formHealth = signal<HostRuntimeHealth>('unknown');
    readonly formRemoteUrl = signal('');

    private readonly dialogPanel = viewChild<ElementRef<HTMLElement>>('dialogPanel');
    private readonly hostIdInput = viewChild<ElementRef<HTMLInputElement>>('hostIdInput');

    readonly summary = computed(() => {
        const hosts = this.hosts();
        const runtimes = hosts.flatMap((host) => host.runtimes);
        const models = new Set<string>();
        for (const runtime of runtimes) for (const model of runtime.models) models.add(model);
        return {
            hosts: hosts.length,
            runtimes: runtimes.length,
            healthy: runtimes.filter((runtime) => runtime.health === 'healthy').length,
            models: models.size,
        };
    });

    /** Known host types: active when any registered host has this host type. */
    readonly catalogEntries = computed(() => HOST_CATALOG.map((item) => {
        const host = this.hosts().find((entry) => entry.hostType === item.type);
        return { ...item, state: host ? 'active' as const : 'not-registered' as const, host };
    }));

    readonly runtimeKeyPreview = computed(() => {
        const hostId = this.formHostId().trim() || 'host-id';
        const runtimeId = this.formRuntimeId().trim() || 'runtime-id';
        return `${hostId}:${runtimeId}`;
    });

    readonly dialogEyebrow = computed(() => {
        const mode = this.dialogMode();
        if (mode === 'host') return 'Host metadata';
        if (mode === 'runtime') return this.editingRuntimeId() ? 'Edit runtime' : 'New runtime';
        return 'New host';
    });

    readonly dialogTitle = computed(() => {
        const mode = this.dialogMode();
        if (mode === 'host') return `Edit ${this.editingHostId()}`;
        if (mode === 'runtime') return this.editingRuntimeId() ? `Edit ${this.editingHostId()}:${this.editingRuntimeId()}` : `Add runtime to ${this.editingHostId()}`;
        return 'Register host';
    });

    readonly saveLabel = computed(() => {
        if (this.saving()) return 'Saving…';
        if (this.dialogMode() === 'register') return 'Register';
        return 'Save changes';
    });

    readonly formError = computed(() => {
        if (this.dialogMode() !== 'runtime') {
            const hostId = this.formHostId().trim();
            if (!hostId) return 'Host ID is required.';
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(hostId)) return 'Host ID must be a slug: letters, digits, dot, dash, or underscore.';
            if (this.dialogMode() === 'register' && this.hosts().some((host) => host.hostId === hostId)) return 'A host with this host ID already exists.';
            if (!this.formHostType().trim()) return 'Host type is required.';
            if (!this.formHostLabel().trim()) return 'Host label is required.';
        }
        if (this.dialogMode() === 'register' || (this.dialogMode() === 'runtime' && !this.editingRuntimeId())) {
            const runtimeId = this.formRuntimeId().trim();
            if (!runtimeId) return 'Runtime ID is required.';
            const host = this.hosts().find((entry) => entry.hostId === this.editingHostId() || entry.hostId === this.formHostId().trim());
            if (host && host.runtimes.some((runtime) => runtime.runtimeId === runtimeId)) return 'This host already has a runtime with this runtime ID.';
        }
        return '';
    });

    constructor() {
        effect(() => {
            if (!this.dialogOpen()) return;
            setTimeout(() => this.hostIdInput()?.nativeElement.focus());
        });
    }

    ngOnInit(): void {
        void this.load();
    }

    private load(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);
        return this.service.getHosts()
            .then((hosts) => this.hosts.set(hosts.map((host) => ({
                ...host,
                runtimes: [...(host.runtimes || [])].sort((a, b) => a.runtimeId.localeCompare(b.runtimeId)),
            })).sort((a, b) => a.hostId.localeCompare(b.hostId))))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not load hosts'))
            .finally(() => this.loading.set(false));
    }

    openRegister(): void {
        this.configureDialog('register', null);
        this.formHostId.set('');
        this.formHostType.set('cursor');
        this.formHostLabel.set('');
        this.formRuntimeId.set('');
        this.formRuntimeKind.set('cli');
        this.formLeadEligible.set(false);
        this.formHealth.set('unknown');
        this.formRemoteUrl.set('');
    }

    openRegisterFor(type: string): void {
        const item = HOST_CATALOG.find((entry) => entry.type === type);
        this.openRegister();
        if (item) {
            this.formHostId.set(item.type);
            this.formHostType.set(item.type);
            this.formHostLabel.set(item.label);
            this.formRuntimeId.set(item.runtimeId);
            this.formRuntimeKind.set(item.kind);
        }
    }

    openEditHost(host: HostDto): void {
        this.configureDialog('host', host.hostId);
        this.formHostId.set(host.hostId);
        this.formHostType.set(host.hostType);
        this.formHostLabel.set(host.label || '');
    }

    openAddRuntime(host: HostDto): void {
        this.configureDialog('runtime', host.hostId);
        this.formHostId.set(host.hostId);
        this.formHostType.set(host.hostType);
        this.formHostLabel.set(host.label || '');
        this.formRuntimeId.set('');
        this.formRuntimeKind.set('cli');
        this.formLeadEligible.set(false);
        this.formHealth.set('unknown');
        this.formRemoteUrl.set('');
    }

    openEditRuntime(host: HostDto, runtime: HostRuntimeDto): void {
        this.configureDialog('runtime', host.hostId);
        this.editingRuntimeId.set(runtime.runtimeId);
        this.formHostId.set(host.hostId);
        this.formHostType.set(host.hostType);
        this.formHostLabel.set(host.label || '');
        this.formRuntimeId.set(runtime.runtimeId);
        this.formRuntimeKind.set(runtime.runtimeKind);
        this.formLeadEligible.set(runtime.leadEligible);
        this.formHealth.set(runtime.health);
        this.formRemoteUrl.set(runtime.remoteUrl || '');
    }

    private configureDialog(mode: DialogMode, hostId: string | null): void {
        this.dialogMode.set(mode);
        this.editingHostId.set(hostId);
        this.editingRuntimeId.set(null);
        this.submitted.set(false);
        this.notice.set(null);
        this.error.set(null);
        this.dialogOpen.set(true);
    }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (this.modelsDialogRuntime()) { this.closeModels(); return; }
        if (this.dialogOpen() && !this.saving()) this.closeDialog();
    }

    closeDialog(): void {
        if (this.saving()) return;
        this.dialogOpen.set(false);
        this.dialogMode.set('register');
        this.editingHostId.set(null);
        this.editingRuntimeId.set(null);
        this.submitted.set(false);
        this.error.set(null);
    }

    trapFocus(event: KeyboardEvent): void {
        if (event.key !== 'Tab') return;
        const panel = this.dialogPanel()?.nativeElement;
        if (!panel) return;
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    save(): void {
        this.submitted.set(true);
        if (this.formError() || this.saving()) return;
        this.saving.set(true);
        this.error.set(null);
        const mode = this.dialogMode();
        const hostId = this.formHostId().trim();
        const hostType = this.formHostType();
        const label = this.formHostLabel().trim();
        const runtimeId = this.formRuntimeId().trim();
        const runtime: HostRuntimeDto = {
            hostId,
            hostType,
            runtimeId,
            runtimeKey: `${hostId}:${runtimeId}`,
            runtimeKind: this.formRuntimeKind(),
            models: this.findRuntime(hostId, runtimeId)?.models ?? [],
            defaultModel: this.findRuntime(hostId, runtimeId)?.defaultModel || '',
            leadEligible: this.formLeadEligible(),
            health: this.formHealth(),
            lastHeartbeat: this.findRuntime(hostId, runtimeId)?.lastHeartbeat ?? null,
            remoteUrl: this.formRemoteUrl().trim() || null,
        };
        const saveHost = mode === 'runtime' ? Promise.resolve(null) : this.service.saveHost({ hostId, hostType, label });
        saveHost
            .then(() => mode === 'host' ? null : this.service.saveHostRuntime(runtime))
            .then((savedRuntime) => {
                const savedId = savedRuntime?.runtimeKey || runtime.runtimeKey;
                if (mode === 'register') this.notice.set(`Host ${hostId} registered with runtime ${savedId}.`);
                else if (mode === 'host') this.notice.set(`Host ${hostId} updated.`);
                else this.notice.set(`Runtime ${savedId} saved.`);
                this.dialogOpen.set(false);
                this.editingHostId.set(null);
                this.editingRuntimeId.set(null);
                this.submitted.set(false);
                return this.load();
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not save host'))
            .finally(() => this.saving.set(false));
    }

    private findRuntime(hostId: string, runtimeId: string): HostRuntimeDto | undefined {
        return this.hosts().find((host) => host.hostId === hostId)?.runtimes.find((runtime) => runtime.runtimeId === runtimeId);
    }

    sendHeartbeat(runtime: HostRuntimeDto): void {
        if (this.heartbeatBusy()) return;
        this.heartbeatBusy.set(runtime.runtimeKey);
        this.error.set(null);
        this.service.heartbeatHostRuntime(runtime.hostId, runtime.runtimeId)
            .then((updated) => {
                if (!updated) {
                    this.error.set(`Heartbeat response missing for ${runtime.runtimeKey}.`);
                    return;
                }
                const next: HostRuntimeDto = { ...runtime, ...updated, hostId: runtime.hostId, hostType: runtime.hostType, runtimeId: runtime.runtimeId, runtimeKey: runtime.runtimeKey };
                this.hosts.update((hosts) => hosts.map((host) => host.hostId === runtime.hostId
                    ? { ...host, runtimes: host.runtimes.map((item) => item.runtimeKey === runtime.runtimeKey ? next : item) }
                    : host));
                this.notice.set(`Heartbeat recorded for ${runtime.runtimeKey}.`);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not record heartbeat'))
            .finally(() => this.heartbeatBusy.set(null));
    }

    hostTypeLabel(type: string): string {
        return HOST_CATALOG.find((item) => item.type === type)?.label || type;
    }

    kindLabel(kind: HostRuntimeKind): string {
        return RUNTIME_KINDS.find((item) => item.value === kind)?.label || kind;
    }

    healthLabel(health: HostRuntimeHealth): string {
        return health.charAt(0).toUpperCase() + health.slice(1);
    }

    defaultModelOf(runtime: HostRuntimeDto): string {
        return runtime.defaultModel || runtime.models[0] || '';
    }

    openModels(runtime: HostRuntimeDto): void {
        this.modelsSearch.set('');
        this.modelsDialogRuntime.set(runtime);
    }

    closeModels(): void {
        this.modelsDialogRuntime.set(null);
    }

    heartbeatLabel(value: string | null): string {
        if (!value) return 'Never';
        const time = new Date(value).getTime();
        if (!Number.isFinite(time)) return value;
        const diff = Date.now() - time;
        if (diff < 60_000) return 'Just now';
        const minutes = Math.floor(diff / 60_000);
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days} d ago`;
        return new Date(time).toLocaleDateString();
    }
}
