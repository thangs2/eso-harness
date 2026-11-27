import { ChangeDetectionStrategy, Component, ViewChild, input, output, signal } from '@angular/core';
import { StepGuideComponent } from './step-guide.component.js';
import { SectionHintComponent, type SectionHintItem } from '../../../../../shared/section-hint.component.js';
import type { PipelineStepView, TabKey } from '../request-detail.models.js';

type FlowTone = 'ok' | 'decision' | 'recon' | 'warn' | 'muted';

interface NormativeSpecInfo {
    readonly normativeAnchor: string;
    readonly mandate: string;
    readonly auditContract: string;
    readonly requiredProofs: string;
}

const NORMATIVE_SPECS: Record<string, NormativeSpecInfo> = {
    'intake-law': {
        normativeAnchor: '16.master-standard.md · §LawGate · 28.eso-pipeline-v2.md',
        mandate: 'Prompt Intake & Pre-turn Law Consultation Gate. Validates prompt hash integrity and enforces AGENTS.md reading prior to tool/action execution.',
        auditContract: 'Zero tool/action execution permitted without verified pre-turn law consultation (AGENTS.md / core.law-gate.mdc).',
        requiredProofs: 'prompt.submitted · request.promptHash · verdict.ruleRefs[kind=law] · decision.recorded.evidence.refs[]',
    },
    'decision-jev': {
        normativeAnchor: '16.master-standard.md · §DecisionJEV · 28.eso-pipeline-v2.md',
        mandate: 'Dual-threshold decision engine adjudicating allow/deny/partial/unknown against consumer JEV confidence boundaries.',
        auditContract: 'JEV band must be strictly derived from consumer thresholds without inference; winner must be recorded with traceable basis.',
        requiredProofs: 'decision.recorded (verdict, winner, basis) · evidence.jev (mode, band, confidence, match)',
    },
    'evidence-recon': {
        normativeAnchor: '16.master-standard.md · §EvidenceRecon · 28.eso-pipeline-v2.md',
        mandate: 'Multi-source reconnaissance tracking adapter calls, loaded files, and observed retrieval tools.',
        auditContract: 'Honest capture of host retrieval telemetry with no false-muted state when files or tools were accessed.',
        requiredProofs: 'signals.recon · telemetry.files · observedTools · reconAdapters[]',
    },
    sufficiency: {
        normativeAnchor: '16.master-standard.md · §ProofGate',
        mandate: 'Turn proof-gap completeness adjudication. Arithmetically scores turn proof (score = max(0, 100 - 25 * gaps)).',
        auditContract: 'Score 100 requires zero proof gaps; missing proofs mandate explicit consequence recording.',
        requiredProofs: 'verdict.gaps[] · turn proof completeness · knowledge proof completeness',
    },
    slp: {
        normativeAnchor: '16.master-standard.md · §SLPOrchestration',
        mandate: 'Structured Lifecycle Pipeline role orchestration contract across scout, plan, build, verify, audit, and qc.',
        auditContract: 'Worker divergence (matches, missing, extra, reordered) must be explicitly flagged.',
        requiredProofs: 'detail.pipeline roles · worker observation events',
    },
    execution: {
        normativeAnchor: '16.master-standard.md · §ExecutionScope',
        mandate: 'Action execution auditing and write gate authorization with read-before-edit discipline.',
        auditContract: 'Zero disk mutations permitted without write gate authorization and diff reference.',
        requiredProofs: 'action.recorded (tool, files, diffRef) · scope decision',
    },
    seal: {
        normativeAnchor: '16.master-standard.md · §SealDistill',
        mandate: 'Cryptographic SHA-256 hash chaining of turn verdict, receipt payload sources fingerprinting, and durable memory distillation.',
        auditContract: 'Sealed receipts are immutable; hash chain verifies byte-level integrity.',
        requiredProofs: 'receipt hash chain · receipt sources[] SHA-256 · distill signal',
    },
    report: {
        normativeAnchor: '16.master-standard.md · §AuditReport',
        mandate: 'Comprehensive Q1-Q6 readiness audit answering verdict, norm reference, proof gaps, action record, receipt seal, and rule conformance.',
        auditContract: 'Unanswered audit questions represent governance coverage gaps.',
        requiredProofs: 'Q1-Q6 readiness booleans · audit evidence bindings',
    },
};

