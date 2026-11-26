import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type {
    DiscrepancySeverity,
    DiscrepancyType,
    ReconciliationGapDto,
} from '../../models/reconciliation.models.js';

@Component({
    selector: 'eso-reconciliation-gap-card',
    standalone: true,
    imports: [CommonModule, RouterLink],
    template: `
        <article class="inspector-panel" [class.is-staged]="gap().status === 'staged_in_inbox'" aria-label="Selected discrepancy details">
            <!-- Header -->
            <header class="inspector-head">
                <div class="head-badges">
                    <span class="sev-pill" [ngClass]="'sev-' + gap().severity">
                        <span class="dot" aria-hidden="true"></span>
                        {{ gap().severity | uppercase }}
                    </span>
                    <span class="type-code" [title]="getTypeExplanation(gap().type)">
                        {{ getShortCode(gap().type) }} &middot; {{ getTypeName(gap().type) }}
                    </span>
                    @if (gap().status === 'resolved') {
                        <span class="state-pill state-resolved">Resolved</span>
                    } @else if (gap().status === 'staged_in_inbox') {
                        <span class="state-pill state-staged">Staged in Inbox</span>
                    }
                </div>
                <span class="detected-at">{{ gap().detectedAt | slice:0:19 }}</span>
            </header>

            <!-- Body -->
            <div class="inspector-body">
                <h3 class="inspector-title">{{ gap().symbol }}</h3>

                <div class="meta-grid">
                    <div class="meta-row">
                        <span class="meta-key">Source</span>
                        <code class="meta-val">{{ gap().filePath }}:{{ gap().lines }}</code>
                    </div>
                    <div class="meta-row">
                        <span class="meta-key">Target</span>
                        <code class="meta-val target-val">{{ gap().suggestedTarget }}</code>
                    </div>
                </div>

                <div class="detail-block">
                    <span class="section-label">Discrepancy Detail</span>
                    <p class="detail-text">{{ gap().detail }}</p>
                </div>

                <div class="context-hint">
                    <svg class="icon-xs" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                        <circle cx="8" cy="8" r="6" />
                        <path d="M8 7v4M8 5.25h.01" stroke-linecap="round" />
                    </svg>
                    <span>{{ getTypeExplanation(gap().type) }}</span>
                </div>

                @if (gap().codeSnippet) {
                    <div class="snippet-block">
                        <div class="snippet-head">
                            <span class="section-label">Source Snippet</span>
                            <span class="snippet-lines">Lines {{ gap().lines }}</span>
                        </div>
                        <pre class="snippet-pre"><code>{{ gap().codeSnippet }}</code></pre>
                    </div>
                }
            </div>

            <!-- Footer Actions -->
            <footer class="inspector-footer">
                <div class="primary-actions">
                    @if (gap().status === 'resolved') {
                        <span class="resolved-note">
                            <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                                <path d="M3.5 8.5l3 3 6-6.5" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                            Reconciled &amp; verified
                        </span>
                    } @else if (gap().status === 'staged_in_inbox') {
                        <div class="staged-row">
                            <span class="staged-note">Staged as proposed draft</span>
                            <a
                                [routerLink]="['/consumers', consumerId(), 'settings']"
                                [queryParams]="{ tab: 'knowledge', section: 'artifacts' }"
                                class="inbox-link"
                            >
                                Open Artifacts Inbox
                                <svg class="icon-xs" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                                    <path d="M5 11l6-6M6.5 5H11v4.5" stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                            </a>
                        </div>
                    } @else if (gap().type === 'GAP_C_STALE_HASH') {
                        <button
                            type="button"
                            class="btn-action-primary btn-warn"
                            [disabled]="isBusy()"
                            (click)="relock.emit(gap())"
                        >
                            <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                                <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
                                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                            </svg>
                            <span>{{ isBusy() ? 'Re-locking...' : 'Re-verify & Re-lock Hash' }}</span>
                        </button>
                    } @else if (gap().type === 'GAP_F_INDEX_DRIFT') {
                        <button
                            type="button"
                            class="btn-action-primary"
                            [disabled]="isBusy()"
                            (click)="syncIndex.emit(gap())"
                        >
                            <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                                <path d="M13.5 8a5.5 5.5 0 1 1-1.35-3.6M13.5 2.5v2.75h-2.75" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                            <span>{{ isBusy() ? 'Syncing DB...' : 'Sync PostgreSQL Index' }}</span>
                        </button>
                    } @else if (gap().type === 'GAP_E_MISSING_SDLC_DOC') {
                        <button
                            type="button"
                            class="btn-action-primary"
                            [disabled]="isBusy()"
                            (click)="extract.emit(gap())"
                        >
                            <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                                <path d="M3.5 2.5h6.5l2.5 2.5v8.5h-9v-11zM8 6.5v4M6 8.5h4" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                            <span>{{ isBusy() ? 'Generating...' : 'Generate Skeleton to Inbox' }}</span>
                        </button>
                    } @else {
                        <button
                            type="button"
                            class="btn-action-primary"
                            [disabled]="isBusy()"
                            (click)="extract.emit(gap())"
                        >
                            <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                                <path d="M8.5 2L3.5 9h4l-.5 5 5.5-7h-4l.5-5z" stroke-linejoin="round" />
                            </svg>
                            <span>{{ isBusy() ? 'Extracting...' : 'Extract Draft to Inbox' }}</span>
                        </button>
                    }
                </div>

                <div class="secondary-actions">
                    <button
                        type="button"
                        class="btn-action-secondary"
                        [class.copied]="isCopied()"
                        (click)="copyPrompt.emit(gap())"
                    >
                        @if (isCopied()) {
                            <svg class="icon-xs" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                                <path d="M3.5 8.5l3 3 6-6.5" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                            <span>Prompt Copied</span>
                        } @else {
                            <svg class="icon-xs" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                                <rect x="5" y="5" width="8.5" height="8.5" rx="1.2" />
                                <path d="M11 5V3.5A1.2 1.2 0 0 0 9.8 2.3H3.5A1.2 1.2 0 0 0 2.3 3.5v6.3A1.2 1.2 0 0 0 3.5 11H5" />
                            </svg>
                            <span>Copy Agent Prompt</span>
                        }
                    </button>

                    @if (gap().status === 'open') {
                        <button
                            type="button"
                            class="btn-action-ghost"
                            [disabled]="isBusy()"
                            (click)="ignore.emit(gap())"
                            title="Add to .harness/reconcile-ignore.json"
                        >
                            Dismiss
                        </button>
                    }
                </div>
            </footer>
        </article>
    `,
    styles: [`
        :host {
            display: block;
        }

        .inspector-panel {
            display: flex;
            flex-direction: column;
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: var(--radius-md);
            overflow: hidden;

            &.is-staged {
                border-color: color-mix(in srgb, #10b981 40%, var(--line));
            }
        }

        .inspector-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
            padding: var(--space-3) var(--space-4);
            background: var(--surface-2);
            border-bottom: 1px solid var(--line);
            flex-wrap: wrap;
        }

        .head-badges {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        .sev-pill {
            display: inline-flex;
            align-items: center;
            gap: 0.3125rem;
            padding: 0.125rem 0.4375rem;
            border-radius: var(--radius-sm);
            font-size: 0.6875rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            border: 1px solid var(--line);
        }

        .dot {
            width: 0.375rem;
            height: 0.375rem;
            border-radius: 50%;
        }

        .sev-critical {
            color: #f87171;
            border-color: color-mix(in srgb, #ef4444 35%, var(--line));
            background: color-mix(in srgb, #ef4444 10%, transparent);
            .dot { background: #ef4444; }
        }

        .sev-warning {
            color: #fbbf24;
            border-color: color-mix(in srgb, #f59e0b 35%, var(--line));
            background: color-mix(in srgb, #f59e0b 10%, transparent);
            .dot { background: #f59e0b; }
        }

        .sev-info {
            color: #38bdf8;
            border-color: color-mix(in srgb, #38bdf8 35%, var(--line));
            background: color-mix(in srgb, #38bdf8 10%, transparent);
            .dot { background: #38bdf8; }
        }

        .type-code {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: var(--text-xs);
            font-weight: 600;
            color: var(--muted);
        }

        .state-pill {
            font-size: 0.6875rem;
            font-weight: 600;
            padding: 0.125rem 0.4375rem;
            border-radius: 999px;
            border: 1px solid var(--line);
        }

        .state-resolved,
        .state-staged {
            color: #34d399;
            border-color: color-mix(in srgb, #10b981 35%, var(--line));
            background: color-mix(in srgb, #10b981 10%, transparent);
        }

        .detected-at {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.6875rem;
            color: var(--muted);
            font-variant-numeric: tabular-nums;
        }

        .inspector-body {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
            padding: var(--space-4);
        }

        .inspector-title {
            margin: 0;
            font-size: var(--text-md);
            font-weight: 600;
            color: var(--ink);
            line-height: 1.35;
            overflow-wrap: anywhere;
        }

        .meta-grid {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
            padding: var(--space-3);
            border-radius: var(--radius-sm);
            background: var(--surface-2);
            border: 1px solid var(--line);
        }

        .meta-row {
            display: grid;
            grid-template-columns: 3.75rem minmax(0, 1fr);
            gap: var(--space-2);
            align-items: baseline;
        }

        .meta-key {
            font-size: 0.6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted);
        }

        .meta-val {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: var(--text-xs);
            color: var(--ink);
            overflow-wrap: anywhere;
        }

        .target-val {
            color: var(--brand);
        }

        .detail-block {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
        }

        .section-label {
            font-size: 0.6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted);
        }

        .detail-text {
            margin: 0;
            font-size: var(--text-sm);
            color: var(--ink);
            line-height: 1.5;
        }

        .context-hint {
            display: flex;
            align-items: flex-start;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-sm);
            border: 1px solid var(--line);
            background: color-mix(in srgb, var(--surface-2) 60%, transparent);
            font-size: var(--text-xs);
            color: var(--muted);
            line-height: 1.45;
        }

        .snippet-block {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
        }

        .snippet-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .snippet-lines {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.6875rem;
            color: var(--muted);
        }

        .snippet-pre {
            margin: 0;
            padding: var(--space-3);
            max-height: 12rem;
            overflow: auto;
            border-radius: var(--radius-sm);
            border: 1px solid var(--line);
            background: color-mix(in srgb, var(--bg, #070e18) 80%, var(--surface));
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.725rem;
            line-height: 1.5;
            color: var(--ink);
            white-space: pre;
        }

        .inspector-footer {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
            padding: var(--space-3) var(--space-4);
            background: var(--surface-2);
            border-top: 1px solid var(--line);
        }

        .primary-actions {
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .secondary-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        .btn-action-primary,
        .btn-action-secondary,
        .btn-action-ghost {
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
            transition: background 150ms ease, border-color 150ms ease, opacity 150ms ease;

            &:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 2px;
            }
        }

        .btn-action-primary {
            width: 100%;
            background: var(--brand);
            color: var(--brand-ink, #06141a);
            border: 1px solid transparent;

            &:hover:not(:disabled) {
                filter: brightness(1.08);
            }

            &.btn-warn {
                background: #f59e0b;
                color: #1c1002;
            }
        }

        .btn-action-secondary {
            flex: 1;
            background: var(--surface);
            color: var(--ink);
            border: 1px solid var(--line);

            &:hover {
                border-color: color-mix(in srgb, var(--ink) 30%, var(--line));
            }

            &.copied {
                color: #34d399;
                border-color: color-mix(in srgb, #10b981 45%, var(--line));
            }
        }

        .btn-action-ghost {
            background: transparent;
            color: var(--muted);
            border: 1px solid transparent;

            &:hover:not(:disabled) {
                color: #f87171;
                border-color: color-mix(in srgb, #ef4444 35%, var(--line));
                background: color-mix(in srgb, #ef4444 8%, transparent);
            }
        }

        .resolved-note {
            display: inline-flex;
            align-items: center;
            gap: var(--space-2);
            font-size: var(--text-xs);
            font-weight: 600;
            color: #34d399;
        }

        .staged-row {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        .staged-note {
            font-size: var(--text-xs);
            font-weight: 600;
            color: #34d399;
        }

        .inbox-link {
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            font-size: var(--text-xs);
            font-weight: 600;
            color: var(--brand);
            text-decoration: none;

            &:hover {
                text-decoration: underline;
            }
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
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReconciliationGapCardComponent {
    readonly gap = input.required<ReconciliationGapDto>();
    readonly consumerId = input.required<string>();
    readonly isCopied = input(false);
    readonly isExtracted = input(false);
    readonly isBusy = input(false);

    readonly extract = output<ReconciliationGapDto>();
    readonly relock = output<ReconciliationGapDto>();
    readonly ignore = output<ReconciliationGapDto>();
    readonly syncIndex = output<ReconciliationGapDto>();
    readonly copyPrompt = output<ReconciliationGapDto>();

    getShortCode(type: DiscrepancyType): string {
        switch (type) {
            case 'GAP_A_ORPHAN_ROUTE': return 'GAP-A';
            case 'GAP_B_UNFED_SCHEMA': return 'GAP-B';
            case 'GAP_C_STALE_HASH': return 'GAP-C';
            case 'GAP_D_UNLINKED_SPIKE': return 'GAP-D';
            case 'GAP_E_MISSING_SDLC_DOC': return 'GAP-E';
            case 'GAP_F_INDEX_DRIFT': return 'GAP-F';
            default: return type;
        }
    }

    getTypeName(type: DiscrepancyType): string {
        switch (type) {
            case 'GAP_A_ORPHAN_ROUTE': return 'Orphan Route';
            case 'GAP_B_UNFED_SCHEMA': return 'Unfed Schema';
            case 'GAP_C_STALE_HASH': return 'Stale Contract';
            case 'GAP_D_UNLINKED_SPIKE': return 'Unlinked Spike';
            case 'GAP_E_MISSING_SDLC_DOC': return 'Missing SDLC Doc';
            case 'GAP_F_INDEX_DRIFT': return 'Postgres Index Drift';
            default: return type;
        }
    }

    getTypeExplanation(type: DiscrepancyType): string {
        switch (type) {
            case 'GAP_A_ORPHAN_ROUTE':
                return 'Implemented API endpoint in source code without a corresponding S8 API contract (sdlc/07.technical/03.api/) or S7 Acceptance Criteria.';
            case 'GAP_B_UNFED_SCHEMA':
                return 'Database model or DDL table defined in code without S9 Data Dictionary documentation (sdlc/07.technical/02.data-design/).';
            case 'GAP_C_STALE_HASH':
                return 'Governed file modified on disk whose SHA-256 diverges from the locked baseline in .harness/knowledge-manifest.json.';
            case 'GAP_D_UNLINKED_SPIKE':
                return 'Experimental spike artifact not anchored to an Architecture Decision Record (ADR) or WBS work package.';
            case 'GAP_E_MISSING_SDLC_DOC':
                return 'Required SDLC Master Pipeline stage (S1-S17) has zero markdown artifacts on disk. Generate a YAML frontmatter skeleton to reconcile.';
            case 'GAP_F_INDEX_DRIFT':
                return 'Markdown file on disk is out of sync with PostgreSQL knowledge_doc (missing row, stale content_hash, or deleted ghost row).';
            default:
                return '';
        }
    }
}
