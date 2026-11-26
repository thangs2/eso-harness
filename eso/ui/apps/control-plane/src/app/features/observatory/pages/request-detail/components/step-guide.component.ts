import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, signal } from '@angular/core';
import type { PipelineStepView } from '../request-detail.models.js';

interface StepGuide {
    question: string;
    reads: string[];
    states: { label: string; text: string }[];
    limits: string[];
    change: string;
}

/** Per-step meaning. The card only has room for three values; this dialog explains the model. */
const GUIDES: Record<string, StepGuide> = {
    'intake-law': {
        question: 'Did the host consult the law before it acted?',
        reads: [
            'decision.recorded.evidence.refs[] — the host decision itself cites a law file (strong).',
            'law.loaded — the Stop hook saw a real read_file/view_file/cat of AGENTS.md or CLAUDE.md (weak: it proves a read, not that a decision relied on it).',
            'action.recorded / worker.completed.tools[] — shows whether the turn used a tool at all.',
        ],
        states: [
            { label: 'law refs (ok)', text: 'A decision cites AGENTS.md/CLAUDE.md. The turn is strong evidence that law was part of the decision.' },
            { label: 'law loaded (info)', text: 'The transcript proves the host read the law. Nothing claims a decision used it, so the stage stays neutral, not green.' },
            { label: 'law missing (warn)', text: 'A tool was used but no read/decision ref exists. The PreToolUse law gate should block this on new turns; a trace that predates the gate can still show it.' },
            { label: 'law not exercised (info)', text: 'No tool or action was recorded. The law gate runs before tools, so it had nothing to evaluate. A text-only answer does not read AGENTS.md — expected, but the law remains unproven.' },
        ],
        limits: [
            'The stage does not block the prompt; enforcement belongs to the PreToolUse law gate.',
            'It does not prove the host followed the law, only that a reference or read exists.',
            'A text-only answer can be correct and still show no law evidence; this is not automatically a violation.',
        ],
        change: 'Read AGENTS.md (read_file, or cat AGENTS.md) and the Stop hook emits law.loaded. For a decision-grade proof, record decision.recorded with refs.',
    },
    'decision-jev': {
        question: 'What did the host decide, and did its JEV band match the confidence?',
        reads: ['decision.recorded (verdict, winner, basis)', 'decision.recorded.evidence.jev (mode, consent, confidence, band, decision)'],
        states: [
            { label: 'JEV reported', text: 'The host sent a JEV block; ESO recomputes the expected band from the consumer thresholds and reports match/mismatch.' },
            { label: 'JEV not reported', text: 'No JEV block was sent. The decision may still exist; the band cannot be checked.' },
            { label: 'no decision', text: 'No decision.recorded at all; the verdict becomes unknown/HOST_SILENT.' },
        ],
        limits: ['JEV is host policy and an input to the verdict, never a replacement for it.', 'ESO never invents confidence or a band.'],
        change: 'Record decision.recorded with verdict + basis, and include evidence.jev when JEV is active.',
    },
    'evidence-recon': {
        question: 'Did the host retrieve evidence, and how many adapter calls did it make?',
        reads: ['Host-reported recon signals', 'evidence.packet observations'],
        states: [
            { label: 'calls reported', text: 'Adapter call counts are shown as reported; they are not inferred from files.' },
            { label: 'not captured', text: 'No recon signal; ESO cannot tell whether retrieval happened.' },
        ],
        limits: ['Counts describe host retrieval, not the quality of the evidence.', 'A missing signal is not proof that no retrieval happened.'],
        change: 'Have the host report recon calls and evidence packets for the turn.',
    },
    sufficiency: {
        question: 'Does the evidence sustain the host claim?',
        reads: ['decision.recorded', 'evidence.packet', 'actor', 'action.recorded'],
        states: [
            { label: 'allow', text: 'Claim sustained and all three proofs are present.' },
            { label: 'partial', text: 'A proof is missing; the claim is not fully proven.' },
            { label: 'deny', text: 'A recorded decision or rule rejected the turn.' },
            { label: 'unknown', text: 'No decision or host unknown; not allow and not deny.' },
        ],
        limits: [
            'This is Q1/Q3 of the turn proof surface; it does not rerun the host.',
            'Score = max(0, 100 − 25 × gaps); it measures turn proof-gap completeness, not model quality.',
            'Turn proof score is distinct from knowledge sufficiency (which checks contradictions, near-duplicates, and missing artifact kinds in Knowledge settings).',
        ],
        change: 'Record the decision and its proofs; the Turn verdict card gives the full arithmetic.',
    },
    slp: {
        question: 'Which roles and workers did the host report for this turn?',
        reads: ['detail.pipeline roles', 'worker observations'],
        states: [
            { label: 'roles observed', text: 'Roles named by observations; not a claim that every assigned role ran.' },
            { label: 'not captured', text: 'No worker evidence; the orchestration is unproven.' },
        ],
        limits: ['ESO never assigns or runs a worker.', 'Role counts are reported facts, not a quality grade.'],
        change: 'Have the host report worker/role observations.',
    },
    execution: {
        question: 'What did the host actually do, and did the write gate allow it?',
        reads: ['action.recorded', 'scope decision (write gate)'],
        states: [
            { label: 'action recorded', text: 'The tool/action is evidence of what ran.' },
            { label: 'write gate', text: 'allowed/blocked/not recorded; not recorded means permission is unverified, not granted.' },
            { label: 'no action', text: 'No action event; the turn either did nothing or did not report it.' },
        ],
        limits: ['The verdict does not replace the write gate; they are independent decisions.', 'Absence of an action event is not proof that nothing happened.'],
        change: 'Record actions and call scope/check with the traceId before writing.',
    },
    seal: {
        question: 'Was the verdict/receipt sealed, and which spec does it point to?',
        reads: ['receipt hash chain', 'REQUEST_SPEC_REF', 'distill signal'],
        states: [
            { label: 'sealed', text: 'A hash chain exists; verification can prove the bytes were not altered.' },
            { label: 'not issued', text: 'No receipt yet; the turn has no sealed record.' },
        ],
        limits: ['A sealed receipt proves integrity, not correctness of the verdict.', 'Changing the spec version does not rewrite old receipts.'],
        change: 'Let ESO seal the verdict; no host action is required beyond observing.',
    },
    report: {
        question: 'Are the six audit questions answerable from this trace?',
        reads: ['Q1–Q6 readiness booleans'],
        states: [
            { label: 'answered', text: 'How many of the six readiness checks have data.' },
            { label: 'missing', text: 'The named questions have no data; this is a coverage gap, not a failure judgement.' },
        ],
        limits: ['Readiness is not a quality score.', 'A question can be answerable and still show a gap.'],
        change: 'Provide the missing observations named by the unanswered questions.',
    },
};

