import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { PluginManifestDto } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-plugins-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="plugins-page">
            <header class="page-header">
                <div><p class="eyebrow">System</p><h1>Plugin registry</h1><p class="subtitle">Installed adapters and providers available to consumers.</p></div>
                <button mat-stroked-button type="button" (click)="back()">Back to consumers</button>
            </header>
            @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
            <div class="plugin-summary">
                <div><span>Installed</span><strong>{{ installedCount() }}</strong></div>
                <div><span>Providers</span><strong>{{ providerCount() }}</strong></div>
                <div><span>Hosts</span><strong>{{ hostCount() }}</strong></div>
            </div>
            @for (group of groups(); track group.id) {
                <section class="plugin-group">
                    <header class="plugin-group-head"><div><p class="eyebrow">{{ group.label }}</p><h2>{{ group.plugins.length }} plugin{{ group.plugins.length === 1 ? '' : 's' }}</h2></div></header>
                    <div class="plugin-grid">
                        @for (plugin of group.plugins; track plugin.id) {
                            <article class="plugin-card">
                                <header><div><h2>{{ plugin.label }}</h2><code>{{ plugin.id }} · v{{ plugin.version }}</code></div><span class="badge" [class.badge-warn]="plugin.status !== 'installed'">{{ plugin.status }}</span></header>
                                <p>{{ plugin.description }}</p>
                                <div class="plugin-caps">@for (cap of plugin.capabilities; track cap) { <span class="tag">{{ cap }}</span> }</div>
                                <footer><span class="badge">{{ plugin.category }}</span><span class="muted">{{ plugin.installed ? 'installed' : 'available' }}</span></footer>
                            </article>
                        }
                    </div>
                </section>
            }
            <section class="plugin-install">
                <header><div><p class="eyebrow">Custom</p><h2>Install provider manifest</h2></div></header>
                <p class="muted">JSON manifest only. A custom provider can declare an <code>http-json</code> connector for health and sync.</p>
                <mat-form-field appearance="outline" class="full"><mat-label>Manifest JSON</mat-label><textarea matInput rows="6" [(ngModel)]="manifestJson"></textarea></mat-form-field>
                <div class="plugin-install-actions"><button mat-flat-button color="primary" type="button" [disabled]="installing()" (click)="install()">{{ installing() ? 'Installing…' : 'Install manifest' }}</button>@if (installError()) { <span class="form-error">{{ installError() }}</span> }</div>
            </section>
        </main>
    `,
    styles: [`
        .plugins-page { display: grid; gap: var(--space-5); max-width: var(--container); margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; gap: var(--space-4); align-items: flex-start; }
        .page-header h1 { margin: 0 0 var(--space-1); }
        .plugin-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
        .plugin-summary > div { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-3); display: grid; gap: var(--space-1); }
        .plugin-summary span { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .plugin-summary strong { font-size: var(--text-xl); }
        .plugin-group { display: grid; gap: var(--space-2); }
        .plugin-group-head { display: flex; justify-content: space-between; gap: var(--space-2); align-items: flex-start; }
        .plugin-group-head h2 { margin: 0; font-size: var(--text-lg); }
        .plugin-install { display: grid; gap: var(--space-2); padding: var(--space-4); border: 1px dashed var(--line); border-radius: var(--radius-md); }
        .plugin-install-head { display: flex; justify-content: space-between; gap: var(--space-2); }
        .plugin-install-actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
        .plugin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-3); }
        .plugin-card { display: grid; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .plugin-card header { display: flex; justify-content: space-between; gap: var(--space-2); align-items: flex-start; }
        .plugin-card h2 { margin: 0 0 2px; font-size: var(--text-md); }
        .plugin-card code { color: var(--muted); font-size: 11px; }
        .plugin-card p { margin: 0; color: var(--muted); font-size: var(--text-sm); }
        .plugin-caps { display: flex; gap: var(--space-1); flex-wrap: wrap; }
        .plugin-card footer { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
        @media (max-width: 700px) { .plugin-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); } .plugin-summary > div { padding: var(--space-2); } .plugin-summary strong { font-size: var(--text-lg); } .page-header { flex-direction: column; } }
    `],
})
export class PluginsPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);
    private readonly router = inject(Router);
    readonly plugins = signal<PluginManifestDto[]>([]);
    readonly error = signal('');
    readonly installedCount = computed(() => this.plugins().filter((plugin) => plugin.installed).length);
    readonly providerCount = computed(() => this.plugins().filter((plugin) => plugin.type === 'provider').length);
    readonly hostCount = computed(() => this.plugins().filter((plugin) => plugin.type === 'host').length);
    readonly groups = computed(() => {
        const labels: Record<string, string> = { host: 'Hosts', work: 'Work management', design: 'Design management', content: 'Content management', other: 'Other' };
        return Object.entries(labels).map(([id, label]) => ({ id, label, plugins: this.plugins().filter((plugin) => (plugin.category || 'other') === id) })).filter((group) => group.plugins.length > 0);
    });
    readonly installing = signal(false);
    readonly installError = signal('');
    manifestJson = '';

    ngOnInit(): void {
        this.service.getPlugins()
            .then((plugins) => this.plugins.set(plugins))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not load plugins'));
    }

    install(): void {
        this.installError.set('');
        let manifest: any;
        try { manifest = JSON.parse(this.manifestJson); } catch { this.installError.set('Manifest must be valid JSON'); return; }
        this.installing.set(true);
        this.service.installPlugin(manifest)
            .then((result) => {
                if (!result.ok) { this.installError.set(result.reason || 'Install failed'); return; }
                this.manifestJson = '';
                return this.service.getPlugins().then((plugins) => this.plugins.set(plugins));
            })
            .catch((err) => this.installError.set(err?.detail || err?.message || 'Install failed'))
            .finally(() => this.installing.set(false));
    }

    back(): void { void this.router.navigate(['/consumers']); }
}
