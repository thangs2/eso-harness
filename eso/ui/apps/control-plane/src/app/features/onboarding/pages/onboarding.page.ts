import { ChangeDetectionStrategy, Component, OnInit, Optional, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { OnboardingService } from '../data/onboarding.service.js';
import type { ConsumerOption, ProvisioningError, ProvisioningPreview, ProvisioningSuccess } from '../models/onboarding.model.js';

@Component({
    selector: 'eso-onboarding-page',
    standalone: true,
    imports: [
        RouterLink,
        FormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatSelectModule,
        MatCardModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="onboarding-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Control Plane · Phase 1</p>
                    <h1>Onboarding Consumer</h1>
                    <p class="subtitle">Select a ready consumer to provision an isolated Postgres schema and material bundle.</p>
                </div>
            </header>

            @if (error(); as err) {
                <div class="alert-error" role="alert">
                    <div class="alert-header">
                        <strong>{{ err.code }}</strong>
                        @if (err.status) {
                            <span class="status-code">HTTP {{ err.status }}</span>
                        }
                    </div>
                    <p class="alert-message">{{ err.message }}</p>
                </div>
            }

            @if (success(); as res) {
                <div class="alert-success" role="status">
                    <div class="alert-header">
                        <strong>Provisioning complete</strong>
                        <span class="status-badge">{{ res.status }}</span>
                    </div>
                    <p class="alert-message">
                        Consumer <code>{{ res.consumerId }}</code> was provisioned with schema <code>{{ res.schema }}</code> and is ready.
                    </p>
                </div>
            }

            @if (loading()) {
                <section class="panel loading-panel" role="status">
                    <p class="loading-label">Loading ready consumers…</p>
                </section>
            } @else if (!error() && consumers().length === 0) {
                <section class="panel empty-panel" role="status">
                    <h2>No consumers in ready state</h2>
                    <p class="empty-hint">
                        No consumer with status <code>ready</code> was found for provisioning.
                        Declare or configure a consumer first.
                    </p>
                    <div class="empty-actions">
                        <a mat-flat-button color="primary" routerLink="/setup">Create new consumer</a>
                    </div>
                </section>
            } @else if (consumers().length > 0) {
                <section class="panel onboarding-panel">
                    <h2>Select consumer</h2>
                    <p class="section-hint">Only consumers in ready state are shown.</p>

                    <mat-form-field appearance="outline" class="consumer-select-field">
                        <mat-label>Consumer</mat-label>
                        <mat-select [ngModel]="selectedConsumerId()" (ngModelChange)="onSelectConsumer($event)">
                            @for (c of consumers(); track c.id) {
                                <mat-option [value]="c.id">
                                    {{ c.name }} ({{ c.id }})
                                </mat-option>
                            }
                        </mat-select>
                    </mat-form-field>

                    @if (preview(); as p) {
                        <div class="preview-container">
                            <h3>Provisioning preview</h3>
                            <p class="preview-hint">
                                The schema is expanded independently inside the existing database; schemas are not shared and no separate database is created (INV-1).
                            </p>

                            <dl class="preview-details">
                                <div class="detail-row">
                                    <dt>Consumer ID</dt>
                                    <dd><code>{{ p.consumerId }}</code></dd>
                                </div>
                                <div class="detail-row">
                                    <dt>Display name</dt>
                                    <dd>{{ p.name }}</dd>
                                </div>
                                <div class="detail-row">
                                    <dt>Root directory</dt>
                                    <dd><code>{{ p.root }}</code></dd>
                                </div>
                                <div class="detail-row">
                                    <dt>Database Schema</dt>
                                    <dd><code>{{ p.schemaName }}</code></dd>
                                </div>
                                <div class="detail-row">
                                    <dt>Material Bundle</dt>
                                    <dd>
                                        <ul class="material-list">
                                            @for (item of p.materialBundle; track item) {
                                                <li><code>{{ item }}</code></li>
                                            }
                                        </ul>
                                    </dd>
                                </div>
                            </dl>

                            <div class="preview-actions">
                                <button
                                    mat-flat-button
                                    color="primary"
                                    type="button"
                                    class="submit-button"
                                    [disabled]="submitting()"
                                    (click)="submitProvision()"
                                >
                                    {{ submitting() ? 'Provisioning…' : 'Confirm & provision' }}
                                </button>
                            </div>
                        </div>
                    }
                </section>
            }
        </div>
    `,
    styles: [`
        .onboarding-page {
            display: grid;
            gap: var(--space-5);
            max-width: var(--container);
            margin: 0 auto;
        }

        .page-header {
            margin-bottom: var(--space-2);
        }

        .eyebrow {
            font-size: var(--text-xs);
            color: var(--text-secondary, #666);
            margin: 0 0 var(--space-1) 0;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        h1 {
            font-size: var(--text-2xl);
            margin: 0 0 var(--space-1) 0;
            font-weight: 600;
        }

        .subtitle {
            font-size: var(--text-sm);
            color: var(--text-secondary, #666);
            margin: 0;
        }

        .panel {
            background: var(--surface, #fff);
            border-radius: var(--radius-md);
            padding: var(--space-5);
            border: 1px solid var(--border-color, #e0e0e0);
        }

        .section-hint {
            font-size: var(--text-sm);
            color: var(--text-secondary, #666);
            margin-top: 0;
            margin-bottom: var(--space-4);
        }

        .consumer-select-field {
            width: 100%;
            max-width: 480px;
        }

        .preview-container {
            margin-top: var(--space-4);
            padding-top: var(--space-4);
            border-top: 1px solid var(--border-color, #e0e0e0);
        }

        .preview-container h3 {
            font-size: var(--text-lg);
            margin: 0 0 var(--space-1) 0;
        }

        .preview-hint {
            font-size: var(--text-xs);
            color: var(--text-secondary, #666);
            margin: 0 0 var(--space-4) 0;
        }

        .preview-details {
            display: grid;
            gap: var(--space-3);
            margin: 0 0 var(--space-5) 0;
        }

        .detail-row {
            display: grid;
            grid-template-columns: 200px 1fr;
            align-items: baseline;
            gap: var(--space-3);
        }

        @media (max-width: 600px) {
            .detail-row {
                grid-template-columns: 1fr;
                gap: var(--space-1);
            }
        }

        dt {
            font-size: var(--text-sm);
            font-weight: 500;
            color: var(--text-secondary, #555);
        }

        dd {
            margin: 0;
            font-size: var(--text-sm);
        }

        .material-list {
            margin: 0;
            padding-left: var(--space-4);
            display: grid;
            gap: var(--space-1);
        }

        .preview-actions {
            display: flex;
            gap: var(--space-3);
        }

        .alert-error {
            background-color: #fde8e8;
            border-left: 4px solid #e02424;
            color: #9b1c1c;
            padding: var(--space-4);
            border-radius: var(--radius-sm);
        }

        .alert-success {
            background-color: #def7ec;
            border-left: 4px solid #0e9f6e;
            color: #03543f;
            padding: var(--space-4);
            border-radius: var(--radius-sm);
        }

        .alert-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: var(--text-sm);
            margin-bottom: var(--space-1);
        }

        .alert-message {
            margin: 0;
            font-size: var(--text-sm);
        }

        .status-badge {
            background: #0e9f6e;
            color: white;
            padding: 2px var(--space-2);
            border-radius: var(--radius-sm);
            font-size: var(--text-xs);
        }

        .empty-panel {
            text-align: center;
            padding: var(--space-7) var(--space-5);
        }

        .empty-hint {
            color: var(--text-secondary, #666);
            max-width: 480px;
            margin: var(--space-2) auto var(--space-5) auto;
            font-size: var(--text-sm);
        }

        .loading-panel {
            text-align: center;
            padding: var(--space-6);
            color: var(--text-secondary, #666);
        }
    `],
})
export class OnboardingPage implements OnInit {
    private readonly service: OnboardingService;

    constructor(@Optional() service?: OnboardingService | null) {
        this.service = service ?? inject(OnboardingService);
    }

    readonly loading = signal<boolean>(true);
    readonly consumers = signal<ConsumerOption[]>([]);
    readonly selectedConsumerId = signal<string>('');
    readonly submitting = signal<boolean>(false);
    readonly success = signal<ProvisioningSuccess | null>(null);
    readonly error = signal<ProvisioningError | null>(null);

    readonly selectedConsumer = computed(() =>
        this.consumers().find((c) => c.id === this.selectedConsumerId()) ?? null
    );

    readonly preview = computed<ProvisioningPreview | null>(() => {
        const c = this.selectedConsumer();
        return c ? this.service.derivePreview(c) : null;
    });

    async ngOnInit(): Promise<void> {
        await this.loadConsumers();
    }

    async loadConsumers(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);
        try {
            const list = await this.service.loadReadyConsumers();
            this.consumers.set(list);
            if (list.length > 0 && !this.selectedConsumerId()) {
                this.selectedConsumerId.set(list[0].id);
            }
        } catch (err: unknown) {
            const errorObj = err as Record<string, unknown> | undefined;
            const code = typeof errorObj?.code === 'string' ? errorObj.code : 'LOAD_FAILED';
            const message =
                typeof errorObj?.message === 'string'
                    ? errorObj.message
                    : typeof errorObj?.detail === 'string'
                    ? errorObj.detail
                    : 'Unable to load consumers.';
            const status = typeof errorObj?.status === 'number' ? errorObj.status : undefined;
            this.error.set({ code, message, status });
        } finally {
            this.loading.set(false);
        }
    }

    onSelectConsumer(id: string): void {
        this.selectedConsumerId.set(id);
        this.error.set(null);
        this.success.set(null);
    }

    async submitProvision(): Promise<void> {
        const consumerId = this.selectedConsumerId();
        if (!consumerId || this.submitting()) {
            return;
        }

        this.submitting.set(true);
        this.error.set(null);
        this.success.set(null);

        try {
            const result = await this.service.provision(consumerId);
            this.success.set(result);
        } catch (err: unknown) {
            const errorObj = err as Record<string, unknown> | undefined;
            const code =
                typeof errorObj?.code === 'string'
                    ? errorObj.code
                    : typeof errorObj?.title === 'string'
                    ? errorObj.title.toUpperCase().replace(/\s+/g, '_')
                    : 'PROVISION_FAILED';
            const message =
                typeof errorObj?.detail === 'string'
                    ? errorObj.detail
                    : typeof errorObj?.message === 'string'
                    ? errorObj.message
                    : 'Provisioning failed.';
            const status = typeof errorObj?.status === 'number' ? errorObj.status : undefined;
            this.error.set({ code, message, status });
        } finally {
            this.submitting.set(false);
        }
    }
}
