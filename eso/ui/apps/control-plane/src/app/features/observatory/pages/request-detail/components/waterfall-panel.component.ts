import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { SectionHintComponent, type SectionHintItem } from '../../../../../shared/section-hint.component.js';
import {
    formatAt as formatDateAt,
    workerLabel as labelForWorker,
    type ObservationDto,
    type RequestLlmCallDto,
} from '../request-detail.models.js';

interface FileRow {
    path: string;
    meta: string;
    title: string;
}

interface ToolRow {
    tool: string;
    count: number;
}

interface LlmRow {
    index: number;
    label: string;
    title: string;
    tokens: number | null;
    estimated: boolean;
    bar: number;
}

/**
 * Execution waterfall — the dense event table plus the legacy right rail. The rail is restored
 * only when at least one of its three datasets exists (files / tool calls / LLM emissions);
 * when all three are empty the rail is not rendered and the table spans the full width.
 */
@Component({
    selector: 'eso-waterfall-panel',
    standalone: true,
    imports: [SectionHintComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="panel waterfall">
            <div class="waterfall-toolbar">
                <div class="chips"><button type="button" class="chip" [class.on]="!eventQuery()" (click)="eventQuery.set('')">All</button><button type="button" class="chip" [class.on]="eventQuery() === 'FAIL'" (click)="eventQuery.set('FAIL')">Failures</button><button type="button" class="chip" [class.on]="eventQuery() === 'prompt.submitted'" (click)="eventQuery.set('prompt.submitted')">Requests</button></div>
                <div class="wf-summary"><span class="summary-chip">Files <strong>{{ fileRows().length }}</strong></span><span class="summary-chip">Tool calls <strong>{{ toolRows().length }}</strong></span><span class="summary-chip">LLM calls <strong>{{ llmRows().length }}</strong></span></div>
                <eso-section-hint [summary]="hint.summary" [items]="hint.items" />
                <input class="search" [value]="eventQuery()" (input)="onQueryInput($event)" placeholder="Filter event / worker…">
            </div>
            <div class="wf-layout" [class.no-rail]="!hasRail()">
                <div class="wf-main">
                    <div class="event-table-head" aria-hidden="true"><span>Time</span><span>Event</span><span>Worker</span><span>Outcome</span><span>Duration</span></div>
                    @for (event of waterfallEvents(); track event.observationId) {
                        <article class="event-row" [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'">
                            <div class="event-grid">
                                <time [title]="formatAt(event.at)">{{ formatClock(event.at) }}</time>
                                <span class="event-main"><span class="event-pill" [attr.data-kind]="eventKind(event)">{{ eventKind(event) }}</span><code [title]="event.event">{{ event.event }}</code></span>
                                <span class="event-worker" [title]="event.workerId || '—'">{{ workerLabel(event.workerId) }}</span>
                                <span class="badge" [class.ok]="event.outcome === 'PASS' || event.outcome === 'COMPLETED'" [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'">{{ event.outcome || '—' }}</span>
                                <span class="event-duration">{{ eventDuration(event) }}</span>
                            </div>
                            <details class="event-evidence" (toggle)="onEvidenceToggle($event)"><summary>Evidence</summary><pre>{{ evidenceText(event.evidence) }}</pre></details>
                        </article>
                    } @empty {
                        <p class="hint waterfall-empty">{{ eventQuery() ? 'No events match this filter.' : 'No events recorded for this request.' }}</p>
                    }
                </div>
                @if (hasRail()) {
                    <aside class="wf-rail" aria-label="Execution context">
                        @if (fileRows().length) {
                            <section class="rail-card">
                                <header class="rail-head"><h3>Files touched ({{ fileRows().length }})</h3><span>reads / edits</span></header>
                                <div class="rail-list">
                                    @for (file of fileRows(); track file.path) {
                                        <div class="rail-row"><code [title]="file.title">{{ file.path }}</code><span class="rail-meta">{{ file.meta }}</span></div>
                                    }
                                </div>
                            </section>
                        }
                        @if (toolRows().length) {
                            <section class="rail-card">
                                <header class="rail-head"><h3>Tool call breakdown ({{ toolRows().length }})</h3></header>
                                <div class="rail-tools">
                                    @for (tool of toolRows(); track tool.tool) {
                                        <span class="tool-chip"><span>{{ tool.tool }}</span><strong>×{{ tool.count }}</strong></span>
                                    }
                                </div>
                            </section>
                        }
                        @if (llmRows().length) {
                            <section class="rail-card">
                                <header class="rail-head"><h3>LLM emissions ({{ llmRows().length }})</h3></header>
                                <div class="rail-list">
                                    @for (call of llmRows(); track call.index) {
                                        <div class="llm-row">
                                            <div class="llm-head"><span [title]="call.title">#{{ call.index }} · {{ call.label }}</span><span class="rail-meta">{{ call.tokens == null ? 'tokens not reported' : (call.estimated ? '~' : '') + call.tokens + ' tok' }}</span></div>
                                            <div class="llm-track"><span class="llm-bar" [style.width.%]="call.bar"></span></div>
                                        </div>
                                    }
                                </div>
                            </section>
                        }
                    </aside>
                }
            </div>
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #38bdf8; --muted: #94a3b8; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --ok-ink: #34d399; --warn-ink: #fbbf24; --danger-ink: #f87171; --fs-table: .75rem; --fs-label: .6875rem; --lh: 1.45; }
        .panel { display: grid; align-content: start; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: .75rem; background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-table); line-height: var(--lh); }
        .hint { color: var(--muted); font-size: var(--fs-label); }
        .waterfall { gap: var(--space-2); }
        .waterfall-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-soft); }
        .chips { display: flex; gap: var(--space-1); }
        .chip { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: .375rem; background: var(--surface-3); color: var(--muted); font: inherit; font-size: var(--fs-label); line-height: 1.7; cursor: pointer; }
        .chip.on { border-color: rgba(52,211,153,.45); background: rgba(52,211,153,.12); color: var(--ok-ink); }
        .chip:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .wf-summary { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-left: auto; }
        .summary-chip { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.375rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: .375rem; background: var(--surface-2); color: var(--muted); font-size: var(--fs-label); white-space: nowrap; }
        .summary-chip strong { color: #cbd5e1; font-variant-numeric: tabular-nums; }
        .search { width: 12rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: .375rem; background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--fs-label); line-height: 1.8; }
        .wf-layout { display: grid; grid-template-columns: minmax(0, 2.4fr) minmax(15rem, 1fr); gap: var(--space-4); align-items: start; }
        .wf-layout.no-rail { grid-template-columns: minmax(0, 1fr); }
        .wf-main { min-width: 0; }
        .event-table-head, .event-grid { display: grid; grid-template-columns: 5rem minmax(0, 2.2fr) 7rem 5.5rem 4.5rem; gap: var(--space-2); align-items: center; }
        .event-table-head { padding: var(--space-1) 0; border-bottom: 1px solid var(--line); color: var(--dim); font-size: var(--fs-label); letter-spacing: .06em; text-transform: uppercase; }
        .event-row { padding: 0; border-bottom: 1px solid var(--line-soft); }
        .event-row:last-child { border-bottom: 0; }
        .event-grid { min-height: 2rem; padding: var(--space-1) 0; }
        .event-grid time { color: var(--dim); font-size: var(--fs-table); font-variant-numeric: tabular-nums; }
        .event-main { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .event-main code { color: #cbd5e1; font-size: var(--fs-table); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .event-pill { flex: 0 0 auto; padding: 0 .375rem; border: 1px solid currentColor; border-radius: .25rem; font-size: var(--fs-label); font-weight: 700; letter-spacing: .06em; line-height: 1.7; }
        .event-pill[data-kind='PROMPT'] { color: #38bdf8; background: rgba(56,189,248,.12); }
        .event-pill[data-kind='TOOL'] { color: #34d399; background: rgba(52,211,153,.12); }
        .event-pill[data-kind='FAIL'] { color: #fbbf24; background: rgba(251,191,36,.12); }
        .event-worker { color: #cbd5e1; font-size: var(--fs-table); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .event-duration { color: var(--muted); font-size: var(--fs-table); text-align: right; font-variant-numeric: tabular-nums; }
        .event-row.bad .event-main code { color: var(--danger-ink); }
        .badge { display: inline-flex; align-items: center; min-height: 1.375rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: .375rem; background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-label); white-space: nowrap; }
        .badge.ok { color: #a7f3d0; border-color: rgba(52,211,153,.3); }
        .badge.bad { color: #fecaca; border-color: rgba(248,113,113,.4); }
        .event-evidence { padding: 0 0 var(--space-1) 5rem; }
        .event-evidence summary { color: var(--muted); font-size: var(--fs-label); cursor: pointer; }
        .waterfall-empty { margin: 0; padding: var(--space-2) 0; }
        .wf-rail { display: grid; gap: var(--space-3); min-width: 0; }
        .rail-card { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-radius: .75rem; background: var(--surface-2); min-width: 0; }
        .rail-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
        .rail-head h3 { margin: 0; color: #cbd5e1; font-size: var(--fs-label); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .rail-head > span { color: var(--dim); font-size: var(--fs-label); }
        .rail-list { display: grid; gap: var(--space-1); max-height: 17.5rem; overflow-y: auto; }
        .rail-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-soft); border-radius: .375rem; background: rgba(19,23,34,.7); }
        .rail-row code { min-width: 0; color: #cbd5e1; font-size: var(--fs-label); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rail-meta { flex: 0 0 auto; color: var(--muted); font-size: var(--fs-label); font-variant-numeric: tabular-nums; }
        .rail-tools { display: flex; flex-wrap: wrap; gap: var(--space-1); }
        .tool-chip { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); border: 1px solid var(--line-soft); border-radius: .375rem; background: rgba(19,23,34,.7); color: #cbd5e1; font-size: var(--fs-label); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .tool-chip strong { color: var(--ok-ink); font-size: var(--fs-label); font-weight: 700; }
        .llm-row { display: grid; gap: .25rem; }
        .llm-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); color: var(--muted); font-size: var(--fs-label); }
        .llm-head > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .llm-track { width: 100%; height: .375rem; overflow: hidden; border-radius: 62.44rem; background: #0a0e17; }
        .llm-bar { display: block; height: 100%; border-radius: 62.44rem; background: linear-gradient(90deg, #a78bfa, #38bdf8); }
        pre { max-height: 18rem; overflow: auto; margin: 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: .375rem; background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-label); line-height: var(--lh); white-space: pre-wrap; }
        @media (max-width: 62.5rem) { .wf-layout { grid-template-columns: minmax(0, 1fr); } .event-table-head, .event-grid { grid-template-columns: 4.5rem minmax(0, 1fr) 6rem 5rem 4rem; } }
        @media (max-width: 47.9375rem) { .event-table-head, .event-grid { grid-template-columns: 4.5rem minmax(0, 1fr) 5rem 4.5rem; } .event-table-head span:nth-child(3), .event-grid .event-worker { display: none; } }
    `],
})
export class WaterfallPanelComponent {
    readonly hint: { summary: string; items: SectionHintItem[] } = {
        summary: 'The raw event ledger for this trace, plus side rails for files, tool calls and LLM emissions. Every row is an observation the host sent.',
        items: [
            { label: 'All / Failures / Requests', text: 'Filter chips. Requests keeps only prompt.submitted; Failures keeps FAIL/BLOCKED outcomes.' },
            { label: 'Files / Tool calls / LLM calls', text: 'Counts of what the host reported. The right rail only renders when at least one of these exists.' },
            { label: 'Time / Event / Worker', text: 'When the observation was recorded, its event name, and which worker reported it. "—" means not reported.' },
            { label: 'Outcome', text: 'PASS/COMPLETED are green; FAIL/BLOCKED are red. An empty outcome means the host sent none.' },
            { label: 'Evidence', text: 'Expand to see the exact JSON the host sent. ESO does not rewrite it; missing keys stay missing.' },
            { label: 'duration', text: 'The duration carried by the observation. It is not recomputed from timestamps.' },
        ],
    };
    readonly events = input<ObservationDto[]>([]);
    readonly files = input<unknown[]>([]);
    readonly tools = input<unknown[]>([]);
    readonly llmCalls = input<RequestLlmCallDto[]>([]);
    readonly rawEvidenceOpened = output<void>();

    readonly eventQuery = signal('');

    readonly fileRows = computed<FileRow[]>(() =>
        this.files().map((item, index) => {
            if (typeof item === 'string') return { path: item, meta: '—', title: item };
            const rec = this.record(item);
            const path = this.text(rec['path']) || this.text(rec['file']) || this.text(rec['name']) || `file ${index + 1}`;
            const actions = this.text(rec['actions']);
            const reads = this.number(rec['reads']);
            const edits = this.number(rec['edits']);
            const meta = actions || (reads != null || edits != null ? `${reads ?? 0}r/${edits ?? 0}e` : '—');
            return { path, meta, title: path };
        }),
    );

    readonly toolRows = computed<ToolRow[]>(() =>
        this.tools().map((item, index) => {
            if (typeof item === 'string') return { tool: item, count: 1 };
            const rec = this.record(item);
            const tool = this.text(rec['tool']) || this.text(rec['name']) || this.text(rec['id']) || `tool ${index + 1}`;
            return { tool, count: this.number(rec['count']) ?? 1 };
        }),
    );

    readonly llmRows = computed<LlmRow[]>(() => {
        const calls = this.llmCalls();
        const totals = calls.map((call) => {
            const values = [call.inputTokens, call.outputTokens].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
            return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
        });
        const max = Math.max(1, ...totals.map((value) => value ?? 0));
        return calls.map((call, index) => ({
            index: index + 1,
            label: call.model || call.adapter || `call ${index + 1}`,
            title: [call.model, call.workerId, call.adapter].filter(Boolean).join(' · '),
            tokens: totals[index],
            estimated: call.estimated === true,
            bar: totals[index] == null ? 0 : Math.max(4, Math.round((totals[index]! / max) * 100)),
        }));
    });

    readonly hasRail = computed(() => this.fileRows().length > 0 || this.toolRows().length > 0 || this.llmRows().length > 0);

    readonly waterfallEvents = computed(() => {
        const query = this.eventQuery().trim().toLowerCase();
        if (!query) return this.events();
        return this.events().filter((event) => [event.event, event.workerId, event.outcome, String((event.evidence as Record<string, unknown> | null)?.['errorCode'] || '')].some((value) => String(value || '').toLowerCase().includes(query)));
    });

    /** The legacy row pill: a prompt event, a fail outcome, or a tool/worker call. */
    eventKind(event: ObservationDto): 'PROMPT' | 'TOOL' | 'FAIL' {
        if (event.outcome === 'FAIL' || event.outcome === 'BLOCKED' || /fail/i.test(event.event)) return 'FAIL';
        if (/prompt|request/i.test(event.event)) return 'PROMPT';
        return 'TOOL';
    }

    workerLabel(id: string | null | undefined): string {
        return labelForWorker(id);
    }

    formatAt(value: string): string {
        return formatDateAt(value);
    }

    /** Waterfall duration — host-reported ms when present, otherwise the observed span, never a guess. */
    eventDuration(event: ObservationDto): string {
        const evidence = (event.evidence as Record<string, unknown> | null) ?? {};
        const reported = evidence['durationMs'];
        if (typeof reported === 'number' && Number.isFinite(reported)) return this.humanDuration(reported);
        const span = new Date(event.receivedAt).getTime() - new Date(event.at).getTime();
        return Number.isFinite(span) && span > 0 ? this.humanDuration(span) : '—';
    }

    /** Waterfall time column — clock only; the full timestamp stays in the tooltip. */
    formatClock(value: string): string {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    }

    evidenceText(value: unknown): string {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }

    humanDuration(ms: number | null | undefined): string {
        if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
        const total = Math.max(0, ms);
        if (total < 1000) return `${total} ms`;
        const seconds = total / 1000;
        if (seconds < 60) return `${seconds.toFixed(1)} s`;
        const minutes = Math.floor(seconds / 60);
        const rest = Math.round(seconds % 60);
        return `${minutes}m ${rest}s`;
    }

    onQueryInput(event: Event): void {
        this.eventQuery.set((event.target as HTMLInputElement).value);
    }

    onEvidenceToggle(event: Event): void {
        if (!(event.target as HTMLDetailsElement)?.open) return;
        this.rawEvidenceOpened.emit();
    }

    private record(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    }

    private text(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }

    private number(value: unknown): number | null {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
}
