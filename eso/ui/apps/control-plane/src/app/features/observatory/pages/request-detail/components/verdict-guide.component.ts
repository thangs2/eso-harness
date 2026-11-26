import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, input } from '@angular/core';
import type { TurnVerdictView } from '../request-detail.models.js';

/**
 * Long-form explainer for the Turn verdict. The card stays dense; this dialog carries the full
 * model: what the verdict is for, how it is computed, every level, the score arithmetic, the gap
 * catalogue, the current trace worked example, and what it does NOT affect.
 */
@Component({
    selector: 'eso-verdict-guide',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <dialog #dialog class="guide eso-sheet" style="--eso-sheet-width: 56rem" aria-labelledby="guide-title" (click)="onBackdrop($event)">
            <article class="guide-panel eso-sheet-panel">
                <header class="guide-head">
                    <div>
                        <p class="guide-eyebrow">ESO proof surface · Q1</p>
                        <h2 id="guide-title">Turn verdict — full explanation</h2>
                        <p class="guide-lede">What it answers, what each value means, how the score is produced, and what it changes downstream.</p>
                    </div>
                    <button type="button" class="guide-close" aria-label="Close verdict explanation" (click)="close()">×</button>
                </header>

                <div class="guide-body">
                    <section>
                        <h3>1. What the Turn verdict is</h3>
                        <p>The Turn verdict is ESO's <strong>Q1 adjudication</strong> of one trace: <em>does the evidence prove this turn was justified?</em> ESO reads the observations the host sent and decides whether the host claim is sustained. It does <strong>not</strong> rerun the host, call a model, or decide policy on the host's behalf.</p>
                        <p>It is computed per trace by <code>VerdictService</code> from observations, stored append-only in <code>platform.turn_verdict</code>, and rendered at the top of the request detail page. A stored row wins on every later read: new observations never rewrite an existing verdict, because history must stay auditable.</p>
                    </section>

                    <section>
                        <h3>2. Why it exists</h3>
                        <ul>
                            <li><strong>Prove why a turn proceeded.</strong> A prompt existing is not proof that the host was allowed to act. The verdict names the decision and the basis, or names the missing proof.</li>
                            <li><strong>Make silence visible.</strong> When a host runs without recording a decision, the verdict must say <code>unknown</code> + <code>HOST_SILENT</code>, not silently default to “allowed”.</li>
                            <li><strong>Give reviewers a stable answer.</strong> Audit, support and receipt verification can cite one level and one score instead of re-reading every event.</li>
                            <li><strong>Feed downstream evidence.</strong> The score and gaps are sealed into the receipt and reflected by effectiveness and the stage view.</li>
                        </ul>
                        <p class="guide-no">It is not a permission system, not a model-quality score, and not a substitute for the write gate.</p>
                    </section>

                    <section>
                        <h3>3. How it is computed</h3>
                        <p>The adjudication is a pure function over the trace's observations. Rules are applied in priority order:</p>
                        <ol>
                            <li>Any <code>decision.recorded</code> with verdict <code>deny</code> → <strong>deny</strong>.</li>
                            <li>No <code>decision.recorded</code> at all → <strong>unknown</strong> + gap <code>HOST_SILENT</code>.</li>
                            <li>Host reported <code>unknown</code> → <strong>unknown</strong>, no gap (the host itself abstained).</li>
                            <li>Host reported <code>partial</code> → <strong>partial</strong>, no gap.</li>
                            <li>Host claimed <code>allow</code> → ESO checks the three proofs; any missing proof downgrades to <strong>partial</strong> and adds its gap.</li>
                        </ol>
                        <p>Missing evidence is never an exception: it becomes a named gap, which is why the page can explain an <code>unknown</code> instead of showing an error.</p>
                    </section>

                    <section>
                        <h3>4. Inputs ESO reads</h3>
                        <dl class="guide-grid">
                            <div><dt>prompt.submitted</dt><dd>Shows the turn exists. On its own it proves only that a prompt was recorded — not why it ran.</dd></div>
                            <div><dt>decision.recorded</dt><dd>The host's claim: <code>verdict</code>, <code>basis</code>, optional actor and JEV block. Without it the verdict cannot be sustained.</dd></div>
                            <div><dt>evidence.packet</dt><dd>The evidence bundle the claim can be checked against. Required for an <code>allow</code> claim.</dd></div>
                            <div><dt>actor (kind,id)</dt><dd>Who acted. Required for an <code>allow</code> claim; without it the turn cannot be attributed.</dd></div>
                            <div><dt>action.recorded</dt><dd>What the host actually did, including a tool. Required for an <code>allow</code> claim.</dd></div>
                        </dl>
                    </section>

                    <section>
                        <h3>5. The four levels</h3>
                        <table class="guide-table">
                            <thead><tr><th>Level</th><th>When</th><th>What it means</th><th>Consequence</th></tr></thead>
                            <tbody>
                                <tr><td><code>allow</code></td><td>Host claim allow + all three proofs present</td><td>The evidence sustains the turn. This is the only level that means “proven”.</td><td>Reviewers may cite the turn as evidenced.</td></tr>
                                <tr><td><code>partial</code></td><td>Claim allow but at least one proof is missing, or host reported partial</td><td>The turn may have run, but the claim is not fully proven.</td><td>Name the gaps; do not present it as allow.</td></tr>
                                <tr><td><code>deny</code></td><td>A recorded decision or rule rejected the turn</td><td>The turn was not permitted. Gaps are not needed to explain a denial.</td><td>Treat the turn as rejected; the basis carries the rule.</td></tr>
                                <tr><td><code>unknown</code></td><td>No decision.recorded, or the host reported unknown</td><td><strong>Not allow</strong> (nothing sustained it) and <strong>not deny</strong> (nothing rejected it). The turn is unproven.</td><td>Cannot prove why the turn proceeded; cite the gap.</td></tr>
                            </tbody>
                        </table>
                    </section>

                    <section>
                        <h3>6. The score</h3>
                        <p class="guide-formula"><code>score = max(0, 100 − 25 × số_gap)</code></p>
                        <p>It measures <strong>evidence completeness</strong>, not model quality, speed, or business value. Four named proofs can be missing; the floor is 0, never negative.</p>
                        <table class="guide-table">
                            <thead><tr><th>Gaps</th><th>Score</th><th>Reading</th></tr></thead>
                            <tbody>
                                <tr><td>0</td><td>100</td><td>Every required proof is present; an allow claim is sustainable.</td></tr>
                                <tr><td>1</td><td>75</td><td>One proof missing; the claim cannot be sustained as allow.</td></tr>
                                <tr><td>2</td><td>50</td><td>Two proofs missing; most of the chain is unproven.</td></tr>
                                <tr><td>3</td><td>25</td><td>Only one proof exists; the turn is largely unsupported.</td></tr>
                                <tr><td>4</td><td>0</td><td>No proof beyond the prompt itself.</td></tr>
                            </tbody>
                        </table>
                        <p><strong>Where it goes:</strong> the level and score are stored with the verdict, then sealed into the receipt as <code>evidenceScore</code>. It does <strong>not</strong> block a write by itself — that is the Scope guard's decision — and a low score does not mean the host was malicious; it means the evidence is incomplete.</p>
                    </section>

                    <section>
                        <h3>7. The gap catalogue</h3>
                        <dl class="guide-grid">
                            <div><dt>HOST_SILENT</dt><dd>No <code>decision.recorded</code> in the trace. Consequence: cannot prove why the turn proceeded. Clear it by recording the host decision with a verdict and basis.</dd></div>
                            <div><dt>EVIDENCE_MISSING</dt><dd>No <code>evidence.packet</code>. Consequence: the claim has no bundle to verify against. Clear it by posting the evidence packet for the turn.</dd></div>
                            <div><dt>ACTOR_MISSING</dt><dd>No actor <code>(kind,id)</code> on any contract observation. Consequence: cannot attribute the turn. Clear it by recording the actor.</dd></div>
                            <div><dt>ACTION_MISSING</dt><dd>No <code>action.recorded</code> carrying a tool. Consequence: cannot confirm what the host did. Clear it by recording the action.</dd></div>
                        </dl>
                    </section>

                    <section class="guide-this">
                        <h3>8. This trace</h3>
                        @if (verdict(); as v) {
                            <p>Level <strong>{{ v.level }}</strong>, score <strong>{{ v.score }}/100</strong>, {{ v.gaps.length }} gap(s).</p>
                            <p class="guide-formula">100 − 25 × {{ v.gaps.length }} = {{ v.score }}</p>
                            @if (v.gaps.length) {
                                <ul>@for (gap of v.gaps; track gap.code) { <li><code>{{ gap.code }}</code> — {{ gap.what }}. <em>{{ gap.consequence }}</em></li> }</ul>
                            } @else {
                                <p>No gap recorded. If the level is <code>allow</code>, the three proofs are present; if the host itself reported <code>unknown</code>/<code>partial</code>, the level reflects that report.</p>
                            }
                            <p><strong>Basis (host's own words):</strong> {{ v.basis }}</p>
                            <p><strong>What would change this row:</strong> nothing in place — verdicts are append-only. A later observation does not rewrite history; the fix belongs to the next turn (record the decision and proofs before the host acts).</p>
                        } @else {
                            <p>This response carried no verdict, so there is no row to explain.</p>
                        }
                    </section>

                    <section>
                        <h3>9. How it relates to the rest of the page</h3>
                        <dl class="guide-grid">
                            <div><dt>JEV (stage 2)</dt><dd>JEV is the host's confidence→band policy and produces the reported decision. It is an <em>input</em>; it must never replace the verdict. ESO only checks whether a reported band matches its thresholds (warning, not the verdict).</dd></div>
                            <div><dt>Scope guard</dt><dd>A separate write-target decision. The verdict can be <code>unknown</code> while the write gate is <code>allowed</code>, or vice versa; never collapse the two.</dd></div>
                            <div><dt>Effectiveness</dt><dd>Counts which pipeline stages have evidence. The verdict is the Q1 answer; effectiveness is the tally behind it.</dd></div>
                            <div><dt>Receipt</dt><dd>Seals the verdict level, score, gaps and spec reference. Verification proves the bytes were not altered, not that the verdict is morally right.</dd></div>
                        </dl>
                    </section>

                    <section>
                        <h3>10. Reading checklist and limits</h3>
                        <ol>
                            <li>Read the <strong>level</strong> first: allow, partial, deny, unknown.</li>
                            <li>Read the <strong>gaps</strong>: each code says exactly what proof is missing.</li>
                            <li>Read the <strong>score</strong> only as arithmetic over those gaps.</li>
                            <li>Read the <strong>basis</strong>: it is the host's claim, copied verbatim, not ESO's opinion.</li>
                            <li>Check the <strong>receipt</strong> if you need immutability, and the <strong>write gate</strong> if you need permission.</li>
                        </ol>
                        <p class="guide-no">Absence of a failure event is not proof of success. <code>unknown</code> is not an accusation. A 100 does not prove the model was correct — only that the required evidence exists. ESO never invents a reason, a token count, or a band.</p>
                    </section>
                </div>
            </article>
        </dialog>
    `,
    styles: [`
        /* Size, backdrop and the mobile bottom-sheet behaviour come from eso-sheet (src/styles.css). */
        .guide-panel { grid-template-rows: auto minmax(0,1fr); }
        .guide-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); padding: var(--space-4); border-bottom: 1px solid var(--line); background: #0b111b; }
        .guide-eyebrow { margin: 0 0 .125rem; color: var(--dim); font-size: .6875rem; letter-spacing: .09em; text-transform: uppercase; }
        h2 { margin: 0; font-size: 1.125rem; }
        .guide-lede { margin: .25rem 0 0; color: var(--muted); font-size: .8125rem; }
        .guide-close { flex: 0 0 auto; width: 1.75rem; height: 1.75rem; border: 1px solid var(--line); border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 1.125rem; line-height: 1; cursor: pointer; }
        .guide-close:hover { border-color: var(--brand); color: var(--brand); }
        .guide-close:focus-visible { outline: .125rem solid var(--brand); outline-offset: .125rem; }
        .guide-body { overflow: auto; padding: var(--space-4); display: grid; gap: var(--space-4); }
        .guide-body section { display: grid; gap: var(--space-2); }
        h3 { margin: 0; color: #f1f5f9; font-size: .9375rem; }
        p, li, dd { color: #b6c2d2; font-size: .8125rem; line-height: 1.55; }
        ul, ol { margin: 0; padding-left: var(--space-5); display: grid; gap: .25rem; }
        code { color: #7dd3fc; font-family: ui-monospace, monospace; font-size: .75rem; }
        .guide-formula { padding: var(--space-2); border-left: 2px solid var(--brand); background: var(--surface-2); }
        .guide-table { width: 100%; border-collapse: collapse; font-size: .75rem; }
        .guide-table th, .guide-table td { padding: .375rem .5rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; color: #b6c2d2; }
        .guide-table th { color: var(--dim); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; font-size: .6875rem; }
        .guide-grid { display: grid; gap: var(--space-2); margin: 0; }
        .guide-grid > div { display: grid; grid-template-columns: 9rem minmax(0,1fr); gap: var(--space-2); align-items: baseline; }
        .guide-grid dt { color: var(--brand); font-size: .75rem; font-family: ui-monospace, monospace; }
        .guide-grid dd { margin: 0; }
        .guide-no { padding: var(--space-2); border: 1px dashed var(--line); border-radius: var(--radius-sm); color: var(--muted); }
        .guide-this { padding: var(--space-3); border: 1px solid rgba(56,189,248,.35); border-radius: var(--radius-md); background: rgba(56,189,248,.06); }
        @media (max-width: 47.9375rem) {
            .guide-grid > div { grid-template-columns: minmax(0,1fr); gap: .125rem; }
        }
    `],
})
export class VerdictGuideComponent {
    readonly verdict = input<TurnVerdictView | null>(null);

    @ViewChild('dialog') private dialog?: ElementRef<HTMLDialogElement>;

    open(): void {
        this.dialog?.nativeElement.showModal();
    }

    close(): void {
        this.dialog?.nativeElement.close();
    }

    onBackdrop(event: MouseEvent): void {
        if (event.target === this.dialog?.nativeElement) this.close();
    }
}
