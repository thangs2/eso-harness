import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
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
                        <div class="endflow-step" [class.is-empty]="step.empty" [attr.id]="'step-' + step.id" [attr.data-tone]="tone(step)">
                            <div class="endflow-rail">
                                <span class="endflow-no" [attr.data-tone]="tone(step)">{{ index + 1 }}</span>
                                @if (!$last) { <span class="endflow-connector" [attr.data-tone]="tone(step)" aria-hidden="true"></span> }
                            </div>
                            @if (step.empty && !isStepOpen(step)) {
                                <div class="endflow-collapsed">
                                    <button type="button" class="collapsed-head" (click)="toggleStep(step)" [attr.aria-expanded]="false">
                                        <span class="endflow-card-title" [attr.data-tone]="tone(step)">STEP {{ index + 1 }} · {{ step.label }}</span>
                                        <span class="missing-tag">missing</span>
                                        <span class="collapsed-note">No host evidence for this step</span>
                                        <span class="chevron" aria-hidden="true">▸</span>
                                    </button>
                                    <button type="button" class="open-tab-btn" (click)="openRelatedTab(step)" [title]="'Open the ' + step.tabLabel + ' tab'">Open {{ step.tabLabel }}</button>
                                </div>
                            } @else {
                                <div class="endflow-card" [attr.data-tone]="tone(step)" [class.selected]="selectedStepId() === step.id">
                                    <div class="endflow-card-row">
                                        <button type="button" class="endflow-card-head" (click)="toggleStep(step)" [attr.aria-expanded]="isStepOpen(step)">
                                            <span class="endflow-card-title" [attr.data-tone]="tone(step)">STEP {{ index + 1 }} · {{ step.label }}</span>
                                            <span class="endflow-card-sub">({{ step.empty ? 'no host evidence for this step' : step.sub }})</span>
                                            <span class="status-pill" [attr.data-tone]="tone(step)">{{ step.status }}</span>
                                            <span class="chevron" aria-hidden="true">{{ isStepOpen(step) ? '▾' : '▸' }}</span>
                                        </button>
                                        <button type="button" class="open-tab-btn" (click)="openRelatedTab(step)" [title]="'Open the ' + step.tabLabel + ' tab'">Open {{ step.tabLabel }}</button>
                                    </div>
                                    @if (isStepOpen(step)) {
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
                                    }
                                </div>
                            }
                        </div>
                    }
                </div>
            }
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #38bdf8; --muted: #94a3b8; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --page: #0a0e17; --ink: #e2e8f0; --warn-ink: #fbbf24; --ok-ink: #34d399; --decision-ink: #a78bfa; --recon-ink: #38bdf8; --fs-label: .6875rem; --fs-body: .75rem; --lh: 1.45; }
        h2, p { margin: 0; }
        h2 { font-size: 1rem; font-weight: 650; color: #f1f5f9; }
        .eyebrow { color: var(--dim); font-size: var(--fs-label); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .endflow { border: 1px solid var(--line); border-radius: .75rem; background: var(--surface); overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .endflow-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: .875rem 1.25rem; border-bottom: 1px solid var(--line); background: #0d1118; }
        .endflow-title { display: flex; align-items: center; gap: .625rem; min-width: 0; }
        .endflow-icon { display: grid; place-items: center; flex: 0 0 auto; width: 2rem; height: 2rem; border: 1px solid rgba(56,189,248,.35); border-radius: .5rem; background: rgba(56,189,248,.1); color: var(--recon-ink); }
        .endflow-icon svg { width: 1rem; height: 1rem; }
        .endflow-title p { margin: 0; color: var(--muted); font-size: var(--fs-label); }
        .ghost-btn { padding: 0 .625rem; border: 1px solid var(--line); border-radius: .375rem; background: var(--surface); color: var(--muted); font: inherit; font-size: var(--fs-label); line-height: 1.8; cursor: pointer; white-space: nowrap; }
        .ghost-btn:hover { border-color: var(--recon-ink); color: #ffffff; }
        .ghost-btn:focus-visible, .open-tab-btn:focus-visible, .collapsed-head:focus-visible { outline: .125rem solid var(--recon-ink); outline-offset: -.125rem; }
        .endflow-body { display: grid; gap: 1.25rem; padding: 1.25rem; background: var(--page); }
        .endflow-step { display: grid; grid-template-columns: 2.25rem minmax(0, 1fr); gap: .75rem; align-items: stretch; scroll-margin-top: calc(var(--header-h) + var(--space-2)); }
        .endflow-rail { display: flex; flex-direction: column; align-items: center; }
        .endflow-no { display: grid; place-items: center; flex: 0 0 auto; width: 2.25rem; height: 2.25rem; border: 2px solid var(--tone, var(--muted)); border-radius: 50%; background: #0d1118; color: var(--tone, var(--muted)); font-size: .75rem; font-weight: 700; box-shadow: 0 0 .75rem color-mix(in srgb, var(--tone, #94a3b8) 35%, transparent); }
        .endflow-step.is-empty .endflow-no { width: 1.75rem; height: 1.75rem; font-size: var(--fs-label); box-shadow: none; }
        .endflow-connector { flex: 1 1 auto; width: .125rem; min-height: 1.5rem; margin: .375rem 0; background: var(--connector, var(--line)); }
        [data-tone='ok'] { --tone: var(--ok-ink); --connector: linear-gradient(180deg, #34d399, rgba(167,139,250,.4)); }
        [data-tone='decision'] { --tone: var(--decision-ink); --connector: linear-gradient(180deg, #a78bfa, rgba(56,189,248,.4)); }
        [data-tone='recon'] { --tone: var(--recon-ink); --connector: linear-gradient(180deg, #38bdf8, rgba(251,191,36,.4)); }
        [data-tone='warn'] { --tone: var(--warn-ink); --connector: linear-gradient(180deg, #fbbf24, rgba(148,163,184,.35)); }
        [data-tone='muted'] { --tone: var(--muted); --connector: linear-gradient(180deg, rgba(148,163,184,.6), transparent); }
        .endflow-card { min-width: 0; padding: 1rem; border: 1px solid var(--line); border-radius: .75rem; background: var(--surface); }
        .endflow-card[data-tone='ok'] { border-color: rgba(52,211,153,.55); }
        .endflow-card[data-tone='decision'] { border-color: rgba(167,139,250,.55); }
        .endflow-card[data-tone='recon'] { border-color: rgba(56,189,248,.55); }
        .endflow-card[data-tone='warn'] { border-color: rgba(251,191,36,.6); }
        .endflow-card[data-tone='muted'] { border-color: rgba(148,163,184,.35); }
        .endflow-card.selected { box-shadow: 0 0 0 1px var(--recon-ink), 0 0 1rem rgba(56,189,248,.18); }
        .endflow-card-row { display: flex; align-items: flex-start; gap: .75rem; }
        .endflow-card-head { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: baseline; gap: .25rem .5rem; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
        .endflow-card-head:focus-visible { outline: .125rem solid var(--recon-ink); outline-offset: .125rem; }
        .endflow-card-title { flex: 0 0 auto; color: var(--tone, var(--muted)); font-size: var(--fs-label); font-weight: 700; letter-spacing: .08em; line-height: 1.5; text-transform: uppercase; }
        .endflow-card-sub { flex: 1 1 12rem; min-width: 0; color: var(--muted); font-size: var(--fs-label); line-height: 1.5; overflow-wrap: anywhere; }
        .status-pill { flex: 0 0 auto; margin-left: auto; padding: 0 .5rem; border: 1px solid var(--tone, var(--line)); border-radius: 62.44rem; background: color-mix(in srgb, var(--tone, #94a3b8) 14%, transparent); color: var(--tone, var(--muted)); font-size: var(--fs-label); font-weight: 600; letter-spacing: .04em; line-height: 1.6; text-transform: uppercase; }
        .chevron { flex: 0 0 auto; color: var(--muted); font-size: var(--fs-label); line-height: 1.6; }
        .missing-tag { flex: 0 0 auto; padding: 0 .375rem; border: 1px solid rgba(251,191,36,.4); border-radius: .25rem; background: rgba(251,191,36,.1); color: var(--warn-ink); font-size: var(--fs-label); letter-spacing: .06em; line-height: 1.6; text-transform: uppercase; }
        .open-tab-btn { flex: 0 0 auto; align-self: flex-start; padding: 0 .625rem; border: 1px solid var(--line); border-radius: .375rem; background: #0d1118; color: var(--recon-ink); font: inherit; font-size: var(--fs-label); line-height: 1.8; cursor: pointer; white-space: nowrap; }
        .open-tab-btn:hover { border-color: var(--recon-ink); background: rgba(56,189,248,.12); }
        .endflow-subgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin-top: .75rem; }
        .endflow-subgrid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .endflow-subgrid.single { grid-template-columns: minmax(0, 1fr); }
        .endflow-sub { display: grid; grid-template-columns: .375rem minmax(0, 1fr); align-items: start; gap: .125rem .5rem; min-width: 0; padding: .625rem .75rem; border: 1px solid var(--line-soft); border-radius: .5rem; background: #0d1118; }
        .endflow-sub .sub-dot { grid-row: 1; align-self: center; width: .375rem; height: .375rem; border-radius: 50%; background: var(--tone, var(--muted)); }
        .endflow-sub .sub-label { color: var(--tone, var(--muted)); font-size: var(--fs-label); font-weight: 700; letter-spacing: .06em; line-height: 1.45; text-transform: uppercase; }
        .endflow-sub .sub-value { grid-column: 2; color: #e2e8f0; font-size: var(--fs-body); font-weight: 650; line-height: 1.45; overflow-wrap: anywhere; }
        .endflow-sub .sub-detail { grid-column: 2; color: var(--muted); font-size: var(--fs-label); line-height: 1.45; overflow-wrap: anywhere; }
        .endflow-collapsed { display: flex; align-items: center; justify-content: space-between; gap: .75rem; min-width: 0; min-height: 2rem; padding: .25rem 0; border-bottom: 1px solid rgba(37,48,71,.65); }
        .collapsed-head { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: baseline; gap: .25rem .5rem; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
        .collapsed-head .endflow-card-title { color: var(--muted); letter-spacing: .06em; }
        .collapsed-note { color: var(--dim); font-size: var(--fs-label); line-height: 1.45; }
        .endflow-collapsed .open-tab-btn { align-self: center; }
        @media (max-width: 62.5rem) { .endflow-subgrid, .endflow-subgrid.two { grid-template-columns: minmax(0, 1fr); } }
    `],
})
export class PipelineFlowComponent {
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
