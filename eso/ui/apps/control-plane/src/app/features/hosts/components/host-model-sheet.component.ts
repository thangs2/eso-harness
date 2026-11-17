import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { HostRuntimeDto } from '../../../../../../../libs/api-client/types.js';

/**
 * Model catalog bottom sheet for one host. The catalog is reported by the host runtime;
 * ESO only renders it. Kept in its own component so the host page stays under its
 * component-style budget and the sheet keeps one owner.
 */
@Component({
    selector: 'eso-host-model-sheet',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="host-sheet-backdrop" (click)="closed.emit()">
            <section class="host-sheet" role="dialog" aria-modal="true" aria-label="Host model catalog" (click)="$event.stopPropagation()">
                <span class="host-sheet-handle" aria-hidden="true"></span>
                <header class="host-sheet-head">
                    <div><p class="eyebrow">Host model catalog</p><h2>{{ host().hostId }} · {{ host().runtimeId }}</h2></div>
                    <button mat-button type="button" (click)="closed.emit()">Close</button>
                </header>
                <p class="host-models-note">Default model is the one the host runtime currently uses. The catalog is reported by the host; ESO does not type it.</p>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full">
                    <mat-label>Filter models</mat-label>
                    <input matInput [ngModel]="search()" (ngModelChange)="searchChange.emit($event)" placeholder="model id or name">
                    <span matSuffix class="host-model-filter-count">{{ filteredModels().length }} / {{ host().models.length }}</span>
                </mat-form-field>
                <ul class="host-model-list">
                    @for (model of filteredModels(); track model) {
                        <li [class.is-default]="model === defaultModel()"><code>{{ model }}</code>@if (model === defaultModel()) { <span class="host-model-default-badge">Default</span> }</li>
                    } @empty {
                        <li class="host-model-empty">No model matches "{{ search() }}".</li>
                    }
                </ul>
                <footer class="host-sheet-actions"><button mat-flat-button color="primary" type="button" (click)="closed.emit()">Close</button></footer>
            </section>
        </div>
    `,
    styles: [`
        .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: var(--text-xs); margin: 0 0 var(--space-1); }
        .host-sheet-backdrop { position: fixed; inset: 0; z-index: 40; display: flex; align-items: flex-end; justify-content: center; background: color-mix(in srgb, #000 58%, transparent); }
        .host-sheet { width: min(760px, 100%); max-height: min(82vh, 760px); display: grid; grid-template-rows: auto auto auto auto minmax(0, 1fr) auto; gap: var(--space-2); padding: var(--space-3) var(--space-5) var(--space-4); border: 1px solid var(--line); border-bottom: 0; border-radius: var(--radius-lg) var(--radius-lg) 0 0; background: var(--surface); color: var(--ink); box-shadow: 0 -12px 40px rgba(0,0,0,.4); animation: host-sheet-in .18s ease-out; }
        .host-sheet-handle { width: 44px; height: 4px; margin: 0 auto var(--space-1); border-radius: 999px; background: color-mix(in srgb, var(--muted) 45%, transparent); }
        .host-sheet-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); }
        .host-sheet-head h2 { margin: 0; font-size: var(--text-lg); overflow-wrap: anywhere; }
        .host-sheet-actions { display: flex; justify-content: flex-end; padding-top: var(--space-1); }
        @keyframes host-sheet-in { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @media (max-width: 600px) {
            .host-sheet { max-height: 88vh; padding: var(--space-3) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom)); border-left: 0; border-right: 0; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
            .host-sheet-head h2 { font-size: var(--text-md); }
        }
        .host-models-note { margin: 0; color: var(--muted); font-size: var(--text-xs); }
        .host-model-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 50vh; overflow-y: auto; }
        .host-model-list li { display: flex; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .host-model-list li.is-default { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, var(--surface)); }
        .host-model-default-badge { color: var(--brand); font-size: var(--text-xs); font-weight: 600; }
        .host-model-filter-count { color: var(--muted); font-size: var(--text-xs); padding-right: var(--space-2); }
        .host-model-list li.host-model-empty { justify-content: center; color: var(--muted); }
        .full { width: 100%; }
    `],
})
export class HostModelSheetComponent {
    readonly host = input.required<HostRuntimeDto>();
    readonly search = input('');
    readonly searchChange = output<string>();
    readonly closed = output<void>();

    readonly filteredModels = computed(() => {
        const query = this.search().trim().toLowerCase();
        return query ? this.host().models.filter((model) => model.toLowerCase().includes(query)) : this.host().models;
    });

    defaultModel(): string {
        return this.host().defaultModel || this.host().models[0] || '';
    }
}
