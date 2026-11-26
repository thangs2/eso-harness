import { ChangeDetectionStrategy, Component, ViewChild, input, output, signal } from '@angular/core';
import { StepGuideComponent } from './step-guide.component.js';
import { SectionHintComponent, type SectionHintItem } from '../../../../../shared/section-hint.component.js';
import type { PipelineStepView, TabKey } from '../request-detail.models.js';

type FlowTone = 'ok' | 'decision' | 'recon' | 'warn' | 'muted';

/**
 * End-to-end flow — one card per system stage, ported from the legacy diagram anatomy:
 * a numbered circle plus a vertical gradient connector on the left, then a 1px coloured card
 * (emerald executed / purple decision / sky recon / amber warn / slate unknown) with 16px
 * padding and up to three raised sub-panels. An empty step collapses to one slim muted row.
 *
 * A card owns two distinct actions: toggle its evidence, or open the related tab. Selecting a
 * step is the stepper's job.
 */
@Component({
    selector: 'eso-pipeline-flow',
    standalone: true,
    imports: [SectionHintComponent, StepGuideComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="endflow">
            <header class="endflow-head">
                <div class="endflow-title">
                    <span class="endflow-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 11-14h-8l1-6z" /></svg></span>
                    <div><p class="eyebrow">Pipeline v2 · data flow</p><h2>End-to-End Pipeline Data Flow</h2><p class="endflow-desc">Prompt ingest → worker handoff → evidence → telemetry</p></div>
                </div>
                <div class="endflow-actions">
                    <eso-section-hint [summary]="hint.summary" [items]="hint.items" />
                    <button type="button" class="ghost-btn" (click)="flowExpanded.set(!flowExpanded())">{{ flowExpanded() ? '▲ Hide' : '▼ Show flow' }}</button>
                </div>
            </header>
            @if (flowExpanded()) {
                <div class="endflow-body">
                    @for (step of steps(); track step.id; let index = $index) {
                        <div class="endflow-step" [class.is-empty]="step.empty" [class.is-open]="isStepOpen(step)" [attr.id]="'step-' + step.id" [attr.data-tone]="tone(step)">
                            <div class="endflow-rail">
                                <span class="endflow-no" [attr.data-tone]="tone(step)">{{ index + 1 }}</span>
                                @if (!$last) { <span class="endflow-connector" [attr.data-tone]="tone(step)" aria-hidden="true"></span> }
                            </div>
                            <div class="endflow-card" [attr.data-tone]="tone(step)" [class.selected]="selectedStepId() === step.id" [class.empty-step]="step.empty">
                                <div class="endflow-card-row">
                                    <button type="button" class="endflow-card-head" (click)="toggleStep(step)" [attr.aria-expanded]="isStepOpen(step)">
                                        <span class="step-badge" [attr.data-tone]="tone(step)">STEP {{ index + 1 }}</span>
                                        <span class="endflow-card-title">{{ step.label }}</span>
                                        <span class="endflow-card-sub">{{ step.empty ? 'No host evidence for this step' : step.sub }}</span>
                                        <span class="status-pill" [attr.data-tone]="tone(step)">{{ step.status }}</span>
                                        <span class="chevron" aria-hidden="true">{{ isStepOpen(step) ? '▾' : '▸' }}</span>
                                    </button>
                                    <div class="endflow-step-actions">
                                        <button type="button" class="step-guide-btn" aria-label="Explain this step" title="Explain this step" (click)="stepGuide?.open(step); $event.stopPropagation()">?</button>
                                        <button type="button" class="open-tab-btn" (click)="openRelatedTab(step)" [title]="'Open the ' + step.tabLabel + ' tab'">Open {{ step.tabLabel }}</button>
                                    </div>
                                </div>
                                @if (isStepOpen(step)) {
                                    @if (step.subcards.length > 0) {
                                        <div class="endflow-subgrid" [class.single]="step.subcards.length === 1" [class.two]="step.subcards.length === 2">
                                            @for (sub of step.subcards; track sub.label; let i = $index) {
                                                <div class="endflow-sub" [attr.data-tone]="subTone(i)">
                                                    <span class="sub-dot" aria-hidden="true"></span>
                                                    <span class="sub-label">{{ sub.label }}</span>
                                                    <strong class="sub-value">{{ sub.value }}</strong>
                                                    <span class="sub-detail">{{ sub.detail }}</span>
                                                </div>
                                            }
                                        </div>
                                    } @else {
                                        <div class="endflow-empty-note">
                                            <span class="note-icon" aria-hidden="true">ⓘ</span>
                                            <span>No observation was recorded by the host for this pipeline stage. Open the <strong>{{ step.tabLabel }}</strong> tab to inspect related configuration.</span>
                                        </div>
                                    }
                                }
                            </div>
                        </div>
                    }
                </div>
            }
            <eso-step-guide #stepGuide />
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #38bdf8; --muted: #94a3b8; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --warn-ink: #fbbf24; --ok-ink: #34d399; --decision-ink: #a78bfa; --recon-ink: #38bdf8; --fs-label: .6875rem; --fs-body: .8125rem; --lh: 1.45; }
        h2, p { margin: 0; }
        h2 { font-size: var(--text-sm); font-weight: 650; color: #f1f5f9; }
        .eyebrow { color: var(--dim); font-size: var(--fs-label); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .endflow { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .endflow-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--line); background: var(--surface-2); }
        .endflow-title { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
        .endflow-icon { display: grid; place-items: center; flex: 0 0 auto; width: 1.875rem; height: 1.875rem; border: 1px solid rgba(56,189,248,.35); border-radius: .5rem; background: rgba(56,189,248,.1); color: var(--recon-ink); }
        .endflow-icon svg { width: 1rem; height: 1rem; }
        .endflow-desc { color: var(--muted); font-size: var(--fs-label); margin: 0; }
        .endflow-actions { display: inline-flex; align-items: center; gap: var(--space-2); }
        .ghost-btn { padding: 0 .625rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted); font: inherit; font-size: var(--fs-label); line-height: 1.8; cursor: pointer; white-space: nowrap; }
        .ghost-btn:hover { border-color: var(--recon-ink); color: #ffffff; }
        .ghost-btn:focus-visible, .open-tab-btn:focus-visible, .step-guide-btn:focus-visible, .endflow-card-head:focus-visible { outline: .125rem solid var(--brand); outline-offset: .125rem; }
        .endflow-body { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--surface-2); }
        .endflow-step { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: var(--space-3); align-items: stretch; scroll-margin-top: calc(var(--header-h) + var(--space-2)); }
        .endflow-rail { display: flex; flex-direction: column; align-items: center; }
        .endflow-no { display: grid; place-items: center; flex: 0 0 auto; width: 2rem; height: 2rem; border: 2px solid var(--tone, var(--muted)); border-radius: 50%; background: var(--surface); color: var(--tone, var(--muted)); font-size: .6875rem; font-weight: 700; box-shadow: 0 0 .75rem color-mix(in srgb, var(--tone, #94a3b8) 35%, transparent); }
        .endflow-step.is-empty .endflow-no { border-color: var(--line); color: var(--dim); box-shadow: none; }
        .endflow-connector { flex: 1 1 auto; width: .125rem; min-height: 1.25rem; margin: .25rem 0; background: var(--connector, var(--line)); }
        [data-tone='ok'] { --tone: var(--ok-ink); --connector: linear-gradient(180deg, #34d399, rgba(167,139,250,.4)); }
        [data-tone='decision'] { --tone: var(--decision-ink); --connector: linear-gradient(180deg, #a78bfa, rgba(56,189,248,.4)); }
        [data-tone='recon'] { --tone: var(--recon-ink); --connector: linear-gradient(180deg, #38bdf8, rgba(251,191,36,.4)); }
        [data-tone='warn'] { --tone: var(--warn-ink); --connector: linear-gradient(180deg, #fbbf24, rgba(148,163,184,.35)); }
        [data-tone='muted'] { --tone: var(--muted); --connector: linear-gradient(180deg, rgba(148,163,184,.6), transparent); }
        .endflow-card { min-width: 0; padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--tone, var(--line)); border-radius: var(--radius-md); background: var(--surface); transition: border-color .15s ease, box-shadow .15s ease; }
        .endflow-card.empty-step { border-color: var(--line); border-left-color: var(--line-soft); background: var(--surface); }
        .endflow-card.selected { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand), 0 0 1rem rgba(56,189,248,.18); }
        .endflow-card-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
        .endflow-card-head { display: flex; flex: 1 1 auto; align-items: center; gap: var(--space-2); min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
        .step-badge { flex: 0 0 auto; display: inline-flex; align-items: center; padding: .0625rem .375rem; border: 1px solid var(--tone, var(--line)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--tone, #94a3b8) 14%, transparent); color: var(--tone, var(--muted)); font-size: .6875rem; font-weight: 700; letter-spacing: .06em; line-height: 1.4; text-transform: uppercase; }
        .endflow-card-title { flex: 0 0 auto; color: #f1f5f9; font-size: var(--fs-body); font-weight: 650; }
        .endflow-card-sub { flex: 1 1 8rem; min-width: 0; color: var(--muted); font-size: var(--fs-label); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .status-pill { flex: 0 0 auto; padding: 0 .4375rem; border: 1px solid var(--tone, var(--line)); border-radius: 62.44rem; background: color-mix(in srgb, var(--tone, #94a3b8) 12%, transparent); color: var(--tone, var(--muted)); font-size: .6875rem; font-weight: 600; letter-spacing: .04em; line-height: 1.5; text-transform: uppercase; }
        .chevron { flex: 0 0 auto; color: var(--dim); font-size: var(--fs-label); line-height: 1; transition: transform .15s ease; }
        .endflow-step-actions { display: inline-flex; align-items: center; gap: var(--space-2); flex: 0 0 auto; margin-left: var(--space-1); }
        .step-guide-btn { display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border: 1px solid var(--line); border-radius: 50%; background: var(--surface-2); color: var(--dim); font-size: .6875rem; font-weight: 700; cursor: pointer; }
        .step-guide-btn:hover { border-color: var(--brand); color: var(--brand); }
        .open-tab-btn { padding: 0 .625rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--brand); font: inherit; font-size: var(--fs-label); line-height: 1.7; cursor: pointer; white-space: nowrap; }
        .open-tab-btn:hover { border-color: var(--brand); background: rgba(56,189,248,.12); color: #ffffff; }
        .endflow-subgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--line-soft); }
        .endflow-subgrid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .endflow-subgrid.single { grid-template-columns: minmax(0, 1fr); }
        .endflow-sub { display: grid; grid-template-columns: .375rem minmax(0, 1fr); align-items: start; gap: .125rem var(--space-2); min-width: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); }
        .endflow-sub .sub-dot { grid-row: 1; align-self: center; width: .375rem; height: .375rem; border-radius: 50%; background: var(--tone, var(--muted)); }
        .endflow-sub .sub-label { color: var(--tone, var(--muted)); font-size: .6875rem; font-weight: 700; letter-spacing: .06em; line-height: 1.45; text-transform: uppercase; }
        .endflow-sub .sub-value { grid-column: 2; color: #e2e8f0; font-size: var(--fs-body); font-weight: 650; line-height: 1.45; overflow-wrap: anywhere; }
        .endflow-sub .sub-detail { grid-column: 2; color: var(--muted); font-size: var(--fs-label); line-height: 1.45; overflow-wrap: anywhere; }
        .endflow-empty-note { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); margin-top: var(--space-3); border: 1px dashed var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--fs-label); line-height: 1.45; }
        .endflow-empty-note .note-icon { color: var(--dim); }
        @media (max-width: 62.5rem) {
            .endflow-subgrid, .endflow-subgrid.two { grid-template-columns: minmax(0, 1fr); }
            .endflow-card-row { flex-wrap: wrap; }
            .endflow-card-head { flex: 1 1 100%; }
            .endflow-step-actions { margin-left: auto; margin-top: var(--space-2); }
        }
    `],
})
export class PipelineFlowComponent {
    @ViewChild('stepGuide') private stepGuide?: StepGuideComponent;

    readonly hint: { summary: string; items: SectionHintItem[] } = {
        summary: 'One card per handoff. An empty step collapses to one row; MISSING is a missing proof, not a UI error.',
        items: [
            { label: 'STEP n', text: 'Pipeline order (1→8), the same order as the stepper above.' },
            { label: 'missing', text: 'No observation for this handoff in the trace. Expand it to see what evidence would be required.' },
            { label: 'OK / WARN', text: 'OK: evidence present. WARN: evidence present but a required field or proof is absent.' },
            { label: 'Open …', text: 'Opens the related tab (waterfall, verdict, rules, telemetry). It does not select the stepper step.' },
            { label: 'row', text: 'Click the row to toggle its evidence details; the sub-cards show what the host actually reported.' },
        ],
    };
    readonly steps = input<PipelineStepView[]>([]);
    readonly selectedStepId = input<string | null>(null);
    readonly expandedIds = input<ReadonlySet<string>>(new Set<string>());

    readonly stepToggled = output<PipelineStepView>();
    readonly openTab = output<TabKey>();

    readonly flowExpanded = signal(true);

    /** Legacy colour law: warn wins, then decision, executed, recon, unknown. */
    tone(step: PipelineStepView): FlowTone {
        if (step.status === 'warn' || step.status === 'bad' || step.status === 'missing' || step.status === 'fail') return 'warn';
        if (step.id === 'decision-jev') return 'decision';
        if (step.status === 'ok') return 'ok';
        if (step.status === 'info') return 'recon';
        return 'muted';
    }

    /** Sub-panel dots cycle emerald → sky → amber, like the legacy three-up rows. */
    subTone(index: number): FlowTone {
        return (['ok', 'recon', 'warn'] as const)[index % 3];
    }

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
