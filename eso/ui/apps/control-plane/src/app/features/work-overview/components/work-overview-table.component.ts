import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import type { WorkOverviewItem } from '../models/work-overview.model.js';

/**
 * Presentational Component: S1 Work Table (SKILL.md §1.2, §2 & §5)
 * Pure presentation: NEVER injects data service.
 * Read-only surface: MUST NOT render write controls (D-72 / AC-UI-01).
 */
@Component({
    selector: 'eso-work-overview-table',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <table class="turns-table" role="table" aria-label="Turn list">
            <thead>
                <tr>
                    <th scope="col">Work</th>
                    <th scope="col">Level</th>
                    <th scope="col">Missing</th>
                    <th scope="col">Action</th>
                </tr>
            </thead>
            <tbody>
                @for (item of items(); track item.turnId) {
                    <tr [attr.data-turn-id]="item.turnId" [class]="item.distinctStyling">
                        <td class="col-work">{{ item.work }}</td>
                        <td class="col-level">{{ item.level }}</td>
                        <td class="col-missing">{{ item.missingBadge }}</td>
                        <td class="col-actions">
                            <button
                                type="button"
                                class="btn-why"
                                [attr.data-turn-id]="item.turnId"
                                (click)="whyTriggered.emit(item.turnId)"
                            >
                                Why
                            </button>
                        </td>
                    </tr>
                }
            </tbody>
        </table>
    `,
})
export class WorkOverviewTableComponent {
    readonly items = input.required<WorkOverviewItem[]>();
    readonly whyTriggered = output<string>();
}
