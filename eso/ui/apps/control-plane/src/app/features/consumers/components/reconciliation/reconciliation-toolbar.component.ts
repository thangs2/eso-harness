import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'eso-reconciliation-toolbar',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
        <div class="workbench-toolbar" role="search" aria-label="Filter discrepancies">
            <div class="search-field">
                <svg class="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.5" />
                    <path d="M10.5 10.5L14 14" stroke-linecap="round" />
                </svg>
                <input
                    id="recon-search-input"
                    name="reconSearch"
                    type="search"
                    class="search-input"
                    placeholder="Filter by symbol, file path, or target..."
                    [ngModel]="searchQuery()"
                    (ngModelChange)="searchQueryChange.emit($event)"
                    aria-label="Filter discrepancies"
                />
            </div>

            <div class="toolbar-right">
                <div class="severity-group" role="group" aria-label="Filter by severity">
                    <button
                        type="button"
                        class="sev-btn"
                        [class.active]="filterSeverity() === 'all'"
                        (click)="filterSeverityChange.emit('all')"
                    >
                        All
                    </button>
                    <button
                        type="button"
                        class="sev-btn"
                        [class.active]="filterSeverity() === 'critical'"
                        (click)="filterSeverityChange.emit('critical')"
                    >
                        Critical
                    </button>
                    <button
                        type="button"
                        class="sev-btn"
                        [class.active]="filterSeverity() === 'warning'"
                        (click)="filterSeverityChange.emit('warning')"
                    >
                        Warning
                    </button>
                    <button
                        type="button"
                        class="sev-btn"
                        [class.active]="filterSeverity() === 'info'"
                        (click)="filterSeverityChange.emit('info')"
                    >
                        Info
                    </button>
                </div>

                @if (hasActiveFilters()) {
                    <button type="button" class="reset-btn" (click)="resetFilters.emit()">
                        Reset
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
        }

        .workbench-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-3);
            flex-wrap: wrap;
        }

        .search-field {
            position: relative;
            flex: 1 1 18rem;
            min-width: 14rem;
            max-width: 28rem;
        }

        .search-icon {
            position: absolute;
            left: 0.75rem;
            top: 50%;
            transform: translateY(-50%);
            width: 0.875rem;
            height: 0.875rem;
            color: var(--muted);
            pointer-events: none;
        }

        .search-input {
            width: 100%;
            height: 2.125rem;
            padding: 0 var(--space-3) 0 2.125rem;
            border-radius: var(--radius-sm);
            border: 1px solid var(--line);
            background: var(--surface);
            color: var(--ink);
            font: inherit;
            font-size: var(--text-xs);
            transition: border-color 150ms ease;

            &::placeholder {
                color: var(--muted);
            }

            &:focus {
                outline: none;
                border-color: var(--brand);
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 1px;
            }
        }

        .toolbar-right {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        .severity-group {
            display: inline-flex;
            align-items: center;
            padding: 0.125rem;
            border-radius: var(--radius-sm);
            background: var(--surface-2);
            border: 1px solid var(--line);
        }

        .sev-btn {
            appearance: none;
            border: none;
            background: transparent;
            color: var(--muted);
            font: inherit;
            font-size: var(--text-xs);
            font-weight: 500;
            padding: 0.25rem 0.625rem;
            border-radius: calc(var(--radius-sm) - 0.125rem);
            cursor: pointer;
            transition: background 140ms ease, color 140ms ease;

            &:hover {
                color: var(--ink);
            }

            &.active {
                background: var(--surface);
                color: var(--ink);
                font-weight: 600;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 1px;
            }
        }

        .reset-btn {
            appearance: none;
            border: none;
            background: transparent;
            color: var(--brand);
            font: inherit;
            font-size: var(--text-xs);
            font-weight: 600;
            padding: 0 var(--space-2);
            cursor: pointer;

            &:hover {
                text-decoration: underline;
            }
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReconciliationToolbarComponent {
    readonly searchQuery = input<string>('');
    readonly filterType = input<string>('all');
    readonly filterSeverity = input<string>('all');
    readonly activePillar = input<'all' | 'code' | 'sdlc' | 'postgres'>('all');
    readonly hasActiveFilters = input<boolean>(false);

    readonly searchQueryChange = output<string>();
    readonly filterTypeChange = output<string>();
    readonly filterSeverityChange = output<string>();
    readonly activePillarChange = output<'all' | 'code' | 'sdlc' | 'postgres'>();
    readonly resetFilters = output<void>();
}
