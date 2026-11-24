import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import type { StepperStageView } from '../request-detail.models.js';

/**
 * Pipeline stepper — ESO v2 (8 stages). One circular icon per stage with a status ring, a single
 * selected state, and an evidence counter. A step opens its evidence; a linked tab is a separate
 * action inside the step card (CR-042 contract).
 */
@Component({
    selector: 'eso-pipeline-stepper',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <header class="stepper-head">
            <div class="stepper-heading">
                <p class="stepper-eyebrow">Pipeline v2</p>
                <p class="stepper-hint">Select a step to open its evidence</p>
            </div>
            <p class="stepper-count">
                <span class="count-value">{{ evidenced() }}/{{ stages().length }}</span>
                <span class="count-label">steps with evidence</span>
            </p>
        </header>
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
                    [attr.aria-label]="'Step ' + stage.stepNumber + ': ' + stage.title + ' — ' + stage.sub + '. Open its evidence'"
                    [title]="'Step ' + stage.stepNumber + ': ' + stage.title + ' — click to open its evidence'"
                    (click)="select(stage.id)"
                    (keydown)="onKeydown($event, index)"
                >
                    <span class="stage-badge">
                        <svg class="stage-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path [attr.d]="iconPath(stage.id)" />
                        </svg>
                        <span class="stage-no">{{ stage.stepNumber }}</span>
                    </span>
                    <span class="pipeline-step-copy">
                        <span class="pipeline-step-title">{{ stage.title }}</span>
                        <span class="pipeline-step-sub">{{ displaySub(stage.sub) }}</span>
                    </span>
                </button>
            }
        </nav>
        <footer class="stepper-legend" aria-label="Step status legend">
            <span class="legend-item"><i class="legend-dot ok"></i>Evidence recorded</span>
            <span class="legend-item"><i class="legend-dot warn"></i>Attention</span>
            <span class="legend-item"><i class="legend-dot missing"></i>Not captured</span>
            <span class="legend-hint">Click a step, or use ← → · Enter opens its evidence</span>
        </footer>
    `,
    styles: [`
        :host {
            display: block;
            padding: var(--space-3) var(--space-4) var(--space-2);
            border: 1px solid var(--line);
            border-radius: var(--radius-md);
            background: var(--surface);
            box-shadow: 0 1px 2px rgba(0,0,0,.35);
            --brand: #38bdf8;
            --muted: #94a3b8;
            --dim: #64748b;
            --line: #253047;
            --surface-2: #0d1118;
            --warn-ink: #fbbf24;
            --ok-ink: #34d399;
        }
        .stepper-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin: 0 0 var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-soft, #1e2a3e); }
        .stepper-heading { display: grid; gap: .125rem; }
        .stepper-eyebrow { margin: 0; color: var(--dim); font-size: .6875rem; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
        .stepper-hint { margin: 0; color: var(--muted); font-size: .75rem; }
        .stepper-count { margin: 0; display: flex; align-items: baseline; gap: .375rem; color: var(--dim); font-size: .6875rem; }
        .count-value { color: #cbd5e1; font-weight: 700; font-variant-numeric: tabular-nums; }
        .stepper-legend { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line-soft, #1e2a3e); color: var(--dim); font-size: .6875rem; }
        .legend-item { display: inline-flex; align-items: center; gap: .375rem; }
        .legend-dot { width: .4375rem; height: .4375rem; border-radius: 50%; background: var(--dim); }
        .legend-dot.ok { background: var(--ok-ink); }
        .legend-dot.warn { background: var(--warn-ink); }
        .legend-dot.missing { background: var(--dim); }
        .legend-hint { margin-left: auto; color: #475569; }
        .pipeline-stepper { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 0; border: 0; background: transparent; }
        .pipeline-step {
            position: relative;
            display: grid;
            grid-template-columns: 2.5rem minmax(0, 1fr);
            align-items: start;
            gap: .5rem;
            padding: .375rem .5rem .625rem 0;
            border: 0;
            border-radius: var(--radius-sm);
            background: transparent;
            color: var(--muted);
            font: inherit;
            text-align: left;
            cursor: pointer;
            transition: background .15s ease;
        }
        .pipeline-step:hover { background: rgba(148, 163, 184, .06); }
        .pipeline-step:focus-visible { outline: .125rem solid var(--brand); outline-offset: .125rem; }
        /* connector runs badge-centre → next badge-centre, behind the badges */
        .pipeline-step:not(:last-child)::after {
            content: '';
            position: absolute;
            top: 1.3125rem;
            left: 2.5rem;
            right: 0;
            height: .0625rem;
            background: linear-gradient(to right, var(--line), rgba(37, 48, 71, .35));
            pointer-events: none;
        }
        .stage-badge { position: relative; display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 1.5px solid currentColor; border-radius: 50%; background: var(--surface-2); }
        .stage-icon { width: 1.125rem; height: 1.125rem; }
        .stage-no { position: absolute; right: -.1875rem; bottom: -.1875rem; display: grid; place-items: center; min-width: 1rem; height: 1rem; padding: 0 .1875rem; border: 1px solid var(--line); border-radius: 999px; background: #0a0e17; color: var(--dim); font-size: .6875rem; font-weight: 700; font-variant-numeric: tabular-nums; }
        .pipeline-step-copy { display: grid; gap: .125rem; min-width: 0; padding-top: .125rem; }
        .pipeline-step-title { color: currentColor; font-size: .71875rem; font-weight: 650; line-height: 1.3; letter-spacing: .01em; overflow-wrap: anywhere; }
        .pipeline-step-sub { color: var(--dim); font-size: .6875rem; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .pipeline-step.ok { color: var(--ok-ink); }
        .pipeline-step.bad { color: var(--warn-ink); }
        .pipeline-step.info { color: var(--brand); }
        .pipeline-step.muted { color: var(--muted); }
        .pipeline-step.active .stage-badge { border-color: var(--brand); background: rgba(56, 189, 248, .14); color: #e0f2fe; box-shadow: 0 0 0 .1875rem rgba(56, 189, 248, .18), 0 0 .875rem rgba(56, 189, 248, .45); }
        .pipeline-step.active .pipeline-step-title { color: var(--brand); }
        .pipeline-step.active .pipeline-step-sub { color: #bae6fd; }
        .pipeline-step.active .stage-no { color: #e0f2fe; border-color: rgba(56, 189, 248, .5); }
        @media (max-width: 74.9375rem) {
            .pipeline-stepper { grid-auto-flow: column; grid-auto-columns: minmax(10.5rem, 1fr); grid-template-columns: none; overflow-x: auto; padding-bottom: var(--space-2); scroll-snap-type: x proximity; }
            .pipeline-step { scroll-snap-align: start; }
            .pipeline-step:not(:last-child)::after { display: none; }
        }
        @media (prefers-reduced-motion: reduce) { .pipeline-step, .pipeline-step.active .stage-badge { transition: none; } }
    `],
})
export class PipelineStepperComponent {
    readonly stages = input<StepperStageView[]>([]);
    readonly selectedStepId = input<string | null>(null);
    readonly evidencedSteps = input<number | null>(null);
    readonly stepSelected = output<string>();

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

    readonly evidenced = computed(() => {
        const reported = this.evidencedSteps();
        if (reported !== null) return reported;
        return this.stages().filter((stage) => stage.status === 'ok' || stage.status === 'warn').length;
    });

    /** One consistent stroke icon per stage — no emoji/text glyphs. */
    iconPath(id: string): string {
        switch (id) {
            case 'intake-law':
                return 'M7 3h7l4 4v14H7z M14 3v5h4 M10 12h5 M10 16h5';
            case 'decision-jev':
                return 'M6 4v6a4 4 0 0 0 4 4h8 M6 4a1.5 1.5 0 1 0 0-.001 M18 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M6 20a1.5 1.5 0 1 0 0-.001';
            case 'evidence-recon':
                return 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M16 16l4 4';
            case 'sufficiency':
                return 'M4 14a8 8 0 1 1 16 0 M12 14l4-4 M12 14h.01';
            case 'slp':
                return 'M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M5 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M19 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M12 8v4 M12 12l-5 4 M12 12l5 4';
            case 'execution':
                return 'M5 4l14 8-14 8z M5 4v16';
            case 'seal':
                return 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12l2 2 4-4';
            case 'report':
                return 'M7 3h10v18H7z M10 8h4 M10 12h4 M10 16h4';
            default:
                return 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16';
        }
    }

    /** Normalise backend subs that leak raw enum words ("none") into readable copy. */
    displaySub(sub: string): string {
        return String(sub || '')
            .replace(/\bnone\b/g, 'not recorded')
            .replace(/\bnot captured\b/g, 'not captured');
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
