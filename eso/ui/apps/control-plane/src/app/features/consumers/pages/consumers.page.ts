import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { ConsumerSummary } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-consumers-page',
    standalone: true,
    imports: [RouterLink, DatePipe, MatButtonModule, MatFormFieldModule, MatSelectModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <header class="page-header">
            <div>
                <p class="eyebrow">Control Plane</p>
                <h1>Consumers</h1>
                <p class="subtitle">Registered consumers, provisioning status and control-plane version.</p>
            </div>
            <a mat-flat-button color="primary" routerLink="/setup">Create consumer</a>
        </header>

        <div class="filters">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" density="-4" class="status-filter">
                <mat-label>Status</mat-label>
                <mat-select [value]="statusFilter()" (selectionChange)="statusFilter.set($event.value)" aria-label="Filter by status">
                    <mat-option value="all">All</mat-option>
                    <mat-option value="ready">Ready</mat-option>
                    <mat-option value="retired">Retired</mat-option>
                </mat-select>
            </mat-form-field>
            <span class="filter-count">{{ visible().length }} / {{ items().length }}</span>
        </div>

        <div class="stats-row">
            <div class="stat"><span class="stat-value">{{ items().length }}</span><span class="stat-label">consumers</span></div>
            <div class="stat"><span class="stat-value">{{ readyCount() }}</span><span class="stat-label">ready</span></div>
            <div class="stat"><span class="stat-value">{{ latest() || '—' }}</span><span class="stat-label">last update</span></div>
        </div>

        @if (error(); as message) {
            <p class="form-error" role="alert">@if (errorCode()) { <strong>{{ errorCode() }}</strong> — }{{ message }}</p>
        }
        @if (loading()) {
            <section class="panel"><p class="loading-label">Loading consumers…</p></section>
        } @else if (visible().length === 0) {
            <section class="panel empty-panel">
                <h2>{{ items().length === 0 ? 'No consumers yet' : 'No consumers match this filter' }}</h2>
                <p>{{ items().length === 0 ? 'Start by declaring the consumer repo and harness settings.' : 'Clear the status filter to see all consumers.' }}</p>
                @if (items().length === 0) { <a class="btn-primary" routerLink="/setup">Create consumer</a> }
            </section>
        } @else {
            <section class="panel table-panel">
                <table class="turns-table" aria-label="Consumer list">
                    <thead><tr><th>Consumer</th><th>Repo</th><th>Status</th><th>Version</th><th>Updated</th><th></th></tr></thead>
                    <tbody>
                        @for (item of visible(); track item.id) {
                            <tr>
                                <td class="col-work" data-label="Consumer">
                                    <strong>{{ item.name || item.id }}</strong>
                                    @if (item.name && item.name !== item.id) { <br><small>{{ item.id }}</small> }
                                </td>
                                <td data-label="Repo"><span class="repo-path">{{ item.root }}</span></td>
                                <td data-label="Status"><span class="pill" [class.pill-warn]="item.status !== 'ready'">{{ item.status }}</span></td>
                                <td data-label="Version">v{{ item.version }}</td>
                                <td data-label="Updated">{{ item.updatedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                                <td class="col-actions" data-label="Actions">
                                    <a class="btn-why" [routerLink]="['/consumers', item.id]">Details</a>
                                    <a class="btn-why" [routerLink]="['/events']" [queryParams]="{ consumer: item.id }">Events</a>
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
    readonly readyCount = computed(() => this.items().filter((item) => item.status === 'ready').length);
    readonly latest = computed(() => {
        const dates = this.items().map((item) => item.updatedAt).filter(Boolean).sort();
        return dates.length ? dates[dates.length - 1].slice(0, 16).replace('T', ' ') : '';
    });
    readonly loading = signal(true);
    readonly error = signal<string | null>(null);
    readonly errorCode = signal('');
    readonly statusFilter = signal<'all' | 'ready' | 'retired'>('all');
    readonly visible = computed(() => {
        const filter = this.statusFilter();
        return filter === 'all' ? this.items() : this.items().filter((item) => item.status === filter);
    });

    ngOnInit(): void {
        this.service
            .list()
            .then((res) => this.items.set(res.items || []))
            .catch((err) => {
                const status = (err as { status?: number })?.status;
                this.errorCode.set(status === 401 || status === 403 ? 'CONS_DENIED' : 'CONS_UPSTREAM_FAILED');
                this.error.set((err as { detail?: string; message?: string })?.detail || (err as Error)?.message || 'Unable to load consumers');
            })
            .finally(() => this.loading.set(false));
    }
}
