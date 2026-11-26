import { Injectable, computed, inject, signal } from '@angular/core';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
// The api-client DTOs and the local mirror in reconciliation.models.ts are near-duplicates that have
// drifted (api still carries `lastSyncedAt`, the mirror now carries `ghostDbCount`), so both are imported
// under explicit aliases and every API stats payload is converted by `toModelStats` below.
import type {
    DiscrepancySeverity,
    DiscrepancyType,
    ReconciliationGapDto,
} from '../../../../../../../libs/api-client/types.js';
import type { PostgresKnowledgeStatsDto as ApiPostgresStatsDto } from '../../../../../../../libs/api-client/types.js';
import type { ConsumerArtifactDto } from '../pages/consumer-settings.models.js';
import type {
    PostgresKnowledgeStatsDto as ModelPostgresStatsDto,
    ReconciliationScanScope,
    ReconciliationScanSummaryDto,
    ReconciliationTruncatedByType,
    SdlcPipelineStageCoverageDto,
} from '../models/reconciliation.models.js';

/**
 * Every discrepancy category the cockpit can render, in display order. This tuple is the ONLY
 * list of gap types the UI filters, counts and labels by — `DiscrepancyType` is checked against it
 * at compile time, so a new API type cannot silently render in the ledger without a category.
 */
export const DISCREPANCY_TYPES = [
    'GAP_A_ORPHAN_ROUTE',
    'GAP_B_UNFED_SCHEMA',
    'GAP_C_STALE_HASH',
    'GAP_D_UNLINKED_SPIKE',
    'GAP_E_MISSING_SDLC_DOC',
    'GAP_F_INDEX_DRIFT',
] as const satisfies readonly DiscrepancyType[];

export type DiscrepancyCategory = (typeof DISCREPANCY_TYPES)[number];

/** Compile-time guard: the API's DiscrepancyType union and DISCREPANCY_TYPES must stay identical. */
type AssertSameUnion<A extends string, B extends string> = [Exclude<A, B>] extends [never]
    ? [Exclude<B, A>] extends [never]
        ? true
        : never
    : never;
const _discrepancyTypesAreExhaustive: AssertSameUnion<DiscrepancyType, DiscrepancyCategory> = true;
void _discrepancyTypesAreExhaustive;

/**
 * Gap types owned by each cockpit pillar. These are the exact sets the page filters rows by, so the
 * pillar counts, the ledger rows and the GAP-E stage fallback can never disagree with each other.
 */
export const PILLAR_DISCREPANCY_TYPES = {
    code: ['GAP_A_ORPHAN_ROUTE', 'GAP_B_UNFED_SCHEMA', 'GAP_D_UNLINKED_SPIKE'],
    sdlc: ['GAP_E_MISSING_SDLC_DOC'],
    postgres: ['GAP_F_INDEX_DRIFT'],
} as const satisfies Record<string, readonly DiscrepancyCategory[]>;

/** A gap type is "known" only if it has a category; unknown types are counted nowhere. */
export function isKnownDiscrepancyType(type: string): type is DiscrepancyCategory {
    return (DISCREPANCY_TYPES as readonly string[]).includes(type);
}

/** Per-category counts over a gap list (the ledger's rows). Unknown types are omitted, never guessed. */
export function countGapsByType(gaps: readonly ReconciliationGapDto[]): Partial<Record<DiscrepancyCategory, number>> {
    const counts: Partial<Record<DiscrepancyCategory, number>> = {};
    for (const gap of gaps) {
        if (!isKnownDiscrepancyType(gap.type)) continue;
        counts[gap.type] = (counts[gap.type] ?? 0) + 1;
    }
    return counts;
}

