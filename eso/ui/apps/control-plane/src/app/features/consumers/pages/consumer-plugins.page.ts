import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { ConsumerPluginDto, PluginPropertyDto } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-consumer-plugins-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="consumer-plugins-page">
            <header class="page-header">
                <div><p class="eyebrow">Consumer setup · providers</p><h1>Providers</h1><p class="subtitle">Activate and configure external sources for this consumer. Files remain the default when no provider is selected.</p></div>
                <div class="actions-row"><button mat-stroked-button type="button" (click)="openRegistry()">Registry</button></div>
            </header>
            

            <section class="plugin-summary" aria-label="Provider summary">
                <div><span>Providers</span><strong>{{ providers().length }}</strong><small>available for this consumer</small></div>
                <div><span>Enabled</span><strong>{{ enabledCount() }}</strong><small>activated</small></div>
                <div><span>Healthy</span><strong>{{ healthyCount() }}</strong><small>tested and reachable</small></div>
                <div><span>Host adapters</span><strong>{{ hostCount() }}</strong><small>managed by Host bindings</small></div>
            </section>

            @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }

            <div class="plugin-layout">
                <aside class="plugin-list">
                    <header><div><p class="eyebrow">Provider registry</p><h2>External sources</h2></div></header>
                    @for (group of groups(); track group.id) {
                        <p class="plugin-group-label">{{ group.label }}</p>
                        @for (plugin of group.plugins; track plugin.id) {
                            <button type="button" class="plugin-row" [class.active]="selectedId() === plugin.id" (click)="select(plugin)">
                                <span class="plugin-mark" [attr.data-category]="plugin.category">{{ plugin.label.slice(0, 1) }}</span>
                                <span class="plugin-copy"><strong>{{ plugin.label }}</strong><small>{{ plugin.capabilities.join(' · ') }}</small></span>
                                <span class="plugin-state" [class.plugin-state-ok]="pluginStatus(plugin) === 'healthy'" [class.plugin-state-warn]="pluginStatus(plugin) === 'unreachable' || pluginStatus(plugin) === 'needs config'">{{ pluginStatus(plugin) }}</span>
                            </button>
                        }
                    }
                    <p class="plugin-list-note">Host adapters are not providers. Bind them in <button type="button" class="link-button" (click)="openHosts()">Host bindings</button>.</p>
                </aside>

                <section class="plugin-config">
                    @if (selected(); as plugin) {
                        <header class="plugin-config-head">
                            <div class="plugin-identity">
                                <span class="plugin-mark plugin-mark-lg" [attr.data-category]="plugin.category">{{ plugin.label.slice(0, 1) }}</span>
                                <div><p class="eyebrow">{{ categoryLabel(plugin.category) }} · {{ plugin.id }}</p><h2>{{ plugin.label }}</h2><p>{{ plugin.description }}</p></div>
                            </div>
                            <span class="plugin-state" [class.plugin-state-ok]="pluginStatus(plugin) === 'healthy'" [class.plugin-state-warn]="pluginStatus(plugin) === 'unreachable' || pluginStatus(plugin) === 'needs config'">{{ pluginStatus(plugin) }}</span>
                        </header>

                        <div class="plugin-lifecycle" aria-label="Provider lifecycle">
                            <div class="done"><b>1</b><span>Installed</span><small>v{{ plugin.version }}</small></div>
                            <div [class.done]="plugin.enabled"><b>2</b><span>Enabled</span><small>{{ plugin.enabled ? 'active' : 'toggle below' }}</small></div>
                            <div [class.done]="isConfigured(plugin)"><b>3</b><span>Configured</span><small>{{ missingFields(plugin).length ? missingFields(plugin).length + ' required missing' : 'required fields set' }}</small></div>
                            <div [class.done]="plugin.health === 'healthy'"><b>4</b><span>Healthy</span><small>{{ plugin.health === 'healthy' ? 'connection passed' : 'run test' }}</small></div>
                        </div>

                        <div class="plugin-enable-row">
                            <mat-slide-toggle [ngModel]="plugin.enabled" (ngModelChange)="toggle(plugin, $event)">Enable for this consumer</mat-slide-toggle>
                            <span class="muted">{{ plugin.enabled ? 'Provider can be selected for its work area.' : 'Provider stays available but is not selected.' }}</span>
                        </div>

                        <div class="plugin-fields">
                            @for (field of properties(); track field.key) {
                                @if (field.property.secret) {
                                    <mat-form-field appearance="outline"><mat-label>{{ field.property.label }}</mat-label><input matInput [ngModel]="secretValue(field.key)" (ngModelChange)="setSecret(field.key, $event)" [placeholder]="field.property.help || 'env:JIRA_API_TOKEN'"><mat-hint>{{ field.property.help || 'Reference only — never paste the token.' }}</mat-hint></mat-form-field>
                                } @else if (field.property.enum) {
                                    <mat-form-field appearance="outline"><mat-label>{{ field.property.label }}</mat-label>
                                        <mat-select [ngModel]="fieldValue(field.key)" (ngModelChange)="setField(field.key, $event)">
                                            @for (option of field.property.enum; track option) { <mat-option [value]="option">{{ option }}</mat-option> }
                                        </mat-select>
                                    </mat-form-field>
                                } @else {
                                    <mat-form-field appearance="outline"><mat-label>{{ field.property.label }}</mat-label><input matInput [ngModel]="fieldValue(field.key)" (ngModelChange)="setField(field.key, $event)" [placeholder]="fieldPlaceholder(field.key)"></mat-form-field>
                                }
                            }
                        </div>

                        @if (plugin.id === 'jira') {
                            <div class="plugin-project-scope">
                                <div class="plugin-project-head"><div><span class="control-label">Project scope</span><small>Optional. Link one project, all accessible projects, or none.</small></div><button mat-stroked-button type="button" [disabled]="projectsLoading()" (click)="loadProjects()">{{ projectsLoading() ? 'Loading…' : (projects().length ? 'Reload projects' : 'Load projects') }}</button></div>
                                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="plugin-project-select"><mat-label>Project</mat-label>
                                    <mat-select [ngModel]="fieldValue('projectKey')" (ngModelChange)="setField('projectKey', $event)">
                                        <mat-option value="__none__">None · no Jira project for this consumer</mat-option>
                                        <mat-option value="">All accessible projects</mat-option>
                                        @for (project of projects(); track project.id) { <mat-option [value]="project.key">{{ project.name }} · {{ project.key }}</mat-option> }
                                    </mat-select>
                                </mat-form-field>
                                @if (projectsError()) { <p class="form-error">{{ projectErrorLabel(projectsError()) }}</p> } @else if (projects().length) { <small class="muted">{{ projects().length }} projects available</small> @if (!hasMatchingProject()) { <small class="muted">No project named <strong>{{ consumerId }}</strong> among them. Choose a project, All, or None.</small> } }
                                @if (fieldValue('projectKey') === '__none__') { <small class="muted">No project linked. Work stays in <code>.md</code>; provider configuration is kept for later.</small> }
                                @if (!projects().length && !projectsError()) { <small class="muted">Save connection details first, then load projects from Jira.</small> }
                            </div>
                        }

                        <div class="plugin-actions">
                            <button mat-flat-button color="primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save configuration' }}</button>
                            <button mat-stroked-button type="button" [disabled]="saving() || !plugin.enabled" (click)="test()">Test connection</button>
                            <button mat-stroked-button type="button" [disabled]="saving() || syncing() || !plugin.enabled || fieldValue('projectKey') === '__none__'" (click)="sync()">{{ syncing() ? 'Syncing…' : 'Sync now' }}</button>
                            @if (plugin.lastCheckedAt) { <span class="muted">checked {{ formatDate(plugin.lastCheckedAt) }}</span> }
                        </div>

                        @if (testResult(); as result) {
                            <div class="plugin-feedback" [class.plugin-feedback-ok]="result.ok" [class.plugin-feedback-warn]="!result.ok">
                                <strong>{{ result.ok ? 'Connection healthy' : result.reason || 'Connection failed' }}</strong>
                                <span>{{ result.detail || result.health || '' }}</span>
                            </div>
                        }
                        @if (syncResult(); as result) {
                            <div class="plugin-feedback" [class.plugin-feedback-ok]="result.ok" [class.plugin-feedback-warn]="!result.ok">
                                <strong>{{ result.ok ? result.count + ' records synced' : result.reason || 'Sync failed' }}</strong>
                                <span>{{ result.ok ? 'External references updated for Knowledge.' : result.detail || '' }}</span>
                            </div>
                        }
                        @if (syncResult(); as result) {
                            <div class="plugin-feedback" [class.plugin-feedback-ok]="result.ok" [class.plugin-feedback-warn]="!result.ok">
                                <strong>{{ result.ok ? result.count + ' records synced' : result.reason || 'Sync failed' }}</strong>
                                <span>{{ result.ok ? 'Provider records now available for routing.' : result.detail || '' }}</span>
                            </div>
                        }

                        <footer class="plugin-meta">
                            <span>Plugin <code>{{ plugin.id }}</code></span>
                            <span>Source <code>{{ plugin.source || 'builtin' }}</code></span>
                            <span class="plugin-caps">@for (cap of plugin.capabilities; track cap) { <span class="tag">{{ cap }}</span> }</span>
                        </footer>
                    } @else {
                        <p class="muted">Select a provider.</p>
                    }
                </section>
            </div>
        </main>
    `,
    styles: [`
        .consumer-plugins-page { display: grid; gap: var(--space-5); max-width: var(--container); margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; }
        .page-header h1 { margin: 0 0 var(--space-1); }
        .actions-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .plugin-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
        .plugin-summary > div { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-3); display: grid; gap: 2px; background: var(--surface); }
        .plugin-summary span { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .plugin-summary strong { font-size: var(--text-xl); }
        .plugin-summary small { color: var(--muted); font-size: var(--text-xs); }
        .plugin-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: var(--space-4); align-items: start; }
        .plugin-list { display: grid; gap: var(--space-1); align-content: start; }
        .plugin-list > header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-2); }
        .plugin-list h2 { margin: 0; font-size: var(--text-lg); }
        .plugin-list-note { margin: var(--space-3) 0 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
        .plugin-group-label { margin: var(--space-3) 0 0; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: 10px; }
        .plugin-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); text-align: left; cursor: pointer; }
        .plugin-row:hover { border-color: var(--muted); }
        .plugin-row.active { border-color: var(--brand); background: color-mix(in srgb, var(--surface) 88%, var(--brand)); }
        .plugin-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-sm); background: var(--brand); color: var(--brand-ink); font-weight: 700; flex: none; }
        .plugin-mark[data-category="design"] { background: #a78bfa; color: #17111f; }
        .plugin-mark[data-category="content"] { background: #34d399; color: #071a12; }
        .plugin-mark-lg { width: 44px; height: 44px; font-size: var(--text-lg); }
        .plugin-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
        .plugin-copy small { color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .plugin-state { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
        .plugin-state-ok { color: var(--ok-ink, #34d399); }
        .plugin-state-warn { color: var(--warn-ink, #fbbf24); }
        .link-button { border: 0; padding: 0; background: transparent; color: var(--brand); font: inherit; cursor: pointer; text-decoration: underline; }
        .plugin-config { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .plugin-config-head { display: flex; justify-content: space-between; gap: var(--space-3); align-items: flex-start; padding-bottom: var(--space-3); border-bottom: 1px solid var(--line); }
        .plugin-identity { display: flex; gap: var(--space-3); align-items: flex-start; }
        .plugin-identity h2 { margin: 0 0 2px; }
        .plugin-identity p { margin: 0; color: var(--muted); font-size: var(--text-sm); max-width: 65ch; }
        .plugin-lifecycle { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
        .plugin-lifecycle > div { display: grid; grid-template-columns: 24px 1fr; gap: 2px var(--space-2); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--muted); }
        .plugin-lifecycle > div.done { border-color: color-mix(in srgb, var(--brand) 55%, var(--line)); color: var(--ink); }
        .plugin-lifecycle b { grid-row: span 2; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: var(--line); color: var(--ink); font-size: 11px; }
        .plugin-lifecycle .done b { background: var(--brand); color: var(--brand-ink); }
        .plugin-lifecycle span { font-size: var(--text-sm); font-weight: 600; }
        .plugin-lifecycle small { font-size: 10px; }
        .plugin-enable-row { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
        .plugin-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
        .plugin-project-scope { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--surface) 96%, var(--brand)); }
        .plugin-project-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); flex-wrap: wrap; }
        .plugin-project-head div { display: grid; gap: 2px; }
        .plugin-project-select { max-width: 420px; }
        .plugin-actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
        .plugin-feedback { display: grid; gap: 2px; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--text-sm); }
        .plugin-feedback-ok { border-color: color-mix(in srgb, var(--ok-ink, #34d399) 45%, var(--line)); }
        .plugin-feedback-warn { border-color: color-mix(in srgb, var(--warn-ink, #fbbf24) 45%, var(--line)); }
        .plugin-feedback span { color: var(--muted); font-size: var(--text-xs); }
        .plugin-records { display: grid; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--line); }
        .plugin-records > header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); }
        .plugin-records h3 { margin: 0; font-size: var(--text-md); }
        .plugin-record-tools { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
        .plugin-record-search { min-width: 240px; }
        .plugin-record-foot { margin: 0; }
        .plugin-record-table { display: grid; border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; }
        .plugin-record-head { display: grid; grid-template-columns: 120px 1fr 110px 100px; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 92%, var(--brand)); color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
        .plugin-record-row { display: grid; grid-template-columns: 120px 1fr 110px 100px; gap: var(--space-2); align-items: center; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); font-size: var(--text-xs); }
        .plugin-record-row:last-child { border-bottom: 0; }
        .plugin-record-row a { color: var(--brand); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .plugin-record-row a:hover { text-decoration: underline; }
        .plugin-record-row span { color: var(--muted); }
        .plugin-meta { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; padding-top: var(--space-3); border-top: 1px solid var(--line); color: var(--muted); font-size: var(--text-xs); }
        .plugin-meta code { color: var(--ink); }
        .plugin-caps { display: flex; gap: var(--space-1); flex-wrap: wrap; }
        @media (max-width: 1000px) { .plugin-layout { grid-template-columns: minmax(0, 1fr); } .plugin-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 700px) { .page-header { flex-direction: column; } .plugin-fields, .plugin-lifecycle { grid-template-columns: 1fr; } .plugin-summary { grid-template-columns: 1fr 1fr; } .plugin-config { padding: var(--space-3); } .plugin-record-row { grid-template-columns: 80px 1fr; } }
    `],
})
export class ConsumerPluginsPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    readonly consumerId = this.route.snapshot.paramMap.get('id') || '';
    readonly plugins = signal<ConsumerPluginDto[]>([]);
    readonly selectedId = signal('');
    readonly selected = computed(() => this.plugins().find((plugin) => plugin.id === this.selectedId()) || null);
    readonly providers = computed(() => this.plugins().filter((plugin) => plugin.type === 'provider'));
    readonly hostCount = computed(() => this.plugins().filter((plugin) => plugin.type === 'host').length);
    readonly enabledCount = computed(() => this.providers().filter((plugin) => plugin.enabled).length);
    readonly healthyCount = computed(() => this.providers().filter((plugin) => plugin.health === 'healthy').length);
    readonly groups = computed(() => {
        const labels: Record<string, string> = { work: 'Work management', design: 'Design management', content: 'Content management', other: 'Other providers' };
        return Object.entries(labels).map(([id, label]) => ({ id, label, plugins: this.providers().filter((plugin) => (plugin.category || 'other') === id) })).filter((group) => group.plugins.length > 0);
    });
    readonly config = signal<Record<string, any>>({});
    readonly secrets = signal<Record<string, string>>({});
    readonly error = signal('');
    readonly saving = signal(false);
    readonly syncing = signal(false);
    readonly testResult = signal<any | null>(null);
    readonly syncResult = signal<any | null>(null);
    readonly projects = signal<any[]>([]);
    readonly projectsLoading = signal(false);
    readonly projectsError = signal('');
    readonly properties = computed(() => {
        const plugin = this.selected();
        if (!plugin) return [];
        return Object.entries(plugin.configSchema?.properties || {})
            .filter(([key]) => !(plugin.id === 'jira' && key === 'projectKey'))
            .map(([key, property]) => ({ key, property: property as PluginPropertyDto }));
    });

    ngOnInit(): void { this.load(); }

    private load(): Promise<void> {
        return this.service.getConsumerPlugins(this.consumerId)
            .then((plugins) => {
                this.plugins.set(plugins);
                const preferred = this.selectedId() && plugins.some((plugin) => plugin.id === this.selectedId() && plugin.type === 'provider')
                    ? this.selectedId()
                    : (plugins.find((plugin) => plugin.id === 'jira' && plugin.type === 'provider')?.id || plugins.find((plugin) => plugin.type === 'provider')?.id || '');
                this.selectId(preferred);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not load providers'));
    }

    select(plugin: ConsumerPluginDto): void { this.selectId(plugin.id); }

    private selectId(id: string): void {
        this.selectedId.set(id);
        const plugin = this.plugins().find((item) => item.id === id);
        const config = { ...(plugin?.config || {}) };
        if (plugin?.id === 'jira' && !config.projectKey) config.projectKey = '__none__';
        this.config.set(config);
        this.secrets.set({ ...(plugin?.secretRefs || {}) });
        this.testResult.set(null);
        this.syncResult.set(null);
        this.projects.set([]);
        this.projectsError.set('');
        if (plugin?.id === 'jira' && plugin.enabled) { void this.loadProjects(); }
    }

    hasMatchingProject(): boolean {
        const id = this.consumerId.toLowerCase();
        return this.projects().some((project) => project.key.toLowerCase() === id || project.name.toLowerCase() === id || project.name.toLowerCase().includes(id));
    }

    projectErrorLabel(reason: string): string {
        if (reason === 'SECRET_MISSING') return 'Control plane cannot read the API token. Set env:JIRA_API_TOKEN on the control-plane process.';
        if (reason === 'CONFIG_INCOMPLETE') return 'Base URL and email are required before loading projects.';
        return reason;
    }

    loadProjects(): void {
        const plugin = this.selected();
        if (!plugin || plugin.id !== 'jira') return;
        this.projectsLoading.set(true);
        this.projectsError.set('');
        this.service.getPluginProjects(this.consumerId, 'jira')
            .then((projects) => this.projects.set(projects))
            .catch((err) => this.projectsError.set(err?.detail || err?.message || 'Could not load projects'))
            .finally(() => this.projectsLoading.set(false));
    }

    categoryLabel(category: string): string {
        return ({ host: 'Host adapter', work: 'Work management', design: 'Design management', content: 'Content management' } as Record<string, string>)[category] || 'Provider';
    }

    pluginStatus(plugin: ConsumerPluginDto): string {
        if (!plugin.enabled) return 'disabled';
        if (plugin.health === 'healthy') return 'healthy';
        if (plugin.health === 'unreachable') return 'unreachable';
        if (this.missingFields(plugin).length > 0) return 'needs config';
        return 'configured';
    }

    isConfigured(plugin: ConsumerPluginDto): boolean { return this.missingFields(plugin).length === 0; }

    missingFields(plugin: ConsumerPluginDto): string[] {
        return (plugin.configSchema?.required || []).filter((key) => {
            const value = this.config()[key];
            return value === undefined || value === null || String(value).trim() === '';
        });
    }

    fieldValue(key: string): any { return this.config()[key] ?? ''; }
    secretValue(key: string): string { return this.secrets()[key] ?? ''; }
    setField(key: string, value: any): void { this.config.update((config) => ({ ...config, [key]: value })); }
    setSecret(key: string, value: string): void { this.secrets.update((secrets) => ({ ...secrets, [key]: value })); }

    fieldPlaceholder(key: string): string {
        return ({ baseUrl: 'https://company.atlassian.net', projectKey: 'ESO', email: 'you@company.com', fileKey: 'Figma file key', teamId: 'Penpot team id', databaseId: 'Notion database id', spaceKey: 'Confluence space key' } as Record<string, string>)[key] || '';
    }

    toggle(plugin: ConsumerPluginDto, enabled: boolean): void {
        this.savePayload(plugin, { enabled });
    }

    save(): void {
        const plugin = this.selected();
        if (!plugin) return;
        this.savePayload(plugin, { enabled: plugin.enabled });
    }

    private savePayload(plugin: ConsumerPluginDto, patch: { enabled: boolean }): void {
        this.saving.set(true);
        this.error.set('');
        this.service.configureConsumerPlugin(this.consumerId, plugin.id, {
            enabled: patch.enabled, config: this.config(), secretRefs: this.secrets(),
        })
            .then((result) => {
                if (!result.ok) {
                    this.error.set(result.reason + (result.missing?.length ? ': ' + result.missing.join(', ') : ''));
                    return;
                }
                void this.load().then(() => {
                    if (plugin.id === 'jira' && patch.enabled) this.loadProjects();
                });
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not save provider'))
            .finally(() => this.saving.set(false));
    }

    test(): void {
        const plugin = this.selected();
        if (!plugin) return;
        this.service.testConsumerPlugin(this.consumerId, plugin.id)
            .then(async (result) => {
                await this.load();
                this.testResult.set(result);
                if (plugin.id === 'jira') this.loadProjects();
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not test provider'));
    }

    sync(): void {
        const plugin = this.selected();
        if (!plugin) return;
        if (plugin.id === 'jira' && this.fieldValue('projectKey') === '__none__') {
            this.error.set('No Jira project linked. Choose a project or All accessible projects before syncing.');
            return;
        }
        this.syncing.set(true);
        this.syncResult.set(null);
        this.service.syncConsumerPlugin(this.consumerId, plugin.id)
            .then(async (result) => {
                await this.load();
                this.syncResult.set(result);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not sync provider'))
            .finally(() => this.syncing.set(false));
    }

    formatDate(value: string): string {
        try { return new Date(value).toLocaleString(); } catch { return value; }
    }

    openRegistry(): void { void this.router.navigate(['/plugins']); }
    openHosts(): void { void this.router.navigate(['/consumers', this.consumerId, 'settings'], { queryParams: { tab: 'workers' } }); }
    back(): void { void this.router.navigate(['/consumers', this.consumerId]); }
}
