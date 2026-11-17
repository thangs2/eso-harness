import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { ConsumerSummary } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-consumers-page',
    standalone: true,
    imports: [RouterLink, DatePipe, MatButtonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <header class="page-header">
            <div>
                <p class="eyebrow">Control Plane</p>
                <h1>Consumers</h1>
                <p class="subtitle">Registered profiles; select a consumer to process cases.</p>
            </div>
            <a mat-flat-button color="primary" routerLink="/setup">Create consumer</a>
        </header>

        <div class="stats-row">
            <div class="stat"><span class="stat-value">{{ items().length }}</span><span class="stat-label">consumers</span></div>
            <div class="stat"><span class="stat-value">{{ profileCount() }}</span><span class="stat-label">profiles</span></div>
            <div class="stat"><span class="stat-value">{{ latest() || '—' }}</span><span class="stat-label">last update</span></div>
        </div>

        @if (error(); as message) {
            <p class="form-error" role="alert">{{ message }}</p>
        }
        @if (loading()) {
            <section class="panel"><p class="loading-label">Loading consumers…</p></section>
        } @else if (items().length === 0) {
            <section class="panel empty-panel">
                <h2>No consumers yet</h2>
                <p>Start by declaring the consumer repo and harness settings.</p>
                <a class="btn-primary" routerLink="/setup">Create consumer</a>
            </section>
        } @else {
            <section class="panel table-panel">
                <table class="turns-table" aria-label="Consumer list">
                    <thead><tr><th>Consumer</th><th>Repo</th><th>Profile</th><th>Version</th><th>Updated</th><th></th></tr></thead>
                    <tbody>
                        @for (item of items(); track item.id) {
                            <tr>
                                <td class="col-work" data-label="Consumer"><strong>{{ item.id }}</strong><br><small>{{ item.name }}</small></td>
                                <td data-label="Repo">{{ item.root }}</td>
                                <td data-label="Profile">
                                    @if (item.profile?.canonical) {
                                        <span class="pill">repo harness</span><br><small>{{ item.profile?.canonical?.agents || item.profile?.host || '' }}</small>
                                    } @else if (item.profile?.source || item.profile?.recipe) {
                                        <span class="pill">{{ item.profile?.source || item.profile?.recipe }}</span><br><small>{{ item.profile?.host || item.profile?.hostProfile || '' }}</small>
                                    } @else {
                                        <span class="muted">—</span>
                                    }
                                </td>
                                <td data-label="Version">v{{ item.version }}</td>
                                <td data-label="Updated">{{ item.updatedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                                <td class="col-actions" data-label="Actions">
                                    <a class="btn-why" [routerLink]="['/consumers', item.id]">Details</a>
                                    <a class="btn-why" [routerLink]="['/work-overview']" [queryParams]="{ project: item.id }">Work</a>
                                </td>
                            </tr>
                        }
                    </tbody>
                </table>
            </section>
        }
    `,
})
export class ConsumersPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);
    readonly items = signal<ConsumerSummary[]>([]);
    readonly profileCount = computed(() => new Set(this.items().map((item) => item.profile?.recipe).filter(Boolean)).size);
    readonly latest = computed(() => {
        const dates = this.items().map((item) => item.updatedAt).filter(Boolean).sort();
        return dates.length ? dates[dates.length - 1].slice(0, 16).replace('T', ' ') : '';
    });
    readonly loading = signal(true);
    readonly error = signal<string | null>(null);

    ngOnInit(): void {
        this.service
            .list()
            .then((res) => this.items.set(res.items || []))
            .catch((err) => this.error.set(err?.detail || 'Unable to load consumers'))
            .finally(() => this.loading.set(false));
    }
}
