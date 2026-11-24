import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CONTROL_PLANE_API_CLIENT } from '../../../core/tokens.js';
import { GlanceCardsComponent } from './request-detail/components/glance-cards.component.js';
import { GraphPanelComponent } from './request-detail/components/graph-panel.component.js';
import { PipelineFlowComponent } from './request-detail/components/pipeline-flow.component.js';
import { PipelineStepperComponent } from './request-detail/components/pipeline-stepper.component.js';
import { RequestHeroComponent } from './request-detail/components/request-hero.component.js';
import { RulesPanelComponent } from './request-detail/components/rules-panel.component.js';
import { TelemetryPanelComponent } from './request-detail/components/telemetry-panel.component.js';
import { VerdictPanelComponent } from './request-detail/components/verdict-panel.component.js';
import { WaterfallPanelComponent } from './request-detail/components/waterfall-panel.component.js';
import {
    TAB_GLYPH,
    shortIdOf,
    type ActionEventView,
    type EffectivenessView,
    type HostSignalsView,
    type JevView,
    type PipelineStepView,
    type ReceiptVerificationState,
    type RequestDetailWithVerdict,
    type RequestReceiptSummaryDto,
    type SpecRefView,
    type TabKey,
    type TokenSummaryView,
    type TurnVerdictView,
    type WriteGateView,
} from './request-detail/request-detail.models.js';
import { toActionEvents, toFlowSteps, toTraceEvents } from './request-detail/request-detail.selectors.js';

/**
 * Request detail container — it loads one payload, owns the two independent UI selections
 * (`selectedStepId` for evidence, `activeTab` for the drill pane) and wires the panels.
 * No panel markup lives here.
 */