/**
 * End-to-end flow — one card per system stage, elevated with timeline rail,
 * active path highlighting, and normative spec visualization.
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
                    <span class="endflow-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M13 2 3 14h8l-1 8 11-14h-8l1-6z" />
                        </svg>
                    </span>
                    <div class="endflow-title-block">
                        <div class="eyebrow-line">
                            <p class="eyebrow">PIPELINE V2 · DATA FLOW</p>
                            <span class="spec-chip" title="Normative Specification Reference">16.master-standard.md · REQUEST_SPEC_REF v3.0.0</span>
                        </div>
                        <h2 class="endflow-heading">End-to-End Pipeline Data Flow & Decision Orchestration</h2>
                        <p class="endflow-desc">Prompt ingest → worker handoff → evidence → telemetry</p>
                    </div>
                </div>
                <div class="endflow-actions">
                    <div class="view-mode-toggle" role="radiogroup" aria-label="Pipeline view mode">
                        <button type="button" class="mode-toggle-btn" [class.is-active]="viewMode() === 'trace'" (click)="viewMode.set('trace')" role="radio" [attr.aria-checked]="viewMode() === 'trace'">
                            <span class="mode-icon" aria-hidden="true">⚡</span>
                            <span>Turn Trace Active</span>
                        </button>
                        <button type="button" class="mode-toggle-btn" [class.is-active]="viewMode() === 'spec'" (click)="viewMode.set('spec')" role="radio" [attr.aria-checked]="viewMode() === 'spec'">
                            <span class="mode-icon" aria-hidden="true">📋</span>
                            <span>Full Normative Spec</span>
                        </button>
                    </div>
                    <eso-section-hint [summary]="hint.summary" [items]="hint.items" />
                    <button type="button" class="ghost-btn" (click)="flowExpanded.set(!flowExpanded())">{{ flowExpanded() ? '▲ Hide Flow' : '▼ Show Flow' }}</button>
                </div>
            </header>
            @if (flowExpanded()) {
                <div class="endflow-body" [attr.data-mode]="viewMode()">
                    @for (step of steps(); track step.id; let index = $index) {
                        <div class="endflow-step" [class.is-empty]="step.empty" [class.is-open]="isStepOpen(step)" [class.active-path]="viewMode() === 'trace' && !step.empty" [class.is-dimmed]="viewMode() === 'trace' && step.empty" [attr.id]="'step-' + step.id" [attr.data-stage]="step.id" [attr.data-step]="index + 1" [attr.data-tone]="tone(step)">
                            <div class="endflow-rail">
                                <span class="endflow-no" [attr.data-tone]="tone(step)">{{ index + 1 }}</span>
                                @if (!$last) { <span class="endflow-connector" [attr.data-tone]="tone(step)" [style.background]="connectorGradient(index)" aria-hidden="true"></span> }
                            </div>
                            <div class="endflow-card" [attr.data-stage]="step.id" [attr.data-step]="index + 1" [attr.data-tone]="tone(step)" [class.selected]="selectedStepId() === step.id" [class.empty-step]="step.empty">
                                <div class="endflow-card-row">
                                    <button type="button" class="endflow-card-head" (click)="toggleStep(step)" [attr.aria-expanded]="isStepOpen(step)">
                                        <span class="step-badge" [attr.data-tone]="tone(step)">STEP {{ index + 1 }}</span>
                                        <span class="endflow-card-title">{{ step.label }}</span>
                                        <span class="step-subtitle">{{ stageSubtitle(step.id) }}</span>
                                        <span class="endflow-card-sub">{{ viewMode() === 'spec' ? normativeSpec(step.id).mandate : (step.empty && step.id !== 'intake-law' ? 'No host evidence for this step' : step.sub) }}</span>
                                        <span class="status-pill" [attr.data-tone]="tone(step)" [title]="'status: ' + step.status + (step.empty ? ' · no evidence' : ' · evidence found')">{{ step.empty ? 'no evidence' : step.status }}</span>
                                        @if (step.id === 'intake-law' && lawGatePill(step); as lgb) {
                                            <span class="law-pill" [attr.data-tone]="lgb.tone" [title]="lgb.title">{{ lgb.label }}</span>
                                        }
                                        @if (step.id === 'decision-jev' && decisionJevPill(step); as djp) {
                                            <span class="law-pill" [attr.data-tone]="djp.tone" [title]="djp.title">{{ djp.label }}</span>
                                        }
                                        @if (step.id === 'evidence-recon' && reconPill(step); as rp) {
                                            <span class="law-pill" [attr.data-tone]="rp.tone" [title]="rp.title">{{ rp.label }}</span>
                                        }
                                        @if (step.id === 'sufficiency' && sufficiencyPill(step); as sp) {
                                            <span class="law-pill" [attr.data-tone]="sp.tone" [title]="sp.title">{{ sp.label }}</span>
                                        }
                                        @if (step.id === 'slp' && slpPill(step); as slpp) {
                                            <span class="law-pill" [attr.data-tone]="slpp.tone" [title]="slpp.title">{{ slpp.label }}</span>
                                        }
                                        @if (step.id === 'execution' && executionPill(step); as exp) {
                                            <span class="law-pill" [attr.data-tone]="exp.tone" [title]="exp.title">{{ exp.label }}</span>
                                        }
                                        @if (step.id === 'seal' && sealPill(step); as sp) {
                                            <span class="law-pill" [attr.data-tone]="sp.tone" [title]="sp.title">{{ sp.label }}</span>
                                        }
                                        @if (step.id === 'report' && reportPill(step); as rep) {
                                            <span class="law-pill" [attr.data-tone]="rep.tone" [title]="rep.title">{{ rep.label }}</span>
                                        }
                                        <span class="chevron" aria-hidden="true">{{ isStepOpen(step) ? '▾' : '▸' }}</span>
                                    </button>
                                    <div class="endflow-step-actions">
                                        <button type="button" class="step-guide-btn" aria-label="Explain this step" title="Explain this step" (click)="stepGuide?.open(step); $event.stopPropagation()">?</button>
                                        <button type="button" class="open-tab-btn" (click)="openRelatedTab(step)" [title]="'Open the ' + step.tabLabel + ' tab'">Open {{ step.tabLabel }}</button>
                                    </div>
                                </div>
                                @if (viewMode() === 'spec') {
                                    <div class="normative-spec-panel">
                                        <div class="normative-spec-header">
                                            <span class="normative-chip">NORMATIVE STAGE CONTRACT</span>
                                            <span class="normative-anchor">{{ normativeSpec(step.id).normativeAnchor }}</span>
                                        </div>
                                        <p class="normative-mandate">{{ normativeSpec(step.id).mandate }}</p>
                                        <div class="normative-rules">
                                            <div class="normative-rule">
                                                <span class="rule-label">AUDIT CONTRACT:</span>
                                                <span class="rule-desc">{{ normativeSpec(step.id).auditContract }}</span>
                                            </div>
                                            <div class="normative-rule">
                                                <span class="rule-label">REQUIRED PROOFS:</span>
                                                <span class="rule-desc monospace">{{ normativeSpec(step.id).requiredProofs }}</span>
                                            </div>
                                        </div>
                                    </div>
                                }
                                @if (isStepOpen(step)) {
                                    @if (step.subcards.length > 0) {
                                        <div class="endflow-subgrid" [class.single]="step.subcards.length === 1" [class.two]="step.subcards.length === 2" [class.four]="step.subcards.length === 4">
                                            @for (sub of step.subcards; track sub.label; let i = $index) {
                                                <div class="endflow-sub" [attr.data-tone]="subTone(i, sub)">
                                                    <div class="sub-dot-indicator" aria-hidden="true">
                                                        <span class="sub-dot-core"></span>
                                                    </div>
                                                    <div class="sub-content">
                                                        <div class="sub-meta-row">
                                                            <span class="sub-label">{{ sub.label }}</span>
                                                            <span class="sub-ref-chip">{{ subRefChip(step.id, sub.label) }}</span>
                                                        </div>
                                                        <strong class="sub-value">{{ sub.value }}</strong>
                                                        <span class="sub-detail">{{ sub.detail }}</span>
                                                    </div>
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
        :host {
            display: block;
            --brand: #38bdf8;
            --muted: #94a3b8;
            --dim: #64748b;
            --line: #253047;
            --line-soft: #1e2a3e;
            --surface: #131722;
            --surface-2: #0d1118;
            --surface-3: #0f1a2b;
            --ink: #e2e8f0;
            --warn-ink: #fbbf24;
            --ok-ink: #34d399;
            --decision-ink: #c084fc;
            --recon-ink: #38bdf8;
            --fs-label: .6875rem;
            --fs-body: .8125rem;
            --lh: 1.45;
        }
        h2, p { margin: 0; }
        .endflow-heading { font-size: var(--text-sm); font-weight: 700; color: #f1f5f9; letter-spacing: -.01em; margin: 0; }
        .eyebrow { color: var(--dim); font-size: var(--fs-label); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .endflow { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .endflow-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--line); background: var(--surface-2); }
        .endflow-title { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
        .endflow-title-block { min-width: 0; }
        .eyebrow-line { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: .125rem; }
        .spec-chip { display: inline-flex; align-items: center; padding: .0625rem .4375rem; border: 1px solid rgba(56, 189, 248, .28); border-radius: var(--radius-sm); background: rgba(56, 189, 248, .08); color: #7dd3fc; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: var(--fs-label); letter-spacing: -.01em; }
        .endflow-icon { display: grid; place-items: center; flex: 0 0 auto; width: 2rem; height: 2rem; border: 1px solid rgba(56, 189, 248, .3); border-radius: var(--radius-sm); background: rgba(56, 189, 248, .1); color: #38bdf8; box-shadow: 0 0 12px rgba(56, 189, 248, .25); }
        .endflow-icon svg { width: 1.125rem; height: 1.125rem; }
        .endflow-desc { color: var(--muted); font-size: var(--fs-label); margin: 0; }
        .endflow-actions { display: inline-flex; align-items: center; gap: var(--space-2); }
        .view-mode-toggle { display: inline-flex; align-items: center; padding: .125rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); gap: .125rem; }
        .mode-toggle-btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: .1875rem .5rem; border: 1px solid transparent; border-radius: calc(var(--radius-sm) - .0625rem); background: transparent; color: var(--muted); font: inherit; font-size: var(--fs-label); font-weight: 600; cursor: pointer; white-space: nowrap; transition: all .15s ease; }
        .mode-toggle-btn:hover { color: #f1f5f9; }
        .mode-toggle-btn.is-active { border-color: rgba(56, 189, 248, .35); background: rgba(56, 189, 248, .14); color: #38bdf8; box-shadow: 0 0 8px rgba(56, 189, 248, .2); }
        .mode-icon { font-size: var(--fs-label); line-height: 1; }
        .ghost-btn { padding: 0 .625rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted); font: inherit; font-size: var(--fs-label); line-height: 1.8; cursor: pointer; white-space: nowrap; }
        .ghost-btn:hover { border-color: var(--recon-ink); color: #ffffff; }
        .ghost-btn:focus-visible, .open-tab-btn:focus-visible, .step-guide-btn:focus-visible, .endflow-card-head:focus-visible, .mode-toggle-btn:focus-visible { outline: .125rem solid var(--brand); outline-offset: .125rem; }
        .endflow-body { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--surface-2); }
        .endflow-step { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: var(--space-3); align-items: stretch; position: relative; scroll-margin-top: calc(var(--header-h) + var(--space-2)); transition: opacity .2s ease; }
        .endflow-step.is-dimmed { opacity: 0.6; }
        .endflow-step.is-dimmed:hover { opacity: 0.9; }
        .endflow-rail { display: flex; flex-direction: column; align-items: center; position: relative; }
        .endflow-no { display: grid; place-items: center; flex: 0 0 auto; width: 2rem; height: 2rem; border: 2px solid var(--stage-color, var(--tone, var(--muted))); border-radius: 50%; background: var(--surface); color: var(--stage-color, var(--tone, var(--muted))); font-size: var(--fs-label); font-weight: 700; box-shadow: none; transition: all .2s ease; position: relative; z-index: 2; }
        .endflow-step:hover .endflow-no, .endflow-no:hover { box-shadow: 0 0 14px var(--stage-glow, color-mix(in srgb, var(--stage-color, #38bdf8) 60%, transparent)); transform: scale(1.04); }
        .endflow-step.is-empty .endflow-no { border-color: color-mix(in srgb, var(--stage-color, var(--line)) 50%, var(--line)); color: var(--stage-color, var(--dim)); box-shadow: none; }
        .endflow-step.active-path .endflow-no { box-shadow: none; }
        .endflow-connector { position: absolute; top: 2rem; bottom: calc(-1 * var(--space-3)); width: .125rem; margin: 0; background: var(--connector, var(--line)); border-radius: 62.44rem; z-index: 1; }
        [data-step='1'], [data-stage='intake-law'] { --stage-color: #34d399; --stage-500-30: rgba(16, 185, 129, 0.4); --stage-400-60: rgba(52, 211, 153, 0.85); --stage-glow: rgba(52, 211, 153, 0.45); }
        [data-step='2'], [data-stage='decision-jev'] { --stage-color: #c084fc; --stage-500-30: rgba(168, 85, 247, 0.4); --stage-400-60: rgba(192, 132, 252, 0.85); --stage-glow: rgba(192, 132, 252, 0.45); }
        [data-step='3'], [data-stage='evidence-recon'] { --stage-color: #38bdf8; --stage-500-30: rgba(14, 165, 233, 0.4); --stage-400-60: rgba(56, 189, 248, 0.85); --stage-glow: rgba(56, 189, 248, 0.45); }
        [data-step='4'], [data-stage='sufficiency'] { --stage-color: #fbbf24; --stage-500-30: rgba(245, 158, 11, 0.4); --stage-400-60: rgba(251, 191, 36, 0.85); --stage-glow: rgba(251, 191, 36, 0.45); }
        [data-step='5'], [data-stage='slp'], [data-stage='slp-orchestration'] { --stage-color: #818cf8; --stage-500-30: rgba(99, 102, 241, 0.4); --stage-400-60: rgba(129, 140, 248, 0.85); --stage-glow: rgba(129, 140, 248, 0.45); }
        [data-step='6'], [data-stage='execution'], [data-stage='safe-execution'] { --stage-color: #2dd4bf; --stage-500-30: rgba(20, 184, 166, 0.4); --stage-400-60: rgba(45, 212, 191, 0.85); --stage-glow: rgba(45, 212, 191, 0.45); }
        [data-step='7'], [data-stage='seal'], [data-stage='crypto-integrity'] { --stage-color: #2dd4bf; --stage-500-30: rgba(20, 184, 166, 0.4); --stage-400-60: rgba(45, 212, 191, 0.85); --stage-glow: rgba(45, 212, 191, 0.45); }
        [data-step='8'], [data-stage='report'], [data-stage='readiness-audit'] { --stage-color: #34d399; --stage-500-30: rgba(16, 185, 129, 0.4); --stage-400-60: rgba(52, 211, 153, 0.85); --stage-glow: rgba(52, 211, 153, 0.45); }
        [data-tone='ok'] { --tone: var(--ok-ink); --connector: linear-gradient(180deg, #34d399, rgba(167,139,250,.4)); }
        [data-tone='decision'] { --tone: var(--decision-ink); --connector: linear-gradient(180deg, #c084fc, rgba(56,189,248,.4)); }
        [data-tone='recon'] { --tone: var(--recon-ink); --connector: linear-gradient(180deg, #38bdf8, rgba(251,191,36,.4)); }
        [data-tone='warn'] { --tone: var(--warn-ink); --connector: linear-gradient(180deg, #fbbf24, rgba(148,163,184,.35)); }
        [data-tone='muted'] { --tone: var(--muted); --connector: linear-gradient(180deg, rgba(148,163,184,.6), transparent); }
        .endflow-card { min-width: 0; padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-color: var(--stage-500-30, color-mix(in srgb, var(--tone, var(--line)) 20%, transparent)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 90%, transparent); box-shadow: none; transition: all .2s cubic-bezier(0.4, 0, 0.2, 1); }
        .endflow-step.active-path .endflow-card { border-color: var(--stage-500-30, color-mix(in srgb, var(--tone, #34d399) 20%, transparent)); box-shadow: none; }
        .endflow-card.empty-step { border-color: color-mix(in srgb, var(--stage-500-30, var(--line)) 40%, transparent); background: color-mix(in srgb, var(--surface) 80%, transparent); box-shadow: none; }
        .endflow-card:hover, .endflow-step:hover .endflow-card, .endflow-step.active-path:hover .endflow-card, .endflow-step.active-path .endflow-card:hover { border-color: var(--stage-400-60, color-mix(in srgb, var(--tone, var(--brand)) 60%, transparent)) !important; background: color-mix(in srgb, var(--surface) 96%, transparent); box-shadow: 0 0 0 1px var(--stage-400-60, var(--brand)), 0 10px 25px -5px rgba(0, 0, 0, .6), 0 0 20px -2px var(--stage-glow, color-mix(in srgb, var(--tone, var(--brand)) 40%, transparent)) !important; transform: translateY(-.125rem); }
        .endflow-card.empty-step:hover, .endflow-step.is-empty:hover .endflow-card { border-color: var(--stage-400-60, var(--line-soft)) !important; transform: none; box-shadow: 0 4px 12px -2px rgba(0, 0, 0, .5) !important; }
        .endflow-card.selected, .endflow-step .endflow-card.selected, .endflow-step.active-path .endflow-card.selected { border-color: var(--brand) !important; box-shadow: 0 0 0 2px var(--brand), 0 0 24px rgba(56, 189, 248, .35) !important; background: linear-gradient(180deg, rgba(14, 30, 54, .95) 0%, rgba(10, 20, 36, .98) 100%) !important; }
        .endflow-card-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
        .endflow-card-head { display: flex; flex: 1 1 auto; align-items: center; gap: var(--space-2); min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; overflow: hidden; }
        .step-badge { flex: 0 0 auto; display: inline-flex; align-items: center; padding: .0625rem .375rem; border: 1px solid var(--stage-500-30, var(--tone, var(--line))); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--stage-color, #94a3b8) 12%, transparent); color: var(--stage-color, var(--tone, var(--muted))); font-size: var(--fs-label); font-weight: 700; letter-spacing: .06em; line-height: 1.4; text-transform: uppercase; }
        .endflow-card-title { flex: 0 0 auto; color: var(--stage-color, #f1f5f9); font-size: var(--fs-body); font-weight: 700; }
        .step-subtitle { flex: 0 1 auto; color: var(--dim); font-size: var(--fs-label); font-weight: 500; margin-left: .25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .endflow-card-sub { flex: 0 1 auto; min-width: 0; color: var(--muted); font-size: var(--fs-label); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .status-pill { flex: 0 0 auto; padding: 0 .4375rem; border: 1px solid var(--tone, var(--line)); border-radius: 62.44rem; background: color-mix(in srgb, var(--tone, #94a3b8) 12%, transparent); color: var(--tone, var(--muted)); font-size: var(--fs-label); font-weight: 600; letter-spacing: .04em; line-height: 1.5; text-transform: uppercase; }
        .law-pill { flex: 0 0 auto; padding: 0 .4375rem; border: 1px solid var(--tone, var(--line)); border-radius: 62.44rem; background: color-mix(in srgb, var(--tone, #94a3b8) 14%, transparent); color: var(--tone, var(--muted)); font-size: var(--fs-label); font-weight: 700; letter-spacing: .04em; line-height: 1.5; text-transform: uppercase; }
        .chevron { flex: 0 0 auto; display: inline-grid; place-items: center; width: 1.375rem; height: 1.375rem; border-radius: var(--radius-sm); background: rgba(255, 255, 255, .06); border: 1px solid var(--line); color: var(--ink); font-size: var(--fs-label); font-weight: 700; line-height: 1; transition: all .15s ease; }
        .endflow-card-head:hover .chevron { color: #ffffff; border-color: var(--brand); background: rgba(56, 189, 248, .18); }
        .endflow-step-actions { display: inline-flex; align-items: center; gap: var(--space-2); flex: 0 0 auto; margin-left: var(--space-1); }
        .step-guide-btn { display: inline-grid; place-items: center; width: 1.625rem; height: 1.625rem; border: 1px solid var(--line); border-radius: 62.44rem; background: var(--surface-2); color: var(--muted); font: inherit; font-size: var(--fs-label); font-weight: 700; cursor: pointer; transition: border-color .15s ease, color .15s ease, background .15s ease, box-shadow .15s ease; }
        .step-guide-btn:hover { border-color: var(--brand); color: #ffffff; background: rgba(56, 189, 248, .14); box-shadow: 0 0 8px rgba(56, 189, 248, .25); }
        .open-tab-btn { display: inline-flex; align-items: center; gap: .25rem; height: 1.625rem; padding: 0 .625rem; border: 1px solid var(--line); border-radius: 62.44rem; background: var(--surface-2); color: var(--brand); font: inherit; font-size: var(--fs-label); font-weight: 600; cursor: pointer; white-space: nowrap; transition: border-color .15s ease, background .15s ease, color .15s ease, box-shadow .15s ease; }
        .open-tab-btn:hover { border-color: var(--brand); background: rgba(56, 189, 248, .18); color: #ffffff; box-shadow: 0 0 8px rgba(56, 189, 248, .25); }
        .normative-spec-panel { margin-top: var(--space-3); padding: var(--space-3); border: 1px solid rgba(56, 189, 248, .25); border-radius: var(--radius-sm); background: rgba(15, 26, 43, .7); }
        .normative-spec-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-2); flex-wrap: wrap; }
        .normative-chip { padding: .0625rem .375rem; border-radius: var(--radius-sm); background: rgba(56, 189, 248, .15); color: #38bdf8; font-size: var(--fs-label); font-weight: 700; letter-spacing: .06em; }
        .normative-anchor { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: var(--fs-label); }
        .normative-mandate { color: #e2e8f0; font-size: var(--fs-body); line-height: 1.45; margin: 0 0 var(--space-2) 0; }
        .normative-rules { display: grid; gap: var(--space-1); padding-top: var(--space-2); border-top: 1px solid var(--line-soft); }
        .normative-rule { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: var(--space-2); font-size: var(--fs-label); line-height: 1.45; }
        .rule-label { color: var(--dim); font-weight: 700; letter-spacing: .04em; }
        .rule-desc { color: var(--muted); }
        .rule-desc.monospace { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #7dd3fc; }
        .endflow-subgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--line-soft); }
        .endflow-subgrid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .endflow-subgrid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .endflow-subgrid.single { grid-template-columns: minmax(0, 1fr); }
        .endflow-sub { display: flex; align-items: flex-start; gap: var(--space-2); min-width: 0; min-height: 5.25rem; padding: var(--space-2) var(--space-3); border: 1px solid color-mix(in srgb, var(--sub-tone, var(--line-soft)) 30%, transparent); border-radius: var(--radius-sm); background: var(--surface-2); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); transition: border-color .15s ease, background .15s ease, box-shadow .15s ease, transform .15s ease; }
        .endflow-sub:hover { border-color: color-mix(in srgb, var(--sub-tone, #38bdf8) 60%, transparent); background: rgba(15, 26, 43, .9); box-shadow: 0 4px 12px -2px rgba(0, 0, 0, .4), 0 0 10px -2px color-mix(in srgb, var(--sub-tone, #38bdf8) 25%, transparent); transform: translateY(-.0625rem); }
        .endflow-sub[data-tone='ok'] { --sub-tone: var(--ok-ink); }
        .endflow-sub[data-tone='recon'] { --sub-tone: var(--recon-ink); }
        .endflow-sub[data-tone='warn'] { --sub-tone: var(--warn-ink); }
        .endflow-sub[data-tone='decision'] { --sub-tone: var(--decision-ink); }
        .endflow-sub[data-tone='muted'] { --sub-tone: var(--muted); }
        .sub-dot-indicator { display: grid; place-items: center; flex: 0 0 auto; width: 1.5rem; height: 1.5rem; margin-top: .125rem; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--sub-tone, #38bdf8) 14%, transparent); border: 1px solid color-mix(in srgb, var(--sub-tone, #38bdf8) 35%, transparent); }
        .sub-dot-core { width: .5rem; height: .5rem; border-radius: 50%; background: var(--sub-tone, #38bdf8); box-shadow: 0 0 6px var(--sub-tone, #38bdf8); }
        .sub-content { display: flex; flex-direction: column; gap: .25rem; min-width: 0; flex: 1 1 auto; }
        .sub-meta-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
        .endflow-sub .sub-label { color: var(--sub-tone, var(--muted)); font-size: var(--fs-label); font-weight: 700; letter-spacing: .06em; line-height: 1.45; text-transform: uppercase; }
        .sub-ref-chip { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: var(--fs-label); color: var(--dim); background: rgba(255, 255, 255, .04); border: 1px solid rgba(255, 255, 255, .08); border-radius: var(--radius-sm); padding: 0 .25rem; line-height: 1.4; }
        .endflow-sub .sub-value { color: #f1f5f9; font-size: var(--fs-body); font-weight: 650; line-height: 1.45; overflow-wrap: anywhere; }
        .sub-value.monospace-val { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: var(--fs-label); color: #7dd3fc; }
        .endflow-sub .sub-detail { color: var(--muted); font-size: var(--fs-label); line-height: 1.45; overflow-wrap: anywhere; }
        .endflow-empty-note { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); margin-top: var(--space-3); border: 1px dashed var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--fs-label); line-height: 1.45; }
        .endflow-empty-note .note-icon { color: var(--dim); }
        @media (max-width: 75rem) {
            .step-subtitle { display: none; }
            .endflow-subgrid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 62.5rem) {
            .endflow-head { flex-direction: column; align-items: stretch; gap: var(--space-3); }
            .endflow-actions { flex-wrap: wrap; justify-content: flex-start; }
            .normative-rule { grid-template-columns: minmax(0, 1fr); gap: .125rem; }
            .endflow-subgrid, .endflow-subgrid.two, .endflow-subgrid.four { grid-template-columns: minmax(0, 1fr); }
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
    readonly viewMode = signal<'trace' | 'spec'>('trace');

    private readonly TONE_COLORS: Record<FlowTone, string> = {
        ok: '#34d399',
        decision: '#c084fc',
        recon: '#38bdf8',
        warn: '#fbbf24',
        muted: '#64748b',
    };

    /**
     * Colour law: the stage's own evidence decides, `status` only raises attention. A stage that
     * carries no proof is muted no matter what its presentation status says, so this card can never
     * read greener than the stepper and the coverage axis for the same stage.
     */
    tone(step: PipelineStepView): FlowTone {
        const warns = step.status === 'warn' || step.status === 'bad' || step.status === 'missing' || step.status === 'fail';
        if (step.empty) return warns ? 'warn' : 'muted';
        if (warns) return 'warn';
        if (step.id === 'decision-jev') return 'decision';
        if (step.status === 'info') return 'recon';
        if (step.status === 'ok') return 'ok';
        if (step.evidenced === true) return 'ok';
        return 'recon';
    }

    /** Sub-panel dots cycle emerald → sky → amber, or respect semantic label/value. */
    subTone(index: number, sub?: { label?: string; value?: string; detail?: string }): FlowTone {
        if (sub) {
            const lbl = (sub.label || '').toLowerCase();
            const val = (sub.value || '').toLowerCase();
            if (lbl.includes('law')) {
                return (val === 'not captured' || (sub.detail || '').includes('missing') || (sub.detail || '').includes('violation')) ? 'warn' : 'ok';
            }
            if (lbl.includes('band')) {
                if (val.includes('match') && !val.includes('mismatch')) return 'ok';
                if (val.includes('mismatch')) return 'warn';
                return 'muted';
            }
            if (lbl.includes('decision')) {
                return val === 'not captured' ? 'muted' : 'decision';
            }
            if (lbl.includes('jev')) {
                return val.includes('not reported') ? 'muted' : 'decision';
            }
            if (lbl.includes('files') || lbl.includes('loaded')) return 'recon';
            if (lbl.includes('recon tool') || lbl.includes('tools')) return 'recon';
            if (lbl.includes('adapter')) return 'decision';
            if (lbl.includes('actor') || lbl.includes('role')) return 'decision';
            if (lbl.includes('prompt') || lbl.includes('chars')) return 'recon';
            if (lbl.includes('score')) {
                if (val.startsWith('100')) return 'ok';
                if (val.startsWith('0')) return 'warn';
                return 'warn';
            }
            if (lbl.includes('disposition')) {
                if (val.toLowerCase().includes('sufficient') || val.toLowerCase().includes('eligible')) return 'ok';
                if (val.toLowerCase().includes('advisory') || val.toLowerCase().includes('degraded')) return 'warn';
                return 'warn';
            }
            if (lbl.includes('gap')) {
                return (val === 'none' || val === '0') ? 'ok' : 'warn';
            }
            if (lbl.includes('execution shape') || lbl.includes('shape')) {
                return 'decision';
            }
            if (lbl.includes('worker')) {
                if (val.startsWith('0')) return 'muted';
                return 'ok';
            }
            if (lbl.includes('write gate')) {
                if (val.toLowerCase().includes('authorized') || val.toLowerCase().includes('clean')) return 'ok';
                if (val.toLowerCase().includes('blocked')) return 'warn';
                return 'ok';
            }
            if (lbl.includes('action')) {
                if (val.toLowerCase().includes('0 mutation') || val.toLowerCase().includes('not captured')) return 'muted';
                return 'ok';
            }
            if (lbl.includes('receipt')) {
                return val.includes('not captured') ? 'muted' : 'ok';
            }
            if (lbl.includes('spec')) {
                return 'recon';
            }
            if (lbl.includes('source')) {
                return 'ok';
            }
            if (lbl.includes('distill')) {
                if (val.toLowerCase().includes('saved') && !val.toLowerCase().includes('not saved')) return 'ok';
                return 'muted';
            }
            if (lbl.includes('audit questions') || lbl.includes('audit')) {
                if (val.startsWith('6/6')) return 'ok';
                return 'warn';
            }
            if (lbl.includes('verdict · receipt')) {
                return 'ok';
            }
        }
        return (['ok', 'recon', 'warn'] as const)[index % 3];
    }

    reportPill(step: PipelineStepView): { label: string; tone: FlowTone; title: string } | null {
        if (step.id !== 'report') return null;
        const sub = (step.sub || '').toLowerCase();
        const auditCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('audit'))?.value;
        const auditDetail = step.subcards.find((s) => (s.label || '').toLowerCase().includes('audit'))?.detail || '';

        if (sub.includes('6/6') || (auditCard && auditCard.startsWith('6/6'))) {
            return { label: '6/6 Audit Clear · Ready', tone: 'ok', title: 'All six V3 audit questions fully answerable by third-party auditor' };
        }
        if (auditDetail.includes('missing')) {
            const missingPart = auditDetail.replace('missing ', '').toUpperCase();
            return { label: `${auditCard || '5/6'} Audit · Missing ${missingPart}`, tone: 'warn', title: `Audit readiness gap: ${auditDetail}` };
        }
        if (step.status === 'ok') {
            return { label: 'Audit Ready', tone: 'ok', title: 'Audit readiness verified' };
        }
        return { label: 'Audit Degraded', tone: 'warn', title: `Audit readiness: ${step.sub}` };
    }

    sealPill(step: PipelineStepView): { label: string; tone: FlowTone; title: string } | null {
        if (step.id !== 'seal') return null;
        const sub = (step.sub || '').toLowerCase();
        const receiptCard = step.subcards.find((s) => (s.label || '').toLowerCase() === 'receipt')?.value;
        const distillCard = step.subcards.find((s) => (s.label || '').toLowerCase() === 'distill')?.value;
        const sourcesCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('source'))?.value;

        if (distillCard && distillCard.toLowerCase().includes('saved') && !distillCard.toLowerCase().includes('not saved')) {
            return { label: 'Distilled & Sealed', tone: 'ok', title: `Durable memory distilled with cryptographic seal: ${distillCard}` };
        }
        if (sub.includes('chained') || (receiptCard && receiptCard.toLowerCase().includes('chained'))) {
            return { label: 'HMAC Sealed · Chained', tone: 'ok', title: 'Receipt hash linked to previous turn in immutable hash chain' };
        }
        if (receiptCard && !receiptCard.toLowerCase().includes('not captured')) {
            const prefix = receiptCard.split(' ')[0];
            return { label: `HMAC Sealed · ${prefix}`, tone: 'ok', title: 'Cryptographic receipt minted for turn integrity' };
        }
        if (sourcesCard) {
            return { label: 'Sources Fingerprinted', tone: 'ok', title: 'Source files verified and sealed in receipt payload' };
        }
        if (step.status === 'warn' || !step.evidenced) {
            return { label: 'Receipt Pending', tone: 'warn', title: 'No sealed cryptographic receipt issued for this trace' };
        }
        return { label: 'Seal Verified', tone: 'ok', title: 'Cryptographic seal verified' };
    }

    executionPill(step: PipelineStepView): { label: string; tone: FlowTone; title: string } | null {
        if (step.id !== 'execution') return null;
        const sub = (step.sub || '').toLowerCase();
        const actionsCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('action'))?.value;
        const gateCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('write gate'))?.value;

        if (gateCard && gateCard.toLowerCase().includes('blocked')) {
            return { label: 'Write Gate Blocked', tone: 'warn', title: 'Write gate rejected mutation outside allowed scope' };
        }
        if (gateCard && gateCard.toLowerCase().includes('authorized')) {
            return { label: 'Write Gate Authorized', tone: 'ok', title: 'Scope-guarded workspace writes authorized' };
        }
        if (actionsCard && !actionsCard.toLowerCase().includes('0 mutation') && !actionsCard.toLowerCase().includes('not captured')) {
            return { label: `${actionsCard} Executed`, tone: 'ok', title: `Actions executed: ${step.sub}` };
        }
        if (sub.includes('0 action') || (actionsCard && actionsCard.toLowerCase().includes('read-only'))) {
            return { label: 'Read-Only · Zero Mutations', tone: 'muted', title: 'Turn executed in read-only mode, no workspace files modified' };
        }
        if (step.evidenced) {
            return { label: 'Execution Evidenced', tone: 'ok', title: 'Workspace action or scope gate recorded' };
        }
        return { label: 'Scope Protected', tone: 'ok', title: 'Execution boundary monitored' };
    }

    slpPill(step: PipelineStepView): { label: string; tone: FlowTone; title: string } | null {
        if (step.id !== 'slp') return null;
        const sub = (step.sub || '').toLowerCase();
        const rolesCard = step.subcards.find((s) => (s.label || '').toLowerCase() === 'roles')?.value;
        const workersCard = step.subcards.find((s) => (s.label || '').toLowerCase() === 'workers')?.value;
        const shapeCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('shape'))?.value;

        if (sub.includes('swarm') || (shapeCard && shapeCard.toLowerCase().includes('swarm'))) {
            return { label: 'Swarm Mesh Active', tone: 'ok', title: 'Workers coordinated over shared blackboard swarm' };
        }
        if (workersCard && !workersCard.startsWith('0/')) {
            return { label: `${workersCard} Executed`, tone: 'ok', title: 'SLP lifecycle peer workers observed' };
        }
        if (rolesCard && rolesCard !== 'not captured') {
            const count = (rolesCard.match(/,/g) || []).length + 1;
            return { label: `${count}+ SLP Roles Defined`, tone: 'decision', title: `SLP role contract configured: ${rolesCard}` };
        }
        if (step.evidenced) {
            return { label: 'SLP Configured', tone: 'decision', title: 'Structured Lifecycle Pipeline configured' };
        }
        return { label: 'SLP Unexercised', tone: 'muted', title: 'No SLP roles or workers active' };
    }

    sufficiencyPill(step: PipelineStepView): { label: string; tone: FlowTone; title: string } | null {
        if (step.id !== 'sufficiency') return null;
        const scoreCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('score'))?.value;
        const gapsCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('gap'))?.value;
        const dispositionCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('disposition'))?.value;

        if (gapsCard === 'none' || gapsCard === '0' || (scoreCard && scoreCard.startsWith('100'))) {
            return { label: 'Sufficient · Gate Pass', tone: 'ok', title: 'Turn proof score is 100 with zero evidence gaps' };
        }
        if (dispositionCard && dispositionCard.toLowerCase().includes('advisory')) {
            const gapSummary = gapsCard && gapsCard !== 'none' ? gapsCard : 'Gaps Flagged';
            return { label: `Advisory · ${gapSummary}`, tone: 'warn', title: `Turn proof evaluated with gaps: ${step.sub}` };
        }
        if (step.status === 'warn' || step.status === 'bad') {
            const gapSummary = gapsCard && gapsCard !== 'none' ? gapsCard : 'Gaps Present';
            return { label: `Degraded · ${gapSummary}`, tone: 'warn', title: `Proof gaps detected: ${step.sub}` };
        }
        return { label: 'Turn Proof Evaluated', tone: 'ok', title: 'Turn proof gate evaluated' };
    }

    reconPill(step: PipelineStepView): { label: string; tone: FlowTone; title: string } | null {
        if (step.id !== 'evidence-recon') return null;
        const sub = (step.sub || '').toLowerCase();
        const filesCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('files'))?.value;
        const adaptersCard = step.subcards.find((s) => (s.label || '').toLowerCase().includes('adapter'))?.value;

        if (step.status === 'ok' || step.evidenced) {
            if (filesCard && filesCard !== 'not captured') {
                return { label: `${filesCard} Loaded`, tone: 'ok', title: 'Observed retrieval files captured from host telemetry' };
            }
            if (sub.includes('adapter')) {
                return { label: 'Recon Observed', tone: 'ok', title: 'Recon adapters actively executed and recorded' };
            }
            return { label: 'Recon Verified', tone: 'ok', title: 'Recon evidence verified' };
        }
        if (adaptersCard && adaptersCard !== 'not captured') {
            return { label: `${adaptersCard}`, tone: 'recon', title: 'Configured recon integrations' };
        }
        return { label: 'Recon Unexercised', tone: 'muted', title: 'No retrieval operations or signals captured' };
    }

    decisionJevPill(step: PipelineStepView): { label: string; tone: FlowTone; title: string } | null {
        if (step.id !== 'decision-jev') return null;
        const bandCheck = step.subcards.find((s) => (s.label || '').toLowerCase().includes('band'))?.value?.toLowerCase();
        const winnerCard = step.subcards.find((s) => (s.label || '').toLowerCase() === 'decision')?.value;

        if (bandCheck === 'match') {
            return { label: 'JEV Band Match', tone: 'ok', title: 'Adjudicated decision strictly matches consumer JEV confidence band' };
        }
        if (bandCheck === 'mismatch') {
            return { label: 'JEV Band Mismatch', tone: 'warn', title: 'Observed confidence diverged from expected consumer JEV band' };
        }
        if (winnerCard && winnerCard !== 'not captured') {
            return { label: `Winner: ${winnerCard}`, tone: 'decision', title: `Decision resolved by ${winnerCard}` };
        }
        if (step.evidenced) {
            return { label: 'Decision Recorded', tone: 'decision', title: 'Decision evidence recorded' };
        }
        return { label: 'JEV Unreported', tone: 'muted', title: 'No JEV evidence captured in decision telemetry' };
    }

    lawGatePill(step: PipelineStepView): { label: string; tone: FlowTone; title: string } | null {
        if (step.id !== 'intake-law') return null;
        const sub = step.sub.toLowerCase();
        if (step.status === 'ok' || sub.includes('law ref')) {
            return { label: 'AGENTS.md Verified', tone: 'ok', title: 'Authoritative law referenced and verified' };
        }
        if (sub.includes('law missing') || step.status === 'warn') {
            return { label: 'Law Missing', tone: 'warn', title: 'Action recorded without prior law consultation' };
        }
        if (sub.includes('law loaded')) {
            return { label: 'Law Loaded', tone: 'recon', title: 'Law file read, no decision claim attached' };
        }
        if (sub.includes('not exercised')) {
            return { label: 'Text-Only · Law Unexercised', tone: 'muted', title: 'Text-only turn, PreToolUse gate not required' };
        }
        return null;
    }

    private readonly STAGE_GRADIENTS: string[] = [
        'linear-gradient(180deg, rgba(16, 185, 129, 0.7) 0%, rgba(168, 85, 247, 0.5) 100%)', // 1 -> 2 (emerald -> purple)
        'linear-gradient(180deg, rgba(168, 85, 247, 0.5) 0%, rgba(14, 165, 233, 0.5) 100%)',  // 2 -> 3 (purple -> sky)
        'linear-gradient(180deg, rgba(14, 165, 233, 0.5) 0%, rgba(245, 158, 11, 0.5) 100%)',  // 3 -> 4 (sky -> amber)
        'linear-gradient(180deg, rgba(245, 158, 11, 0.5) 0%, rgba(99, 102, 241, 0.5) 100%)',  // 4 -> 5 (amber -> indigo)
        'linear-gradient(180deg, rgba(99, 102, 241, 0.5) 0%, rgba(20, 184, 166, 0.5) 100%)',  // 5 -> 6 (indigo -> teal)
        'linear-gradient(180deg, rgba(20, 184, 166, 0.5) 0%, rgba(20, 184, 166, 0.5) 100%)',  // 6 -> 7 (teal -> teal)
        'linear-gradient(180deg, rgba(20, 184, 166, 0.5) 0%, rgba(16, 185, 129, 0.5) 100%)',  // 7 -> 8 (teal -> emerald)
    ];

    connectorGradient(index: number): string {
        return this.STAGE_GRADIENTS[index] ?? 'var(--line)';
    }

    normativeSpec(stepId: string): NormativeSpecInfo {
        return NORMATIVE_SPECS[stepId] ?? {
            normativeAnchor: '16.master-standard.md · §Pipeline',
            mandate: 'Normative pipeline execution stage.',
            auditContract: 'Audit proof evidence must be recorded by the host.',
            requiredProofs: 'Stage observation events',
        };
    }

    stageSubtitle(stepId: string): string {
        switch (stepId) {
            case 'intake-law': return '(Cognitive Preflight · Fingerprint & Law Gate)';
            case 'decision-jev': return '(Decision Facade · L0 vs JEV Machine Band)';
            case 'evidence-recon': return '(Reconnaissance via Adapters · Delta Scoped)';
            case 'sufficiency': return '(Turn Proof Evaluation · HMAC Evidence Gate)';
            case 'slp': return '(SLP Orchestration · Peer Work Slicing & Roles)';
            case 'execution': return '(Safe Scope Execution · Range-Read & Write Gate)';
            case 'seal': return '(Cryptographic Integrity · HMAC SHA-256 Chain)';
            case 'report': return '(Normative Readiness Audit · 5-Axis Telemetry)';
            default: return '';
        }
    }

    subRefChip(stepId: string, label: string): string {
        const lbl = (label || '').toLowerCase();
        if (lbl.includes('prompt')) return 'prompt.hash';
        if (lbl.includes('actor')) return 'worker.role';
        if (lbl.includes('law')) return 'core.law-gate';
        if (lbl.includes('decision')) return 'decision.recorded';
        if (lbl.includes('jev')) return 'evidence.jev';
        if (lbl.includes('band')) return 'confidence.band';
        if (lbl.includes('files')) return 'telemetry.files';
        if (lbl.includes('recon tool') || lbl.includes('tools')) return 'observedTools';
        if (lbl.includes('adapter')) return 'reconAdapters[]';
        if (lbl.includes('level')) return 'verdict.level';
        if (lbl.includes('score')) return 'verdict.score';
        if (lbl.includes('gap')) return 'verdict.gaps[]';
        if (lbl.includes('disposition')) return 'gate.disposition';
        if (lbl.includes('shape')) return 'pipeline.shape';
        if (lbl.includes('role')) return 'pipeline.roles';
        if (lbl.includes('worker')) return 'worker.completed';
        if (lbl.includes('action')) return 'action.recorded';
        if (lbl.includes('write gate')) return 'scope_decision';
        if (lbl.includes('receipt')) return 'receipt.sha256';
        if (lbl.includes('spec')) return 'specRef v3.0';
        if (lbl.includes('source')) return 'sources[].sha256';
        if (lbl.includes('distill')) return 'signals.distill';
        if (lbl.includes('audit')) return 'Q1–Q6 audit';
        return 'telemetry';
    }

    isMonospaceVal(val?: string): boolean {
        if (!val) return false;
        return /^sha256:|[0-9a-f]{8,}|^\/[a-zA-Z0-9_\-./]+/.test(val) || /^[0-9]+(\.[0-9]+)?$/.test(val) || val.includes('/') || val.includes('_');
    }

    isMonospace(val: string): boolean {
        return /^sha256:|[0-9a-f]{8,}|^\/[a-zA-Z0-9_\-./]+/.test(val);
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
