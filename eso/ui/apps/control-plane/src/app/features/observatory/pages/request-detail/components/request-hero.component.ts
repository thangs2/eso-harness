import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { SectionHintComponent, type SectionHintItem } from '../../../../../shared/section-hint.component.js';
import { statusTone, verdictTone, type Tone } from '../../../../../shared/status-tone.js';
import { actorIdOf, formatAt, shortIdOf, type RequestDetailWithVerdict, type TurnVerdictView } from '../request-detail.models.js';

/** One header chip: what it is (`label`), what it says (`value`), and how to read it (`tone`). */
interface HeroChip {
    label: string;
    value: string;
    tone: Tone;
    title: string;
}

/**
 * Request hero — prompt identity only. It never owns page state beyond the copy affordance:
 * status/verdict badges, one meta line, and the collapsible identity grid.
 */
@Component({
    selector: 'eso-request-hero',
    standalone: true,
    imports: [SectionHintComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (request(); as request) {
            <header class="request-hero">
                <div class="hero-head">
                    <div class="hero-copy">
                        <p class="eyebrow">Prompt request@if (value('flowId') !== '—') {<span class="eyebrow-flow"> · {{ value('flowId') }}</span>}</p>
                        <h1 class="request-query">{{ queryText() }}</h1>
                    </div>
                    <div class="badges hero-badges">
                        @for (item of chips(); track item.label) {
                            <span class="chip" [class]="'tone-' + item.tone" [attr.title]="item.title">
                                <span class="chip-dot" aria-hidden="true"></span>
                                <span class="chip-label">{{ item.label }}</span>
                                <span class="chip-value">{{ item.value }}</span>
                            </span>
                        }
                        <eso-section-hint [summary]="hint.summary" [items]="hint.items" />
                    </div>
                </div>
                <p class="hero-meta">
                    <span class="meta-fact"><span class="meta-key">Started</span><span class="meta-value">{{ formatAt(request.at) }}</span></span>
                    <span class="meta-fact"><span class="meta-key">Duration</span><span class="meta-value">{{ duration() }}</span></span>
                    <span class="meta-fact" [class.is-unknown]="!request.hostId"><span class="meta-key">Host</span><span class="meta-value">{{ request.hostId || 'not captured' }}</span></span>
                    <span class="meta-fact" [class.is-unknown]="!request.runtimeKey"><span class="meta-key">Runtime</span><span class="meta-value">{{ request.runtimeKey || 'not captured' }}</span></span>
                    <span class="meta-fact" [class.is-unknown]="value('model') === '—'"><span class="meta-key">Model</span><span class="meta-value">{{ value('model') === '—' ? 'not captured' : value('model') }}</span></span>
                    <span class="meta-fact" [class.is-unknown]="actor() === UNKNOWN_ACTOR"><span class="meta-key">Actor</span><span class="meta-value">{{ actor() }}</span></span>
                </p>
                <details class="identity-details">
                    <summary class="identity-summary">
                        <span class="identity-title">Identity</span>
                        <code class="identity-locator" [title]="request.observationId">{{ shortId(request.observationId) }}</code>
                        <span class="identity-hint">id · hash · length · flow</span>
                        <span class="chevron" aria-hidden="true">▸</span>
                    </summary>
                    <div class="identity-body">
                        <p class="policy-note">Prompt body is captured at operator request. Content may contain sensitive data and is shown read-only.</p>
                        <dl class="identity-grid">
                            <div class="identity-cell"><dt>Request ID</dt><dd><code>{{ request.observationId }}</code> <button type="button" class="copy-path" (click)="copyRequestId(request.observationId)" [attr.aria-label]="requestIdCopied() ? 'Request id copied' : 'Copy request id'">{{ requestIdCopied() ? 'copied' : 'copy' }}</button></dd></div>
                            <div class="identity-cell"><dt>Request hash</dt><dd><code>{{ value('promptHash') !== '—' ? value('promptHash') : value('requestHash') }}</code></dd></div>
                            <div class="identity-cell"><dt>Request length</dt><dd>{{ value('promptLength') !== '—' ? value('promptLength') : value('requestLength') }} chars</dd></div>
                            <div class="identity-cell"><dt>Worker</dt><dd>{{ request.workerId || '—' }}</dd></div>
                            <div class="identity-cell"><dt>Runtime</dt><dd>{{ request.runtimeKey }}</dd></div>
                            <div class="identity-cell"><dt>Host</dt><dd>{{ request.hostId }}</dd></div>
                            <div class="identity-cell"><dt>Task type</dt><dd>{{ value('taskType') }}</dd></div>
                            <div class="identity-cell"><dt>Model / adapter</dt><dd>{{ value('model') }} · {{ value('adapter') }}</dd></div>
                            <div class="identity-cell"><dt>Flow</dt><dd>{{ value('flowId') }}</dd></div>
                        </dl>
                    </div>
                </details>
            </header>
        }
    `,
    styles: [`
        :host { display: block; --brand: #5aa9ff; --muted: #8b97ab; --dim: #64748b; --line: #253047; --line-soft: #1e2a3e; --surface: #131722; --surface-2: #0d1118; --surface-3: #0f1a2b; --ink: #e2e8f0; --fs-title: .875rem; --fs-body: .8125rem; --fs-secondary: var(--text-xs); --fs-badge: .6875rem; --lh: 1.35; }
        .request-hero { display: grid; gap: var(--space-2); padding: var(--space-4) var(--space-5); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--surface); box-shadow: 0 1px 2px rgba(0,0,0,.35); color: var(--ink); font-size: var(--fs-body); line-height: var(--lh); }
        h1, p, dl, dd, dt { margin: 0; }
        .eyebrow { color: var(--muted); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .eyebrow-flow { color: var(--brand); }
        .hero-head { display: flex; align-items: flex-start; gap: var(--space-3); flex-wrap: wrap; }
        .hero-copy { display: grid; gap: var(--space-1); flex: 1 1 32rem; min-width: 0; }
        .hero-badges { margin-left: auto; justify-content: flex-end; }
        .badges { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
        /* A chip is label + value, so the value never appears without saying what it is. Tone is carried by
           the dot, the border and the value colour; the label stays neutral for a stable reading order. */
        .chip { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.5rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); font-size: var(--fs-badge); line-height: 1.2; white-space: nowrap; }
        .chip-label { color: var(--muted); font-weight: 500; }
        .chip-label::after { content: ':'; margin-left: .0625rem; }
        .chip-value { color: #cbd5e1; font-weight: 600; }
        .chip-dot { display: inline-block; width: .4375rem; height: .4375rem; border-radius: 50%; background: currentColor; flex: none; }
        .tone-ok { color: #4ec97a; border-color: rgba(78,201,122,.45); background: rgba(78,201,122,.12); }
        .tone-ok .chip-value { color: #86efac; }
        .tone-warn { color: #e0b341; border-color: rgba(224,179,65,.45); background: rgba(224,179,65,.12); }
        .tone-warn .chip-value { color: #fde68a; }
        .tone-bad { color: #ff6b6b; border-color: rgba(255,107,107,.45); background: rgba(255,107,107,.14); }
        .tone-bad .chip-value { color: #fecaca; }
        .tone-muted { color: var(--dim); border-color: var(--line); background: var(--surface-2); }
        .tone-muted .chip-value { color: var(--muted); }
        .request-query { font-size: var(--fs-h1); line-height: 1.2; font-weight: 650; letter-spacing: -.01em; color: #f1f5f9; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
        .hero-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); color: #cbd5e1; font-size: var(--fs-secondary); }
        .meta-fact { display: inline-flex; align-items: baseline; gap: var(--space-1); }
        .meta-fact + .meta-fact::before { content: '·'; margin-right: var(--space-1); color: var(--dim); }
        .meta-fact.is-unknown .meta-key, .meta-fact.is-unknown .meta-value { color: var(--muted); font-style: italic; }
        .meta-key { color: var(--muted); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .identity-details { border-top: 1px solid var(--line-soft); padding-top: var(--space-2); }
        .identity-summary { display: flex; align-items: center; gap: var(--space-2); cursor: pointer; color: var(--muted); font-size: var(--fs-secondary); list-style: none; }
        .identity-summary::-webkit-details-marker { display: none; }
        .identity-title { color: #cbd5e1; font-weight: 600; }
        .identity-locator { color: var(--brand); overflow-wrap: anywhere; }
        .identity-hint { color: var(--dim); font-size: var(--fs-badge); }
        .chevron { color: var(--muted); font-size: var(--fs-secondary); line-height: 1; }
        .identity-summary .chevron { margin-left: auto; transition: transform .15s ease; }
        .identity-details[open] .identity-summary .chevron { transform: rotate(90deg); }
        .identity-body { display: grid; gap: var(--space-2); padding-top: var(--space-2); }
        .policy-note { padding: var(--space-2); border: 1px solid var(--line-soft); border-left: 3px solid #e0b341; border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--fs-secondary); }
        .identity-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); }
        .identity-cell { display: grid; gap: .0625rem; min-width: 0; }
        .identity-cell dt { color: var(--muted); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
        .identity-cell dd { color: #cbd5e1; font-size: var(--fs-secondary); overflow-wrap: anywhere; }
        .identity-cell code { color: var(--brand); }
        .identity-cell button { padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-3); color: var(--muted); font: inherit; font-size: var(--fs-badge); line-height: 1.6; cursor: pointer; }
        .identity-cell button:hover { border-color: var(--brand); color: #ffffff; }
        .identity-cell button:focus-visible { outline: .125rem solid var(--brand); outline-offset: -.125rem; }
        @media (max-width: 74.9375rem) { .identity-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (min-width: 75rem) { .request-query { font-size: var(--fs-h1-lg); } }
        @media (max-width: 47.9375rem) { .identity-grid { grid-template-columns: minmax(0, 1fr); } }
    `],
})
export class RequestHeroComponent {
    /** Shared with the template so the "actor was not reported" test is written once. */
    readonly UNKNOWN_ACTOR = 'unknown actor';

    readonly hint: { summary: string; items: SectionHintItem[] } = {
        summary: 'One immutable request/trace: the prompt, its host facts, and the badges that summarise what ESO could observe.',
        items: [
            { label: 'Status', text: 'submitted: only the prompt exists. in progress: worker events without an outcome yet. completed: a PASS outcome exists. failed/blocked: the host reported FAIL or BLOCKED.' },
            { label: 'Verdict', text: 'The Q1 verdict level: allow (green), partial (amber), deny (red), unknown (grey). It is explained in Turn verdict below; the chip is a shortcut, not a second rule.' },
            { label: 'Task', text: 'The host-reported task type. "not captured" means the host sent no value — ESO does not guess one.' },
            { label: 'Events', text: 'How many observations belong to this trace. More events usually means richer evidence.' },
            { label: 'Failure', text: 'Only shown when a failure was observed: the kind the host classified (e.g. INFRA).' },
            { label: 'meta line', text: 'Started / duration / host / runtime / model / actor come from observations. Items shown in italics marked "not captured" were not sent by the host; ESO does not estimate.' },
            { label: 'identity', text: 'Observation id, request hash and length prove which bytes were observed. The prompt body is shown read-only and may be sensitive.' },
        ],
    };
    readonly detail = input.required<RequestDetailWithVerdict>();
    readonly verdict = input<TurnVerdictView | null>(null);

    readonly requestIdCopied = signal(false);
    readonly request = computed(() => {
        const request = this.detail().request;
        return {
            observationId: request.id,
            at: request.startedAt,
            hostId: request.hostId,
            runtimeKey: request.runtimeKey,
            workerId: request.workerId,
        };
    });

    readonly status = computed(() => this.detail().request.status || 'unknown');
    /**
     * The header chips, in reading order: status, verdict, task, events, failure.
     * A missing observation renders "not captured" rather than "—", so a chip never shows a dash whose
     * meaning the reader has to infer; the tooltip repeats what the value was derived from.
     */
    readonly chips = computed<HeroChip[]>(() => {
        const status = this.status();
        const verdict = this.verdict();
        const taskType = this.value('taskType');
        const failureKind = this.failureKind();
        const chips: HeroChip[] = [
            { label: 'status', value: status, tone: statusTone(status), title: `Host-reported request status: ${status}` },
            verdict
                ? { label: 'verdict', value: verdict.level, tone: verdictTone(verdict.level), title: `Q1 verdict: ${verdict.level} — ${verdict.basis || 'no basis recorded'}` }
                : { label: 'verdict', value: 'unknown', tone: 'muted', title: 'No turn verdict was sealed for this trace' },
            taskType === '—'
                ? { label: 'task', value: 'not captured', tone: 'muted', title: 'The host sent no task type for this request' }
                : { label: 'task', value: taskType, tone: 'muted', title: `Host-reported task type: ${taskType}` },
            { label: 'events', value: String(this.eventCount()), tone: 'muted', title: 'Observations belonging to this trace' },
        ];
        if (failureKind) {
            chips.push({ label: 'failure', value: failureKind, tone: 'bad', title: `Failure kind reported by the host: ${failureKind}` });
        }
        return chips;
    });

    readonly queryText = computed(() => {
        const value = this.detail().request.userQuery;
        return value && value.trim() ? value.trim() : 'Prompt body was not captured for this legacy request.';
    });
    readonly eventCount = computed(() => this.detail().events.length);
    readonly duration = computed(() => {
        const request = this.detail().request;
        const ms = Math.max(0, new Date(request.endedAt).getTime() - new Date(request.startedAt).getTime());
        return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 60000 ? 1 : 0)} s`;
    });
    readonly failureKind = computed(() => {
        for (const event of this.detail().events) {
            const value = (event.evidence as Record<string, unknown> | null)?.['failureKind'];
            if (value) return String(value);
        }
        return '';
    });
    readonly actor = computed(() => actorIdOf(this.verdict()?.actor ?? null));

    value(key: string): string {
        const request = this.detail().request as unknown as Record<string, unknown>;
        const item = request[key];
        return item === undefined || item === null || item === '' ? '—' : String(item);
    }

    formatAt(value: string): string {
        return formatAt(value);
    }

    shortId(value: string | null | undefined): string {
        return shortIdOf(value);
    }

    /** Header — copies the full request id; a rejected clipboard leaves the button at "copy". */
    copyRequestId(id: string): void {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (!clipboard || typeof clipboard.writeText !== 'function') return;
        void clipboard.writeText(id).then(
            () => this.requestIdCopied.set(true),
            () => this.requestIdCopied.set(false),
        );
    }
}