@Component({
    selector: 'eso-step-guide',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <dialog #dialog class="guide eso-sheet" style="--eso-sheet-width: 46rem" aria-labelledby="step-guide-title" (click)="onBackdrop($event)">
            <article class="guide-panel eso-sheet-panel">
                <header class="guide-head">
                    <div>
                        <p class="guide-eyebrow">Pipeline step {{ step()?.stepNumber }}</p>
                        <h2 id="step-guide-title">{{ step()?.label }} — how this step works</h2>
                    </div>
                    <button type="button" class="guide-close" aria-label="Close step explanation" (click)="close()">×</button>
                </header>
                @if (step(); as s) {
                    <div class="guide-body">
                        <section>
                            <h3>What this step answers</h3>
                            <p>{{ guide().question }}</p>
                            <p class="guide-current">This trace: <strong>{{ s.status }}</strong> · {{ s.sub }}</p>
                        </section>
                        <section>
                            <h3>What ESO reads</h3>
                            <ul>@for (item of guide().reads; track item) { <li>{{ item }}</li> }</ul>
                        </section>
                        <section>
                            <h3>What the states mean</h3>
                            <dl class="guide-grid">
                                @for (item of guide().states; track item.label) {
                                    <div><dt>{{ item.label }}</dt><dd>{{ item.text }}</dd></div>
                                }
                            </dl>
                        </section>
                        @if (s.subcards.length) {
                            <section>
                                <h3>The values on this card</h3>
                                <dl class="guide-grid">
                                    @for (sub of s.subcards; track sub.label) {
                                        <div><dt>{{ sub.label }}</dt><dd><strong>{{ sub.value }}</strong> — {{ sub.detail }}</dd></div>
                                    }
                                </dl>
                            </section>
                        }
                        <section>
                            <h3>What it does not do</h3>
                            <ul>@for (item of guide().limits; track item) { <li>{{ item }}</li> }</ul>
                        </section>
                        <section>
                            <h3>How to change this trace</h3>
                            <p>{{ guide().change }}</p>
                        </section>
                    </div>
                }
            </article>
        </dialog>
    `,
    styles: [`
        /* Size, backdrop and the mobile bottom-sheet behaviour come from eso-sheet (src/styles.css). */
        .guide-panel { grid-template-rows: auto minmax(0,1fr); }
        .guide-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); padding: var(--space-4); border-bottom: 1px solid var(--line); }
        .guide-eyebrow { margin: 0 0 .125rem; color: var(--dim); font-size: .6875rem; letter-spacing: .09em; text-transform: uppercase; }
        h2 { margin: 0; font-size: 1rem; }
        .guide-close { width: 1.75rem; height: 1.75rem; border: 1px solid var(--line); border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 1.125rem; cursor: pointer; }
        .guide-body { overflow: auto; padding: var(--space-4); display: grid; gap: var(--space-3); }
        .guide-body section { display: grid; gap: var(--space-2); }
        h3 { margin: 0; color: #f1f5f9; font-size: .875rem; }
        p, li, dd { margin: 0; color: #b6c2d2; font-size: .8125rem; line-height: 1.55; }
        ul { margin: 0; padding-left: var(--space-5); display: grid; gap: .25rem; }
        .guide-current { padding: var(--space-2); border-left: 2px solid var(--brand); background: var(--surface-2); }
        .guide-grid { display: grid; gap: var(--space-2); margin: 0; }
        .guide-grid > div { display: grid; grid-template-columns: 9rem minmax(0,1fr); gap: var(--space-2); align-items: baseline; }
        .guide-grid dt { color: var(--brand); font-size: .75rem; }
        .guide-grid dd { margin: 0; }
        @media (max-width: 47.9375rem) {
            .guide-grid > div { grid-template-columns: minmax(0,1fr); gap: .125rem; }
        }
    `],
})
export class StepGuideComponent {
    readonly step = signal<PipelineStepView | null>(null);

    @ViewChild('dialog') private dialog?: ElementRef<HTMLDialogElement>;

    guide(): StepGuide {
        return GUIDES[this.step()?.id || ''] || {
            question: 'What does this pipeline step observe?',
            reads: ['The observations named by the stage values on the card.'],
            states: [{ label: 'status', text: 'Derived from the evidence reported for this stage.' }],
            limits: ['ESO observes; it does not execute.'],
            change: 'Provide the missing host evidence named on the card.',
        };
    }

    open(step: PipelineStepView): void {
        this.step.set(step);
        this.dialog?.nativeElement.showModal();
    }

    close(): void {
        this.dialog?.nativeElement.close();
    }

    onBackdrop(event: MouseEvent): void {
        if (event.target === this.dialog?.nativeElement) this.close();
    }
}
