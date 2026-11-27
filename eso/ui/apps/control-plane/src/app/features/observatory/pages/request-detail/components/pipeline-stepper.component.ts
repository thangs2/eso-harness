import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { SectionHintComponent, type SectionHintItem } from '../../../../../shared/section-hint.component.js';
import type { StepperStageView } from '../request-detail.models.js';

/**
 * Pipeline stepper — ESO v2 (8 stages). One circular icon per stage with a status ring, a single
 * selected state, and an evidence counter. A step opens its evidence; a linked tab is a separate
 * action inside the step card (CR-042 contract).
 */
@Component({
    selector: 'eso-pipeline-stepper',
    standalone: true,
    imports: [SectionHintComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <header class="stepper-head">
            <div class="stepper-heading">
                <p class="stepper-eyebrow">Pipeline v2</p>
                <p class="stepper-hint">Select a step to open its evidence</p>
            </div>
            <div class="stepper-actions">
                <p class="stepper-count">
                    <span class="count-value">{{ evidencedDeclared() ? evidenced() + '/' + stages().length : 'n/a' }}</span>
                    <span class="count-label">{{ evidencedDeclared() ? 'steps with evidence' : 'evidence not declared' }}</span>
                </p>
                <eso-section-hint [summary]="hint.summary" [items]="hint.items" />
            </div>
        </header>
        <nav class="pipeline-stepper" aria-label="Pipeline stages">
            @for (stage of stages(); track stage.id; let index = $index) {
                <button
                    type="button"
                    class="pipeline-step"
                    [class.ok]="stage.evidenced === true && stage.status !== 'warn'"
                    [class.bad]="stage.status === 'warn'"
                    [class.info]="stage.evidenced === true && stage.status === 'info'"
                    [class.muted]="stage.evidenced !== true || stage.status === 'muted'"
                    [attr.data-evidenced]="stage.evidenced === true"
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
        <footer class="stepper-legend" aria-label="Step evidence legend">
            <span class="legend-item"><i class="legend-dot ok"></i>Evidence found</span>
            <span class="legend-item"><i class="legend-dot warn"></i>Finding needs attention</span>
            <span class="legend-item"><i class="legend-dot missing"></i>No proof for this step</span>
            <span class="legend-hint">Ring = this step's finding · count = steps with evidence</span>
            <span class="legend-hint">Click a step, or use ← → · Enter opens its evidence</span>
        </footer>
    `,
    styles: [`
        :host {
            display: block;
            padding: var(--space-4);
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
        .stepper-heading { display: grid; gap: var(--space-1); }
        .stepper-eyebrow { margin: 0; color: var(--dim); font-size: .6875rem; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
        .stepper-hint { margin: 0; color: var(--muted); font-size: .75rem; }
        .stepper-actions { display: inline-flex; align-items: center; gap: var(--space-2); }
        .stepper-count { margin: 0; display: flex; align-items: baseline; gap: .375rem; color: var(--dim); font-size: .6875rem; }
        .count-value { color: #cbd5e1; font-weight: 700; font-variant-numeric: tabular-nums; }
        .stepper-legend { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line-soft, #1e2a3e); color: var(--dim); font-size: .6875rem; }
        .legend-item { display: inline-flex; align-items: center; gap: .375rem; }
        .legend-dot { width: .4375rem; height: .4375rem; border-radius: 50%; background: var(--dim); }
        .legend-dot.ok { background: var(--ok-ink); }
        .legend-dot.warn { background: var(--warn-ink); }
        .legend-dot.missing { background: var(--dim); }
        .legend-hint { margin-left: auto; color: #475569; }
        /* Steps are separated by the grid gap, not by each item's own padding (spacing contract §5). */
        .pipeline-stepper { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: var(--space-3); border: 0; background: transparent; }
        .pipeline-step {
            position: relative;
            display: grid;
            grid-template-columns: 2.5rem minmax(0, 1fr);
            align-items: start;
            gap: var(--space-2);
            padding: var(--space-1) var(--space-2);
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
        /* No connector between steps: the hairline used to run from the badge edge across the step
           title. position: relative stays — the numbered badge below is absolute to it. */
        .stage-badge { position: relative; display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 1.5px solid currentColor; border-radius: 50%; background: var(--surface-2); }
        .stage-icon { width: 1.125rem; height: 1.125rem; overflow: visible; }
        .stage-no { position: absolute; right: -.1875rem; bottom: -.1875rem; display: grid; place-items: center; min-width: 1rem; height: 1rem; padding: 0 .1875rem; border: 1px solid var(--line); border-radius: 999px; background: #0a0e17; color: var(--dim); font-size: .6875rem; font-weight: 700; font-variant-numeric: tabular-nums; }
        .pipeline-step-copy { display: grid; gap: var(--space-1); min-width: 0; }
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
        /* The app shell keeps a 260px navigator, so the content column is narrower than the
           viewport. Two rows of four keep the labels readable instead of squeezing eight
           columns (or hiding everything behind a horizontal scrollbar). */
        @media (max-width: 100rem) {
            .pipeline-stepper { grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: var(--space-3); }
        }
        /* Phones: four columns leave ~9px of text width, so every title stacked one character per
           line. One step per row (badge beside the copy) stays readable down to 360px. */
        @media (max-width: 47.9375rem) {
            .pipeline-stepper { grid-template-columns: minmax(0, 1fr); row-gap: var(--space-2); }
            .pipeline-step { grid-template-columns: 2.5rem minmax(0, 1fr); }
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

    readonly hint: { summary: string; items: SectionHintItem[] } = {
        summary: 'Eight fixed ESO v2 stages. The ring colour is the evidence status of that stage for THIS trace; selecting a step opens its evidence without switching the tab.',
        items: [
            { label: 'emerald', text: 'At least one OK observation proves the stage ran.' },
            { label: 'amber', text: 'The stage ran but a gap/attention signal is recorded (for example score below 100).' },
            { label: 'sky', text: 'Informational: something was observed, but no pass/fail proof is attached.' },
            { label: 'slate', text: 'No observation for this stage in this trace — not recorded, not zero.' },
            { label: 'count', text: 'Stages that found proof for their own question. 4/8 means the other four stages have no proof on this trace. The count is the same figure the coverage axis shows.' },
            { label: 'ring', text: 'The ring colour is the stage\'s own finding — not the count. A stage can hold a value and still carry no proof (step 1: the prompt is known but the law was never read), so it stays un-evidenced.' },
            { label: 'number', text: 'The stage order (1→8), fixed by the pipeline; it is not a turn sequence.' },
            { label: 'sub-line', text: 'The stage\'s own metric. "not recorded" means the host sent no value; ESO never fills it in.' },
        ],
    };

    /**
     * Stages that found proof for their own question. The backend count is authoritative; the local
     * count uses the per-stage `evidenced` flag so both always agree. It must never fall back to
     * `status`, which is presentation only — that fallback is what made this header disagree with
     * the 5-Axis "steps" figure on the same screen.
     */
    readonly evidenced = computed(() => {
        const reported = this.evidencedSteps();
        if (reported !== null) return reported;
        return this.stages().filter((stage) => stage.evidenced === true).length;
    });

    /** No declared flag anywhere ⇒ the payload predates it; say so instead of inventing a count. */
    readonly evidencedDeclared = computed(() => this.stages().some((stage) => typeof stage.evidenced === 'boolean'));

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
                // Gauge: a ~240° dial spanning y 2→18 (centred on 12) with a needle at 45°.
                // The previous path was a 180° arc on y 6→14: it read as a stray semicircle sitting in the
                // lower half of the badge, unlike every other 18px icon.
                return 'M6.5 18.5a7 7 0 1 1 11 0 M12 12l3.4-3.4 M12 12h.01';
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
