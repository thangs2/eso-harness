import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface SectionHintItem {
    label: string;
    text: string;
}

/**
 * One consistent "?" affordance for section headers. Native <details> gives keyboard and
 * screen-reader behaviour; the panel is absolute so opening it never moves the layout.
 * Use it to say what the section answers and what each value means.
 */
@Component({
    selector: 'eso-section-hint',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <details class="section-hint" #hint>
            <summary [attr.aria-label]="'Explain this section: ' + summary()" [title]="summary()">?</summary>
            <div class="hint-body" role="note">
                <button type="button" class="hint-close" aria-label="Close explanation" (click)="hint.open = false">×</button>
                <p class="hint-summary">{{ summary() }}</p>
                @if (items().length) {
                    <dl class="hint-list">
                        @for (item of items(); track item.label) {
                            <div><dt>{{ item.label }}</dt><dd>{{ item.text }}</dd></div>
                        }
                    </dl>
                }
            </div>
        </details>
    `,
    styles: [`
        :host { display: inline-flex; }
        .section-hint { position: relative; display: inline-flex; }
        .section-hint > summary {
            display: inline-grid; place-items: center; width: 1.25rem; height: 1.25rem;
            border: 1px solid var(--line); border-radius: 50%; background: var(--surface-2);
            color: var(--dim); font-size: .6875rem; font-weight: 700; line-height: 1;
            cursor: pointer; list-style: none; user-select: none;
        }
        .section-hint > summary::-webkit-details-marker { display: none; }
        .section-hint > summary:hover { border-color: var(--brand); color: var(--brand); }
        .section-hint > summary:focus-visible { outline: .125rem solid var(--brand); outline-offset: .125rem; }
        .section-hint[open] > summary { border-color: var(--brand); color: var(--brand); background: rgba(56,189,248,.12); }
        .hint-body {
            position: absolute; z-index: 40; top: 1.625rem; right: 0;
            width: min(23rem, calc(100vw - 3rem)); max-height: 22rem; overflow: auto;
            padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md);
            background: #0b111b; box-shadow: 0 12px 32px rgba(0,0,0,.55);
            color: var(--muted); font-size: .75rem; line-height: 1.45; text-align: left;
        }
        .hint-summary { margin: 0 0 var(--space-2); color: #e2e8f0; font-size: .75rem; }
        .hint-list { display: grid; gap: var(--space-2); margin: 0; }
        .hint-list > div { display: grid; gap: .125rem; }
        .hint-list dt { color: var(--brand); font-size: .6875rem; font-weight: 650; letter-spacing: .02em; }
        .hint-list dd { margin: 0; color: var(--muted); }
        .hint-close { display: none; position: absolute; top: var(--space-2); right: var(--space-2); width: 1.5rem; height: 1.5rem; border: 1px solid var(--line); border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 1rem; line-height: 1; cursor: pointer; }
        @media (max-width: 47.9375rem) {
            .hint-body { position: fixed; top: 12vh; left: var(--space-3); right: var(--space-3); width: auto; max-height: 66vh; z-index: 120; }
            .hint-close { display: grid; place-items: center; }
            .hint-summary { padding-right: 1.5rem; }
        }
    `],
})
export class SectionHintComponent {
    readonly summary = input.required<string>();
    readonly items = input<readonly SectionHintItem[]>([]);
}