/** Number of gaps that belong to a pillar ('' / 'all' = every gap). */
export function countGapsInPillar(
    gaps: readonly ReconciliationGapDto[],
    pillar: string,
): number {
    if (pillar === 'all' || pillar === '') return gaps.length;
    const types = (PILLAR_DISCREPANCY_TYPES as Record<string, readonly DiscrepancyCategory[]>)[pillar];
    if (!types) return 0;
    return gaps.filter((gap) => (types as readonly string[]).includes(gap.type)).length;
}

/**
 * Sum of backend-reported capped-out gaps that the current pillar/type filter would keep.
 * Shares the pillar type sets above, so a capped-out count can only appear for a pillar that
 * would actually have rendered those rows.
 */
export function countHiddenByCap(
    truncated: ReconciliationTruncatedByType | undefined,
    pillar: string,
    type: string,
): number {
    if (!truncated) return 0;
    const pillarTypes = pillar === 'all' || pillar === ''
        ? null
        : ((PILLAR_DISCREPANCY_TYPES as Record<string, readonly DiscrepancyCategory[]>)[pillar] ?? []);
    let total = 0;
    for (const gapType of Object.keys(truncated) as DiscrepancyType[]) {
        const dropped = truncated[gapType];
        if (typeof dropped !== 'number' || dropped <= 0) continue;
        if (pillarTypes && !(pillarTypes as readonly string[]).includes(gapType)) continue;
        if (type !== 'all' && gapType !== type) continue;
        total += dropped;
    }
    return total;
}

/** The gap a pipeline stage points at, so a stage chip can select the row it actually describes. */
export function findGapBackingStage(
    gaps: readonly ReconciliationGapDto[],
    stage: SdlcPipelineStageCoverageDto,
): ReconciliationGapDto | null {
    if (stage.gapId) {
        return gaps.find((gap) => gap.id === stage.gapId) ?? null;
    }
    if (stage.status !== 'missing') return null;
    const folder = stage.directory.replace(/\/$/, '');
    return (
        gaps.find(
            (gap) =>
                gap.type === 'GAP_E_MISSING_SDLC_DOC' &&
                (gap.filePath.replace(/\/$/, '').endsWith(folder) || gap.symbol.includes(`Missing ${stage.stage} `)),
        ) ?? null
    );
}

/** Everything the summary renders, reloaded as one snapshot. */
export interface ReconciliationSnapshot {
    gaps: ReconciliationGapDto[];
    pipelineStages?: SdlcPipelineStageCoverageDto[];
    postgresStats?: ModelPostgresStatsDto;
    lastScannedAt?: string;
    scanScope?: ReconciliationScanScope;
    ignoredCount?: number;
    truncated?: ReconciliationTruncatedByType;
}

/**
 * Converts an api-client `PostgresKnowledgeStatsDto` into the UI mirror's shape.
 * Both DTOs now carry the server's real fields (`ghostDbCount` replaced a non-existent
 * `lastSyncedAt` in api-client/types.ts), so this is a straight pass-through.
 */
function toModelStats(stats: ApiPostgresStatsDto): ModelPostgresStatsDto {
    return {
        diskMarkdownCount: stats.diskMarkdownCount,
        indexedDocsCount: stats.indexedDocsCount,
        unindexedCount: stats.unindexedCount,
        staleDbCount: stats.staleDbCount,
        ghostDbCount: stats.ghostDbCount ?? 0,
    };
}

@Injectable({
    providedIn: 'root',
})
export class ReconciliationService {
    private readonly consumerService = inject(ConsumerProfileService);

    // Consumer-scoped state
    private readonly gapsByConsumer = signal<Record<string, ReconciliationGapDto[]>>({});
    private readonly pipelineStagesByConsumer = signal<Record<string, SdlcPipelineStageCoverageDto[]>>({});
    private readonly postgresStatsByConsumer = signal<Record<string, ModelPostgresStatsDto>>({});
    private readonly truncatedByConsumer = signal<Record<string, ReconciliationTruncatedByType>>({});

