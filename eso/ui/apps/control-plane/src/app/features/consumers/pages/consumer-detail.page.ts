import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import { ReconciliationService } from '../services/reconciliation.service.js';
import type { ConsumerProfile } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-consumer-detail-page',
    standalone: true,
    imports: [MatButtonModule, RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (profile(); as p) {
            <header class="page-header">
                <div>
                    <p class="eyebrow">Consumer · v{{ p.version || 1 }}</p>
                    <h1>{{ p.name }}</h1>
                    <p class="subtitle"><code>{{ p.id }}</code> · {{ p.root }}</p>
                </div>
                <div class="page-header-actions">
                    <a mat-stroked-button [routerLink]="['/consumers', p.id, 'reconciliation']">Reconciliation</a>
                    <a mat-stroked-button [routerLink]="['/consumers', p.id, 'settings']">Open settings</a>
                </div>
            </header>

            <aside class="recon-watchdog-banner" aria-label="Reconciliation Guard Status">
                <div class="recon-banner-content">
                    <div class="recon-banner-icon" aria-hidden="true">📡</div>
                    <div>
                        <div class="recon-banner-title">
                            <strong>Reconciliation Guard Watchdog</strong>
                            @if (gapCount() > 0) {
                                <span class="recon-chip recon-chip-alert">{{ gapCount() }} open discrepancies</span>
                            } @else if (stagedCount() > 0) {
                                <span class="recon-chip recon-chip-staged">{{ stagedCount() }} staged in inbox</span>
                            } @else {
                                <span class="recon-chip recon-chip-clean">AST &amp; Knowledge Base in sync</span>
                            }
                        </div>
                        <p class="recon-banner-desc">
                            Monitors codebase AST against canonical SDLC contracts and artifact scratchpads. Run reconciliation to detect orphan routes and schema drift.
                        </p>
                    </div>
                </div>
                <a mat-flat-button class="recon-banner-btn" [routerLink]="['/consumers', p.id, 'reconciliation']">
                    Inspect GAPs & Reconcile ↗
                </a>
            </aside>

            @if (created()) {
                <p class="saved-banner">Consumer saved. Setup is complete; you can now process cases.</p>
            }

            <div class="detail-grid">
                <section class="panel">
                    <h2>Profile</h2>
                    <dl class="kv">
                        <dt>Canonical</dt><dd>{{ p.profile?.canonical ? (p.profile.canonical.agents + ' / ' + p.profile.canonical.harness) : (p.profile?.host || p.profile?.hostProfile || '—') }}</dd>
                        <dt>Source policy</dt><dd>{{ p.profile?.source || 'per host chain' }}</dd>
                        <dt>Description</dt><dd>{{ p.profile?.description || '—' }}</dd>
                        <dt>Version</dt><dd>v{{ p.version }} · {{ p.status }}</dd>
                    </dl>
                </section>
                <section class="panel">
                    <h2>Knowledge base</h2>
                    <dl class="kv">
                        <dt>SDLC root</dt><dd>{{ p.sdlcRoot }}</dd>
                        <dt>Header profile</dt><dd>{{ p.headerProfile }}</dd>
                        <dt>Preset</dt><dd>{{ p.presetVersion || '—' }}</dd>
                        @for (zone of p.zones || []; track zone.name) {
                            <dt>Zone {{ zone.name }}</dt><dd>{{ zone.path }} · {{ zone.headerProfile || '—' }}</dd>
                        }
                    </dl>
                </section>
                <section class="panel">
                    <h2>Team & gates</h2>
                    <dl class="kv">
                        <dt>Roles</dt><dd>{{ p.team?.roles?.join(', ') || '—' }}</dd>
                        <dt>Gates</dt><dd>{{ enabled(p.gates || {}) }}</dd>
                        <dt>Sources</dt><dd>{{ enabled(p.sources || {}) }}</dd>
                    </dl>
                </section>
                <section class="panel">
                    <h2>Protected paths</h2>
                    @if (!((p.protectedPaths || []).length)) {
                        <p class="muted">No protected paths configured.</p>
                    } @else {
                        <ul class="path-list">
                            @for (path of p.protectedPaths; track path) { <li><code>{{ path }}</code></li> }
                        </ul>
                    }
                </section>
            </div>
        } @else if (error(); as message) {
            <p class="form-error" role="alert">@if (errorCode()) { <strong>{{ errorCode() }}</strong> — }{{ message }}</p>
        } @else {
            <section class="panel"><p class="loading-label">Loading consumer…</p></section>
        }
    `,
    styles: [`
        .page-header-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .recon-watchdog-banner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-4);
            flex-wrap: wrap;
            padding: var(--space-3) var(--space-4);
            margin: var(--space-4) 0;
            background: rgba(14, 165, 233, 0.08);
            border: 1px solid rgba(14, 165, 233, 0.3);
            border-radius: var(--radius-md);
        }
        .recon-banner-content {
            display: flex;
            align-items: flex-start;
            gap: var(--space-3);
        }
        .recon-banner-icon {
            font-size: 1.5rem;
            line-height: 1;
            padding-top: var(--space-1);
        }
        .recon-banner-title {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            flex-wrap: wrap;
        }
        .recon-banner-title strong {
            color: var(--ink);
            font-size: var(--text-sm);
        }
        .recon-chip {
            font-size: 10px;
            font-weight: 700;
            padding: 1px 6px;
            border-radius: 9999px;
            text-transform: uppercase;
        }
        .recon-chip-alert {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.35);
        }
        .recon-chip-staged {
            background: rgba(59, 130, 246, 0.15);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.3);
        }
        .recon-chip-clean {
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .recon-banner-desc {
            margin: var(--space-1) 0 0;
            font-size: var(--text-xs);
            color: var(--muted);
            max-width: 44rem;
        }
        .recon-banner-btn {
            background: #0ea5e9;
            color: #ffffff;
            font-size: var(--text-xs);
            font-weight: 600;
            padding: var(--space-1) var(--space-3);
            border-radius: var(--radius-sm);
            text-decoration: none;
            white-space: nowrap;
        }
        .recon-banner-btn:hover {
            background: #0284c7;
        }
    `],
})
export class ConsumerDetailPage implements OnInit {
    private readonly service = inject(ConsumerProfileService);
    private readonly route = inject(ActivatedRoute);
    private readonly reconciliation = inject(ReconciliationService);
    readonly profile = signal<ConsumerProfile | null>(null);
    readonly error = signal<string | null>(null);
    readonly errorCode = signal('');
    readonly created = signal(false);
    readonly gapCount = computed(() => this.reconciliation.gaps().filter((g) => g.status === 'open').length);
    readonly stagedCount = computed(() => this.reconciliation.gaps().filter((g) => g.status === 'staged_in_inbox').length);

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('id')!;
        this.created.set(this.route.snapshot.queryParamMap.get('created') === '1');
        if (id) {
            this.reconciliation.setActiveConsumer(id);
            void this.reconciliation.loadGaps(id).catch(() => {
                // non-blocking
            });
        }
        this.service
            .get(id)
            .then((profile) => this.profile.set(profile))
            .catch((err) => {
                const status = (err as { status?: number })?.status;
                this.errorCode.set(status === 404 ? 'DETAIL_NOT_FOUND' : status === 401 || status === 403 ? 'DETAIL_DENIED' : 'DETAIL_UPSTREAM_FAILED');
                this.error.set((err as { detail?: string; message?: string })?.detail || (err as Error)?.message || 'Unable to load consumer');
            });
    }

    enabled(map: Record<string, unknown>): string {
        const keys = Object.entries(map || {})
            .filter(([, value]) => value === true)
            .map(([key]) => key);
        return keys.length ? keys.join(', ') : '—';
    }
}
