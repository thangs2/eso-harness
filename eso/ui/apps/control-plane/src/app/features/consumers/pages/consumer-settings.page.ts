import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { ConsumerProfile } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-consumer-settings-page',
    standalone: true,
    imports: [
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatSlideToggleModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="settings-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Consumer settings</p>
                    <h1>{{ name() || route.snapshot.paramMap.get('id') }}</h1>
                    <p class="subtitle">Consumer runtime configuration. Changes are saved to the canonical profile.</p>
                </div>
                <button mat-stroked-button type="button" (click)="back()">Back to consumer</button>
            </header>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
            @if (saved()) { <p class="saved-banner" role="status">Settings saved. Consumer version was incremented.</p> }

            @if (loading()) {
                <section class="panel settings-loading"><p class="loading-label">Loading settings…</p></section>
            } @else {
                <nav class="settings-tabs" role="tablist" aria-label="Consumer settings sections">
                    @for (tab of tabs; track tab.id) {
                        <button
                            type="button"
                            role="tab"
                            class="settings-tab"
                            [class.active]="activeTab() === tab.id"
                            [attr.aria-selected]="activeTab() === tab.id"
                            [attr.aria-controls]="'settings-panel-' + tab.id"
                            [id]="'settings-tab-' + tab.id"
                            (click)="activeTab.set(tab.id)"
                        >
                            <span class="settings-step-no">{{ tab.n }}</span>
                            <span>{{ tab.label }}</span>
                        </button>
                    }
                </nav>

                <div class="settings-tab-content">
                    @switch (activeTab()) {
                    @case ('profile') {
                        <section class="tab-panel" role="tabpanel" id="settings-panel-profile" aria-labelledby="settings-tab-profile">
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

                    @case ('harness') {
                        <section class="tab-panel" role="tabpanel" id="settings-panel-harness" aria-labelledby="settings-tab-harness">
                            <p class="section-hint">Harness source order for this consumer. The host remains a projection, not a consumer field.</p>
                            <div class="form-grid">
                                <mat-form-field appearance="outline">
                                    <mat-label>Source chain</mat-label>
                                    <mat-select [ngModel]="chain()" (ngModelChange)="chain.set($event)">
                                        @for (option of chainOptions; track option.value) {
                                            <mat-option [value]="option.value">{{ option.label }}</mat-option>
                                        }
                                    </mat-select>
                                </mat-form-field>
                                <mat-form-field appearance="outline"><mat-label>Market providers</mat-label><input matInput [ngModel]="marketProviders()" (ngModelChange)="marketProviders.set($event)" placeholder="agentmemory, codegraph, docgraph, graphify"></mat-form-field>
                            </div>
                            <div class="toggle-row">
                                <mat-slide-toggle [ngModel]="hostNative()" (ngModelChange)="hostNative.set($event)">Host-native</mat-slide-toggle>
                                <mat-slide-toggle [ngModel]="esoNative()" (ngModelChange)="esoNative.set($event)">ESO-native</mat-slide-toggle>
                                <mat-slide-toggle [ngModel]="market()" (ngModelChange)="market.set($event)">Market</mat-slide-toggle>
                            </div>
                        </section>
                    }

                    @case ('jira') {
                        <section class="tab-panel" role="tabpanel" id="settings-panel-jira" aria-labelledby="settings-tab-jira">
                            <p class="section-hint">Credentials live in the operator/secret store; the consumer keeps only project and policy.</p>
                            <div class="toggle-row">
                                <mat-slide-toggle [ngModel]="jiraEnabled()" (ngModelChange)="jiraEnabled.set($event)">Enable Jira</mat-slide-toggle>
                            </div>
                            <div class="form-grid">
                                <mat-form-field appearance="outline"><mat-label>Project key</mat-label><input matInput [ngModel]="jiraProject()" (ngModelChange)="jiraProject.set($event)" placeholder="FIN"></mat-form-field>
                                <mat-form-field appearance="outline">
                                    <mat-label>Sync mode</mat-label>
                                    <mat-select [ngModel]="jiraSyncMode()" (ngModelChange)="jiraSyncMode.set($event)">
                                        @for (mode of jiraModes; track mode) { <mat-option [value]="mode">{{ mode }}</mat-option> }
                                    </mat-select>
                                </mat-form-field>
                            </div>
                        </section>
                    }

                    @case ('observation') {
                        <section class="tab-panel" role="tabpanel" id="settings-panel-observation" aria-labelledby="settings-tab-observation">
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

                    @case ('material') {
                        <section class="tab-panel" role="tabpanel" id="settings-panel-material" aria-labelledby="settings-tab-material">
                            <p class="section-hint">Canonical artefact set materialized for this consumer.</p>
                            <div class="toggle-row">
                                <mat-checkbox [ngModel]="materialAgentsMd()" (ngModelChange)="materialAgentsMd.set($event)">AGENTS.md</mat-checkbox>
                                <mat-checkbox [ngModel]="materialAgentsDir()" (ngModelChange)="materialAgentsDir.set($event)">agents/</mat-checkbox>
                                <mat-checkbox [ngModel]="materialConfig()" (ngModelChange)="materialConfig.set($event)">.harness/config.json</mat-checkbox>
                                <mat-checkbox [ngModel]="materialManifest()" (ngModelChange)="materialManifest.set($event)">.harness/manifest.json</mat-checkbox>
                            </div>
                        </section>
                    }
                    }
                </div>

                <footer class="settings-actions">
                    <button mat-stroked-button type="button" (click)="back()">Cancel</button>
                    <button mat-flat-button color="primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save settings' }}</button>
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
        .settings-tabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; }
        .settings-tab { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3); border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
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
        .toggle-row { display: flex; flex-wrap: wrap; gap: var(--space-4) var(--space-5); align-items: center; }
        .event-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
        .event-grid-disabled { opacity: .55; }
        .event-copy { display: grid; gap: 2px; white-space: normal; }
        .event-copy small { color: var(--muted); }
        .settings-actions { display: flex; justify-content: flex-end; gap: var(--space-3); padding-top: var(--space-1); }
        .saved-banner { border-left: 4px solid var(--brand); background: color-mix(in srgb, var(--surface) 88%, var(--brand)); padding: var(--space-3); border-radius: var(--radius-sm); margin: 0; }
        .loading-label { color: var(--muted); margin: 0; }
        .settings-loading { border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-5); background: var(--surface); }
        @media (max-width: 900px) { .form-grid, .event-grid { grid-template-columns: 1fr; } .page-header { flex-direction: column; } .tab-panel { padding: var(--space-4); } }
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
    readonly tabs = [
        { id: 'profile', n: 1, label: 'Profile' },
        { id: 'harness', n: 2, label: 'Harness' },
        { id: 'jira', n: 3, label: 'Jira' },
        { id: 'observation', n: 4, label: 'Observation' },
        { id: 'material', n: 5, label: 'Material' },
    ];

    readonly name = signal('');
    readonly owner = signal('');
    readonly locale = signal('vi-VN');
    readonly tags = signal('');
    readonly description = signal('');
    readonly chain = signal('host-native,eso-native,market');
    readonly hostNative = signal(true);
    readonly esoNative = signal(true);
    readonly market = signal(true);
    readonly marketProviders = signal('agentmemory, codegraph, docgraph, graphify');
    readonly jiraEnabled = signal(false);
    readonly jiraProject = signal('');
    readonly jiraSyncMode = signal('off');
    readonly consent = signal(true);
    readonly events = signal<string[]>(['prompt.submitted', 'turn.completed', 'tool.called']);
    readonly materialAgentsMd = signal(true);
    readonly materialAgentsDir = signal(true);
    readonly materialConfig = signal(true);
    readonly materialManifest = signal(true);

    readonly chainOptions = [
        { value: 'host-native,eso-native,market', label: 'Host-native → ESO-native → Market' },
        { value: 'eso-native,host-native,market', label: 'ESO-native → Host-native → Market' },
        { value: 'market,host-native,eso-native', label: 'Market → Host-native → ESO-native' },
        { value: 'none', label: 'None' },
    ];
    readonly jiraModes = ['off', 'push', 'two-way'];
    readonly eventKinds = [
        { id: 'prompt.submitted', label: 'Prompt request', description: 'Request sent by the user to the host.' },
        { id: 'turn.completed', label: 'Turn result', description: 'Turn result and status.' },
        { id: 'tool.called', label: 'Tool call', description: 'Tool/MCP call and result.' },
        { id: 'file.changed', label: 'File change', description: 'File changed during the turn.' },
    ];

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('id')!;
        this.service.get(id)
            .then((profile) => {
                this.current.set(profile);
                this.hydrate(profile);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Unable to load consumer'))
            .finally(() => this.loading.set(false));
    }

    back(): void {
        const id = this.route.snapshot.paramMap.get('id');
        this.router.navigate(['/consumers', id]);
    }

    toggleEvent(id: string): void {
        this.events.set(this.events().includes(id) ? this.events().filter((event) => event !== id) : [...this.events(), id]);
    }

    save(): void {
        const profile = this.current();
        if (!profile) return;
        this.saving.set(true);
        this.saved.set(false);
        this.error.set(null);

        const previous = (profile.profile || {}) as Record<string, unknown>;
        const nextProfile: Record<string, unknown> = {
            ...previous,
            observation: { consent: this.consent(), events: this.events() },
            settings: {
                general: {
                    owner: this.owner().trim(),
                    locale: this.locale().trim(),
                    tags: this.tags().split(',').map((tag) => tag.trim()).filter(Boolean),
                    description: this.description().trim(),
                },
                harness: {
                    chain: this.chain(),
                    hostNative: this.hostNative(),
                    esoNative: this.esoNative(),
                    market: this.market(),
                    marketProviders: this.marketProviders().split(',').map((provider) => provider.trim()).filter(Boolean),
                },
                jira: {
                    enabled: this.jiraEnabled(),
                    projectKey: this.jiraProject().trim(),
                    syncMode: this.jiraSyncMode(),
                },
                material: {
                    agentsMd: this.materialAgentsMd(),
                    agentsDir: this.materialAgentsDir(),
                    config: this.materialConfig(),
                    manifest: this.materialManifest(),
                },
            },
        };

        this.service.updateSettings(profile.id, this.name().trim() || profile.name, nextProfile, profile.version || 1)
            .then((updated) => {
                this.current.set(updated);
                this.hydrate(updated);
                this.saved.set(true);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Unable to save settings'))
            .finally(() => this.saving.set(false));
    }

    private hydrate(profile: ConsumerProfile): void {
        const prof = (profile.profile || {}) as any;
        const settings = (prof.settings || {}) as any;
        this.name.set(profile.name || '');
        this.owner.set(settings.general?.owner || '');
        this.locale.set(settings.general?.locale || 'vi-VN');
        this.tags.set((settings.general?.tags || []).join(', '));
        this.description.set(prof.description || settings.general?.description || '');
        this.chain.set(settings.harness?.chain || 'host-native,eso-native,market');
        this.hostNative.set(settings.harness?.hostNative ?? true);
        this.esoNative.set(settings.harness?.esoNative ?? true);
        this.market.set(settings.harness?.market ?? true);
        this.marketProviders.set((settings.harness?.marketProviders || ['agentmemory', 'codegraph', 'docgraph', 'graphify']).join(', '));
        this.jiraEnabled.set(settings.jira?.enabled ?? false);
        this.jiraProject.set(settings.jira?.projectKey || '');
        this.jiraSyncMode.set(settings.jira?.syncMode || 'off');
        this.consent.set(prof.observation?.consent ?? true);
        this.events.set(prof.observation?.events || ['prompt.submitted', 'turn.completed', 'tool.called']);
        this.materialAgentsMd.set(settings.material?.agentsMd ?? true);
        this.materialAgentsDir.set(settings.material?.agentsDir ?? true);
        this.materialConfig.set(settings.material?.config ?? true);
        this.materialManifest.set(settings.material?.manifest ?? true);
    }
}
