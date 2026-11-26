export type ReconciliationScanScope = 'full' | 'git-diff';

export type DiscrepancyType =
    | 'GAP_A_ORPHAN_ROUTE'
    | 'GAP_B_UNFED_SCHEMA'
    | 'GAP_C_STALE_HASH'
    | 'GAP_D_UNLINKED_SPIKE'
    | 'GAP_E_MISSING_SDLC_DOC'
    | 'GAP_F_INDEX_DRIFT';

export type DiscrepancySeverity = 'critical' | 'warning' | 'info';

export type ReconciliationGapStatus = 'open' | 'staged_in_inbox' | 'resolved';

export interface SdlcPipelineStageCoverageDto {
    stage: string;
    name: string;
    owner: string;
    group: 'A' | 'B' | 'C' | 'D';
    directory: string;
    docCount: number;
    status: 'covered' | 'missing' | 'drift';
    /** Set by the backend only when a real gap backs this stage; the chip click selects it. */
    gapId?: string;
}

/**
 * UI mirror of the PostgreSQL knowledge stats used by the cockpit template (`ghostDbCount`).
 * Kept free of the older wire field on purpose: reconciliation-cockpit.test.mjs pins this shape.
 * reconciliation.service.ts converts the api-client payload with `toModelStats`.
 */
export interface PostgresKnowledgeStatsDto {
    diskMarkdownCount: number;
    indexedDocsCount: number;
    unindexedCount: number;
    staleDbCount: number;
    ghostDbCount: number;
}

export interface ReconciliationGapDto {
    id: string;
    type: DiscrepancyType;
    severity: DiscrepancySeverity;
    symbol: string;
    filePath: string;
    lines: string;
    codeSnippet?: string;
    detectedAt: string;
    detail: string;
    suggestedTarget: string;
    promptTemplate: string;
    status: ReconciliationGapStatus;
}

/**
 * Count of gaps DROPPED by the backend emission cap, keyed by GAP type
 * (GAP-F caps at MAX_INDEX_DRIFT_GAPS, A/B/D/E at MAX_GAPS_PER_CATEGORY).
 * A missing key means 0.
 */
export type ReconciliationTruncatedByType = Partial<Record<DiscrepancyType, number>>;

/** Backend scan / sync-index response (`ReconciliationScanResultDto`). */
export interface ReconciliationScanResultDto {
    consumerId: string;
    scannedAt: string;
    scope?: ReconciliationScanScope;
    ignoredCount?: number;
    truncated?: ReconciliationTruncatedByType;
    pipelineStages?: SdlcPipelineStageCoverageDto[];
    postgresStats?: PostgresKnowledgeStatsDto;
    gaps: ReconciliationGapDto[];
}

/** Backend stored-scan response (`ReconciliationGapsResponseDto`). */
export interface ReconciliationGapsResponseDto {
    consumerId: string;
    scannedAt: string | null;
    scope?: ReconciliationScanScope;
    ignoredCount?: number;
    truncated?: ReconciliationTruncatedByType;
    pipelineStages?: SdlcPipelineStageCoverageDto[];
    postgresStats?: PostgresKnowledgeStatsDto;
    gaps: ReconciliationGapDto[];
}

export interface ReconciliationScanSummaryDto {
    totalGaps: number;
    openGaps: number;
    stagedGaps: number;
    orphanRoutes: number;
    unfedSchemas: number;
    staleContracts: number;
    unlinkedSpikes: number;
    missingSdlcDocs: number;
    indexDrift: number;
    lastScannedAt: string;
    scope?: ReconciliationScanScope;
    ignoredCount?: number;
    truncated?: ReconciliationTruncatedByType;
    pipelineStages?: SdlcPipelineStageCoverageDto[];
    postgresStats?: PostgresKnowledgeStatsDto;
}

