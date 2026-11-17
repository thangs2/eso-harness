import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import { HostModelSheetComponent } from '../components/host-model-sheet.component.js';
import type { HostRuntimeDto, HostRuntimeHealth, HostRuntimeKind } from '../../../../../../../libs/api-client/types.js';

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
                    <p class="subtitle">Hosts are shared across consumers. A consumer binds a host in Settings → Host Bindings. ESO queues work; the host runtime claims it and reports back.</p>
                </div>
                <div class="hosts-head-actions">
                    <button mat-flat-button color="primary" type="button" (click)="openRegister()">Register host runtime</button>
                </div>
            </header>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
            @if (notice(); as message) { <p class="saved-banner" role="status">{{ message }}</p> }

            @if (loading()) {
                <p class="loading-label">Loading hosts…</p>
            } @else {
                <section class="host-summary" aria-label="Host runtime summary">
                    <div class="stat"><span class="stat-label">Runtimes</span><strong class="stat-value">{{ summary().runtimes }}</strong></div>
                    <div class="stat"><span class="stat-label">Healthy</span><strong class="stat-value">{{ summary().healthy }}</strong></div>
                    <div class="stat"><span class="stat-label">Lead eligible</span><strong class="stat-value">{{ summary().leadEligible }}</strong></div>
                    <div class="stat"><span class="stat-label">Models</span><strong class="stat-value">{{ summary().models }}</strong></div>
                </section>

                @if (hosts().length === 0) {
                    <section class="empty-state">
                        <h3>No host runtime registered</h3>
                        <p class="muted">Register the runtime installed on a machine. Consumers can bind it from Settings → Host Bindings once it is healthy.</p>
                        <button mat-stroked-button type="button" (click)="openRegister()">Register host runtime</button>
                    </section>
                } @else {
                    <section class="host-grid" aria-label="Registered host runtimes">
                        @for (host of hosts(); track host.hostId) {
                            <article class="host-card">
                                <header class="host-card-head">
                                    <div class="host-card-title">
                                        <code>{{ host.hostId }}</code>
                                        <span class="host-runtime-id">{{ host.runtimeId }}</span>
                                    </div>
                                    <span class="health-badge"
                                          [class.health-healthy]="host.health === 'healthy'"
                                          [class.health-degraded]="host.health === 'degraded'"
                                          [class.health-offline]="host.health === 'offline'">{{ healthLabel(host.health) }}</span>
                                </header>
                                <dl class="host-card-facts">
                                    <div><dt>Runtime kind</dt><dd>{{ kindLabel(host.runtimeKind) }}</dd></div>
                                    <div>
                                        <dt>Models</dt>
                                        <dd>
                                            @if (host.models.length > 0) {
                                                <span class="host-default-model-row">
                                                    <button type="button" class="host-default-model" (click)="openModels(host)">{{ defaultModelOf(host) }}</button>
                                                    <button type="button" class="host-model-count" (click)="openModels(host)">{{ host.models.length }} model{{ host.models.length === 1 ? '' : 's' }} · view all</button>
                                                </span>
                                            } @else { <span class="host-models-pending">Waiting for host runtime model report</span> }
                                        </dd>
                                    </div>
                                    <div><dt>Lead eligible</dt><dd>{{ host.leadEligible ? 'Yes' : 'No' }}</dd></div>
                                    <div><dt>Last heartbeat</dt><dd [attr.title]="host.lastHeartbeat || 'Never'">{{ heartbeatLabel(host.lastHeartbeat) }}</dd></div>
                                </dl>
                                <footer class="host-card-actions">
                                    <button mat-stroked-button type="button" [disabled]="heartbeatBusy() === host.hostId" (click)="sendHeartbeat(host)">{{ heartbeatBusy() === host.hostId ? 'Sending…' : 'Heartbeat' }}</button>
                                    <button mat-stroked-button type="button" (click)="openEdit(host)">Edit</button>
                                </footer>
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
                                    <button mat-stroked-button type="button" (click)="openEdit(host)">Edit registration</button>
                                } @else {
                                    <button mat-stroked-button type="button" (click)="openRegisterFor(item.type)">Register runtime</button>
                                }
                            </article>
                        }
                    </div>
                </section>
            }

            @if (modelsDialogHost(); as host) {
                <eso-host-model-sheet [host]="host" [search]="modelsSearch()" (searchChange)="modelsSearch.set($event)" (closed)="closeModels()"></eso-host-model-sheet>
            }

            @if (dialogOpen()) {
                <div class="host-dialog-backdrop" (click)="closeDialog()">
                    <section #dialogPanel class="host-dialog" role="dialog" aria-modal="true" aria-labelledby="host-dialog-title" (click)="$event.stopPropagation()" (keydown)="trapFocus($event)">
                        <header class="host-dialog-head">
                            <div>
                                <p class="eyebrow">{{ editingHostId() ? 'Edit host runtime' : 'New host runtime' }}</p>
                                <h2 id="host-dialog-title">{{ editingHostId() ? 'Update ' + editingHostId() : 'Register host runtime' }}</h2>
                            </div>
                            <button mat-button type="button" (click)="closeDialog()">Cancel</button>
                        </header>
                        <div class="host-form">
                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                <mat-label>Host ID</mat-label>
                                <input matInput #hostIdInput [ngModel]="formHostId()" (ngModelChange)="formHostId.set($event)" [readOnly]="!!editingHostId()" placeholder="host-mac-01">
                                <mat-hint>{{ editingHostId() ? 'Host ID is the identity key and cannot change.' : 'Global identity for this machine, e.g. host-mac-01.' }}</mat-hint>
                            </mat-form-field>
                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                                <mat-label>Runtime ID</mat-label>
                                <input matInput [ngModel]="formRuntimeId()" (ngModelChange)="formRuntimeId.set($event)" placeholder="dsh-paseo">
                                <mat-hint>Host-native runtime that claims and executes runs. Workspace comes from the consumer, not the host.</mat-hint>
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
                            <div class="host-model-note full">
                                <strong>Models are reported by the host runtime</strong>
                                <span>ESO never asks you to type a model catalog. The host runtime sends its available models on registration or heartbeat.</span>
                            </div>
                            <mat-checkbox class="full" [checked]="formLeadEligible()" (change)="formLeadEligible.set($event.checked)">Lead eligible — this runtime may run the Lead turn</mat-checkbox>
                            @if (submitted() && formError(); as message) { <p class="form-error form-error-full" role="alert">{{ message }}</p> }
                        </div>
                        <footer class="host-dialog-actions">
                            <button mat-stroked-button type="button" (click)="closeDialog()">Cancel</button>
                            <button mat-flat-button color="primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : (editingHostId() ? 'Save changes' : 'Register') }}</button>
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
        .subtitle { color: var(--muted); margin: 0; max-width: 78ch; }
        .hosts-head-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; flex: none; }
        .host-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
        .host-summary .stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); display: grid; gap: 2px; min-width: 0; }
        .stat-label { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .stat-value { font-size: var(--text-xl); font-weight: 700; letter-spacing: -.02em; }
        .host-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-3); min-width: 0; }
        .host-catalog { display: grid; gap: var(--space-3); padding-top: var(--space-4); border-top: 1px solid var(--line); }
        .host-catalog-head h3 { margin: 0 0 2px; }
        .host-catalog-head p { margin: 0; }
        .host-catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-3); }
        .host-catalog-card { display: grid; gap: var(--space-2); padding: var(--space-4); border: 1px dashed var(--line); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 94%, var(--brand)); }
        .host-catalog-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        .host-catalog-title code { color: var(--muted); font-size: var(--text-xs); }
        .host-catalog-state { margin-left: auto; color: var(--muted); font-size: var(--text-xs); }
        .host-catalog-card p { margin: 0; font-size: var(--text-xs); }
        .host-catalog-card button { justify-self: start; }
        .host-catalog-dim { opacity: .55; }
        .host-card { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); min-width: 0; }
        .host-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); min-width: 0; }
        .host-card-title { display: grid; gap: 2px; min-width: 0; }
        .host-card-title code { color: var(--ink); font-size: var(--text-sm); font-weight: 650; overflow-wrap: anywhere; }
        .host-runtime-id { color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
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
            .host-grid { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 600px) {
            .page-header { flex-direction: column; }
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

    readonly loading = signal(true);
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);
    readonly notice = signal<string | null>(null);
    readonly hosts = signal<HostRuntimeDto[]>([]);
    readonly heartbeatBusy = signal<string | null>(null);
    readonly modelsDialogHost = signal<HostRuntimeDto | null>(null);
    readonly modelsSearch = signal('');

    readonly dialogOpen = signal(false);
    readonly editingHostId = signal<string | null>(null);
    readonly submitted = signal(false);
    readonly formHostId = signal('');
    readonly formRuntimeId = signal('');
    readonly formRuntimeKind = signal<HostRuntimeKind>('cli');
    readonly formLeadEligible = signal(false);
    readonly formHealth = signal<HostRuntimeHealth>('unknown');

    private readonly dialogPanel = viewChild<ElementRef<HTMLElement>>('dialogPanel');
    private readonly hostIdInput = viewChild<ElementRef<HTMLInputElement>>('hostIdInput');

    readonly summary = computed(() => {
        const hosts = this.hosts();
        const models = new Set<string>();
        for (const host of hosts) for (const model of host.models) models.add(model);
        return {
            runtimes: hosts.length,
            healthy: hosts.filter((host) => host.health === 'healthy').length,
            leadEligible: hosts.filter((host) => host.leadEligible).length,
            models: models.size,
        };
    });

    /** Known host types, joined with the global registry: registered = active, otherwise dimmed. */
    readonly catalogEntries = computed(() => {
        const byType = new Map<string, HostRuntimeDto>();
        for (const host of this.hosts()) byType.set(this.hostTypeOf(host), host);
        return HOST_CATALOG.map((item) => {
            const host = byType.get(item.type);
            return { ...item, state: host ? 'active' as const : 'not-registered' as const, host };
        });
    });

    hostTypeOf(host: HostRuntimeDto): string {
        const value = `${host.runtimeId} ${host.hostId}`.toLowerCase();
        if (value.includes('cursor')) return 'cursor';
        if (value.includes('agy') || value.includes('antigravity')) return 'agy';
        if (value.includes('dsh')) return 'dsh';
        if (value.includes('claude')) return 'claude';
        if (value.includes('codex')) return 'codex';
        if (value.includes('paseo')) return 'paseo';
        return host.hostId;
    }

    readonly formError = computed(() => {
        const hostId = this.formHostId().trim();
        if (!hostId) return 'Host ID is required.';
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(hostId)) return 'Host ID must be a slug: letters, digits, dot, dash, or underscore.';
        if (!this.editingHostId() && this.hosts().some((host) => host.hostId === hostId)) return 'A host runtime with this host ID already exists.';
        if (!this.formRuntimeId().trim()) return 'Runtime ID is required.';
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

    private load(): void {
        this.loading.set(true);
        this.error.set(null);
        this.service.getHostRuntimes()
            .then((hosts) => this.hosts.set([...hosts].sort((a, b) => a.hostId.localeCompare(b.hostId))))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not load hosts'))
            .finally(() => this.loading.set(false));
    }

    openRegister(): void {
        this.editingHostId.set(null);
        this.formHostId.set('');
        this.formRuntimeId.set('');
        this.formRuntimeKind.set('cli');
        this.formLeadEligible.set(false);
        this.formHealth.set('unknown');
        this.submitted.set(false);
        this.notice.set(null);
        this.dialogOpen.set(true);
    }

    openRegisterFor(type: string): void {
        const item = HOST_CATALOG.find((entry) => entry.type === type);
        this.openRegister();
        if (item) {
            this.formHostId.set(item.type);
            this.formRuntimeId.set(item.runtimeId);
            this.formRuntimeKind.set(item.kind);
        }
    }

    openEdit(host: HostRuntimeDto): void {
        this.editingHostId.set(host.hostId);
        this.formHostId.set(host.hostId);
        this.formRuntimeId.set(host.runtimeId);
        this.formRuntimeKind.set(host.runtimeKind);
        this.formLeadEligible.set(host.leadEligible);
        this.formHealth.set(host.health);
        this.submitted.set(false);
        this.notice.set(null);
        this.dialogOpen.set(true);
    }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (this.modelsDialogHost()) { this.closeModels(); return; }
        if (this.dialogOpen() && !this.saving()) this.closeDialog();
    }

    closeDialog(): void {
        if (this.saving()) return;
        this.dialogOpen.set(false);
        this.editingHostId.set(null);
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
        const hostId = this.formHostId().trim();
        const existing = this.hosts().find((host) => host.hostId === hostId);
        const runtime: HostRuntimeDto = {
            hostId,
            runtimeId: this.formRuntimeId().trim(),
            runtimeKind: this.formRuntimeKind(),
            models: existing?.models ?? [],
            defaultModel: existing?.defaultModel || '',
            leadEligible: this.formLeadEligible(),
            health: this.formHealth(),
            lastHeartbeat: existing?.lastHeartbeat ?? null,
        };
        this.saving.set(true);
        this.error.set(null);
        this.service.saveHostRuntime(runtime)
            .then((saved) => {
                const next = { ...runtime, ...saved, hostId: saved.hostId || hostId };
                this.hosts.update((hosts) => {
                    const others = hosts.filter((host) => host.hostId !== next.hostId);
                    return [...others, next].sort((a, b) => a.hostId.localeCompare(b.hostId));
                });
                this.notice.set(existing ? `Host runtime ${next.hostId} updated.` : `Host runtime ${next.hostId} registered.`);
                this.dialogOpen.set(false);
                this.editingHostId.set(null);
                this.submitted.set(false);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not save host runtime'))
            .finally(() => this.saving.set(false));
    }

    sendHeartbeat(host: HostRuntimeDto): void {
        if (this.heartbeatBusy()) return;
        this.heartbeatBusy.set(host.hostId);
        this.error.set(null);
        this.service.sendHostHeartbeat(host.hostId)
            .then((updated) => {
                if (!updated) {
                    this.error.set(`Heartbeat response missing for ${host.hostId}.`);
                    return;
                }
                const next: HostRuntimeDto = { ...host, ...updated };
                this.hosts.update((hosts) => hosts.map((item) => item.hostId === host.hostId ? next : item));
                this.notice.set(`Heartbeat recorded for ${host.hostId}.`);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not record heartbeat'))
            .finally(() => this.heartbeatBusy.set(null));
    }

    kindLabel(kind: HostRuntimeKind): string {
        return RUNTIME_KINDS.find((item) => item.value === kind)?.label || kind;
    }

    healthLabel(health: HostRuntimeHealth): string {
        return health.charAt(0).toUpperCase() + health.slice(1);
    }

    defaultModelOf(host: HostRuntimeDto): string {
        return host.defaultModel || host.models[0] || '';
    }

    openModels(host: HostRuntimeDto): void {
        this.modelsSearch.set('');
        this.modelsDialogHost.set(host);
    }

    closeModels(): void {
        this.modelsDialogHost.set(null);
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
