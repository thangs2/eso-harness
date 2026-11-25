import { ChangeDetectionStrategy, Component } from '@angular/core';

interface MatrixRow {
    host: string;
    prompt: string;
    mode: 'A' | 'B' | 'SLP' | '—';
    protocol: string;
    target: string;
    tone: 'ok' | 'warn' | 'bad' | 'info';
}

/**
 * Prompt × host × mode × protocol matrix. This is reference material: it is rendered from the
 * documented contract (sdlc/02.governance/01.standard/17.prompt-mode-guideline.md §9) so an operator
 * can see which prompt triggers which execution path from which host before changing placement.
 */
@Component({
    selector: 'eso-prompt-mode-matrix',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <details class="prompt-matrix">
            <summary class="pm-summary">
                <span class="pm-title">
                    <span class="pm-eyebrow">Prompt contract</span>
                    <strong>Which prompt runs which mode from which host</strong>
                </span>
                <span class="pm-hint">mode=A|B · SLP optional · target from placement</span>
                <span class="pm-chevron" aria-hidden="true">▸</span>
            </summary>

            <div class="pm-body">
                <p class="pm-lede">
                    The prompt decides <strong>what runs</strong>; worker placement decides <strong>where</strong>.
                    Never write <code>to=</code> in the prompt — the target is the first allowed host that
                    satisfies the requested mode.
                </p>

                <div class="pm-legend" aria-label="Status legend">
                    <span class="pm-chip ok">hard injector</span>
                    <span class="pm-chip warn">skill-followed</span>
                    <span class="pm-chip info">SLP path</span>
                    <span class="pm-chip bad">rejected</span>
                </div>

                <div class="pm-table-wrap">
                    <table class="pm-table">
                        <thead>
                            <tr><th scope="col">Host</th><th scope="col">Prompt</th><th scope="col">Mode</th><th scope="col">Protocol</th><th scope="col">Target</th><th scope="col">Status</th></tr>
                        </thead>
                        <tbody>
                            @for (row of rows; track row.host + row.prompt) {
                                <tr>
                                    <td data-label="Host"><code>{{ row.host }}</code></td>
                                    <td data-label="Prompt"><code class="pm-prompt">{{ row.prompt }}</code></td>
                                    <td data-label="Mode"><span class="pm-mode" [attr.data-mode]="row.mode">{{ row.mode }}</span></td>
                                    <td data-label="Protocol">{{ row.protocol }}</td>
                                    <td data-label="Target"><code>{{ row.target }}</code></td>
                                    <td data-label="Status"><span class="pm-chip" [class]="row.tone">{{ statusText(row.tone) }}</span></td>
                                </tr>
                            }
                        </tbody>
                    </table>
                </div>

                <div class="pm-notes">
                    <div>
                        <strong>AGY / DSH</strong>
                        <p>A PreInvocation hook injects the exact router command, so the model does not choose whether to route. It still runs the command.</p>
                    </div>
                    <div>
                        <strong>Cursor</strong>
                        <p><code>beforeSubmitPrompt</code> exposes only <code>continue</code>/<code>user_message</code>, so routing stays skill-followed.</p>
                    </div>
                    <div>
                        <strong>SLP + mode</strong>
                        <p>Not wired: the router rejects <code>impl … slp g mode=…</code> instead of dispatching wrongly.</p>
                    </div>
                </div>

                <p class="pm-footnote">
                    Full contract and failure cases: <code>sdlc/02.governance/01.standard/17.prompt-mode-guideline.md</code> §9.
                </p>
            </div>
        </details>
    `,
    styles: [`
        :host { display: block; min-width: 0; }
        .prompt-matrix { border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
        .pm-summary { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); cursor: pointer; list-style: none; }
        .pm-summary::-webkit-details-marker { display: none; }
        .pm-title { display: grid; gap: 1px; min-width: 0; }
        .pm-eyebrow { color: var(--muted); font-size: var(--text-xs); font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
        .pm-title strong { color: var(--ink); font-size: var(--text-sm); }
        .pm-hint { margin-left: auto; color: var(--muted); font-size: var(--text-xs); }
        .pm-chevron { flex: 0 0 auto; color: var(--muted); transition: transform .15s ease; }
        .prompt-matrix[open] .pm-chevron { transform: rotate(90deg); }
        .prompt-matrix[open] .pm-summary { border-bottom: 1px solid var(--line); }
        .pm-summary:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
        .pm-body { display: grid; gap: var(--space-3); padding: var(--space-4); }
        .pm-lede { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.5; }
        .pm-lede code, .pm-table code { color: var(--ink); font-size: var(--text-xs); }
        .pm-legend { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .pm-table-wrap { overflow-x: auto; }
        .pm-table { width: 100%; border-collapse: collapse; font-size: var(--text-xs); }
        .pm-table th { padding: var(--space-2); border-bottom: 1px solid var(--line); color: var(--muted); font-weight: 650; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
        .pm-table td { padding: var(--space-2); border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent); color: var(--muted); vertical-align: top; }
        .pm-prompt { color: var(--ink) !important; white-space: nowrap; }
        .pm-mode { display: inline-grid; place-items: center; min-width: 1.5rem; height: 1.25rem; padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); color: var(--ink); font-size: .6875rem; font-weight: 700; }
        .pm-mode[data-mode='A'] { border-color: color-mix(in srgb, #38bdf8 50%, var(--line)); color: #7dd3fc; }
        .pm-mode[data-mode='B'] { border-color: color-mix(in srgb, #a78bfa 50%, var(--line)); color: #c4b5fd; }
        .pm-mode[data-mode='SLP'] { border-color: color-mix(in srgb, #34d399 45%, var(--line)); color: #6ee7b7; }
        .pm-chip { display: inline-flex; align-items: center; padding: 1px var(--space-2); border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); font-size: .6875rem; font-weight: 650; white-space: nowrap; }
        .pm-chip.ok { border-color: color-mix(in srgb, #34d399 45%, var(--line)); color: #6ee7b7; }
        .pm-chip.warn { border-color: color-mix(in srgb, #fbbf24 45%, var(--line)); color: #fcd34d; }
        .pm-chip.info { border-color: color-mix(in srgb, #38bdf8 45%, var(--line)); color: #7dd3fc; }
        .pm-chip.bad { border-color: color-mix(in srgb, #f87171 45%, var(--line)); color: #fca5a5; }
        .pm-notes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
        .pm-notes > div { display: grid; gap: var(--space-1); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-2); }
        .pm-notes strong { color: var(--ink); font-size: var(--text-sm); }
        .pm-notes p { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
        .pm-notes code { color: var(--ink); font-size: var(--text-xs); }
        .pm-footnote { margin: 0; color: var(--muted); font-size: var(--text-xs); }
        .pm-footnote code { color: var(--ink); }
        @media (max-width: 900px) { .pm-notes { grid-template-columns: minmax(0, 1fr); } .pm-hint { display: none; } }
    `],
})
export class PromptModeMatrixComponent {
    readonly rows: MatrixRow[] = [
        { host: 'AGY', prompt: 'review X', mode: '—', protocol: 'chat-native', target: 'AGY local', tone: 'ok' },
        { host: 'DSH', prompt: 'review X', mode: '—', protocol: 'chat-native', target: 'DSH local', tone: 'ok' },
        { host: 'Cursor', prompt: 'review X', mode: '—', protocol: 'chat-native', target: 'Cursor local', tone: 'ok' },
        { host: 'AGY', prompt: 'mode=A review X', mode: 'A', protocol: 'PreInvocation injectSteps → router → run', target: 'agy:agy', tone: 'ok' },
        { host: 'DSH', prompt: 'mode=A review X', mode: 'A', protocol: 'UserPromptSubmit additionalContext → router → run', target: 'dsh:main-chat', tone: 'ok' },
        { host: 'Cursor', prompt: 'mode=A review X', mode: 'A', protocol: 'skill mode-router → router → run', target: 'cursor:cursor-agent', tone: 'warn' },
        { host: 'AGY', prompt: 'mode=B review X', mode: 'B', protocol: 'inject → router → host-runtime dispatch', target: 'dsh:main-chat', tone: 'ok' },
        { host: 'DSH', prompt: 'mode=B review X', mode: 'B', protocol: 'inject → router → dispatch', target: 'agy:agy', tone: 'ok' },
        { host: 'Cursor', prompt: 'mode=B review X', mode: 'B', protocol: 'skill → router → dispatch', target: 'agy:agy', tone: 'warn' },
        { host: 'any', prompt: 'impl ESO-123 slp g', mode: 'SLP', protocol: 'SLP skill → subagents', target: 'host hiện tại', tone: 'info' },
        { host: 'any', prompt: 'impl ESO-123 slp g mode=A|B', mode: 'SLP', protocol: 'router rejects (not wired)', target: '—', tone: 'bad' },
        { host: 'any', prompt: 'mode=B … to=dsh:main-chat', mode: 'B', protocol: 'router rejects (target from placement)', target: '—', tone: 'bad' },
        { host: 'any', prompt: 'mode=A (no task)', mode: 'A', protocol: 'router rejects (task required)', target: '—', tone: 'bad' },
        { host: 'any', prompt: 'mode=auto …', mode: '—', protocol: 'not supported', target: '—', tone: 'bad' },
    ];

    statusText(tone: MatrixRow['tone']): string {
        return tone === 'ok' ? 'hard injector' : tone === 'warn' ? 'skill-followed' : tone === 'info' ? 'SLP path' : 'rejected';
    }
}
