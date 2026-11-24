import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { formatAt as formatDateAt, workerLabel as labelForWorker, type ObservationDto } from '../request-detail.models.js';

/** Execution waterfall — the event table plus filter chips. No right rail. */
@Component({
    selector: 'eso-waterfall-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="panel waterfall">
            <div class="waterfall-toolbar">
                <div class="chips"><button type="button" class="chip" [class.on]="!eventQuery()" (click)="eventQuery.set('')">All</button><button type="button" class="chip" [class.on]="eventQuery() === 'FAIL'" (click)="eventQuery.set('FAIL')">Failures</button><button type="button" class="chip" [class.on]="eventQuery() === 'prompt.submitted'" (click)="eventQuery.set('prompt.submitted')">Requests</button></div>
                <div class="wf-summary"><span class="summary-chip">Files <strong>{{ fileCount() }}</strong></span><span class="summary-chip">Tool calls <strong>{{ toolCount() }}</strong></span><span class="summary-chip">LLM calls <strong>{{ llmCallCount() }}</strong></span></div>
                <input class="search" [value]="eventQuery()" (input)="onQueryInput($event)" placeholder="Filter event / worker…">
            </div>
            <div class="event-table-head" aria-hidden="true"><span>Time</span><span>Event</span><span>Worker</span><span>Outcome</span><span>Duration</span></div>
            @for (event of waterfallEvents(); track event.observationId) {
                <article class="event-row" [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'">
                    <div class="event-grid">
                        <time [title]="formatAt(event.at)">{{ formatClock(event.at) }}</time>
                        <code [title]="event.event">{{ event.event }}</code>
                        <span class="event-worker" [title]="event.workerId || '—'">{{ workerLabel(event.workerId) }}</span>
                        <span class="badge" [class.ok]="event.outcome === 'PASS' || event.outcome === 'COMPLETED'" [class.bad]="event.outcome === 'FAIL' || event.outcome === 'BLOCKED'">{{ event.outcome || '—' }}</span>
                        <span class="event-duration">{{ eventDuration(event) }}</span>
                    </div>
                    <details class="event-evidence" (toggle)="onEvidenceToggle($event)"><summary>Evidence</summary><pre>{{ evidenceText(event.evidence) }}</pre></details>
                </article>
            } @empty {
                <p class="hint waterfall-empty">{{ eventQuery() ? 'No events match this filter.' : 'No events recorded for this request.' }}</p>
            }
        </section>
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --danger-ink: #ff6b6b; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        .panel { display: grid; align-content: start; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface); min-width: 0; box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        .hint { color: var(--muted); font-size: var(--fs-secondary); }
        .waterfall { gap: var(--space-1); }
        .waterfall-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); padding-bottom: var(--space-1); border-bottom: 1px solid var(--line-soft); }
        .chips { display: flex; gap: var(--space-1); }
        .chip { padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--muted); font: inherit; font-size: var(--fs-badge); line-height: 1.6; cursor: pointer; }
        .chip.on { border-color: rgba(90,169,255,.5); background: rgba(90,169,255,.12); color: var(--brand); }
        .chip:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        .wf-summary { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-left: auto; }
        .summary-chip { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--fs-badge); white-space: nowrap; }
        .summary-chip strong { color: #cbd5e1; font-variant-numeric: tabular-nums; }
        .search { width: 12rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--fs-secondary); line-height: 1.6; }
        .event-table-head, .event-grid { display: grid; grid-template-columns: 5.5rem minmax(0, 2fr) 7rem 6rem 4.5rem; gap: var(--space-2); align-items: center; }
        .event-table-head { padding: var(--space-1) 0; border-bottom: 1px solid var(--line); color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .event-row { padding: 0; border-bottom: 1px solid var(--line-soft); }
        .event-row:last-child { border-bottom: 0; }
        .event-grid { min-height: 1.75rem; padding: var(--space-1) 0; }
        .event-grid time { color: var(--dim); font-size: var(--fs-secondary); font-variant-numeric: tabular-nums; }
        .event-grid code { color: var(--brand); font-size: var(--fs-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .event-worker { color: #cbd5e1; font-size: var(--fs-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .event-duration { color: var(--muted); font-size: var(--fs-secondary); text-align: right; font-variant-numeric: tabular-nums; }
        .event-row.bad .event-grid code { color: var(--danger-ink); }
        .badge { display: inline-flex; align-items: center; min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); white-space: nowrap; }
        .badge.ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); }
        .badge.bad { color: #fecaca; border-color: rgba(255,107,107,.4); }
        .event-evidence { padding: 0 0 var(--space-1) 5.5rem; }
        .event-evidence summary { color: var(--muted); font-size: var(--fs-secondary); cursor: pointer; }
        .waterfall-empty { margin: 0; padding: var(--space-2) 0; }
        pre { max-height: 18rem; overflow: auto; margin: 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-secondary); line-height: var(--lh); white-space: pre-wrap; }
        @media (max-width: 47.9375rem) { .event-table-head, .event-grid { grid-template-columns: 4.5rem minmax(0, 1fr) 5rem 4.5rem; } .event-table-head span:nth-child(4), .event-grid .badge { display: none; } .event-table-head span:nth-child(3), .event-grid .event-worker { display: none; } }
    `],
})
export class WaterfallPanelComponent {
    readonly events = input<ObservationDto[]>([]);
    readonly fileCount = input<number>(0);
    readonly toolCount = input<number>(0);
    readonly llmCallCount = input<number>(0);
    readonly rawEvidenceOpened = output<void>();

    readonly eventQuery = signal('');

    readonly waterfallEvents = computed(() => {
        const query = this.eventQuery().trim().toLowerCase();
        if (!query) return this.events();
        return this.events().filter((event) => [event.event, event.workerId, event.outcome, String((event.evidence as Record<string, unknown> | null)?.['errorCode'] || '')].some((value) => String(value || '').toLowerCase().includes(query)));
    });

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
}
