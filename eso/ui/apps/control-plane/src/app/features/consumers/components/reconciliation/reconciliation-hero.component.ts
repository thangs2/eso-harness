import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ReconciliationScanScope } from '../../models/reconciliation.models.js';

@Component({
    selector: 'eso-reconciliation-hero',
    standalone: true,
    imports: [CommonModule, RouterLink],
    template: `
        <header class="cockpit-header">
            <div class="header-identity">
                <nav class="breadcrumb" aria-label="Breadcrumb">
                    <a [routerLink]="['/consumers', consumerId()]" class="crumb-link">
                        <svg class="icon-xs" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                            <path d="M10 3.5L5.5 8 10 12.5" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                        <span>{{ consumerId() || 'Consumer' }}</span>
                    </a>
                    <span class="crumb-sep" aria-hidden="true">/</span>
                    <span class="crumb-current">Reconciliation</span>
                </nav>

                <div class="title-block">
                    <h1 class="page-title">Reconciliation Cockpit</h1>
                    <p class="page-subtitle">
                        Unified drift inspection across source code, SDLC artifacts, and PostgreSQL knowledge index.
                    </p>
                </div>
            </div>

            <div class="header-controls">
                @if (ignoredCount() > 0) {
                    <span class="ignored-indicator" [title]="ignoredCount() + ' discrepancies dismissed via ignore rules'">
                        {{ ignoredCount() }} ignored
                    </span>
                }

                <div class="scope-segmented" role="group" aria-label="Scan scope">
                    <button
                        type="button"
                        class="seg-btn"
                        [class.active]="scanScope() === 'full'"
                        [disabled]="scanning()"
                        (click)="scanScopeChange.emit('full')"
                    >
                        Full
                    </button>
                    <button
                        type="button"
                        class="seg-btn"
                        [class.active]="scanScope() === 'git-diff'"
                        [disabled]="scanning()"
                        (click)="scanScopeChange.emit('git-diff')"
                    >
                        Git Diff
                    </button>
                </div>

                <button
                    type="button"
                    class="btn-secondary"
                    [disabled]="syncingIndex() || scanning()"
                    (click)="syncIndex.emit()"
                    [attr.aria-busy]="syncingIndex()"
                    title="Re-index markdown artifacts into PostgreSQL knowledge_doc"
                >
                    <svg
                        class="icon-sm"
                        [class.spin]="syncingIndex()"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        aria-hidden="true"
                    >
                        <path d="M13.5 8a5.5 5.5 0 1 1-1.35-3.6M13.5 2.5v2.75h-2.75" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <span>{{ syncingIndex() ? 'Syncing DB' : 'Sync DB' }}</span>
                    @if (postgresDriftCount() > 0 && !syncingIndex()) {
                        <span class="count-pill">{{ postgresDriftCount() }}</span>
                    }
                </button>

                <button
                    type="button"
                    class="btn-primary"
                    [disabled]="scanning()"
                    (click)="scan.emit()"
                    [attr.aria-busy]="scanning()"
                >
                    @if (scanning()) {
                        <span class="spinner" aria-hidden="true"></span>
                        <span>Scanning&hellip;</span>
                    } @else {
                        <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                            <circle cx="8" cy="8" r="5.5" />
                            <path d="M8 5v3l2 1.5" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                        <span>Run Scan</span>
                    }
                </button>
            </div>
        </header>
    `,
    styles: [`
        :host {
            display: block;
        }

        .cockpit-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: var(--space-4);
            padding-bottom: var(--space-4);
            border-bottom: 1px solid var(--line);

            @media (max-width: 960px) {
                flex-direction: column;
                align-items: stretch;
            }
        }

        .header-identity {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
            min-width: 0;
        }

        .breadcrumb {
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            font-size: var(--text-xs);
            color: var(--muted);
        }

        .crumb-link {
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            color: var(--muted);
            text-decoration: none;
            font-weight: 500;
            transition: color 150ms ease;

            &:hover {
                color: var(--ink);
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 2px;
                border-radius: var(--radius-sm);
            }
        }

        .crumb-sep {
            opacity: 0.45;
        }

        .crumb-current {
            color: var(--ink);
            font-weight: 500;
        }

        .title-block {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
        }

        .page-title {
            margin: 0;
            font-size: var(--text-xl);
            font-weight: 600;
            line-height: 1.2;
            letter-spacing: -0.02em;
            color: var(--ink);
        }

        .page-subtitle {
            margin: 0;
            font-size: var(--text-sm);
            color: var(--muted);
            line-height: 1.45;
        }

        .header-controls {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            flex-wrap: wrap;
            flex-shrink: 0;
        }

        .ignored-indicator {
            font-size: var(--text-xs);
            color: var(--muted);
            padding: var(--space-1) var(--space-2);
            border-radius: var(--radius-sm);
            border: 1px solid var(--line);
            background: var(--surface-2);
            font-variant-numeric: tabular-nums;
        }

        .scope-segmented {
            display: inline-flex;
            align-items: center;
            padding: 0.125rem;
            border-radius: var(--radius-sm);
            background: var(--surface-2);
            border: 1px solid var(--line);
        }

        .seg-btn {
            appearance: none;
            border: none;
            background: transparent;
            color: var(--muted);
            font: inherit;
            font-size: var(--text-xs);
            font-weight: 500;
            padding: 0.3125rem 0.625rem;
            border-radius: calc(var(--radius-sm) - 0.125rem);
            cursor: pointer;
            transition: background 150ms ease, color 150ms ease;

            &:hover:not(:disabled) {
                color: var(--ink);
            }

            &.active {
                background: var(--surface);
                color: var(--ink);
                font-weight: 600;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
            }

            &:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 1px;
            }
        }

        .btn-secondary,
        .btn-primary {
            appearance: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-2);
            height: 2.125rem;
            padding: 0 var(--space-3);
            border-radius: var(--radius-sm);
            font: inherit;
            font-size: var(--text-xs);
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            transition: background 150ms ease, border-color 150ms ease, opacity 150ms ease;

            &:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 2px;
            }
        }

        .btn-secondary {
            background: var(--surface);
            color: var(--ink);
            border: 1px solid var(--line);

            &:hover:not(:disabled) {
                background: var(--surface-2);
                border-color: color-mix(in srgb, var(--ink) 28%, var(--line));
            }
        }

        .btn-primary {
            background: var(--brand);
            color: var(--brand-ink, #06141a);
            border: 1px solid transparent;

            &:hover:not(:disabled) {
                filter: brightness(1.08);
            }
        }

        .count-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 1.25rem;
            height: 1.125rem;
            padding: 0 0.3125rem;
            border-radius: 999px;
            font-size: 0.6875rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            background: color-mix(in srgb, #f59e0b 18%, transparent);
            color: #fbbf24;
            border: 1px solid color-mix(in srgb, #f59e0b 38%, transparent);
        }

        .icon-xs {
            width: 0.875rem;
            height: 0.875rem;
            flex-shrink: 0;
        }

        .icon-sm {
            width: 0.9375rem;
            height: 0.9375rem;
            flex-shrink: 0;
        }

        .spin {
            animation: spin 0.9s linear infinite;
        }

        .spinner {
            width: 0.875rem;
            height: 0.875rem;
            border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
            border-top-color: currentColor;
            border-radius: 50%;
            animation: spin 0.75s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        @media (prefers-reduced-motion: reduce) {
            .spin, .spinner {
                animation: none;
            }
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReconciliationHeroComponent {
    readonly consumerId = input<string>('');
    readonly scanning = input<boolean>(false);
    readonly scanScope = input<ReconciliationScanScope>('full');
    readonly ignoredCount = input<number>(0);
    readonly syncingIndex = input<boolean>(false);
    readonly postgresDriftCount = input<number>(0);

    readonly scan = output<void>();
    readonly scanScopeChange = output<ReconciliationScanScope>();
    readonly syncIndex = output<void>();
}
