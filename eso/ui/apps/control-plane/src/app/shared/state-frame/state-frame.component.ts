import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

/**
 * The six UX states are a closed set (sdlc/08.ui-design/03.states.md §1):
 * empty · loading · error · denied · partial · stale. `READY` is the content
 * branch, not a seventh ST state — ST6 means **stale only**.
 */
export type UXState =
    | 'ST1_EMPTY'
    | 'ST2_LOADING'
    | 'ST3_FAILED'
    | 'ST4_DENIED'
    | 'ST5_PARTIAL'
    | 'ST6_STALE'
    | 'READY';

/**
 * Shared State Frame Component (Angular 22 / OnPush / Standalone)
 * Implements 6 UX States per SKILL.md §5 and WCAG 2.2 AA accessibility per §6.
 */
@Component({
    selector: 'eso-state-frame',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="state-frame" [attr.data-state]="state()" [attr.aria-busy]="state() === 'ST2_LOADING'" [attr.aria-live]="state() === 'ST3_FAILED' ? 'assertive' : 'polite'">
            @switch (state()) {
                @case ('ST2_LOADING') {
                    <div class="frame-loading" role="status">
                        <div class="skeleton-block" aria-hidden="true"></div>
                        <p class="loading-label">Loading data...</p>
                    </div>
                }
                @case ('ST3_FAILED') {
                    <div class="frame-failed" role="alert">
                        <h2 class="error-title">An error occurred</h2>
                        <p class="error-detail">{{ errorMessage() || 'Unable to load data from the server.' }}</p>
                        <button type="button" class="btn-retry" (click)="retry.emit()">Retry</button>
                    </div>
                }
                @case ('ST4_DENIED') {
                    <div class="frame-denied" role="alert">
                        <p class="denied-message">Access denied or resource not found.</p>
                        <button type="button" class="btn-action" (click)="action.emit('CHANGE_PROJECT')">Change project</button>
                    </div>
                }
                @case ('ST1_EMPTY') {
                    <div class="frame-empty" role="status">
                        <p class="empty-message">{{ emptyMessage() }}</p>
                        <button type="button" class="btn-action" (click)="action.emit('CHANGE_PROJECT')">Change project</button>
                    </div>
                }
                @case ('ST5_PARTIAL') {
                    <div class="frame-partial" role="status">
                        <div class="partial-banner">
                            <span class="warning-icon" aria-hidden="true">⚠</span>
                            <span>{{ partialLabel() }}</span>
                        </div>
                        <ng-content></ng-content>
                    </div>
                }
                @case ('ST6_STALE') {
                    <div class="frame-stale" role="status">
                        <div class="stale-banner" role="alert">
                            <span class="warning-icon" aria-hidden="true">⚠</span>
                            <span>{{ staleLabel() }}</span>
                            <button type="button" class="btn-refresh" (click)="retry.emit()">Refresh</button>
                        </div>
                        <ng-content></ng-content>
                    </div>
                }
                @default {
                    <!-- READY renders the content; every ST1–ST6 state has its own branch above. -->
                    <div class="frame-ready" data-state="READY">
                        <ng-content></ng-content>
                    </div>
                }
            }
        </div>
    `,
})
export class StateFrameComponent {
    readonly state = input.required<UXState>();
    readonly errorMessage = input<string | null>(null);
    readonly emptyMessage = input<string>('No data yet');

    // AC-UI-01-05/06: counts and ratios are data. `null` means "not recorded",
    // and the frame then says nothing about it — a default 0 or 100% would be
    // false certainty on exactly the states that exist to warn.
    readonly missingCount = input<number | null>(null);
    readonly coverage = input<number | null>(null);

    readonly retry = output<void>();
    readonly action = output<string>();

    private coverageText(): string | null {
        const ratio = this.coverage();
        if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
        return `${Math.round(ratio * 100)}%`;
    }

    partialLabel(): string {
        const missing = this.missingCount();
        const coverage = this.coverageText();
        const missingText = missing === null || missing === undefined ? 'Partial data missing' : `${missing} missing elements`;
        return coverage === null ? missingText : `${missingText} (Coverage: ${coverage})`;
    }

    staleLabel(): string {
        const coverage = this.coverageText();
        return coverage === null
            ? 'Data may be stale or coverage is low. Please refresh.'
            : `Graph coverage ${coverage} — decisions may be wrong.`;
    }
}
