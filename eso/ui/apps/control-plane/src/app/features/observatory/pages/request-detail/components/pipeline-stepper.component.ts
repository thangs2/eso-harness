import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';
import { STAGE_GLYPH, type StepperStageView } from '../request-detail.models.js';

/**
 * Pipeline stepper — the legacy anatomy: eight evenly spaced circular badges with a coloured
 * ring per status, an 11px coloured label and a muted sub line. There is no segmented card
 * chrome; selection is the only active state (ring + glow + `aria-current`).
 *
 * A tab may be linked from a step, but a tab never selects a step.
 */
@Component({
    selector: 'eso-pipeline-stepper',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <p class="stepper-hint">Select a step to open its evidence</p>
        <nav class="pipeline-stepper" aria-label="Pipeline stages">
            @for (stage of stages(); track stage.id; let index = $index) {
                <button
                    type="button"
                    class="pipeline-step"
                    [class.ok]="stage.status === 'ok'"
                    [class.bad]="stage.status === 'warn'"
                    [class.info]="stage.status === 'info'"
                    [class.muted]="stage.status === 'muted'"
                    [class.active]="selectedStepId() === stage.id"
                    [attr.aria-current]="selectedStepId() === stage.id ? 'step' : null"
                    [title]="'Step ' + stage.stepNumber + ': ' + stage.title + ' — click to open its evidence'"
                    (click)="select(stage.id)"
                    (keydown)="onKeydown($event, index)"
                >
                    <span class="stage-icon" aria-hidden="true">{{ stageGlyph(stage.id) }}</span>
                    <span class="pipeline-step-copy">
                        <span class="pipeline-step-title">{{ stage.title }}</span>
                        <span class="pipeline-step-sub">{{ stage.sub }}</span>
                    </span>
                </button>
            }
        </nav>
    `,
    styles: [`
        :host { display: block; --brand: #38bdf8; --muted: #94a3b8; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --warn-ink: #fbbf24; --ok-ink: #34d399; --fs-label: .6875rem; }
        .stepper-hint { margin: 0 0 var(--space-2); color: var(--muted); font-size: var(--fs-label); }
        .pipeline-stepper { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); border: 0; background: transparent; }
        .pipeline-step { position: relative; display: grid; grid-template-columns: 2.125rem minmax(0, 1fr); align-items: start; gap: .375rem; padding: .25rem .5rem .5rem 0; border: 0; background: transparent; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
        .pipeline-step:not(:last-child)::after { content: ''; position: absolute; top: 1.3125rem; right: -.0625rem; width: .75rem; height: .0625rem; background: var(--line); }
        .pipeline-step:hover .stage-icon { transform: translateY(-.0625rem); }
        .pipeline-step:focus-visible { outline: .125rem solid var(--brand); outline-offset: .125rem; border-radius: .375rem; }
        .stage-icon { display: grid; place-items: center; width: 2.125rem; height: 2.125rem; border: 2px solid currentColor; border-radius: 50%; background: var(--surface-2); font-size: .8125rem; font-weight: 700; line-height: 1; transition: transform .15s ease, box-shadow .15s ease, background .15s ease; }
        .pipeline-step.ok { color: var(--ok-ink); }
        .pipeline-step.bad { color: var(--warn-ink); }
        .pipeline-step.info { color: var(--brand); }
        .pipeline-step.muted { color: var(--muted); }
        .pipeline-step-copy { display: grid; gap: .125rem; min-width: 0; padding-top: .1875rem; }
        .pipeline-step-title { color: currentColor; font-size: var(--fs-label); font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
        .pipeline-step-sub { color: var(--muted); font-size: var(--fs-label); line-height: 1.35; overflow-wrap: anywhere; }
        .pipeline-step.active .stage-icon { border-color: var(--brand); background: rgba(56,189,248,.14); color: #e0f2fe; box-shadow: 0 0 0 .1875rem rgba(56,189,248,.2), 0 0 .875rem rgba(56,189,248,.55); }
        .pipeline-step.active .pipeline-step-title { color: var(--brand); }
        .pipeline-step.active .pipeline-step-sub { color: #bae6fd; }
        @media (max-width: 74.9375rem) { .pipeline-stepper { grid-template-columns: repeat(8, minmax(9rem, 1fr)); overflow-x: auto; padding-bottom: .25rem; } .pipeline-step:not(:last-child)::after { display: none; } }
    `],
})
export class PipelineStepperComponent {
    readonly stages = input<StepperStageView[]>([]);
    readonly selectedStepId = input<string | null>(null);
    readonly stepSelected = output<string>();

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

    stageGlyph(id: string): string {
        return STAGE_GLYPH[id] ?? '·';
    }

    select(id: string): void {
        this.stepSelected.emit(id);
    }

    /** Arrow keys/Home/End move the single selection and keep focus on the moved step. */
    onKeydown(event: KeyboardEvent, index: number): void {
        const list = this.stages();
        if (!list.length) return;
        let next = index;
        switch (event.key) {
            case 'ArrowLeft':
                next = (index - 1 + list.length) % list.length;
                break;
            case 'ArrowRight':
                next = (index + 1) % list.length;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = list.length - 1;
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                this.stepSelected.emit(list[index].id);
                return;
            default:
                return;
        }
        event.preventDefault();
        this.stepSelected.emit(list[next].id);
        requestAnimationFrame(() => {
            const buttons = this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.pipeline-step');
            buttons[next]?.focus();
        });
    }
}