    readonly activeConsumerId = signal<string>('');
    readonly scanScope = signal<ReconciliationScanScope>('full');
    readonly ignoredCount = signal<number>(0);
    readonly scanning = signal<boolean>(false);
    readonly syncingIndex = signal<boolean>(false);
    readonly error = signal<string | null>(null);
    readonly lastScannedAt = signal<string | null>(null);

    // Active consumer gaps (backwards compatible with existing page and shell components)
    readonly gaps = computed<ReconciliationGapDto[]>(() => {
        const id = this.activeConsumerId();
        return id ? (this.gapsByConsumer()[id] ?? []) : [];
    });

    // Active consumer pipeline stages
    readonly pipelineStages = computed<SdlcPipelineStageCoverageDto[]>(() => {
        const id = this.activeConsumerId();
        return id ? (this.pipelineStagesByConsumer()[id] ?? []) : [];
    });

    // Active consumer PostgreSQL sync stats
    readonly postgresStats = computed<ModelPostgresStatsDto | null>(() => {
        const id = this.activeConsumerId();
        return id ? (this.postgresStatsByConsumer()[id] ?? null) : null;
    });

    // Active consumer truncation counts reported by the backend emission cap
    readonly truncated = computed<ReconciliationTruncatedByType>(
        () => this.truncatedByConsumer()[this.activeConsumerId()] ?? {}
    );

    // Computed Summary Metrics — every per-category count is derived from `gaps()` (the same array
    // the ledger renders), in the one place, so header, tabs and pillars cannot drift apart.
    readonly summary = computed<ReconciliationScanSummaryDto>(() => {
        const allGaps = this.gaps();
        const byType = countGapsByType(allGaps);
        return {
            totalGaps: allGaps.length,
            openGaps: allGaps.filter((g) => g.status === 'open').length,
            stagedGaps: allGaps.filter((g) => g.status === 'staged_in_inbox').length,
            orphanRoutes: byType.GAP_A_ORPHAN_ROUTE ?? 0,
            unfedSchemas: byType.GAP_B_UNFED_SCHEMA ?? 0,
            staleContracts: byType.GAP_C_STALE_HASH ?? 0,
            unlinkedSpikes: byType.GAP_D_UNLINKED_SPIKE ?? 0,
            missingSdlcDocs: byType.GAP_E_MISSING_SDLC_DOC ?? 0,
            indexDrift: byType.GAP_F_INDEX_DRIFT ?? 0,
            lastScannedAt: this.lastScannedAt() || 'Never scanned',
            scope: this.scanScope(),
            ignoredCount: this.ignoredCount(),
            truncated: this.truncated(),
            pipelineStages: this.pipelineStages(),
            postgresStats: this.postgresStats() || undefined,
        };
    });

    private normalizeStages(stages: any[]): SdlcPipelineStageCoverageDto[] {
        return stages.map((s) => ({
            stage: s.stage,
            name: s.name || s.label || s.stage,
            owner: s.owner || s.leadRole || 'TEAM',
            group: s.group,
            directory: s.directory || s.expectedFolder || 'sdlc/',
            docCount: typeof s.docCount === 'number' ? s.docCount : 0,
            status: s.status || 'missing',
            gapId: typeof s.gapId === 'string' && s.gapId.trim() ? s.gapId : undefined,
        }));
    }

    /**
     * Stores the backend-reported per-type truncation counts for a consumer.
     * A missing/absent payload is treated as `{}` (nothing was dropped).
     */
    private setTruncated(consumerId: string, truncated: ReconciliationTruncatedByType | undefined): void {
        this.truncatedByConsumer.update((prev) => ({
            ...prev,
            [consumerId]: truncated ?? {},
        }));
    }