@Component({
    selector: 'eso-request-detail-page',
    standalone: true,
    imports: [MatButtonModule, RouterLink, RequestHeroComponent, GlanceCardsComponent, PipelineStepperComponent, PipelineFlowComponent, WaterfallPanelComponent, VerdictPanelComponent, RulesPanelComponent, GraphPanelComponent, TelemetryPanelComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="detail-page">
            @if (loading()) {
                <p class="loading-label">Loading request…</p>
            } @else if (error(); as message) {
                <section class="error-panel"><strong>Could not open request</strong><span>{{ message }}</span><a mat-stroked-button routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">← Requests</a></section>
            } @else if (detail(); as detail) {
                <nav class="detail-nav">
                    <div class="crumb"><a routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">← Requests</a><span class="crumb-sep">/</span><code>{{ shortId(detail.request.id) }}</code></div>
                    <div class="detail-actions">
                        <a class="pill" routerLink="/office" [queryParams]="{ consumer: consumerId() }">Office 3D</a>
                        <a class="pill" routerLink="/observatory" [queryParams]="{ consumer: consumerId() }">Observatory</a>
                    </div>
                </nav>

                <eso-request-hero [detail]="detail" [verdict]="verdict()" />

                <eso-pipeline-stepper [stages]="detail.systemStages" [selectedStepId]="selectedStepId()" (stepSelected)="selectStep($event)" />

                <eso-pipeline-flow
                    [steps]="flowSteps()"
                    [selectedStepId]="selectedStepId()"
                    [expandedIds]="expandedStepIds()"
                    (stepToggled)="toggleStep($event)"
                    (openTab)="activeTab.set($event)"
                />

                <eso-glance-cards
                    [verdict]="verdict()"
                    [effectiveness]="effectiveness()"
                    [signals]="signals()"
                    [writeGate]="writeGate()"
                    [tokens]="tokenSummary()"
                    [llmCallCount]="detail.telemetry.llmCalls.length"
                    [toolCount]="detail.telemetry.tools.length"
                    [fileCount]="detail.telemetry.files.length"
                />

                <div class="tabs drill-tabs" role="tablist" aria-label="Request detail tabs">
                    @for (tab of tabs; track tab.id) {
                        <button type="button" role="tab" [attr.data-tab]="tab.id" [attr.aria-selected]="activeTab() === tab.id" [class.active]="activeTab() === tab.id" (click)="activeTab.set(tab.id)">
                            <span class="tab-icon" aria-hidden="true">{{ tabGlyph(tab.id) }}</span>
                            <span class="tab-label">{{ tab.label }}</span>
                            <span class="tab-count">{{ tabCount(tab.id) }}</span>
                        </button>
                    }
                </div>

                @if (activeTab() === 'waterfall') {
                    <eso-waterfall-panel [events]="traceEvents()" [files]="detail.telemetry.files" [tools]="detail.telemetry.tools" [llmCalls]="detail.telemetry.llmCalls" (rawEvidenceOpened)="trackRawEvidence()" />
                } @else if (activeTab() === 'topology') {
                    <eso-graph-panel [detail]="detail" />
                } @else if (activeTab() === 'decisions') {
                    <eso-verdict-panel [verdict]="verdict()" [spec]="spec()" [writeGate]="writeGate()" [jev]="jev()" [receipt]="receipt()" [receiptVerification]="receiptVerification()" [checks]="detail.checks" [stages]="detail.pipeline" [actionEvents]="actionEvents()" />
                } @else if (activeTab() === 'rules') {
                    <eso-rules-panel [detail]="detail" />
                } @else if (activeTab() === 'telemetry') {
                    <eso-telemetry-panel [calls]="detail.telemetry.llmCalls" [tokens]="tokenSummary()" [toolCount]="detail.telemetry.tools.length" [fileCount]="detail.telemetry.files.length" />
                }
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .detail-page { --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --line: #253047; --line-soft: #1e2a3e; --ink: #e2e8f0; --muted: #8b97ab; --dim: #64748b; --brand: #5aa9ff; --brand-ink: #ffffff; --warn-ink: #e0b341; --ok-ink: #4ec97a; --danger-ink: #ff6b6b; --fs-h1: 1.625rem; --fs-h1-lg: 1.75rem; --fs-title: 0.875rem; --fs-body: 0.8125rem; --fs-secondary: var(--text-xs); --fs-badge: 0.6875rem; --lh: 1.35; }
        .detail-page { display: grid; gap: var(--space-5); row-gap: var(--space-4); width: 100%; max-width: calc(var(--content-max) + var(--page-pad) * 2); margin: 0 auto; padding: var(--page-pad); box-sizing: border-box; color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .detail-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
        .crumb { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; color: var(--muted); font-size: var(--fs-secondary); }
        .crumb a { color: var(--brand); text-decoration: none; }
        .crumb code { color: var(--brand); overflow-wrap: anywhere; }
        .crumb-sep { color: var(--dim); }
        .detail-actions { display: flex; gap: var(--space-2); }
        .pill { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: 62.44rem; background: var(--surface-3); color: #cbd5e1; font-size: var(--fs-secondary); line-height: 1.6; text-decoration: none; }
        .pill:hover { border-color: var(--brand); color: #ffffff; }
        .tabs { display: flex; width: 100%; gap: 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
        .tabs button { display: inline-flex; flex: 1 1 0; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font: inherit; font-size: var(--fs-secondary); font-weight: 600; cursor: pointer; white-space: nowrap; }
        .tabs button:hover { color: var(--ink); }
        .tabs button:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .tabs button.active { border-color: var(--brand); color: var(--brand); }
        .drill-tabs button[data-tab='waterfall'].active { border-color: var(--ok-ink); color: var(--ok-ink); }
        .drill-tabs button[data-tab='topology'].active { border-color: var(--brand); color: var(--brand); }
        .drill-tabs button[data-tab='decisions'].active { border-color: #c084fc; color: #c084fc; }
        .drill-tabs button[data-tab='rules'].active { border-color: var(--warn-ink); color: var(--warn-ink); }
        .drill-tabs button[data-tab='telemetry'].active { border-color: #818cf8; color: #818cf8; }
        .tab-icon { display: grid; place-items: center; width: 1.125rem; height: 1.125rem; border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--fs-badge); line-height: 1; }
        .tabs button.active .tab-icon { border-color: currentColor; background: rgba(90,169,255,.12); color: inherit; }
        .tab-label { font-size: var(--fs-secondary); }
        .tab-count { padding: .0625rem var(--space-1); border-radius: 62.44rem; background: var(--surface-2); color: var(--muted); font-size: var(--fs-badge); font-variant-numeric: tabular-nums; }
        .tabs button.active .tab-count { color: inherit; }
        .loading-label { color: var(--muted); }
        .error-panel { display: grid; gap: var(--space-2); padding: var(--space-5); border: 1px solid var(--line); border-radius: var(--radius-md); color: var(--muted); }
        .error-panel strong { color: var(--ink); }
    `],
})
export class RequestDetailPage implements OnInit {
    private readonly api = inject(CONTROL_PLANE_API_CLIENT, { optional: true });
    private readonly route = inject(ActivatedRoute);
    /** V2 telemetry: one in-memory session id per page load, never persisted. */
    private readonly uiSession = crypto.randomUUID();
    /** Guards against double-load races (route + query subscriptions) re-verifying or overwriting. */
    private loadSeq = 0;

    readonly loading = signal(true);
    readonly error = signal('');
    readonly consumerId = signal('');
    readonly detail = signal<RequestDetailWithVerdict | null>(null);
    readonly activeTab = signal<TabKey>('waterfall');
    readonly selectedStepId = signal<string | null>(null);
    /** Per-step disclosure override; unset follows the step's own empty state. */
    readonly stepOpen = signal<Record<string, boolean>>({});
    readonly receiptVerification = signal<ReceiptVerificationState>('unavailable');
    readonly requestId = signal(decodeURIComponent(this.route.snapshot.paramMap.get('requestId') || ''));
    readonly tabs = [
        { id: 'waterfall' as const, label: 'Execution & Waterfall' },
        { id: 'topology' as const, label: 'Graphs & Topology' },
        { id: 'decisions' as const, label: 'Verdict & gaps' },
        { id: 'rules' as const, label: 'Rules & Context' },
        { id: 'telemetry' as const, label: 'Telemetry & Trace' },
    ];

    readonly traceEvents = computed(() => toTraceEvents(this.detail()?.events ?? []));
    readonly flowSteps = computed<PipelineStepView[]>(() => toFlowSteps(this.detail()?.systemStages ?? []));
    readonly actionEvents = computed<ActionEventView[]>(() => toActionEvents(this.detail()?.events ?? []));
    readonly tokenSummary = computed<TokenSummaryView>(() => {
        const metrics = this.detail()?.requestMetrics;
        return { input: metrics?.inputTokens ?? null, output: metrics?.outputTokens ?? null, estimated: metrics?.tokensEstimated === true };
    });

    /** P2 — ESO's adjudication of this turn; never derived from prompt text or worker status. */
    readonly verdict = computed<TurnVerdictView | null>(() => this.detail()?.verdict ?? null);
    /** P6c — host-reported signals; `null` means the host reported nothing for this turn. */
    readonly signals = computed<HostSignalsView | null>(() => this.detail()?.signals ?? null);
    /** Pipeline v2 — the backend tally; `null` means this payload predates or omits the field. */
    readonly effectiveness = computed<EffectivenessView | null>(() => this.detail()?.effectiveness ?? null);
    /** Pipeline v2 — the JEV decision recorded for this turn; never derived from the verdict. */
    readonly jev = computed<JevView | null>(() => this.detail()?.jev ?? null);
    /** Write gate — the latest recorded scope decision; never derived from the verdict. */
    readonly writeGate = computed<WriteGateView | null>(() => this.detail()?.writeGate ?? null);
    /** B0-9 — the normative doc reference; a pointer only, never the doc's prose. */
    readonly spec = computed<SpecRefView | null>(() => this.detail()?.spec ?? null);
    /** P5a — receipt summary for Q5; absent on payloads that predate the field, never fabricated. */
    readonly receipt = computed<RequestReceiptSummaryDto | null>(() => this.detail()?.receipt ?? null);

    readonly expandedStepIds = computed<ReadonlySet<string>>(() => {
        const open = new Set<string>();
        for (const step of this.flowSteps()) {
            const override = this.stepOpen()[step.id];
            if (override === undefined ? !step.empty : override) open.add(step.id);
        }
        return open;
    });

    ngOnInit(): void {
        this.trackSurface('surface.request.open');
        // BUG-30: the id must be observed, not frozen at first render.
        this.route.paramMap.subscribe((params) => {
            const next = decodeURIComponent(params.get('requestId') || '');
            if (next === this.requestId()) return;
            this.requestId.set(next);
            void this.load();
        });
        this.route.queryParamMap.subscribe((query) => {
            const next = query.get('consumer') || 'fineso';
            if (next === this.consumerId()) return;
            this.consumerId.set(next);
            void this.load();
        });
        void this.load();
    }

    /** Stepper click — select + expand + scroll. It never changes the tab. */
    selectStep(id: string): void {
        this.selectedStepId.set(id);
        this.stepOpen.update((map) => ({ ...map, [id]: true }));
        this.scrollToStep(id);
    }

    toggleStep(step: PipelineStepView): void {
        const open = this.expandedStepIds().has(step.id);
        this.stepOpen.update((map) => ({ ...map, [step.id]: !open }));
    }

    private scrollToStep(id: string): void {
        if (typeof document === 'undefined') return;
        requestAnimationFrame(() => document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }

    tabCount(tab: TabKey): number {
        const detail = this.detail();
        if (!detail) return 0;
        if (tab === 'waterfall') return this.traceEvents().length;
        if (tab === 'topology') return detail.pipeline.filter((stage) => stage.status !== 'PENDING').length;
        if (tab === 'decisions') return detail.checks.length;
        if (tab === 'rules') return 1;
        return detail.telemetry.llmCalls.length;
    }

    readonly tabGlyph = (id: TabKey): string => TAB_GLYPH[id] ?? '·';
    readonly shortId = shortIdOf;

    /** V2 telemetry — fire-and-forget; a beacon failure must never block or surface in the UI. */
    private trackSurface(surface: string): void {
        if (!this.api) return;
        const consumerId = this.consumerId() || this.route.snapshot.queryParamMap.get('consumer') || null;
        void this.api.postUiEvent({ surface, consumerId, session: this.uiSession }).catch(() => undefined);
    }

    /** V2 raw proxy — expanding the raw evidence JSON is the "raw log" signal. */
    private trackRawEvidence(): void {
        if (!this.api) return;
        void this.api.postUiEvent({ surface: 'raw.evidence.expand', consumerId: this.consumerId() || null, session: this.uiSession }).catch(() => undefined);
    }

    private async load(): Promise<void> {
        const seq = ++this.loadSeq;
        if (!this.api) { this.error.set('API client unavailable'); this.loading.set(false); return; }
        const query = this.route.snapshot.queryParamMap;
        this.consumerId.set(query.get('consumer') || 'fineso');
        // Q5 — a new load invalidates the previous verdict; nothing is claimed verified until re-checked.
        this.receiptVerification.set('unavailable');
        this.selectedStepId.set(null);
        this.stepOpen.set({});
        let loaded: RequestDetailWithVerdict | null = null;
        try {
            loaded = await this.api.getRequestDetail(this.consumerId(), this.requestId());
            if (seq !== this.loadSeq) return;
            this.detail.set(loaded);
        } catch (error) {
            if (seq !== this.loadSeq) return;
            this.error.set((error as { detail?: string; message?: string })?.detail || (error as Error)?.message || 'Unable to load request');
        } finally {
            if (seq === this.loadSeq) this.loading.set(false);
        }
        const receiptId = loaded?.receipt?.receiptId ?? loaded?.verdict?.receiptId ?? '';
        if (receiptId) await this.verifyReceipt(seq, receiptId);
    }

    /** Q5 — one verify per loaded request; a failed call is "unavailable", never "verified". */
    private async verifyReceipt(seq: number, receiptId: string): Promise<void> {
        if (!this.api) return;
        try {
            const result = await this.api.verifyReceipt(this.consumerId(), receiptId);
            if (seq !== this.loadSeq) return;
            this.receiptVerification.set(result.ok && result.hashMatches ? 'verified' : 'failed');
        } catch {
            if (seq !== this.loadSeq) return;
            this.receiptVerification.set('unavailable');
        }
    }
}
