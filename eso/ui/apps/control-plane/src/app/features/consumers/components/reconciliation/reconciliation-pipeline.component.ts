import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type {
    PostgresKnowledgeStatsDto,
    SdlcPipelineStageCoverageDto,
} from '../../models/reconciliation.models.js';

@Component({
    selector: 'eso-reconciliation-pipeline',
    standalone: true,
    imports: [CommonModule],
    template: `
        <section class="cockpit-overview" aria-label="3-Pillar Sync Architecture and SDLC Coverage">
            <!-- Top: 3-Pillar Health Ribbon (Clean 3-column horizontal bar, zero nested clutter) -->
            <div class="pillars-bar" role="tablist" aria-label="Filter by reconciliation pillar">
                <!-- Pillar 1: Source Code -->
                <button
                    type="button"
                    role="tab"
                    class="pillar-cell"
                    [class.active]="activePillar() === 'code'"
                    [attr.aria-selected]="activePillar() === 'code'"
                    (click)="selectPillar('code')"
                >
                    <div class="pillar-top">
                        <span class="pillar-label">
                            <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                                <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                            Source Code
                        </span>
                        <span class="status-chip" [class.chip-ok]="codeDriftCount() === 0" [class.chip-warn]="codeDriftCount() > 0">
                            <span class="dot" aria-hidden="true"></span>
                            {{ codeDriftCount() }} drift
                        </span>
                    </div>
                    <div class="pillar-meta"><code>GAP-A · B · D</code> &mdash; AST routes, schemas &amp; spikes</div>
                </button>

                <!-- Pillar 2: Artifacts, SDLC, Rules & Skills -->
                <button
                    type="button"
                    role="tab"
                    class="pillar-cell"
                    [class.active]="activePillar() === 'sdlc'"
                    [attr.aria-selected]="activePillar() === 'sdlc'"
                    (click)="selectPillar('sdlc')"
                >
                    <div class="pillar-top">
                        <span class="pillar-label">
                            <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                                <path d="M3 2.5h7l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" stroke-linejoin="round" />
                                <path d="M5 8h6M5 10.5h4" stroke-linecap="round" />
                            </svg>
                            Artifacts &middot; SDLC &middot; Rules
                        </span>
                        <span class="status-chip" [class.chip-ok]="missingSdlcCount() === 0" [class.chip-danger]="missingSdlcCount() > 0">
                            <span class="dot" aria-hidden="true"></span>
                            {{ missingSdlcCount() }} gaps
                        </span>
                    </div>
                    <div class="pillar-meta">
                        <code>GAP-C · E</code> &mdash; <strong class="num">{{ postgresStats()?.diskMarkdownCount ?? 0 }}</strong> governed <code>.md</code> files
                    </div>
                </button>

                <!-- Pillar 3: PostgreSQL Knowledge Index -->
                <button
                    type="button"
                    role="tab"
                    class="pillar-cell"
                    [class.active]="activePillar() === 'postgres'"
                    [attr.aria-selected]="activePillar() === 'postgres'"
                    (click)="selectPillar('postgres')"
                >
                    <div class="pillar-top">
                        <span class="pillar-label">
                            <svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                                <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
                                <path d="M2.5 3.5v9c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-9" />
                                <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" />
                            </svg>
                            PostgreSQL Index
                        </span>
                        <span class="status-chip" [class.chip-ok]="postgresDriftCount() === 0" [class.chip-warn]="postgresDriftCount() > 0">
                            <span class="dot" aria-hidden="true"></span>
                            {{ postgresDriftCount() }} sync drift
                        </span>
                    </div>
                    <div class="pillar-meta">
                        <code>GAP-F</code> &mdash; <strong class="num">{{ postgresStats()?.indexedDocsCount ?? 0 }}</strong> rows in <code>knowledge_doc</code>
                    </div>
                </button>
            </div>

            <!-- Bottom: Compact Balanced 4-Column SDLC S1-S17 Coverage Strip -->
            <div class="pipeline-strip">
                <div class="pipeline-bar-head">
                    <button
                        type="button"
                        class="pipeline-toggle"
                        (click)="pipelineExpanded.set(!pipelineExpanded())"
                        [attr.aria-expanded]="pipelineExpanded()"
                    >
                        <svg
                            class="icon-xs chevron"
                            [class.rotated]="pipelineExpanded()"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.6"
                            aria-hidden="true"
                        >
                            <path d="M6 3.5L10.5 8 6 12.5" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                        <span class="pipeline-title">SDLC Pipeline Coverage (S1&ndash;S17)</span>
                        <span class="pipeline-ratio">{{ coveredCount() }}/17 covered</span>
                    </button>

                    <div class="pipeline-right">
                        <div class="legend" aria-hidden="true">
                            <span class="legend-item"><span class="dot dot-covered"></span>Covered</span>
                            <span class="legend-item"><span class="dot dot-drift"></span>Drift</span>
                            <span class="legend-item"><span class="dot dot-missing"></span>Missing</span>
                        </div>
                        @if (activePillar() !== 'all') {
                            <button type="button" class="clear-pillar-btn" (click)="pillarChange.emit('all')">
                                Show all pillars
                            </button>
                        }
                    </div>
                </div>

                @if (pipelineExpanded()) {
                    <div class="pipeline-groups-4col">
                        <div class="stage-col stage-col-a">
                            <div class="col-label">A &middot; Requirements (S1&ndash;S7)</div>
                            <div class="stage-chips">
                                @for (s of groupAStages(); track s.stage) {
                                    <button
                                        type="button"
                                        class="stage-chip"
                                        [ngClass]="'st-' + s.status"
                                        (click)="stageSelect.emit(s)"
                                        [title]="s.stage + ' ' + s.name + ' (' + s.owner + ') — ' + s.docCount + ' docs in ' + s.directory"
                                    >
                                        <span class="dot" aria-hidden="true"></span>
                                        <span class="st-code">{{ s.stage }}</span>
                                        <span class="st-name">{{ s.name }}</span>
                                        <span class="st-num">{{ s.docCount }}</span>
                                    </button>
                                }
                            </div>
                        </div>

                        <div class="stage-col stage-col-b">
                            <div class="col-label">B &middot; Technical (S8&ndash;S10)</div>
                            <div class="stage-chips">
                                @for (s of groupBStages(); track s.stage) {
                                    <button
                                        type="button"
                                        class="stage-chip"
                                        [ngClass]="'st-' + s.status"
                                        (click)="stageSelect.emit(s)"
                                        [title]="s.stage + ' ' + s.name + ' (' + s.owner + ') — ' + s.docCount + ' docs in ' + s.directory"
                                    >
                                        <span class="dot" aria-hidden="true"></span>
                                        <span class="st-code">{{ s.stage }}</span>
                                        <span class="st-name">{{ s.name }}</span>
                                        <span class="st-num">{{ s.docCount }}</span>
                                    </button>
                                }
                            </div>
                        </div>

                        <div class="stage-col stage-col-c">
                            <div class="col-label">C &middot; Breakdown (S11&ndash;S13)</div>
                            <div class="stage-chips">
                                @for (s of groupCStages(); track s.stage) {
                                    <button
                                        type="button"
                                        class="stage-chip"
                                        [ngClass]="'st-' + s.status"
                                        (click)="stageSelect.emit(s)"
                                        [title]="s.stage + ' ' + s.name + ' (' + s.owner + ') — ' + s.docCount + ' docs in ' + s.directory"
                                    >
                                        <span class="dot" aria-hidden="true"></span>
                                        <span class="st-code">{{ s.stage }}</span>
                                        <span class="st-name">{{ s.name }}</span>
                                        <span class="st-num">{{ s.docCount }}</span>
                                    </button>
                                }
                            </div>
                        </div>

                        <div class="stage-col stage-col-d">
                            <div class="col-label">D &middot; Delivery (S14&ndash;S17)</div>
                            <div class="stage-chips">
                                @for (s of groupDStages(); track s.stage) {
                                    <button
                                        type="button"
                                        class="stage-chip"
                                        [ngClass]="'st-' + s.status"
                                        (click)="stageSelect.emit(s)"
                                        [title]="s.stage + ' ' + s.name + ' (' + s.owner + ') — ' + s.docCount + ' docs in ' + s.directory"
                                    >
                                        <span class="dot" aria-hidden="true"></span>
                                        <span class="st-code">{{ s.stage }}</span>
                                        <span class="st-name">{{ s.name }}</span>
                                        <span class="st-num">{{ s.docCount }}</span>
                                    </button>
                                }
                            </div>
                        </div>
                    </div>
                }
            </div>
        </section>
    `,
    styles: [`
        :host {
            display: block;
        }

        .cockpit-overview {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: var(--radius-md);
            overflow: hidden;
        }

        /* 3-Pillar Ribbon */
        .pillars-bar {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            border-bottom: 1px solid var(--line);

            @media (max-width: 860px) {
                grid-template-columns: 1fr;
            }
        }

        .pillar-cell {
            appearance: none;
            background: transparent;
            border: none;
            border-right: 1px solid var(--line);
            padding: var(--space-3) var(--space-4);
            text-align: left;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
            position: relative;
            transition: background 150ms ease;

            &:last-child {
                border-right: none;
            }

            &:hover {
                background: color-mix(in srgb, var(--ink) 3%, transparent);
            }

            &.active {
                background: color-mix(in srgb, var(--brand) 7%, var(--surface));

                &::after {
                    content: '';
                    position: absolute;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    height: 2px;
                    background: var(--brand);
                }
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: -2px;
            }

            @media (max-width: 860px) {
                border-right: none;
                border-bottom: 1px solid var(--line);

                &:last-child {
                    border-bottom: none;
                }
            }
        }

        .pillar-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
        }

        .pillar-label {
            display: inline-flex;
            align-items: center;
            gap: var(--space-2);
            font-size: var(--text-sm);
            font-weight: 600;
            color: var(--ink);
        }

        .pillar-meta {
            font-size: var(--text-xs);
            color: var(--muted);
            line-height: 1.4;

            code {
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-size: 0.6875rem;
                color: var(--ink);
                opacity: 0.85;
            }

            .num {
                color: var(--ink);
                font-weight: 600;
                font-variant-numeric: tabular-nums;
            }
        }

        .status-chip {
            display: inline-flex;
            align-items: center;
            gap: 0.375rem;
            padding: 0.125rem 0.5rem;
            border-radius: 999px;
            font-size: 0.6875rem;
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            border: 1px solid var(--line);
            color: var(--muted);
            background: var(--surface-2);
            white-space: nowrap;
        }

        .chip-ok {
            color: #34d399;
            border-color: color-mix(in srgb, #10b981 30%, var(--line));
            background: color-mix(in srgb, #10b981 10%, transparent);

            .dot { background: #10b981; }
        }

        .chip-warn {
            color: #fbbf24;
            border-color: color-mix(in srgb, #f59e0b 32%, var(--line));
            background: color-mix(in srgb, #f59e0b 10%, transparent);

            .dot { background: #f59e0b; }
        }

        .chip-danger {
            color: #f87171;
            border-color: color-mix(in srgb, #ef4444 32%, var(--line));
            background: color-mix(in srgb, #ef4444 10%, transparent);

            .dot { background: #ef4444; }
        }

        .dot {
            width: 0.375rem;
            height: 0.375rem;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .icon-sm {
            width: 0.9375rem;
            height: 0.9375rem;
            color: var(--muted);
            flex-shrink: 0;
        }

        .icon-xs {
            width: 0.875rem;
            height: 0.875rem;
            flex-shrink: 0;
        }

        /* Pipeline Strip */
        .pipeline-strip {
            background: color-mix(in srgb, var(--surface-2) 65%, var(--surface));
            padding: var(--space-2) var(--space-4) var(--space-3);
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
        }

        .pipeline-bar-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-3);
            flex-wrap: wrap;
        }

        .pipeline-toggle {
            appearance: none;
            border: none;
            background: transparent;
            padding: var(--space-1) 0;
            display: inline-flex;
            align-items: center;
            gap: var(--space-2);
            cursor: pointer;
            color: var(--ink);
            font: inherit;

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 2px;
                border-radius: var(--radius-sm);
            }
        }

        .chevron {
            color: var(--muted);
            transition: transform 160ms ease;

            &.rotated {
                transform: rotate(90deg);
            }
        }

        .pipeline-title {
            font-size: var(--text-xs);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted);
        }

        .pipeline-ratio {
            font-size: var(--text-xs);
            font-weight: 600;
            color: var(--ink);
            font-variant-numeric: tabular-nums;
            padding: 0.0625rem 0.4375rem;
            border-radius: 999px;
            border: 1px solid var(--line);
            background: var(--surface);
        }

        .pipeline-right {
            display: flex;
            align-items: center;
            gap: var(--space-3);
        }

        .legend {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3);
            font-size: 0.6875rem;
            color: var(--muted);
        }

        .legend-item {
            display: inline-flex;
            align-items: center;
            gap: 0.3125rem;
        }

        .dot-covered { background: #10b981; }
        .dot-drift { background: #f59e0b; }
        .dot-missing { background: #ef4444; }

        .clear-pillar-btn {
            appearance: none;
            border: none;
            background: transparent;
            color: var(--brand);
            font: inherit;
            font-size: var(--text-xs);
            font-weight: 600;
            cursor: pointer;
            padding: 0;

            &:hover {
                text-decoration: underline;
            }
        }

        /* Balanced 4-Column Stage Grid — zero orphan row */
        .pipeline-groups-4col {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: var(--space-3);

            @media (max-width: 1120px) {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            @media (max-width: 640px) {
                grid-template-columns: 1fr;
            }
        }

        .stage-col {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
            padding: var(--space-3);
            border-radius: var(--radius-sm);
            border: 1px solid var(--line);
            border-left-width: 3px;
            background: var(--surface);
            min-width: 0;
        }

        .stage-col-a {
            border-left-color: #3b82f6;
        }

        .stage-col-b {
            border-left-color: #fb923c;
        }

        .stage-col-c {
            border-left-color: #10b981;
        }

        .stage-col-d {
            border-left-color: #a855f7;
        }

        .col-label {
            font-size: 0.6875rem;
            font-weight: 600;
            color: var(--muted);
            letter-spacing: 0.02em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .stage-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 0.3125rem;
        }

        .stage-chip {
            appearance: none;
            display: inline-flex;
            align-items: center;
            gap: 0.3125rem;
            padding: 0.1875rem 0.4375rem;
            border-radius: var(--radius-sm);
            border: 1px solid var(--line);
            background: var(--surface-2);
            color: var(--ink);
            font: inherit;
            font-size: 0.6875rem;
            cursor: pointer;
            transition: border-color 150ms ease, background 150ms ease;

            &:hover {
                border-color: var(--brand);
            }

            &:focus-visible {
                outline: 2px solid var(--brand);
                outline-offset: 1px;
            }

            &.st-covered .dot { background: #10b981; }
            &.st-drift .dot { background: #f59e0b; }
            &.st-missing .dot { background: #ef4444; }
        }

        .st-code {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-weight: 700;
            font-size: 0.6875rem;
        }

        .st-name {
            color: var(--muted);
        }

        .st-num {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.625rem;
            color: var(--muted);
            opacity: 0.75;
            font-variant-numeric: tabular-nums;
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReconciliationPipelineComponent {
    readonly stages = input<SdlcPipelineStageCoverageDto[]>([]);
    readonly postgresStats = input<PostgresKnowledgeStatsDto | null>(null);
    readonly activePillar = input<'all' | 'code' | 'sdlc' | 'postgres'>('all');
    readonly codeDriftCount = input<number>(0);
    readonly missingSdlcCount = input<number>(0);
    readonly postgresDriftCount = input<number>(0);

    readonly pillarChange = output<'all' | 'code' | 'sdlc' | 'postgres'>();
    readonly stageSelect = output<SdlcPipelineStageCoverageDto>();

    readonly pipelineExpanded = signal<boolean>(true);

    readonly groupAStages = computed(() => this.stages().filter((s) => s.group === 'A'));
    readonly groupBStages = computed(() => this.stages().filter((s) => s.group === 'B'));
    readonly groupCStages = computed(() => this.stages().filter((s) => s.group === 'C'));
    readonly groupDStages = computed(() => this.stages().filter((s) => s.group === 'D'));
    readonly coveredCount = computed(() => this.stages().filter((s) => s.status === 'covered').length);

    selectPillar(pillar: 'all' | 'code' | 'sdlc' | 'postgres'): void {
        if (this.activePillar() === pillar && pillar !== 'all') {
            this.pillarChange.emit('all');
        } else {
            this.pillarChange.emit(pillar);
        }
    }
}