    /**
     * Commits one backend snapshot (or a locally mutated gap list) for a consumer as a SINGLE
     * atomic write, so `gaps()`, `truncated()` and every header count derived from them always
     * describe the same fetch. Fields absent from the snapshot keep their previous value.
     */
    private commitSnapshot(consumerId: string, snapshot: ReconciliationSnapshot): void {
        this.gapsByConsumer.update((prev) => ({
            ...prev,
            [consumerId]: snapshot.gaps,
        }));
        if (snapshot.pipelineStages) {
            this.pipelineStagesByConsumer.update((prev) => ({
                ...prev,
                [consumerId]: this.normalizeStages(snapshot.pipelineStages!),
            }));
        }
        if (snapshot.postgresStats) {
            this.postgresStatsByConsumer.update((prev) => ({
                ...prev,
                [consumerId]: toModelStats(snapshot.postgresStats!),
            }));
        }
        if (snapshot.lastScannedAt) {
            this.lastScannedAt.set(snapshot.lastScannedAt);
        }
        if (snapshot.scanScope) {
            this.scanScope.set(snapshot.scanScope);
        }
        if (typeof snapshot.ignoredCount === 'number') {
            this.ignoredCount.set(snapshot.ignoredCount);
        }
        if (snapshot.truncated !== undefined) {
            this.setTruncated(consumerId, snapshot.truncated);
        }
    }

    /**
     * Replaces the gap list for a consumer after a local mutation (ignore/resolve). The same
     * snapshot commit is used as for a backend fetch, so the status columns and every derived
     * count move together. Local mutations never invented cap entries, so none are written here.
     */
    private commitLocalGaps(consumerId: string, nextGaps: ReconciliationGapDto[]): void {
        this.commitSnapshot(consumerId, { gaps: nextGaps });
    }

    /**
     * Sets the active consumer ID for scoped state and views.
     */
    setActiveConsumer(consumerId: string): void {
        this.activeConsumerId.set(consumerId);
        this.error.set(null);
    }

    /**
     * Loads the last known scan results from the backend for the given consumer.
     */
    async loadGaps(consumerId: string): Promise<ReconciliationGapDto[]> {
        if (!consumerId) return [];
        this.setActiveConsumer(consumerId);
        try {
            const res = await this.consumerService.getReconciliationGaps(consumerId);
            const loadedGaps = res.gaps || [];
            this.commitSnapshot(consumerId, {
                gaps: loadedGaps,
                pipelineStages: res.pipelineStages,
                postgresStats: res.postgresStats,
                lastScannedAt: res.scannedAt ? new Date(res.scannedAt).toLocaleTimeString() : '',
                scanScope: res.scope,
                ignoredCount: res.ignoredCount,
                truncated: res.truncated,
            });
            this.error.set(null);
            return loadedGaps;
        } catch (err: any) {
            const message = err?.message || 'Failed to load reconciliation gaps';
            this.error.set(message);
            return this.gapsByConsumer()[consumerId] ?? [];
        }
    }

    /**
     * Performs a scan across the AST, artifacts folder, and sdlc/ knowledge base via the backend.
     */
    async scanWorkspaceAndArtifacts(consumerId: string, scope?: ReconciliationScanScope): Promise<ReconciliationGapDto[]> {
        if (!consumerId) return [];
        this.setActiveConsumer(consumerId);
        const effectiveScope = scope || this.scanScope();
        this.scanScope.set(effectiveScope);
        this.scanning.set(true);
        this.error.set(null);

        try {
            const result = await this.consumerService.scanReconciliation(consumerId, effectiveScope);
            const detectedGaps = result.gaps || [];
            this.commitSnapshot(consumerId, {
                gaps: detectedGaps,
                pipelineStages: result.pipelineStages,
                postgresStats: result.postgresStats,
                lastScannedAt: result.scannedAt
                    ? new Date(result.scannedAt).toLocaleTimeString()
                    : new Date().toLocaleTimeString(),
                scanScope: effectiveScope,
                ignoredCount: result.ignoredCount,
                truncated: result.truncated,
            });
            this.scanning.set(false);
            return detectedGaps;
        } catch (err: any) {
            this.scanning.set(false);
            const message = err?.message || 'Reconciliation scan failed';
            this.error.set(message);
            throw err;
        }
    }

