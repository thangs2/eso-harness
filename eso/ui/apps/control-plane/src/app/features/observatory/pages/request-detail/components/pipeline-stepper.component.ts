import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';
import { STAGE_GLYPH, type StepperStageView } from '../request-detail.models.js';

/**
 * Pipeline stepper — selection is the only thing that makes a step active.
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
                    <span class="step-dot" aria-hidden="true"></span>
                </button>
            }
        </nav>
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --warn-ink: #e0b341; --ok-ink: #4ec97a; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; }
        .stepper-hint { margin: 0 0 var(--space-1); color: var(--muted); font-size: var(--fs-secondary); }
        .pipeline-stepper { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; }
        .pipeline-step { position: relative; display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); align-items: center; gap: var(--space-1); min-height: 4rem; padding: var(--space-1) var(--space-2); border: 0; border-right: 1px solid var(--line-soft); background: transparent; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
        .pipeline-step:last-child { border-right: 0; }
        .pipeline-step:hover { background: var(--surface-3); }
        .pipeline-step:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .pipeline-step.active { background: var(--surface-3); box-shadow: inset 0 -2px 0 var(--brand); }
        .pipeline-step.active .stage-icon { border-color: var(--brand); color: var(--brand); background: rgba(90,169,255,.12); }
        .pipeline-step.ok { color: var(--ok-ink); }
        .pipeline-step.bad { color: var(--warn-ink); }
        .pipeline-step.info { color: var(--brand); }
        .pipeline-step.muted { color: var(--dim); }
        .stage-icon { display: grid; place-items: center; width: 1.25rem; height: 1.25rem; border: 1px solid currentColor; border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-secondary); line-height: 1; }
        .pipeline-step-copy { display: grid; gap: 0; min-width: 0; }
        .pipeline-step-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1875rem; color: #e2e8f0; font-size: var(--fs-secondary); line-height: 1.2; }
        .pipeline-step-sub { color: var(--muted); font-size: var(--fs-badge); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .step-dot { position: absolute; top: var(--space-1); right: var(--space-2); width: .375rem; height: .375rem; border-radius: 50%; background: currentColor; }
        @media (max-width: 74.9375rem) { .pipeline-stepper { grid-template-columns: repeat(8, minmax(9rem, 1fr)); overflow-x: auto; } }
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
