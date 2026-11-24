import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { CONTROL_PLANE_API_CLIENT } from '../../../core/tokens.js';
import type { HostDto, PromptSummaryDto, RequestSummaryDto } from '../../../../../../../libs/api-client/types.js';

const PAGE_SIZE = 50;

const HOST_META: Record<string, { label: string; color: string }> = {
    cursor: { label: 'Cursor', color: '#22d3ee' },
    agy: { label: 'AGY', color: '#c084fc' },
    antigravity: { label: 'Antigravity', color: '#c084fc' },
    claude: { label: 'Claude', color: '#f59e0b' },
    codex: { label: 'Codex', color: '#4ec97a' },
    dsh: { label: 'DSH', color: '#5aa9ff' },
    orca: { label: 'Orca', color: '#f472b6' },
    paseo: { label: 'Paseo', color: '#2dd4bf' },
};

interface ConversationGroup {
    conversationId: string;
    host: string;
    items: RequestSummaryDto[];
    latest: string;
}

@Component({
    selector: 'eso-request-grid',
    standalone: true,
    imports: [MatButtonModule, RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="request-grid">
            <section class="toolbar">
                <label class="search-field">
                    <span>Search</span>
                    <input type="search" [value]="query()" (input)="onQuery($any($event.target).value)" placeholder="Substring in user query…">
                </label>
                <div class="ide-filter">
                    <span>IDE Filter</span>
                    <div class="segmented">
                        <button type="button" [class.on]="hostFilter() === 'all'" (click)="setHost('all')">All IDEs</button>
                        @for (host of hostOptions(); track host.id) {
                            <button type="button" [class.on]="hostFilter() === host.id" [style.--host-color]="host.color" [title]="host.used ? host.label + ' · used' : host.label + ' · installed'" (click)="setHost(host.id)">
                                <i class="dot" [style.background]="host.color"></i>{{ host.label }}
                            </button>
                        }
                    </div>
                </div>
                <div class="checks">
                    <label><input type="checkbox" [checked]="groupByConversation()" (change)="groupByConversation.set($any($event.target).checked)"> Group by conversation</label>
                    <label><input type="checkbox" [checked]="failuresOnly()" (change)="setFailures($any($event.target).checked)"> Failures only</label>
                </div>
            </section>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }

            @if (loading() && requests().length === 0) {
                <p class="loading-label">Loading requests…</p>
            } @else if (filtered().length === 0) {
                <section class="empty"><strong>No requests found</strong><span>Waiting for prompt.submitted activity for this consumer.</span></section>
            } @else {
                <p class="count-line">Showing {{ pageStart() }}–{{ pageEnd() }} of {{ filtered().length }}</p>

                @if (groupByConversation()) {
                    <div class="request-groups">
                        @for (group of groups(); track group.conversationId) {
                            <details class="request-group" [style.--host-color]="hostColor(group.host)" open>
                                <summary class="group-summary">
                                    <div class="group-left">
                                        <span class="chevron">›</span>
                                        <span class="ide-badge" [style.color]="hostColor(group.host)"><i class="dot" [style.background]="hostColor(group.host)"></i>{{ hostLabel(group.host) }}</span>
                                        <code class="conv-id" [title]="group.conversationId">{{ shortConversation(group.conversationId) }}</code>
                                        <span class="turns-badge">{{ group.items.length }} turn(s)</span>
                                    </div>
                                    <span class="group-time">latest {{ relative(group.latest) }}</span>
                                </summary>
                                <div class="table-wrap">
                                    <table class="request-table grouped">
                                        <thead>
                                            <tr><th>#</th><th>When</th><th class="col-query">Query</th><th>Source</th><th>Status</th><th>Verdict</th><th>Model</th><th>In</th><th>Out</th><th>Calls</th><th>Tools</th><th>Checks</th><th>Open</th></tr>
                                        </thead>
                                        <tbody>
                                            @for (row of group.items; track row.id; let index = $index) {
                                                <tr [class.row-fail]="row.hasFailures">
                                                    <td class="num boundary-cell" title="boundary index">
                                                        @if (subagents(row.traceId).length > 0) {
                                                            <button type="button" class="expand-btn" [attr.aria-expanded]="isExpanded(row.traceId)" [attr.aria-label]="isExpanded(row.traceId) ? 'Collapse subagent prompts' : 'Expand subagent prompts'" [title]="isExpanded(row.traceId) ? 'Collapse subagent prompts' : 'Expand subagent prompts'" (click)="toggle(row.traceId)">
                                                                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
                                                            </button>
                                                        } @else {
                                                            <span class="expand-spacer" aria-hidden="true"></span>
                                                        }
                                                        <span class="boundary">{{ row.boundaryIndex ?? index + 1 }}</span>
                                                    </td>
                                                    <td class="when" [title]="fullTime(row.startedAt)">{{ relative(row.startedAt) }}</td>
                                                    <td class="col-query"><a class="query-link" [title]="row.userQuery" [routerLink]="['/requests', row.traceId]" [queryParams]="{ consumer: consumerId }">{{ queryPreview(row.userQuery) }}</a></td>
                                                    <td><span class="source-pill agent">agent</span></td>
                                                    <td><span class="status-badge" [class]="'status-' + statusTone(row.status)"><i class="dot"></i>{{ row.status }}</span></td>
                                                    <td><span class="verdict-badge" [class]="'verdict-' + verdictTone(row.decisionVerdict)">{{ row.decisionVerdict }}</span></td>
                                                    <td class="model" [title]="row.model">{{ modelShort(row.model) }}</td>
                                                    <td class="num">{{ token(row.inputTokens) }}</td>
                                                    <td class="num" [title]="row.tokensEstimated ? 'Estimated from chars ÷ 4' : ''">{{ token(row.outputTokens) }}{{ row.tokensEstimated ? '~' : '' }}</td>
                                                    <td class="num">{{ row.callCount }}</td>
                                                    <td class="num">{{ row.toolCount }}</td>
                                                    <td class="checks-cell" [class.checks-fail]="row.checksFail > 0" [title]="row.checksPass + ' pass / ' + row.checksFail + ' warn'">{{ checks(row) }}</td>
                                                    <td class="open-cell">
                                                        <a class="cmd primary" [routerLink]="['/requests', row.traceId]" [queryParams]="{ consumer: consumerId }" title="Detail">→</a>
                                                        <button type="button" class="cmd stream" (click)="streamTrace.emit(row.traceId)" title="Play this trace in Live pulse">Stream</button>
                                                    </td>
                                                </tr>
                                                @if (isExpanded(row.traceId)) {
                                                @for (prompt of subagents(row.traceId); track prompt.id) {
                                                    <tr class="prompt-row">
                                                        <td class="num">{{ $index + 2 }}</td>
                                                        <td class="when" [title]="prompt.at">{{ relative(prompt.at) }}</td>
                                                        <td class="col-query"><span class="prompt-arrow">↳</span> <span class="prompt-text" [title]="prompt.promptText || prompt.userQuery">{{ promptPreview(prompt.promptText || prompt.userQuery) }}</span></td>
                                                        <td><span class="source-pill" [class.subagent]="prompt.source === 'subagent'" [class.swarm]="prompt.source === 'swarm'" [title]="prompt.sourceLabel">{{ prompt.sourceLabel }}</span></td>
                                                        <td><span class="status-badge" [class]="'status-' + statusTone(prompt.status)">{{ prompt.status }}</span></td>
                                                        <td>—</td>
                                                        <td class="model" [title]="prompt.model">{{ modelShort(prompt.model) }}</td>
                                                        <td class="num">{{ token(prompt.inputTokens) }}</td><td class="num" [title]="prompt.tokensEstimated ? 'Estimated from chars ÷ 4' : ''">{{ token(prompt.outputTokens) }}{{ prompt.tokensEstimated ? '~' : '' }}</td><td class="num">1</td><td class="num">0</td><td>—</td>
                                                        <td class="open-cell"><a class="cmd primary" [routerLink]="['/requests', row.traceId]" [queryParams]="{ consumer: consumerId }" title="Detail">→</a></td>
                                                    </tr>
                                                }
                                                }
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </details>
                        }
                    </div>
                } @else {
                    <div class="table-wrap sticky">
                        <table class="request-table flat">
                            <thead><tr><th>#</th><th>When</th><th>IDE</th><th class="col-query">Query</th><th>Source</th><th>Status</th><th>Verdict</th><th>Model</th><th>In</th><th>Out</th><th>Calls</th><th>Tools</th><th>Checks</th><th>Open</th><th>Conversation</th></tr></thead>
                            <tbody>
                                @for (row of paged(); track row.id; let index = $index) {
                                    <tr [class.row-fail]="row.hasFailures">
                                        <td class="num boundary-cell">
                                        @if (subagents(row.traceId).length > 0) {
                                            <button type="button" class="expand-btn" [attr.aria-expanded]="isExpanded(row.traceId)" [attr.aria-label]="isExpanded(row.traceId) ? 'Collapse subagent prompts' : 'Expand subagent prompts'" (click)="toggle(row.traceId)">
                                                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
                                            </button>
                                        } @else {
                                            <span class="expand-spacer" aria-hidden="true"></span>
                                        }
                                        <span class="boundary">{{ row.boundaryIndex ?? index + 1 }}</span>
                                    </td>
                                        <td class="when" [title]="fullTime(row.startedAt)">{{ relative(row.startedAt) }}</td>
                                        <td><span class="ide-badge" [style.color]="hostColor(row.hostId)"><i class="dot" [style.background]="hostColor(row.hostId)"></i>{{ hostLabel(row.hostId) }}</span></td>
                                        <td class="col-query"><a class="query-link" [title]="row.userQuery" [routerLink]="['/requests', row.traceId]" [queryParams]="{ consumer: consumerId }">{{ queryPreview(row.userQuery) }}</a></td>
                                        <td><span class="source-pill agent">agent</span></td>
                                        <td><span class="status-badge" [class]="'status-' + statusTone(row.status)"><i class="dot"></i>{{ row.status }}</span></td>
                                        <td><span class="verdict-badge" [class]="'verdict-' + verdictTone(row.decisionVerdict)">{{ row.decisionVerdict }}</span></td>
                                        <td class="model" [title]="row.model">{{ modelShort(row.model) }}</td>
                                        <td class="num">{{ token(row.inputTokens) }}</td>
                                        <td class="num" [title]="row.tokensEstimated ? 'Estimated from chars ÷ 4' : ''">{{ token(row.outputTokens) }}{{ row.tokensEstimated ? '~' : '' }}</td>
                                        <td class="num">{{ row.callCount }}</td>
                                        <td class="num">{{ row.toolCount }}</td>
                                        <td class="checks-cell" [class.checks-fail]="row.checksFail > 0" [title]="row.checksPass + ' pass / ' + row.checksFail + ' warn'">{{ checks(row) }}</td>
                                        <td class="open-cell">
                                            <a class="cmd primary" [routerLink]="['/requests', row.traceId]" [queryParams]="{ consumer: consumerId }" title="Detail">→</a>
                                            <button type="button" class="cmd stream" (click)="streamTrace.emit(row.traceId)" title="Play this trace in Live pulse">Stream</button>
                                        </td>
                                        <td class="conv-id">{{ shortConversation(row.conversationId) }}</td>
                                    </tr>
                                    @if (isExpanded(row.traceId)) {
                                    @for (prompt of subagents(row.traceId); track prompt.id) {
                                        <tr class="prompt-row">
                                            <td class="num">{{ $index + 2 }}</td><td class="when" [title]="prompt.at">{{ relative(prompt.at) }}</td>
                                            <td>{{ hostLabel(prompt.hostId) }}</td>
                                            <td class="col-query"><span class="prompt-arrow">↳</span> <span class="prompt-text" [title]="prompt.promptText || prompt.userQuery">{{ promptPreview(prompt.promptText || prompt.userQuery) }}</span></td>
                                            <td><span class="source-pill" [class.subagent]="prompt.source === 'subagent'" [class.swarm]="prompt.source === 'swarm'" [title]="prompt.sourceLabel">{{ prompt.sourceLabel }}</span></td>
                                            <td><span class="status-badge" [class]="'status-' + statusTone(prompt.status)">{{ prompt.status }}</span></td>
                                            <td>—</td><td class="model">{{ modelShort(prompt.model) }}</td>
                                            <td class="num">{{ token(prompt.inputTokens) }}</td><td class="num" [title]="prompt.tokensEstimated ? 'Estimated from chars ÷ 4' : ''">{{ token(prompt.outputTokens) }}{{ prompt.tokensEstimated ? '~' : '' }}</td><td class="num">1</td><td class="num">0</td><td>—</td>
                                            <td class="open-cell"><a class="cmd primary" [routerLink]="['/requests', row.traceId]" [queryParams]="{ consumer: consumerId }">→</a></td>
                                            <td class="conv-id"></td>
                                        </tr>
                                    }
                                    }
                                }
                            </tbody>
                        </table>
                    </div>
                }

                <div class="pager">
                    <button type="button" class="ghost-btn" [disabled]="offset() <= 0" (click)="prevPage()">Previous</button>
                    <button type="button" class="ghost-btn" [disabled]="offset() + PAGE_SIZE >= filtered().length" (click)="nextPage()">Next</button>
                </div>
            }
        </section>
    `,
    styles: [`
        :host { display: block; }
        .request-grid {
            --surface: #131722;
            --surface-2: #0d1118;
            --line: #253047;
            --muted: #8b97ab;
            display: grid;
            gap: 12px;
            color: #f1f5f9;
        }
        .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
        .page-header h1 { margin: 0 0 4px; font-size: 24px; line-height: 32px; font-weight: 600; }
        .subtitle { margin: 0; color: var(--muted); font-size: 14px; }
        .header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .header-actions label { display: grid; gap: 3px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
        .header-actions select { height: 32px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #e2e8f0; font: inherit; font-size: 12px; }
        .text-link { color: #5aa9ff; font-size: 12px; text-decoration: none; }
        .ghost-btn { padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: #e2e8f0; font: inherit; font-size: 13px; cursor: pointer; }
        .ghost-btn:disabled { opacity: .5; cursor: default; }

        .toolbar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: rgba(19,23,34,.6); }
        .search-field { display: grid; gap: 4px; flex: 1 1 300px; min-width: 200px; }
        .search-field span, .ide-filter > span { color: var(--muted); font-size: 12px; }
        .search-field input { height: 38px; padding: 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); color: #f1f5f9; font: inherit; font-size: 14px; }
        .ide-filter { display: grid; gap: 4px; }
        .segmented { display: inline-flex; gap: 2px; padding: 4px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
        .segmented button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #94a3b8; font: inherit; font-size: 12px; cursor: pointer; }
        .segmented button.on { border-color: var(--line); background: #1a2a3e; color: #f1f5f9; font-weight: 600; }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }
        .dot.cursor, .ide-cursor .dot { background: #22d3ee; }
        .dot.antigravity, .ide-antigravity .dot { background: #c084fc; }
        .checks { display: flex; gap: 10px; padding-bottom: 8px; }
        .checks label { display: flex; align-items: center; gap: 6px; color: #cbd5e1; font-size: 12px; white-space: nowrap; }

        .count-line { margin: 0; color: var(--muted); font-size: 13px; }
        .request-groups { display: grid; gap: 12px; }
        .request-group { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; }
        .request-group { border-color: var(--host-color, #253047); }
        .group-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; background: color-mix(in srgb, var(--host-color, #64748b) 18%, #131722); cursor: pointer; list-style: none; }
                .group-summary::-webkit-details-marker { display: none; }
        .group-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
        .chevron { color: #94a3b8; transition: transform .15s ease; }
        details[open] .chevron { transform: rotate(90deg); }
        .ide-badge { display: inline-flex; align-items: center; gap: 5px; color: #cbd5e1; font-size: 12px; }
        .conv-id { color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
        .turns-badge { padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: #94a3b8; font-size: 11px; }
        .group-time { color: #94a3b8; font-size: 12px; white-space: nowrap; }

        .table-wrap { overflow: auto; scrollbar-color: #2b3b52 #0b1118; scrollbar-width: thin; }
        .table-wrap::-webkit-scrollbar { height: 8px; }
        .table-wrap::-webkit-scrollbar-thumb { background: #2b3b52; border-radius: 999px; }
        .table-wrap::-webkit-scrollbar-track { background: #0b1118; }
        .request-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.request-table.grouped { table-layout: fixed; }
        .request-table.grouped th:nth-child(1) { width: 54px; }
        .request-table.grouped th:nth-child(2) { width: 62px; }
        .request-table.grouped th:nth-child(3) { width: 27%; }
        .request-table.grouped th:nth-child(4) { width: 92px; }
        .request-table.grouped th:nth-child(5) { width: 80px; }
        .request-table.grouped th:nth-child(6) { width: 56px; }
        .request-table.grouped th:nth-child(7) { width: 72px; }
        .request-table.grouped th:nth-child(8), .request-table.grouped th:nth-child(9) { width: 34px; }
        .request-table.grouped th:nth-child(10), .request-table.grouped th:nth-child(11) { width: 36px; }
        .request-table.grouped th:nth-child(12) { width: 52px; }
        .request-table.grouped th:nth-child(13) { width: 92px; }
        .request-table.grouped .col-query { white-space: normal; overflow-wrap: anywhere; }
        .request-table th { padding: 8px 12px; border-bottom: 1px solid var(--line); color: #94a3b8; font-size: 12px; font-weight: 500; text-align: left; white-space: nowrap; }
        .request-table td { padding: 10px 12px; border-bottom: 1px solid #1e2a3e; color: #cbd5e1; vertical-align: middle; }
        .request-table tbody tr { --row-bg: #131722; }
        .request-table tbody tr.prompt-row { --row-bg: #0f1622; }
        .request-table tbody tr:hover { --row-bg: #162235; }
        .request-table tbody tr td, .request-table tbody tr .open-cell { background: var(--row-bg); }
        .request-table tbody tr.row-fail { box-shadow: inset 2px 0 0 #e0b341; }
        .request-table .num { text-align: right; font-variant-numeric: tabular-nums; color: #94a3b8; white-space: nowrap; }
        .request-table .when { white-space: nowrap; color: #94a3b8; }
        .col-query { min-width: 320px; width: 38%; }
        .query-link { display: block; color: #f1f5f9; text-decoration: none; line-height: 1.4; }
        .query-link:hover { color: #5aa9ff; }
        .status-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 4px; font-size: 10px; white-space: nowrap; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); font-size: 12px; }
        .status-ok { color: #a7f3d0; border-color: rgba(78,201,122,.3); background: rgba(78,201,122,.15); }
        .status-ok .dot { background: #4ec97a; }
        .status-warn { color: #fde68a; border-color: rgba(224,179,65,.4); background: rgba(224,179,65,.12); }
        .status-warn .dot { background: #e0b341; }
        .status-bad { color: #fecaca; border-color: rgba(255,107,107,.4); background: rgba(255,107,107,.15); }
        .status-bad .dot { background: #ff6b6b; }
        .status-muted { color: #94a3b8; border-color: var(--line); background: var(--surface-2); }
        .status-muted .dot { background: #64748b; }
        .verdict-badge { display: inline-block; padding: 2px 5px; border: 1px solid rgba(90,169,255,.35); border-radius: 6px; background: rgba(90,169,255,.12); color: #bae6fd; font-size: 11px; }
        .verdict-muted { border-color: var(--line); background: var(--surface-2); color: #94a3b8; }
        .model { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8; }
        .checks-cell { color: #4ec97a; font-variant-numeric: tabular-nums; }
        .checks-fail { color: #e0b341; }
        .open-cell, .request-table th:last-child { position: sticky; right: 0; z-index: 2; white-space: nowrap; text-align: right; }
        .request-table th:last-child { background: #131722; }
        .open-cell { padding: 8px 10px; }
                .cmd { display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; min-width: 24px; height: 24px; padding: 0 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface-2); color: #cbd5e1; font: inherit; font-size: 10px; line-height: 1; text-decoration: none; transition: border-color .15s ease, background .15s ease, color .15s ease; }
        .cmd + .cmd { margin-left: 6px; }
        .cmd:hover { border-color: rgba(90,169,255,.55); background: rgba(90,169,255,.16); color: #fff; }
        .cmd:focus-visible { outline: 2px solid #5aa9ff; outline-offset: 1px; }
        .cmd.primary { border-color: rgba(90,169,255,.5); background: rgba(90,169,255,.12); color: #5aa9ff; }
        .cmd.primary:hover { border-color: #5aa9ff; background: #5aa9ff; color: #06111d; }
        .cmd.stream { color: #bae6fd; border-color: rgba(90,169,255,.35); background: rgba(90,169,255,.08); }
        .cmd.stream:hover { border-color: #7dd3fc; background: rgba(125,211,252,.2); color: #fff; }
        .pager { display: flex; gap: 8px; margin-top: 4px; }

        .empty, .loading-label, .form-error { color: var(--muted); }
        .empty { display: grid; gap: 4px; padding: 24px; border: 1px dashed var(--line); border-radius: 8px; }
        .empty strong { color: #f1f5f9; }
        .form-error { color: #fca5a5; }
        .table-wrap.sticky { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
        .boundary-cell { vertical-align: middle; white-space: nowrap; }
        .boundary { margin-left: 7px; color: #94a3b8; font-variant-numeric: tabular-nums; }
        .expand-btn { display: inline-grid; place-items: center; vertical-align: middle; flex: 0 0 24px; width: 24px; height: 24px; padding: 0; border: 1px solid #2b3b52; border-radius: 6px; background: #0d1118; color: #5aa9ff; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
        .expand-btn svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform .15s ease; }
        .expand-btn[aria-expanded='true'] svg { transform: rotate(90deg); }
        .expand-btn:hover { border-color: rgba(90,169,255,.55); background: rgba(90,169,255,.12); color: #fff; }
        .expand-btn:focus-visible { outline: 2px solid #5aa9ff; outline-offset: 1px; }
        .expand-spacer { display: inline-block; width: 24px; height: 24px; }
        .source-pill { display: inline-block; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 5px; border: 1px solid #253047; border-radius: 5px; font-size: 9px; }
        .source-pill.agent { color: #e2e8f0; background: #0d1118; }
        .source-pill.subagent { color: #bae6fd; border-color: rgba(90,169,255,.35); background: rgba(90,169,255,.12); }
        .source-pill.swarm { color: #f5d0fe; border-color: rgba(192,132,252,.4); background: rgba(192,132,252,.12); }
        .prompt-row td { color: #94a3b8; }
        .prompt-row .col-query { padding-left: 20px; }
        .prompt-arrow { color: #5aa9ff; margin-right: 4px; }
        .prompt-text { color: #cbd5e1; }
        @media (max-width: 900px) {
            .page-header { flex-direction: column; }
            .toolbar { align-items: stretch; }
            .checks { padding-bottom: 0; }
            .col-query { min-width: 240px; width: auto; }
        }
    `],
})
export class RequestGridComponent implements OnChanges {
    @Input({ required: true }) consumerId = '';
    @Output() readonly streamTrace = new EventEmitter<string>();
    private readonly api = inject(CONTROL_PLANE_API_CLIENT, { optional: true });

    readonly PAGE_SIZE = PAGE_SIZE;
    readonly requests = signal<RequestSummaryDto[]>([]);
    readonly loading = signal(false);
    readonly error = signal('');
    readonly query = signal('');
    readonly hostFilter = signal('all');
    readonly hosts = signal<HostDto[]>([]);
    readonly prompts = signal<PromptSummaryDto[]>([]);
    readonly expanded = signal<Set<string>>(new Set());
    readonly groupByConversation = signal(true);
    readonly failuresOnly = signal(false);
    readonly offset = signal(0);

    readonly filtered = computed(() => {
        const query = this.query().trim().toLowerCase();
        const host = this.hostFilter();
        return this.requests().filter((row) => {
            if (host !== 'all' && row.hostId !== host) return false;
            if (this.failuresOnly() && !row.hasFailures) return false;
            if (!query) return true;
            return [row.id, row.traceId, row.workerId, row.userQuery, row.model, row.conversationId].some((value) => String(value || '').toLowerCase().includes(query));
        });
    });
    readonly paged = computed(() => this.filtered().slice(this.offset(), this.offset() + PAGE_SIZE));
    readonly pageStart = computed(() => this.filtered().length ? this.offset() + 1 : 0);
    readonly pageEnd = computed(() => Math.min(this.offset() + this.paged().length, this.filtered().length));
    readonly groups = computed<ConversationGroup[]>(() => {
        const map = new Map<string, RequestSummaryDto[]>();
        for (const row of this.paged()) {
            const key = row.conversationId || '(no conversation)';
            map.set(key, [...(map.get(key) || []), row]);
        }
        return [...map.entries()].map(([conversationId, items]) => ({
            conversationId,
            host: items[0]?.hostId || 'unknown',
            items: [...items].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || (b.boundaryIndex ?? 0) - (a.boundaryIndex ?? 0)),
            latest: items[0]?.startedAt || '',
        })).sort((a, b) => String(b.latest).localeCompare(String(a.latest)));
    });

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['consumerId'] && this.consumerId) void this.load();
    }

    async load(): Promise<void> {
        if (!this.api || !this.consumerId) return;
        this.loading.set(true);
        this.error.set('');
        try {
            const [requests, hosts, prompts] = await Promise.all([
                this.api.listRequests(this.consumerId, 200),
                this.api.getHosts().catch(() => []),
                this.api.listPrompts(this.consumerId, 500).catch(() => []),
            ]);
            this.requests.set(requests);
            this.hosts.set(hosts);
            this.prompts.set(prompts);
            this.expanded.set(new Set());
        } catch (error) {
            this.error.set((error as Error)?.message || 'Unable to load requests');
        } finally {
            this.loading.set(false);
        }
    }

    onQuery(value: string): void { this.query.set(value); this.offset.set(0); }
    isExpanded(traceId: string): boolean { return this.expanded().has(traceId); }
    toggle(traceId: string): void { const next = new Set(this.expanded()); if (next.has(traceId)) next.delete(traceId); else next.add(traceId); this.expanded.set(next); }
    subagents(traceId: string): PromptSummaryDto[] { return this.prompts().filter((prompt) => prompt.traceId === traceId && prompt.source !== 'agent').sort((left, right) => left.at.localeCompare(right.at)); }
    promptPreview(value: string): string { const clean = (value || '').replace(/\s+/g, ' ').trim(); return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean || '—'; }

    setHost(value: string): void { this.hostFilter.set(value); this.offset.set(0); }
    readonly hostOptions = computed(() => {
        const used = new Set(this.requests().map((row) => row.hostId).filter(Boolean));
        const installed = this.hosts().map((host) => host.hostId).filter(Boolean);
        const ids = [...new Set([...used, ...installed])];
        return ids.map((id) => ({
            id,
            label: HOST_META[id]?.label || id,
            color: HOST_META[id]?.color || '#94a3b8',
            used: used.has(id),
            installed: installed.includes(id),
        })).sort((left, right) => Number(right.used) - Number(left.used) || left.label.localeCompare(right.label));
    });
    setFailures(value: boolean): void { this.failuresOnly.set(value); this.offset.set(0); }
    prevPage(): void { this.offset.set(Math.max(0, this.offset() - PAGE_SIZE)); }
    nextPage(): void { this.offset.set(this.offset() + PAGE_SIZE); }

    queryPreview(value: string): string { return value.length > 140 ? `${value.slice(0, 140)}…` : value || '—'; }
    shortConversation(value: string): string { return value.length > 16 ? `${value.slice(0, 16)}…` : value; }
    hostLabel(value: string): string { return HOST_META[value]?.label || value || 'Unknown'; }
    hostColor(value: string): string { return HOST_META[value]?.color || '#94a3b8'; }
    statusTone(value: string): string { const status = String(value || '').toLowerCase(); if (status.includes('fail') || status.includes('block')) return 'bad'; if (status.includes('completed') || status.includes('pass')) return 'ok'; if (status.includes('submitted') || status.includes('progress') || status.includes('pending')) return 'warn'; return 'muted'; }
    verdictTone(value: string): string { const verdict = String(value || '').toUpperCase(); return verdict === '—' || !verdict ? 'muted' : verdict.includes('FAIL') || verdict.includes('BLOCK') ? 'bad' : ''; }
    modelShort(value: string): string { return (value || '—').split('/').pop() || '—'; }
    token(value: number | null): string { return value == null ? '—' : new Intl.NumberFormat('en-US').format(value); }
    checks(row: RequestSummaryDto): string { if (!row.checksPass && !row.checksFail) return '—'; return `${row.checksPass}/${row.checksFail}`; }
    relative(value: string): string {
        if (!value) return '—';
        const ms = Date.now() - new Date(value).getTime();
        if (Number.isNaN(ms)) return value;
        const minutes = Math.floor(ms / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
    }
    fullTime(value: string): string { return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) : '—'; }
}