    /**
     * Triggers sync between markdown artifacts on disk and PostgreSQL knowledge_doc index.
     */
    async syncPostgresIndex(consumerId: string): Promise<ReconciliationGapDto[]> {
        if (!consumerId) return [];
        this.setActiveConsumer(consumerId);
        this.syncingIndex.set(true);
        this.error.set(null);

        try {
            const result = await this.consumerService.syncReconciliationIndex(consumerId);
            const updatedGaps = result.gaps || [];
            this.commitSnapshot(consumerId, {
                gaps: updatedGaps,
                pipelineStages: result.pipelineStages,
                postgresStats: result.postgresStats,
                lastScannedAt: result.scannedAt
                    ? new Date(result.scannedAt).toLocaleTimeString()
                    : new Date().toLocaleTimeString(),
                ignoredCount: result.ignoredCount,
                truncated: result.truncated,
            });
            this.syncingIndex.set(false);
            return updatedGaps;
        } catch (err: any) {
            this.syncingIndex.set(false);
            const message = err?.message || 'PostgreSQL index sync failed';
            this.error.set(message);
            throw err;
        }
    }

    /**
     * Extracts a reverse-engineered draft artifact into the Consumer's Artifact Inbox.
     * Enforces Invariant I-01 / I-02:
     * - Origin is set to 'agent' (sub-origin 'reverse-extraction')
     * - ktState is ALWAYS 'proposed' (NEVER auto-approved, preserving Gate S17 human review).
     * For GAP_E_MISSING_SDLC_DOC, generates a clean SDLC YAML frontmatter skeleton passing KM-05.
     * Includes codeSnippet in Markdown body if present.
     * Updates gap status to 'staged_in_inbox' upon successful persistence.
     */
    async extractDraftToInbox(consumerId: string, gapId: string): Promise<ConsumerArtifactDto | null> {
        this.error.set(null);
        const currentGaps = this.gapsByConsumer()[consumerId] || [];
        const gap = currentGaps.find((g) => g.id === gapId);
        if (!gap) {
            const err = new Error(`GAP with ID '${gapId}' not found.`);
            this.error.set(err.message);
            throw err;
        }

        const draftArtifactId = `draft-${gap.id}-${Date.now()}`;
        const snippetSection = gap.codeSnippet
            ? `\n## Extracted Source Snippet\n\`\`\`typescript\n${gap.codeSnippet}\n\`\`\`\n`
            : '';

        let draftBody = '';
        if (gap.type === 'GAP_E_MISSING_SDLC_DOC') {
            const docSlug = gap.symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            draftBody = `---
id: ${docSlug || 'sdlc-doc'}
title: "${gap.symbol}"
type: specification
status: DRAFT
owner: PO
created_at: "${new Date().toISOString()}"
target_path: "${gap.suggestedTarget}"
---

# ${gap.symbol}

## Overview & Background
${gap.detail}

## Objectives & Scope
- Generated as canonical SDLC skeleton for pipeline coverage.
- Please detail functional requirements, acceptance criteria, and invariants before promotion.

## Implementation & Directives
${gap.promptTemplate}

---
*Generated by Vibe-Code Reconciliation Guard (GAP-E). Status is 'proposed' awaiting operator verification.*
`;
        } else {
            draftBody = `# Reconciled Draft: ${gap.symbol}

## Origin & Context
- **Discrepancy Type**: \`${gap.type}\`
- **Severity**: \`${gap.severity}\`
- **Source Code**: \`${gap.filePath}:${gap.lines}\`
- **Suggested Canonical Target**: \`${gap.suggestedTarget}\`
- **Detected At**: ${gap.detectedAt}

## Extracted Details
${gap.detail}
${snippetSection}
## Proposed Resolution Action
${gap.promptTemplate}

---
*Generated by Vibe-Code Reconciliation Guard. Status is 'proposed' awaiting operator verification.*
`;
        }

        const draftArtifact: Partial<ConsumerArtifactDto> = {
            id: draftArtifactId,
            consumerId: consumerId,
            title: `[Reconciled Draft] ${gap.symbol} (${gap.type})`,
            origin: 'agent', // Validated enum: 'host' | 'user' | 'agent' | 'machine'
            custodian: 'staging',
            ktState: 'proposed', // Invariant: NEVER auto-approved
            liveness: 'living',
            derivedFrom: [gap.filePath],
            contentType: 'text/markdown',
            body: draftBody,
            metadata: {
                originType: 'reverse-extraction',
                gapId: gap.id,
                severity: gap.severity,
                sourceLocation: `${gap.filePath}:${gap.lines}`,
                suggestedTarget: gap.suggestedTarget,
                gateStatus: 'S17_PENDING_APPROVAL',
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        try {
            // Real backend persistence via consumerProfileService -> apiClient.createArtifact
            const created = await this.consumerService.createArtifact(consumerId, draftArtifact);

            // Mark the GAP as staged_in_inbox in consumer-scoped state
            this.commitLocalGaps(
                consumerId,
                (this.gapsByConsumer()[consumerId] ?? []).map((g) =>
                    g.id === gapId ? { ...g, status: 'staged_in_inbox' } : g,
                ),
            );

            return created;
        } catch (err: any) {
            const message = err?.message || 'Failed to extract draft to Artifacts Inbox';
            this.error.set(message);
            throw err;
        }
    }

    /**
     * Ignores a discrepancy by adding it to the consumer's .harness/reconcile-ignore.json list.
     */
    async ignoreGap(consumerId: string, gapId: string, reason?: string): Promise<void> {
        this.error.set(null);
        const currentGaps = this.gapsByConsumer()[consumerId] || [];
        const gap = currentGaps.find((g) => g.id === gapId);

        try {
            const res = await this.consumerService.ignoreReconciliationGap(consumerId, {
                gapId,
                filePath: gap?.filePath,
                symbol: gap?.symbol,
                reason,
            });

            // Remove gap from consumer state and update ignoredCount
            this.commitLocalGaps(
                consumerId,
                (this.gapsByConsumer()[consumerId] ?? []).filter((g) => g.id !== gapId),
            );
            if (typeof res.ignoredCount === 'number') {
                this.ignoredCount.set(res.ignoredCount);
            }
        } catch (err: any) {
            const message = err?.message || 'Failed to ignore discrepancy';
            this.error.set(message);
            throw err;
        }
    }

    /**
     * Re-locks the hash baseline for a GAP-C stale hash discrepancy.
     */
    async relockHash(consumerId: string, gapId: string): Promise<void> {
        this.error.set(null);
        const currentGaps = this.gapsByConsumer()[consumerId] || [];
        const gap = currentGaps.find((g) => g.id === gapId);
        if (!gap) {
            const err = new Error(`GAP with ID '${gapId}' not found.`);
            this.error.set(err.message);
            throw err;
        }

        try {
            await this.consumerService.relockReconciliationHash(consumerId, {
                gapId,
                filePath: gap.filePath,
            });

            // Mark gap resolved
            this.markGapResolved(gapId, consumerId);
        } catch (err: any) {
            const message = err?.message || 'Failed to re-lock hash baseline';
            this.error.set(message);
            throw err;
        }
    }

    /**
     * Marks a gap as fully resolved (e.g. after Gate S17 approval in Artifacts Inbox).
     */
    markGapResolved(gapId: string, consumerId?: string): void {
        const targetConsumerId = consumerId || this.activeConsumerId();
        if (!targetConsumerId) return;

        this.commitLocalGaps(
            targetConsumerId,
            (this.gapsByConsumer()[targetConsumerId] ?? []).map((g) =>
                g.id === gapId ? { ...g, status: 'resolved' } : g,
            ),
        );
    }
}
