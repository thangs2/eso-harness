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
}

export interface PostgresKnowledgeStatsDto {
    diskMarkdownCount: number;
    indexedDocsCount: number;
    unindexedCount: number;
    staleDbCount: number;
    lastSyncedAt: string | null;
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
    pipelineStages?: SdlcPipelineStageCoverageDto[];
    postgresStats?: PostgresKnowledgeStatsDto;
}

