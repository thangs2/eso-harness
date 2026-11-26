import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReconciliationService } from '../services/reconciliation.service.js';
import { ReconciliationHeroComponent } from '../components/reconciliation/reconciliation-hero.component.js';
import { ReconciliationPipelineComponent } from '../components/reconciliation/reconciliation-pipeline.component.js';
import { ReconciliationMetricsComponent } from '../components/reconciliation/reconciliation-metrics.component.js';
import { ReconciliationToolbarComponent } from '../components/reconciliation/reconciliation-toolbar.component.js';
import { ReconciliationGapCardComponent } from '../components/reconciliation/reconciliation-gap-card.component.js';
import type {
    DiscrepancyType,
    ReconciliationGapDto,
    ReconciliationScanScope,
    SdlcPipelineStageCoverageDto,
} from '../models/reconciliation.models.js';

@Component({
    selector: 'eso-consumer-reconciliation-page',
    standalone: true,
    imports: [
        CommonModule,
        ReconciliationHeroComponent,
        ReconciliationPipelineComponent,
        ReconciliationMetricsComponent,
        ReconciliationToolbarComponent,
        ReconciliationGapCardComponent,
    ],
    templateUrl: './consumer-reconciliation.page.html',
    styleUrl: './consumer-reconciliation.page.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsumerReconciliationPage implements OnInit {
    readonly reconciliationService = inject(ReconciliationService);
    private readonly route = inject(ActivatedRoute);
    private readonly destroyRef = inject(DestroyRef);

    readonly consumerId = signal<string>('');
    readonly activePillar = signal<'all' | 'code' | 'sdlc' | 'postgres'>('all');
    readonly filterType = signal<string>('all');
    readonly filterSeverity = signal<string>('all');
    readonly searchQuery = signal<string>('');
    readonly selectedGapId = signal<string | null>(null);
    readonly copiedGapId = signal<string | null>(null);
    readonly extractedGapId = signal<string | null>(null);
    readonly busyGapId = signal<string | null>(null);

    readonly summary = this.reconciliationService.summary;
    readonly scanning = this.reconciliationService.scanning;
    readonly scanScope = this.reconciliationService.scanScope;
    readonly ignoredCount = this.reconciliationService.ignoredCount;
    readonly syncingIndex = this.reconciliationService.syncingIndex;
    readonly pipelineStages = this.reconciliationService.pipelineStages;
    readonly postgresStats = this.reconciliationService.postgresStats;
    readonly error = this.reconciliationService.error;

    readonly codeDriftCount = computed(() => {
        const s = this.summary();
        return s.orphanRoutes + s.unfedSchemas + s.unlinkedSpikes;
    });

    readonly missingSdlcCount = computed(() => {
        const s = this.summary();
        return s.missingSdlcDocs + s.staleContracts;
    });

    readonly postgresDriftCount = computed(() => this.summary().indexDrift);

    readonly hasActiveFilters = computed(() => {
        return (
            this.activePillar() !== 'all' ||
            this.filterType() !== 'all' ||
            this.filterSeverity() !== 'all' ||
            this.searchQuery().trim().length > 0
        );
    });

    readonly filteredGaps = computed(() => {
        const gaps = this.reconciliationService.gaps();
        const pillar = this.activePillar();
        const type = this.filterType();
        const sev = this.filterSeverity();
        const query = this.searchQuery().trim().toLowerCase();

        return gaps.filter((gap) => {
            if (pillar === 'code') {
                if (!['GAP_A_ORPHAN_ROUTE', 'GAP_B_UNFED_SCHEMA', 'GAP_D_UNLINKED_SPIKE'].includes(gap.type)) {
                    return false;
                }
            } else if (pillar === 'sdlc') {
                if (!['GAP_E_MISSING_SDLC_DOC'].includes(gap.type)) {
                    return false;
                }
            } else if (pillar === 'postgres') {
                if (gap.type !== 'GAP_F_INDEX_DRIFT') {
                    return false;
                }
            }

            if (type !== 'all' && gap.type !== type) return false;
            if (sev !== 'all' && gap.severity !== sev) return false;
            if (query) {
                const matchSymbol = gap.symbol.toLowerCase().includes(query);
                const matchPath = gap.filePath.toLowerCase().includes(query);
                const matchDetail = gap.detail.toLowerCase().includes(query);
                const matchTarget = gap.suggestedTarget.toLowerCase().includes(query);
                if (!matchSymbol && !matchPath && !matchDetail && !matchTarget) {
                    return false;
                }
            }
            return true;
        });
    });

    /**
     * Number of capped-out discrepancies relevant to the CURRENT pillar/type filter.
     * Only types the filter keeps are summed, so a pillar/type selection never
     * surfaces a misleading global number. Severity/search are row-level filters
     * the backend cap does not apply to, so they are not folded in here.
     */
    readonly hiddenByCapCount = computed(() => {
        const truncated = this.summary().truncated ?? {};
        const pillar = this.activePillar();
        const type = this.filterType();
        return (Object.entries(truncated) as [DiscrepancyType, number | undefined][]).reduce((total, [gapType, dropped]) => {
            if (typeof dropped !== 'number' || dropped <= 0) return total;
            const keptByPillar =
                pillar === 'code'
                    ? ['GAP_A_ORPHAN_ROUTE', 'GAP_B_UNFED_SCHEMA', 'GAP_D_UNLINKED_SPIKE'].includes(gapType)
                    : pillar === 'sdlc'
                      ? ['GAP_E_MISSING_SDLC_DOC'].includes(gapType)
                      : pillar === 'postgres'
                        ? gapType === 'GAP_F_INDEX_DRIFT'
                        : true;
            if (!keptByPillar) return total;
            if (type !== 'all' && gapType !== type) return total;
            return total + dropped;
        }, 0);
    });

    readonly selectedGap = computed<ReconciliationGapDto | null>(() => {
        const list = this.filteredGaps();
        if (list.length === 0) return null;
        const id = this.selectedGapId();
        return list.find((g) => g.id === id) || list[0];
    });

    ngOnInit(): void {
        this.route.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                const id = params.get('id') || '';
                if (!id) return;

                this.consumerId.set(id);
                this.reconciliationService.setActiveConsumer(id);
                void this.reconciliationService.loadGaps(id);
            });
    }

    selectGap(gap: ReconciliationGapDto): void {
        this.selectedGapId.set(gap.id);
    }

    getShortCode(type: DiscrepancyType): string {
        switch (type) {
            case 'GAP_A_ORPHAN_ROUTE': return 'GAP-A';
            case 'GAP_B_UNFED_SCHEMA': return 'GAP-B';
            case 'GAP_C_STALE_HASH': return 'GAP-C';
            case 'GAP_D_UNLINKED_SPIKE': return 'GAP-D';
            case 'GAP_E_MISSING_SDLC_DOC': return 'GAP-E';
            case 'GAP_F_INDEX_DRIFT': return 'GAP-F';
            default: return type;
        }
    }

    async scanWorkspace(scope?: ReconciliationScanScope): Promise<void> {
        const id = this.consumerId();
        if (!id) return;
        try {
            await this.reconciliationService.scanWorkspaceAndArtifacts(id, scope);
        } catch {
            // Error signal populated by service
        }
    }

    onScanScopeChange(scope: ReconciliationScanScope): void {
        this.reconciliationService.scanScope.set(scope);
        void this.scanWorkspace(scope);
    }

    async onSyncPostgresIndex(): Promise<void> {
        const id = this.consumerId();
        if (!id) return;
        try {
            await this.reconciliationService.syncPostgresIndex(id);
        } catch {
            // Error signal populated by service
        }
    }

    onPillarChange(pillar: 'all' | 'code' | 'sdlc' | 'postgres'): void {
        this.activePillar.set(pillar);
        this.filterType.set('all');
    }

    onStageSelect(stage: SdlcPipelineStageCoverageDto): void {
        this.activePillar.set('all');
        if (stage.status === 'missing') {
            this.filterType.set('GAP_E_MISSING_SDLC_DOC');
            this.searchQuery.set(stage.stage);
        } else if (stage.status === 'drift') {
            this.filterType.set('GAP_F_INDEX_DRIFT');
            this.searchQuery.set(stage.directory.replace(/\/$/, ''));
        } else {
            this.filterType.set('all');
            this.searchQuery.set(stage.directory.replace(/\/$/, ''));
        }
    }

    async extractDraft(gap: ReconciliationGapDto): Promise<void> {
        const id = this.consumerId();
        if (!id) return;
        this.busyGapId.set(gap.id);
        try {
            await this.reconciliationService.extractDraftToInbox(id, gap.id);
            this.extractedGapId.set(gap.id);
            setTimeout(() => {
                if (this.extractedGapId() === gap.id) {
                    this.extractedGapId.set(null);
                }
            }, 4000);
        } catch {
            // Handled via error signal
        } finally {
            if (this.busyGapId() === gap.id) {
                this.busyGapId.set(null);
            }
        }
    }

    async relockGap(gap: ReconciliationGapDto): Promise<void> {
        const id = this.consumerId();
        if (!id) return;
        this.busyGapId.set(gap.id);
        try {
            await this.reconciliationService.relockHash(id, gap.id);
        } catch {
            // Handled via error signal
        } finally {
            if (this.busyGapId() === gap.id) {
                this.busyGapId.set(null);
            }
        }
    }

    async ignoreGap(gap: ReconciliationGapDto): Promise<void> {
        const id = this.consumerId();
        if (!id) return;
        this.busyGapId.set(gap.id);
        try {
            await this.reconciliationService.ignoreGap(id, gap.id);
        } catch {
            // Handled via error signal
        } finally {
            if (this.busyGapId() === gap.id) {
                this.busyGapId.set(null);
            }
        }
    }

    async syncGapIndex(gap: ReconciliationGapDto): Promise<void> {
        const id = this.consumerId();
        if (!id) return;
        this.busyGapId.set(gap.id);
        try {
            await this.reconciliationService.syncPostgresIndex(id);
        } catch {
            // Handled via error signal
        } finally {
            if (this.busyGapId() === gap.id) {
                this.busyGapId.set(null);
            }
        }
    }

    async copyAgentPrompt(gap: ReconciliationGapDto): Promise<void> {
        let copied = false;
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(gap.promptTemplate);
                copied = true;
            }
        } catch {
            // Fallback
        }

        if (!copied) {
            try {
                const ta = document.createElement('textarea');
                ta.value = gap.promptTemplate;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '-9999px';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                copied = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch {
                // Non-blocking
            }
        }

        this.copiedGapId.set(gap.id);
        setTimeout(() => {
            if (this.copiedGapId() === gap.id) {
                this.copiedGapId.set(null);
            }
        }, 2500);
    }

    onFilterSelect(type: string): void {
        this.filterType.set(type);
        if (type !== 'all') {
            this.activePillar.set('all');
        }
    }

    resetFilters(): void {
        this.activePillar.set('all');
        this.filterType.set('all');
        this.filterSeverity.set('all');
        this.searchQuery.set('');
    }
}
