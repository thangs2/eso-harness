import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ReconciliationScanSummaryDto } from '../../models/reconciliation.models.js';

interface CategoryMeta {
    id: string;
    code: string;
    label: string;
    dotClass: string;
    what: string;
    target: string;
    action: string;
}

@Component({
    selector: 'eso-reconciliation-metrics',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="category-strip-wrap">
            <div class="category-bar" role="tablist" aria-label="Filter discrepancies by category">
                <div class="category-tabs">
                    <button
                        type="button"
                        role="tab"
                        class="cat-tab"
                        [class.active]="activeFilter() === 'all'"
                        [attr.aria-selected]="activeFilter() === 'all'"
                        (click)="onSelect('all')"
                    >
                        <span>All</span>
                        <span class="tab-count">{{ summary().totalGaps }}</span>
                    </button>

                    <button
                        type="button"
                        role="tab"
                        class="cat-tab"
                        [class.active]="activeFilter() === 'GAP_A_ORPHAN_ROUTE'"
                        [attr.aria-selected]="activeFilter() === 'GAP_A_ORPHAN_ROUTE'"
                        (click)="onSelect('GAP_A_ORPHAN_ROUTE')"
                        title="GAP-A: Implemented API routes missing S8 API contract or S7 AC"
                    >
                        <span class="dot dot-a" aria-hidden="true"></span>
                        <span class="tab-code">GAP-A</span>
                        <span>Orphan Routes</span>
                        <span class="tab-count">{{ summary().orphanRoutes }}</span>
                    </button>

                    <button
                        type="button"
                        role="tab"
                        class="cat-tab"
                        [class.active]="activeFilter() === 'GAP_B_UNFED_SCHEMA'"
                        [attr.aria-selected]="activeFilter() === 'GAP_B_UNFED_SCHEMA'"
                        (click)="onSelect('GAP_B_UNFED_SCHEMA')"
                        title="GAP-B: Database tables/models missing S9 Data Dictionary specs"
                    >
                        <span class="dot dot-b" aria-hidden="true"></span>
                        <span class="tab-code">GAP-B</span>
                        <span>Unfed Schemas</span>
                        <span class="tab-count">{{ summary().unfedSchemas }}</span>
                    </button>

                    <button
                        type="button"
                        role="tab"
                        class="cat-tab"
                        [class.active]="activeFilter() === 'GAP_C_STALE_HASH'"
                        [attr.aria-selected]="activeFilter() === 'GAP_C_STALE_HASH'"
                        (click)="onSelect('GAP_C_STALE_HASH')"
                        title="GAP-C: Governed files modified on disk diverging from knowledge-manifest SHA-256"
                    >
                        <span class="dot dot-c" aria-hidden="true"></span>
                        <span class="tab-code">GAP-C</span>
                        <span>Stale Contracts</span>
                        <span class="tab-count">{{ summary().staleContracts }}</span>
                    </button>

                    <button
                        type="button"
                        role="tab"
                        class="cat-tab"
                        [class.active]="activeFilter() === 'GAP_D_UNLINKED_SPIKE'"
                        [attr.aria-selected]="activeFilter() === 'GAP_D_UNLINKED_SPIKE'"
                        (click)="onSelect('GAP_D_UNLINKED_SPIKE')"
                        title="GAP-D: Ad-hoc spike notes in artifacts/ unanchored to ADR or WBS"
                    >
                        <span class="dot dot-d" aria-hidden="true"></span>
                        <span class="tab-code">GAP-D</span>
                        <span>Unlinked Spikes</span>
                        <span class="tab-count">{{ summary().unlinkedSpikes }}</span>
                    </button>

                    <button
                        type="button"
                        role="tab"
                        class="cat-tab"
                        [class.active]="activeFilter() === 'GAP_E_MISSING_SDLC_DOC'"
                        [attr.aria-selected]="activeFilter() === 'GAP_E_MISSING_SDLC_DOC'"
                        (click)="onSelect('GAP_E_MISSING_SDLC_DOC')"
                        title="GAP-E: Required S1-S17 SDLC stage documents missing on disk"
                    >
                        <span class="dot dot-e" aria-hidden="true"></span>
                        <span class="tab-code">GAP-E</span>
                        <span>Missing SDLC</span>
                        <span class="tab-count">{{ summary().missingSdlcDocs }}</span>
                    </button>

                    <button
                        type="button"
                        role="tab"
                        class="cat-tab"
                        [class.active]="activeFilter() === 'GAP_F_INDEX_DRIFT'"
                        [attr.aria-selected]="activeFilter() === 'GAP_F_INDEX_DRIFT'"
                        (click)="onSelect('GAP_F_INDEX_DRIFT')"
                        title="GAP-F: Markdown files on disk out of sync with PostgreSQL knowledge_doc"
                    >
                        <span class="dot dot-f" aria-hidden="true"></span>
                        <span class="tab-code">GAP-F</span>
                        <span>Postgres Drift</span>
                        <span class="tab-count">{{ summary().indexDrift }}</span>
                    </button>
                </div>

                <button
                    type="button"
                    class="guide-trigger"
                    [class.active]="guideOpen()"
                    (click)="guideOpen.set(!guideOpen())"
                    [attr.aria-expanded]="guideOpen()"
                    aria-controls="recon-taxonomy-drawer"
                >
                    <svg class="icon-xs" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                        <circle cx="8" cy="8" r="6" />
                        <path d="M8 7v4M8 5.25h.01" stroke-linecap="round" />
                    </svg>
                    <span>{{ guideOpen() ? 'Hide GAP A–F Guide' : 'GAP A–F Guide' }}</span>
                </button>
            </div>

            @if (guideOpen()) {
                <section id="recon-taxonomy-drawer" class="taxonomy-drawer" aria-label="Reconciliation taxonomy reference">
                    <div class="taxonomy-grid">
                        @for (item of categories; track item.id) {
                            <button
                                type="button"
                                class="tax-item"
                                [class.tax-active]="activeFilter() === item.id"
                                (click)="onSelect(item.id)"
                            >
                                <header class="tax-head">
                                    <span class="tax-code">
                                        <span class="dot" [ngClass]="item.dotClass" aria-hidden="true"></span>
                                        {{ item.code }}
                                    </span>
                                    <h4 class="tax-label">{{ item.label }}</h4>
                                </header>
                                <p class="tax-desc">{{ item.what }}</p>
                                <div class="tax-foot">
                                    <code class="tax-target">{{ item.target }}</code>
                                    <span class="tax-action">{{ item.action }}</span>
                                </div>
                            </button>
                        }
                    </div>
                </section>
            }
        </div>
    `,
    styles: [`
        :host {
            display: block;
        }

        .category-strip-wrap {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
        }

        .category-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-3);
            flex-wrap: wrap;
        }

        .category-tabs {
            display: flex;
            align-items: center;
            gap: var(--space-1);
            flex-wrap: wrap;
        }

        .cat-tab {
            appearance: none;
            display: inline-flex;
            align-items: center;
            gap: 0.375rem;
            height: 2rem;
            padding: 0 var(--space-3);
            border-radius: var(--radius-sm);
            border: 1px solid transparent;
            background: transparent;
            color: var(--muted);
            font: inherit;
            font-size: var(--text-xs);
            font-weight: 500;
            cursor: pointer;
            transition: background 140ms ease, color 140ms ease, border-color 140ms ease;

            &:hover {
                color: var(--ink);
                background: var(--surface-2);
            }

            &.active {
                background: var(--surface);
                color: var(--ink);
                font-weight: 600;
                border-color: var(--line);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 1px;
            }
        }

        .tab-code {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.6875rem;
            font-weight: 700;
            color: var(--ink);
            opacity: 0.85;
        }

        .tab-count {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.6875rem;
            color: var(--muted);
            font-variant-numeric: tabular-nums;
        }

        .cat-tab.active .tab-count {
            color: var(--brand);
            font-weight: 700;
        }

        .dot {
            width: 0.375rem;
            height: 0.375rem;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .dot-a { background: #ef4444; }
        .dot-b { background: #f59e0b; }
        .dot-c { background: #a855f7; }
        .dot-d { background: #38bdf8; }
        .dot-e { background: #ec4899; }
        .dot-f { background: #10b981; }

        .guide-trigger {
            appearance: none;
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            height: 2rem;
            padding: 0 var(--space-3);
            border-radius: var(--radius-sm);
            border: 1px solid var(--line);
            background: var(--surface);
            color: var(--muted);
            font: inherit;
            font-size: var(--text-xs);
            font-weight: 500;
            cursor: pointer;
            transition: color 140ms ease, border-color 140ms ease;

            &:hover,
            &.active {
                color: var(--ink);
                border-color: color-mix(in srgb, var(--brand) 50%, var(--line));
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 2px;
            }
        }

        .icon-xs {
            width: 0.875rem;
            height: 0.875rem;
        }

        .taxonomy-drawer {
            padding: var(--space-4);
            border-radius: var(--radius-md);
            border: 1px solid var(--line);
            background: var(--surface);
        }

        .taxonomy-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: var(--space-3);

            @media (max-width: 1024px) {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            @media (max-width: 640px) {
                grid-template-columns: 1fr;
            }
        }

        .tax-item {
            appearance: none;
            width: 100%;
            text-align: left;
            font: inherit;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: var(--space-2);
            padding: var(--space-3);
            border-radius: var(--radius-sm);
            border: 1px solid var(--line);
            background: var(--surface-2);
            transition: border-color 140ms ease, background 140ms ease;

            &:hover {
                border-color: color-mix(in srgb, var(--brand) 55%, var(--line));
            }

            &.tax-active {
                border-color: var(--brand);
                background: color-mix(in srgb, var(--brand) 8%, var(--surface-2));
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 2px;
            }
        }

        .tax-head {
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .tax-code {
            display: inline-flex;
            align-items: center;
            gap: 0.3125rem;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.6875rem;
            font-weight: 700;
            color: var(--muted);
        }

        .tax-label {
            margin: 0;
            font-size: var(--text-sm);
            font-weight: 600;
            color: var(--ink);
        }

        .tax-desc {
            margin: 0;
            font-size: var(--text-xs);
            color: var(--muted);
            line-height: 1.45;
        }

        .tax-foot {
            display: flex;
            flex-direction: column;
            gap: 0.1875rem;
            padding-top: var(--space-2);
            border-top: 1px solid var(--line);
        }

        .tax-target {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.6875rem;
            color: var(--brand);
            overflow-wrap: anywhere;
        }

        .tax-action {
            font-size: 0.6875rem;
            color: var(--ink);
            opacity: 0.85;
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReconciliationMetricsComponent {
    readonly summary = input.required<ReconciliationScanSummaryDto>();
    readonly activeFilter = input<string>('all');
    readonly filterSelect = output<string>();

    readonly guideOpen = signal<boolean>(false);

    readonly categories: CategoryMeta[] = [
        {
            id: 'GAP_A_ORPHAN_ROUTE',
            code: 'GAP-A',
            label: 'Orphan Routes',
            dotClass: 'dot-a',
            what: 'Implemented API endpoints in source code lacking S8 API contract or S7 Acceptance Criteria.',
            target: 'sdlc/07.technical/03.api/',
            action: 'Extract Draft to Inbox -> Gate S17',
        },
        {
            id: 'GAP_B_UNFED_SCHEMA',
            code: 'GAP-B',
            label: 'Unfed Schemas',
            dotClass: 'dot-b',
            what: 'Database models, Prisma entities, or DDL tables missing S9 Data Dictionary documentation.',
            target: 'sdlc/07.technical/02.data-design/',
            action: 'Extract Draft to Inbox -> Gate S17',
        },
        {
            id: 'GAP_C_STALE_HASH',
            code: 'GAP-C',
            label: 'Stale Contracts',
            dotClass: 'dot-c',
            what: 'Governed files modified on disk whose SHA-256 diverges from .harness/knowledge-manifest.json.',
            target: '.harness/knowledge-manifest.json',
            action: 'Re-verify & Re-lock Hash',
        },
        {
            id: 'GAP_D_UNLINKED_SPIKE',
            code: 'GAP-D',
            label: 'Unlinked Spikes',
            dotClass: 'dot-d',
            what: 'Experimental notes in artifacts/ not anchored to an ADR decision log or WBS ticket.',
            target: 'sdlc/03.inception/02.decision-log/',
            action: 'Extract Draft to Inbox -> Link ADR',
        },
        {
            id: 'GAP_E_MISSING_SDLC_DOC',
            code: 'GAP-E',
            label: 'Missing SDLC Docs',
            dotClass: 'dot-e',
            what: 'Required master pipeline stages (S1-S17: BRD, PRD, FRD, SRS, AC, SCN) with zero docs on disk.',
            target: 'sdlc/05.requirements/ .. 12.phases/',
            action: 'Generate YAML Skeleton to Inbox',
        },
        {
            id: 'GAP_F_INDEX_DRIFT',
            code: 'GAP-F',
            label: 'Postgres Index Drift',
            dotClass: 'dot-f',
            what: 'Markdown files on disk unindexed, hash-stale, or ghosted relative to PostgreSQL knowledge_doc.',
            target: 'platform.knowledge_doc (PostgreSQL)',
            action: 'Sync & Re-index PostgreSQL',
        },
    ];

    onSelect(filterId: string): void {
        if (this.activeFilter() === filterId && filterId !== 'all') {
            this.filterSelect.emit('all');
        } else {
            this.filterSelect.emit(filterId);
        }
    }
}
