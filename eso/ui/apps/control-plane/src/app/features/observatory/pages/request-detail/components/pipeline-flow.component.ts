import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { PipelineStepView, TabKey } from '../request-detail.models.js';

/**
 * End-to-end flow — one card per system stage. A card owns two distinct actions:
 * toggle its evidence, or open the related tab. Selecting a step is the stepper's job.
 */
@Component({
    selector: 'eso-pipeline-flow',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="endflow">
            <header class="endflow-head">
                <div class="endflow-title">
                    <span class="endflow-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 11-14h-8l1-6z" /></svg></span>
                    <div><p class="eyebrow">Pipeline v2 · data flow</p><h2>End-to-End Pipeline Data Flow</h2><p>Prompt ingest → worker handoff → evidence → telemetry</p></div>
                </div>
                <button type="button" class="ghost-btn" (click)="flowExpanded.set(!flowExpanded())">{{ flowExpanded() ? '▲ Hide' : '▼ Show flow' }}</button>
            </header>
            @if (flowExpanded()) {
                <div class="endflow-body">
                    @for (step of steps(); track step.id; let index = $index) {
                        <div class="endflow-step" [class.is-empty]="step.empty" [attr.id]="'step-' + step.id">
                            <div class="endflow-rail"><span class="endflow-no" [class.ok]="step.status === 'ok'" [class.bad]="step.status === 'warn'">{{ index + 1 }}</span></div>
                            <div class="endflow-card" [class.ok]="step.status === 'ok'" [class.bad]="step.status === 'warn'" [class.info]="step.status === 'info'" [class.selected]="selectedStepId() === step.id">
                                <div class="endflow-card-row">
                                    <button type="button" class="endflow-card-head" (click)="toggleStep(step)" [attr.aria-expanded]="isStepOpen(step)">
                                        <span class="endflow-card-title">STEP {{ index + 1 }} · {{ step.label }}</span>
                                        @if (step.empty) { <span class="missing-tag">missing</span> }
                                        <span class="endflow-card-sub">{{ step.empty ? 'No host evidence for this step' : step.sub }}</span>
                                        <span class="badge" [class.ok]="step.status === 'ok'" [class.warn]="step.status === 'warn'">{{ step.status }}</span>
                                        <span class="chevron" aria-hidden="true">{{ isStepOpen(step) ? '▾' : '▸' }}</span>
                                    </button>
                                    <button type="button" class="open-tab-btn" (click)="openRelatedTab(step)" [title]="'Open the ' + step.tabLabel + ' tab'">Open {{ step.tabLabel }}</button>
                                </div>
                                @if (isStepOpen(step)) {
                                    <div class="endflow-subgrid" [class.single]="step.subcards.length === 1">
                                        @for (sub of step.subcards; track sub.label) {
                                            <div class="endflow-sub">
                                                <span class="sub-label">{{ sub.label }}</span>
                                                <strong class="sub-value">{{ sub.value }}</strong>
                                                <small class="sub-detail">{{ sub.detail }}</small>
                                            </div>
                                        }
                                    </div>
                                }
                            </div>
                        </div>
                    }
                </div>
            }
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --warn-ink: #e0b341; --ok-ink: #4ec97a; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        h2, p { margin: 0; }
        h2 { font-size: var(--fs-title); font-weight: 650; }
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .endflow { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .endflow-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line); background: var(--surface-3); }
        .endflow-title { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .endflow-icon { display: grid; place-items: center; flex: 0 0 auto; width: 1.5rem; height: 1.5rem; border: 1px solid rgba(90,169,255,.35); border-radius: var(--radius-sm); background: rgba(90,169,255,.1); color: var(--brand); }
        .endflow-icon svg { width: 1rem; height: 1rem; }
        .endflow-title p { margin: 0; color: var(--muted); font-size: var(--fs-secondary); }
        .ghost-btn { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted); font: inherit; font-size: var(--fs-secondary); line-height: 1.6; cursor: pointer; white-space: nowrap; }
        .ghost-btn:hover { border-color: var(--brand); color: #ffffff; }
        .ghost-btn:focus-visible, .open-tab-btn:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .endflow-body { display: grid; gap: 0; padding: var(--space-2) var(--space-3) var(--space-3); background: var(--surface-2); }
        .endflow-step { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap: var(--space-2); align-items: start; scroll-margin-top: calc(var(--header-h) + var(--space-2)); }
        .endflow-rail { display: flex; flex-direction: column; align-items: center; padding-top: var(--space-1); }
        .endflow-no { display: grid; place-items: center; width: 1.375rem; height: 1.375rem; border: 1px solid #475569; border-radius: 50%; background: var(--surface); color: var(--muted); font-size: var(--fs-badge); font-weight: 700; }
        .endflow-no.ok { border-color: var(--ok-ink); color: var(--ok-ink); }
        .endflow-no.bad { border-color: var(--warn-ink); color: var(--warn-ink); }
        .endflow-step:not(:last-child) .endflow-rail::after { content: ''; flex: 1; width: .0625rem; margin: .1875rem 0; background: var(--line); }
        .endflow-card { min-width: 0; margin-bottom: var(--space-1); border: 1px solid var(--line); border-left: 3px solid #475569; border-radius: var(--radius-sm); background: var(--surface); }
        .endflow-card.ok { border-left-color: var(--ok-ink); }
        .endflow-card.bad { border-left-color: var(--warn-ink); }
        .endflow-card.info { border-left-color: var(--brand); }
        .endflow-card.selected { box-shadow: 0 0 0 1px var(--brand) inset; background: var(--surface-3); }
        .endflow-card-row { display: flex; align-items: center; gap: var(--space-1); padding-right: var(--space-2); }
        .endflow-card-head { display: flex; flex: 1 1 auto; align-items: center; gap: var(--space-2); width: 100%; min-width: 0; padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
        .endflow-card-head:hover { background: rgba(90,169,255,.05); }
        .endflow-card-head:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .endflow-card-title { flex: 0 0 auto; color: #cbd5e1; font-size: var(--fs-badge); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
        .endflow-card-sub { flex: 1 1 auto; min-width: 0; color: var(--muted); font-size: var(--fs-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .missing-tag { flex: 0 0 auto; padding: 0 var(--space-1); border: 1px solid rgba(224,179,65,.4); border-radius: var(--radius-sm); background: rgba(224,179,65,.1); color: var(--warn-ink); font-size: var(--fs-badge); letter-spacing: .06em; line-height: 1.5; text-transform: uppercase; }
        .endflow-card .badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); white-space: nowrap; }
        .endflow-card .badge.ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); }
        .endflow-card .badge.warn { color: #fde68a; border-color: rgba(224,179,65,.45); }
        .open-tab-btn { flex: 0 0 auto; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--brand); font: inherit; font-size: var(--fs-badge); line-height: 1.7; cursor: pointer; white-space: nowrap; }
        .open-tab-btn:hover { border-color: var(--brand); background: rgba(90,169,255,.12); }
        .chevron { color: var(--muted); font-size: var(--fs-secondary); line-height: 1; }
        .endflow-subgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); padding: 0 var(--space-2) var(--space-2); }
        .endflow-subgrid.single { grid-template-columns: minmax(0, 1fr); }
        .endflow-sub { display: grid; gap: 0; min-width: 0; }
        .endflow-sub .sub-label { color: var(--dim); font-size: var(--fs-secondary); letter-spacing: .04em; text-transform: uppercase; }
        .endflow-sub .sub-value { color: #e2e8f0; font-size: var(--fs-body); font-weight: 600; line-height: var(--lh); overflow-wrap: anywhere; }
        .endflow-sub .sub-detail { color: var(--dim); font-size: var(--fs-secondary); line-height: var(--lh); overflow-wrap: anywhere; }
        @media (max-width: 47.9375rem) { .endflow-subgrid { grid-template-columns: minmax(0, 1fr); } }
    `],
})
export class PipelineFlowComponent {
    readonly steps = input<PipelineStepView[]>([]);
    readonly selectedStepId = input<string | null>(null);
    readonly expandedIds = input<ReadonlySet<string>>(new Set<string>());

    readonly stepToggled = output<PipelineStepView>();
    readonly openTab = output<TabKey>();

    readonly flowExpanded = signal(true);

    isStepOpen(step: PipelineStepView): boolean {
        return this.expandedIds().has(step.id);
    }

    toggleStep(step: PipelineStepView): void {
        this.stepToggled.emit(step);
    }

    openRelatedTab(step: PipelineStepView): void {
        this.openTab.emit(step.tab);
    }
}
