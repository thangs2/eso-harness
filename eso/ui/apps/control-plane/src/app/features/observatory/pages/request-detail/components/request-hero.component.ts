import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { SectionHintComponent, type SectionHintItem } from '../../../../../shared/section-hint.component.js';
import { actorIdOf, formatAt, shortIdOf, type RequestDetailWithVerdict, type TurnVerdictView } from '../request-detail.models.js';

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
                        <p class="eyebrow">Prompt request · {{ value('flowId') }}</p>
                        <h1 class="request-query">{{ queryText() }}</h1>
                    </div>
                    <div class="badges hero-badges">
                        <span class="badge status-badge" [class.ok]="status() === 'completed'" [class.warn]="status() === 'failed'" [class.bad]="status() === 'blocked'"><span class="status-dot" aria-hidden="true"></span>{{ status() }}</span>
                        @if (verdict(); as v) { <span class="badge verdict-badge" [class]="'level-' + v.level">{{ v.level }}</span> } @else { <span class="badge muted">unknown</span> }
                        <span class="badge muted">{{ value('taskType') }}</span>
                        <span class="badge muted">{{ eventCount() }} events</span>
                        @if (failureKind()) { <span class="badge warn">{{ failureKind() }}</span> }
                        <eso-section-hint [summary]="hint.summary" [items]="hint.items" />
                    </div>
                </div>
                <p class="hero-meta">
                    <span class="meta-fact"><span class="meta-key">Started</span>{{ formatAt(request.at) }}</span>
                    <span class="meta-fact"><span class="meta-key">Duration</span>{{ duration() }}</span>
                    <span class="meta-fact"><span class="meta-key">Host</span>{{ request.hostId || '—' }}</span>
                    <span class="meta-fact"><span class="meta-key">Runtime</span>{{ request.runtimeKey || '—' }}</span>
                    <span class="meta-fact"><span class="meta-key">Model</span>{{ value('model') === '—' ? 'not captured' : value('model') }}</span>
                    <span class="meta-fact"><span class="meta-key">Actor</span>{{ actor() }}</span>
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
                            <div class="identity-cell"><dt>Request hash</dt><dd><code>{{ value('requestHash') }}</code></dd></div>
                            <div class="identity-cell"><dt>Request length</dt><dd>{{ value('requestLength') }} chars</dd></div>
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
        .eyebrow { color: var(--dim); font-size: var(--fs-badge); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
        .hero-head { display: flex; align-items: flex-start; gap: var(--space-3); flex-wrap: wrap; }
        .hero-copy { display: grid; gap: var(--space-1); flex: 1 1 32rem; min-width: 0; }
        .hero-badges { margin-left: auto; justify-content: flex-end; }
        .badges { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
        .badge { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 1.25rem; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: #cbd5e1; font-size: var(--fs-badge); line-height: 1.2; font-weight: 500; white-space: nowrap; }
        .badge.ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); background: rgba(78,201,122,.15); }
        .badge.warn { color: #fde68a; border-color: rgba(224,179,65,.45); background: rgba(224,179,65,.12); }
        .badge.bad { color: #fecaca; border-color: rgba(255,107,107,.4); background: rgba(255,107,107,.2); }
        .badge.muted { color: var(--muted); background: var(--surface-2); }
        .level-allow, .level-partial, .level-deny, .level-unknown { border-width: 1px; border-style: solid; }
        .level-allow { color: #4ec97a; }
        .level-partial { color: #e0b341; }
        .level-deny { color: #ff6b6b; }
        .level-unknown { color: var(--muted); }
        .status-dot { display: inline-block; width: .4375rem; height: .4375rem; border-radius: 50%; background: currentColor; }
        .request-query { font-size: var(--fs-h1); line-height: 1.2; font-weight: 650; letter-spacing: -.01em; color: #f1f5f9; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
        .hero-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); color: #cbd5e1; font-size: var(--fs-secondary); }
        .meta-fact { display: inline-flex; align-items: baseline; gap: var(--space-1); }
        .meta-fact + .meta-fact::before { content: '·'; margin-right: var(--space-1); color: var(--dim); }
        .meta-key { color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
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
        .identity-cell dt { color: var(--dim); font-size: var(--fs-badge); letter-spacing: .06em; text-transform: uppercase; }
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
    readonly hint: { summary: string; items: SectionHintItem[] } = {
        summary: 'One immutable request/trace: the prompt, its host facts, and the badges that summarise what ESO could observe.',
        items: [
            { label: 'status', text: 'submitted: only the prompt exists. completed: a completion event exists. failed/blocked: the host reported a failure or a scope block.' },
            { label: 'verdict badge', text: 'The Q1 verdict level. It is explained in Turn verdict below; the badge is a shortcut, not a second rule.' },
            { label: 'events', text: 'How many observations belong to this trace. More events usually means richer evidence.' },
            { label: 'meta line', text: 'Started / duration / host / runtime / model / actor come from observations. "not captured" means the host sent no value; ESO does not estimate.' },
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
