import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EvidenceEffectivenessView } from '../evidence-effectiveness.selectors.js';

/**
 * 5-Axis Evidence Effectiveness panel ("Bằng chứng có hiệu quả hay không").
 * Placed right below RequestHero on Observatory v2 Detail so operators can immediately
 * judge Retrieval Precision, Sufficiency Coverage, Evidence Basis, Execution Impact,
 * and Closed-Loop Learn → Train handoffs strictly from real backend evidence (BR-12).
 */
@Component({
    selector: 'eso-evidence-effectiveness',
    standalone: true,
    imports: [RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="ee-panel" [attr.data-overall]="view().overallStatus" aria-label="5-Axis Evidence Effectiveness">
            <header class="ee-head">
                <div class="ee-head-left">
                    <div class="ee-title-row">
                        <span class="ee-eyebrow">Evidence Effectiveness · 5 Axes</span>
                        <span class="ee-status-badge" [attr.data-status]="view().overallStatus">
                            <i class="dot" aria-hidden="true"></i>{{ view().overallLabel }}
                        </span>
                    </div>
                    <p class="ee-summary">{{ view().summary }}</p>
                </div>
                <div class="ee-gauge" aria-label="Captured axes composite gauge">
                    <div class="ee-gauge-meta">
                        <span class="ee-gauge-label">{{ view().capturedAxes }}/{{ view().totalAxes }} axes captured</span>
                        <strong class="ee-gauge-val">{{ view().compositePct !== null ? view().compositePct + '%' : 'n/a' }}</strong>
                    </div>
                    <div class="ee-bar-track">
                        <div class="ee-bar-fill" [attr.data-status]="view().overallStatus" [style.width.%]="view().compositePct ?? 0"></div>
                    </div>
                    <span class="ee-unknowns-hint">{{ view().explicitUnknowns.length }} explicit unknown(s) · BR-18</span>
                </div>
            </header>

            <div class="ee-grid">
                <!-- Axis 1: Retrieval Precision (MET-08) -->
                <article class="axis-card" [attr.data-state]="view().axis1.state">
                    <header class="axis-head">
                        <span class="axis-tag">Axis 1 · MET-08</span>
                        <span class="axis-state">{{ stateLabel(view().axis1.state) }}</span>
                    </header>
                    <h3>Retrieval Precision (MET-08)</h3>
                    <p class="axis-sub">Relevant &amp; non-redundant context</p>
                    <div class="axis-metric">
                        @if (view().axis1.ratioPct !== null) {
                            <strong>{{ view().axis1.ratioPct }}%</strong>
                            <span>{{ view().axis1.usedCount }}/{{ view().axis1.loadedCount }} files used</span>
                        } @else {
                            <strong class="muted-val">not captured</strong>
                            <span>{{ view().axis1.reconCallsTotal }} recon · {{ view().axis1.readToolCount + view().axis1.searchToolCount }} read/search</span>
                        }
                    </div>
                    <div class="mini-track">
                        <div class="mini-fill" [attr.data-state]="view().axis1.state" [style.width.%]="view().axis1.ratioPct ?? 0"></div>
                    </div>
                    <p class="axis-note">{{ view().axis1.note }}</p>
                    <!--
                        The score card shows progress, not the corpus: printing paths here made Axis 1
                        the only card in the strip that grew past one metric row. The list is disclosed
                        on demand (native <dialog>; a bottom sheet on small viewports).
                    -->
                    @if (view().axis1.fileList.length > 0) {
                        <button type="button" class="axis-disclosure" (click)="openFiles()"
                                [attr.aria-label]="'Show all ' + view().axis1.loadedCount + ' files behind Retrieval Precision'">
                            <code>{{ view().axis1.chips[0] }}</code>
                            <span>{{ view().axis1.loadedCount > 1 ? '+' + (view().axis1.loadedCount - 1) + ' more' : 'view file' }}</span>
                        </button>
                    }
                </article>

                <!-- Axis 2: Sufficiency Coverage (P4) -->
                <article class="axis-card" [attr.data-state]="view().axis2.state">
                    <header class="axis-head">
                        <span class="axis-tag">Axis 2 · P4</span>
                        <span class="axis-state">{{ stateLabel(view().axis2.state) }}</span>
                    </header>
                    <h3>Sufficiency Coverage (P4)</h3>
                    <p class="axis-sub">Step coverage &amp; gap diagnosis</p>
                    <div class="axis-metric">
                        @if (view().axis2.stepsWithEvidence !== null && view().axis2.stepsTotal !== null) {
                            <strong>{{ view().axis2.stepsWithEvidence }}/{{ view().axis2.stepsTotal }}</strong>
                            <span>steps · score {{ view().axis2.verdictScore !== null ? view().axis2.verdictScore + '/100' : 'n/a' }}</span>
                        } @else if (view().axis2.verdictScore !== null) {
                            <strong>{{ view().axis2.verdictScore }}/100</strong>
                            <span>{{ view().axis2.gapCount }} gap(s)</span>
                        } @else {
                            <strong class="muted-val">not captured</strong>
                            <span>0 steps reported</span>
                        }
                    </div>
                    <div class="mini-track">
                        <div class="mini-fill" [attr.data-state]="view().axis2.state" [style.width.%]="view().axis2.coveragePct ?? 0"></div>
                    </div>
                    <div class="diag-row">
                        <span class="diag-pill" [attr.data-diag]="view().axis2.diagnosisKind">{{ view().axis2.diagnosisLabel }}</span>
                        <span class="diag-gaps">{{ view().axis2.gapCount }} gap(s)</span>
                    </div>
                </article>

                <!-- Axis 3: Evidence Basis (P7) -->
                <article class="axis-card" [attr.data-state]="view().axis3.state">
                    <header class="axis-head">
                        <span class="axis-tag">Axis 3 · P7</span>
                        <span class="axis-state">{{ stateLabel(view().axis3.state) }}</span>
                    </header>
                    <h3>Evidence Basis &amp; Trust (P7)</h3>
                    <p class="axis-sub">Sealed sources &amp; receipt integrity</p>
                    <div class="axis-metric">
                        @if (view().axis3.totalBasisCount > 0) {
                            <strong>{{ view().axis3.verifiedCount }}/{{ view().axis3.totalBasisCount }} sources verified</strong>
                            <span>Receipt: {{ view().axis3.receiptVerification }}</span>
                        } @else {
                            <strong class="muted-val">Receipt: {{ view().axis3.receiptVerification }}</strong>
                            <span>0 sealed sources</span>
                        }
                    </div>
                    <div class="trust-bar" role="img" [attr.aria-label]="'Verified ' + view().axis3.verifiedCount + ', retrieved ' + view().axis3.retrievedOnlyCount + ', unverified ' + view().axis3.unverifiedCount">
                        @if (view().axis3.totalBasisCount > 0) {
                            <span class="seg-verified" [style.width.%]="view().axis3.verifiedPct ?? 0"></span>
                            <span class="seg-retrieved" [style.width.%]="view().axis3.retrievedPct ?? 0"></span>
                            <span class="seg-unverified" [style.width.%]="view().axis3.unverifiedPct ?? 0"></span>
                        }
                    </div>
                    <div class="trust-legend">
                        <span class="leg-ok">{{ view().axis3.verifiedCount }} verified</span>
                        <span class="leg-info">{{ view().axis3.retrievedOnlyCount }} retrieved</span>
                        <span class="leg-bad">{{ view().axis3.unverifiedCount }} unverified</span>
                    </div>
                    <p class="axis-note">
                        @if (view().axis3.readBeforeEditTotal > 0) {
                            Read-before-edit: {{ view().axis3.readBeforeEditYes }}/{{ view().axis3.readBeforeEditTotal }}
                        } @else {
                            Read-before-edit: not captured
                        }
                        @if (view().axis3.receiptSpecVersion) {
                            · Receipt v{{ view().axis3.receiptSpecVersion }}
                        }
                    </p>
                </article>

                <!-- Axis 4: Execution Impact -->
                <article class="axis-card" [attr.data-state]="view().axis4.state">
                    <header class="axis-head">
                        <span class="axis-tag">Axis 4 · EXEC</span>
                        <span class="axis-state">{{ stateLabel(view().axis4.state) }}</span>
                    </header>
                    <h3>Execution Impact</h3>
                    <p class="axis-sub">Latency, token burn &amp; write gate</p>
                    <dl class="exec-strip">
                        <div><dt>Latency</dt><dd>{{ formatDuration(view().axis4.durationMs) }}</dd></div>
                        <div><dt>LLM / Tools</dt><dd>{{ view().axis4.llmCalls }} / {{ view().axis4.toolCalls }}</dd></div>
                        <div><dt>Tokens</dt><dd>{{ formatTokens(view().axis4.totalTokens, view().axis4.tokensEstimated) }}</dd></div>
                        <div><dt>Failures</dt><dd [class.val-bad]="(view().axis4.failures ?? 0) > 0">{{ view().axis4.failures ?? 'n/a' }}</dd></div>
                    </dl>
                    <div class="gate-row">
                        <span class="gate-label">Write Gate</span>
                        <span class="gate-pill" [attr.data-gate]="view().axis4.writeGateStatus">
                            {{ view().axis4.writeGateStatus === 'not-recorded' ? 'not recorded' : view().axis4.writeGateStatus }}
                            @if (view().axis4.writeGateCode) { · {{ view().axis4.writeGateCode }} }
                        </span>
                    </div>
                </article>

                <!-- Axis 5: Closed-Loop Learn -> Train (P5) -->
                <article class="axis-card" [attr.data-state]="view().axis5.state">
                    <header class="axis-head">
                        <span class="axis-tag">Axis 5 · P5</span>
                        <span class="axis-state">{{ view().axis5.allClear ? 'Clear' : view().axis5.branches.length + ' branch(es)' }}</span>
                    </header>
                    <h3>Learn → Train Handoff (P5)</h3>
                    <p class="axis-sub">Closed-loop remediation branches</p>
                    @if (view().axis5.branches.length > 0) {
                        <ul class="branch-list">
                            @for (item of view().axis5.branches; track item.branch) {
                                <li class="branch-item">
                                    <div class="branch-top">
                                        <span class="branch-badge" [attr.data-branch]="item.branch">{{ item.badge }}</span>
                                        <a class="branch-link" [routerLink]="item.targetRoute" [queryParams]="item.queryParams">Open →</a>
                                    </div>
                                    <span class="branch-triggers">{{ item.triggeredBy.slice(0, 2).join(' · ') }}</span>
                                </li>
                            }
                        </ul>
                    } @else {
                        <div class="branch-clear">
                            <strong>No remediation branch triggered</strong>
                            <span>No Form/KB, Obligation, Model, or Retrieval gaps flagged for this turn.</span>
                            @if (consumerId()) {
                                <a class="branch-link" [routerLink]="['/consumers', consumerId(), 'learning']">View Learning →</a>
                            }
                        </div>
                    }
                </article>
            </div>
        </section>

        <!--
            Retrieval Precision detail. Native <dialog> so focus trap / Esc / backdrop come from the
            platform (same pattern as ess-step-guide). On small viewports it is pinned to the bottom
            edge as a sheet, which keeps the close control and the list within thumb reach.
        -->
        <dialog #filesDialog class="files-sheet eso-sheet" style="--eso-sheet-width: 38rem" aria-labelledby="files-sheet-title" (click)="onSheetBackdrop($event)">
            <div class="files-sheet-panel eso-sheet-panel">
                <header class="files-sheet-head">
                    <div>
                        <p class="files-sheet-eyebrow">Axis 1 · MET-08</p>
                        <h2 id="files-sheet-title">Files behind Retrieval Precision</h2>
                    </div>
                    <button type="button" class="files-sheet-close" aria-label="Close file list" (click)="closeFiles()">×</button>
                </header>
                <div class="files-sheet-meta">
                    <span><strong>{{ view().axis1.usedCount }}</strong> used</span>
                    <span><strong>{{ view().axis1.loadedCount }}</strong> loaded</span>
                    @if (view().axis1.ratioPct !== null) {
                        <span><strong>{{ view().axis1.ratioPct }}%</strong> precision</span>
                    }
                </div>
                <ul class="files-sheet-list">
                    @for (file of view().axis1.fileList; track file.path) {
                        <li [attr.data-used]="file.used">
                            <span class="file-state" [attr.data-used]="file.used">{{ file.used ? 'used' : 'loaded' }}</span>
                            <code [title]="file.path">{{ file.path }}</code>
                        </li>
                    }
                </ul>
            </div>
        </dialog>
    `,
    styles: [`
        :host { display: block; min-width: 0; max-width: 100%; }
        .ee-panel { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-top: 3px solid var(--brand); border-radius: var(--radius-md); background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, var(--brand)) 0%, var(--surface) 100%); box-shadow: 0 2px 6px rgba(0,0,0,.35); min-width: 0; max-width: 100%; overflow: hidden; }
        .ee-panel[data-overall='effective'] { border-top-color: var(--ok-ink); }
        .ee-panel[data-overall='partial'] { border-top-color: var(--warn-ink); }
        .ee-panel[data-overall='ineffective'] { border-top-color: var(--danger-ink); }
        .ee-panel[data-overall='cannot-judge'] { border-top-color: var(--dim); }

        .ee-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; padding-bottom: var(--space-3); border-bottom: 1px solid var(--line); min-width: 0; max-width: 100%; }
        .ee-head-left { display: grid; gap: var(--space-1); flex: 1 1 min(100%, 24rem); min-width: 0; max-width: 100%; }
        .ee-title-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .ee-eyebrow { color: var(--muted); font-size: 0.6875rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .ee-status-badge { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.125rem 0.625rem; border: 1px solid var(--line); border-radius: 62.44rem; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
        .ee-status-badge .dot { width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: currentColor; }
        .ee-status-badge[data-status='effective'] { color: var(--ok-ink); border-color: rgba(78,201,122,.4); background: rgba(78,201,122,.12); }
        .ee-status-badge[data-status='partial'] { color: var(--warn-ink); border-color: rgba(224,179,65,.4); background: rgba(224,179,65,.12); }
        .ee-status-badge[data-status='ineffective'] { color: var(--danger-ink); border-color: rgba(255,107,107,.45); background: rgba(255,107,107,.14); }
        .ee-status-badge[data-status='cannot-judge'] { color: var(--muted); border-color: var(--line); background: var(--surface-2); }
        .ee-summary { margin: 0; color: #cbd5e1; font-size: 0.8125rem; line-height: 1.45; }

        .ee-gauge { display: grid; gap: 0.375rem; min-width: 13.5rem; flex: 0 1 16rem; }
        .ee-gauge-meta { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
        .ee-gauge-label { color: var(--muted); font-size: 0.6875rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
        .ee-gauge-val { color: var(--ink); font-size: 0.9375rem; font-variant-numeric: tabular-nums; }
        .ee-bar-track { height: 0.4375rem; border-radius: 62.44rem; background: var(--surface-2); border: 1px solid var(--line-soft); overflow: hidden; }
        .ee-bar-fill { height: 100%; border-radius: 62.44rem; background: var(--brand); transition: width .35s ease; }
        .ee-bar-fill[data-status='effective'] { background: linear-gradient(90deg, #34d399, #4ec97a); }
        .ee-bar-fill[data-status='partial'] { background: linear-gradient(90deg, #f59e0b, #e0b341); }
        .ee-bar-fill[data-status='ineffective'] { background: linear-gradient(90deg, #ef4444, #ff6b6b); }
        .ee-bar-fill[data-status='cannot-judge'] { background: var(--dim); }
        .ee-unknowns-hint { color: var(--dim); font-size: 0.6875rem; text-align: right; }

        .ee-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-3); min-width: 0; max-width: 100%; overflow: hidden; }
        .axis-card { display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: 0.4375rem; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); min-width: 0; max-width: 100%; overflow: hidden; }
        .axis-card > * { min-width: 0; max-width: 100%; }
        .axis-card[data-state='strong'] { border-color: rgba(78,201,122,.32); }
        .axis-card[data-state='partial'] { border-color: rgba(224,179,65,.32); }
        .axis-card[data-state='weak'] { border-color: rgba(255,107,107,.35); }
        .axis-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); min-width: 0; max-width: 100%; overflow: hidden; }
        .axis-tag { color: var(--dim); font-size: 0.6875rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
        .axis-state { padding: 0.0625rem 0.375rem; border: 1px solid var(--line); border-radius: 62.44rem; font-size: 0.6875rem; font-weight: 600; color: var(--muted); white-space: nowrap; }
        .axis-card[data-state='strong'] .axis-state { color: var(--ok-ink); border-color: rgba(78,201,122,.35); background: rgba(78,201,122,.1); }
        .axis-card[data-state='partial'] .axis-state { color: var(--warn-ink); border-color: rgba(224,179,65,.35); background: rgba(224,179,65,.1); }
        .axis-card[data-state='weak'] .axis-state { color: var(--danger-ink); border-color: rgba(255,107,107,.4); background: rgba(255,107,107,.12); }

        .axis-card h3 { margin: 0; color: #f1f5f9; font-size: 0.875rem; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
        .axis-sub { margin: -0.25rem 0 0; color: var(--dim); font-size: 0.6875rem; }
        .axis-metric { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-1); flex-wrap: wrap; min-width: 0; max-width: 100%; overflow: hidden; }
        .axis-metric strong { color: var(--ink); font-size: 1rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
        .axis-metric strong.muted-val { color: var(--muted); font-size: 0.875rem; font-weight: 600; }
        .axis-metric span { color: var(--muted); font-size: 0.6875rem; }

        .mini-track { height: 0.3125rem; border-radius: 62.44rem; background: #192234; overflow: hidden; }
        .mini-fill { height: 100%; border-radius: 62.44rem; background: var(--brand); transition: width .35s ease; }
        .mini-fill[data-state='strong'] { background: var(--ok-ink); }
        .mini-fill[data-state='partial'] { background: var(--warn-ink); }
        .mini-fill[data-state='weak'] { background: var(--danger-ink); }

        .axis-note { margin: 0; color: var(--muted); font-size: 0.6875rem; line-height: 1.4; overflow-wrap: anywhere; }
        /* Axis 1 disclosure — one line, so all five cards keep the same height. */
        .axis-disclosure { display: flex; align-items: center; gap: 0.375rem; min-width: 0; max-width: 100%; padding: 0.1875rem 0.375rem; border: 1px solid var(--line-soft); border-radius: 0.25rem; background: var(--surface); color: #93c5fd; font: inherit; font-size: 0.6875rem; cursor: pointer; overflow: hidden; }
        .axis-disclosure:hover { border-color: var(--brand); color: #ffffff; }
        .axis-disclosure:focus-visible { outline: 0.125rem solid var(--brand); outline-offset: 0.0625rem; }
        .axis-disclosure code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.6875rem; }
        .axis-disclosure span { margin-left: auto; flex: 0 0 auto; color: var(--muted); font-variant-numeric: tabular-nums; }
        .axis-disclosure:hover span { color: inherit; }

        /* Width, backdrop and the mobile bottom-sheet behaviour come from eso-sheet (src/styles.css);
           this sheet only adds its own row structure (head / meta / list). */
        .files-sheet-panel { grid-template-rows: auto auto minmax(0, 1fr); }
        .files-sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); padding: var(--space-4); border-bottom: 1px solid var(--line); }
        .files-sheet-eyebrow { margin: 0 0 0.125rem; color: var(--dim); font-size: 0.6875rem; letter-spacing: 0.09em; text-transform: uppercase; }
        .files-sheet-head h2 { margin: 0; font-size: 1rem; }
        .files-sheet-close { width: 1.75rem; height: 1.75rem; border: 1px solid var(--line); border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 1.125rem; line-height: 1; cursor: pointer; }
        .files-sheet-meta { display: flex; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line-soft); color: var(--muted); font-size: 0.75rem; }
        .files-sheet-meta strong { color: var(--ink); font-variant-numeric: tabular-nums; }
        .files-sheet-list { margin: 0; padding: var(--space-2) var(--space-4) var(--space-4); list-style: none; overflow: auto; display: grid; gap: 0.125rem; }
        .files-sheet-list li { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr); align-items: baseline; gap: var(--space-2); padding: 0.1875rem 0; border-bottom: 1px solid var(--line-soft); }
        .files-sheet-list li:last-child { border-bottom: 0; }
        .file-state { font-size: 0.625rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--dim); }
        .file-state[data-used='true'] { color: var(--ok-ink); }
        .files-sheet-list code { font-size: 0.75rem; color: #cbd5e1; overflow-wrap: anywhere; }
        .files-sheet-list li[data-used='false'] code { color: var(--muted); }

        @media (max-width: 47.9375rem) {
            .files-sheet-list li { grid-template-columns: 3.25rem minmax(0, 1fr); }
        }

        .diag-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); flex-wrap: wrap; margin-top: 0.125rem; }
        .diag-pill { padding: 0.125rem 0.4375rem; border: 1px solid var(--line); border-radius: 0.25rem; background: var(--surface); color: #cbd5e1; font-size: 0.6875rem; font-weight: 600; }
        .diag-pill[data-diag='sufficient'] { color: var(--ok-ink); border-color: rgba(78,201,122,.35); background: rgba(78,201,122,.08); }
        .diag-pill[data-diag='insufficient-kb'], .diag-pill[data-diag='unsurfaced-retrieval'], .diag-pill[data-diag='proof-gap'] { color: var(--warn-ink); border-color: rgba(224,179,65,.35); background: rgba(224,179,65,.08); }
        .diag-pill[data-diag='cannot-judge-model'] { color: #c084fc; border-color: rgba(192,132,252,.35); background: rgba(192,132,252,.1); }
        .diag-pill[data-diag='host-silent'] { color: var(--danger-ink); border-color: rgba(255,107,107,.35); background: rgba(255,107,107,.1); }
        .diag-gaps { color: var(--dim); font-size: 0.6875rem; font-variant-numeric: tabular-nums; }

        .trust-bar { display: flex; height: 0.375rem; border-radius: 62.44rem; background: #192234; overflow: hidden; }
        .seg-verified { background: var(--ok-ink); transition: width .35s ease; }
        .seg-retrieved { background: var(--brand); transition: width .35s ease; }
        .seg-unverified { background: var(--danger-ink); transition: width .35s ease; }
        .trust-legend { display: flex; flex-wrap: wrap; gap: 0.375rem; font-size: 0.6875rem; font-variant-numeric: tabular-nums; }
        .leg-ok { color: var(--ok-ink); }
        .leg-info { color: var(--brand); }
        .leg-bad { color: var(--danger-ink); }

        .exec-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.375rem; margin: 0; }
        .exec-strip div { display: grid; gap: 0.0625rem; padding: 0.3125rem 0.4375rem; border: 1px solid var(--line-soft); border-radius: 0.25rem; background: var(--surface); min-width: 0; }
        .exec-strip dt { color: var(--dim); font-size: 0.6875rem; text-transform: uppercase; letter-spacing: .05em; }
        .exec-strip dd { margin: 0; color: var(--ink); font-size: 0.75rem; font-weight: 600; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .exec-strip dd.val-bad { color: var(--danger-ink); }
        .gate-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); padding-top: 0.125rem; }
        .gate-label { color: var(--dim); font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
        .gate-pill { padding: 0.0625rem 0.4375rem; border: 1px solid var(--line); border-radius: 0.25rem; font-size: 0.6875rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .gate-pill[data-gate='allowed'] { color: var(--ok-ink); border-color: rgba(78,201,122,.35); background: rgba(78,201,122,.08); }
        .gate-pill[data-gate='blocked'] { color: var(--danger-ink); border-color: rgba(255,107,107,.4); background: rgba(255,107,107,.1); }

        .branch-list { display: grid; gap: 0.375rem; margin: 0; padding: 0; list-style: none; }
        .branch-item { display: grid; gap: 0.1875rem; padding: 0.375rem 0.5rem; border: 1px solid var(--line-soft); border-radius: 0.25rem; background: var(--surface); min-width: 0; }
        .branch-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); }
        .branch-badge { font-size: 0.6875rem; font-weight: 700; color: #e2e8f0; }
        .branch-badge[data-branch='form'] { color: #c084fc; }
        .branch-badge[data-branch='obligation'] { color: var(--warn-ink); }
        .branch-badge[data-branch='model'] { color: #38bdf8; }
        .branch-badge[data-branch='retrieval'] { color: #fb923c; }
        .branch-link { color: var(--brand); font-size: 0.6875rem; font-weight: 600; text-decoration: none; white-space: nowrap; }
        .branch-link:hover { text-decoration: underline; }
        .branch-triggers { color: var(--muted); font-size: 0.6875rem; overflow-wrap: anywhere; }
        .branch-clear { display: grid; gap: 0.25rem; padding: 0.5rem; border: 1px dashed var(--line); border-radius: 0.25rem; color: var(--muted); font-size: 0.6875rem; }
        .branch-clear strong { color: var(--ok-ink); font-size: 0.75rem; }

        @media (max-width: 72rem) {
            .ee-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 44rem) {
            .ee-grid { grid-template-columns: minmax(0, 1fr); }
            .ee-gauge { min-width: 0; width: 100%; }
        }
    `],
})
export class EvidenceEffectivenessPanelComponent {
    readonly view = input.required<EvidenceEffectivenessView>();
    readonly consumerId = input<string>('');

    @ViewChild('filesDialog') private filesDialog?: ElementRef<HTMLDialogElement>;

    /** Open the full retrieval list; `showModal()` gives focus trap, Esc and backdrop for free. */
    openFiles(): void {
        this.filesDialog?.nativeElement.showModal();
    }

    closeFiles(): void {
        this.filesDialog?.nativeElement.close();
    }

    /** A click on the backdrop lands on the dialog itself, never on the panel. */
    onSheetBackdrop(event: MouseEvent): void {
        if (event.target === this.filesDialog?.nativeElement) this.closeFiles();
    }

    stateLabel(state: string): string {
        if (state === 'strong') return 'Strong';
        if (state === 'partial') return 'Partial';
        if (state === 'weak') return 'Weak';
        return 'Not captured';
    }

    formatDuration(ms: number | null): string {
        if (ms === null) return 'n/a';
        if (ms < 1000) return `${ms} ms`;
        return `${(ms / 1000).toFixed(1)} s`;
    }

    formatTokens(total: number | null, estimated: boolean): string {
        if (total === null) return 'n/a';
        const formatted = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
        return estimated ? `${formatted}~` : formatted;
    }
}
