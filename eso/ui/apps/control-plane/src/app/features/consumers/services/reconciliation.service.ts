import { Injectable, computed, inject, signal } from '@angular/core';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { ConsumerArtifactDto } from '../pages/consumer-settings.models.js';
import type {
    DiscrepancySeverity,
    DiscrepancyType,
    PostgresKnowledgeStatsDto,
    ReconciliationGapDto,
    ReconciliationScanScope,
    ReconciliationScanSummaryDto,
    SdlcPipelineStageCoverageDto,
} from '../models/reconciliation.models.js';

@Injectable({
    providedIn: 'root',
})
export class ReconciliationService {
    private readonly consumerService = inject(ConsumerProfileService);

    // Consumer-scoped state
    private readonly gapsByConsumer = signal<Record<string, ReconciliationGapDto[]>>({});
    private readonly pipelineStagesByConsumer = signal<Record<string, SdlcPipelineStageCoverageDto[]>>({});
    private readonly postgresStatsByConsumer = signal<Record<string, PostgresKnowledgeStatsDto>>({});

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
    readonly postgresStats = computed<PostgresKnowledgeStatsDto | null>(() => {
        const id = this.activeConsumerId();
        return id ? (this.postgresStatsByConsumer()[id] ?? null) : null;
    });

    // Computed Summary Metrics
    readonly summary = computed<ReconciliationScanSummaryDto>(() => {
        const allGaps = this.gaps();
        return {
            totalGaps: allGaps.length,
            openGaps: allGaps.filter((g) => g.status === 'open').length,
            stagedGaps: allGaps.filter((g) => g.status === 'staged_in_inbox').length,
            orphanRoutes: allGaps.filter((g) => g.type === 'GAP_A_ORPHAN_ROUTE').length,
            unfedSchemas: allGaps.filter((g) => g.type === 'GAP_B_UNFED_SCHEMA').length,
            staleContracts: allGaps.filter((g) => g.type === 'GAP_C_STALE_HASH').length,
            unlinkedSpikes: allGaps.filter((g) => g.type === 'GAP_D_UNLINKED_SPIKE').length,
            missingSdlcDocs: allGaps.filter((g) => g.type === 'GAP_E_MISSING_SDLC_DOC').length,
            indexDrift: allGaps.filter((g) => g.type === 'GAP_F_INDEX_DRIFT').length,
            lastScannedAt: this.lastScannedAt() || 'Never scanned',
            scope: this.scanScope(),
            ignoredCount: this.ignoredCount(),
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
        }));
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
            this.gapsByConsumer.update((prev) => ({
                ...prev,
                [consumerId]: loadedGaps,
            }));
            if (res.pipelineStages) {
                this.pipelineStagesByConsumer.update((prev) => ({
                    ...prev,
                    [consumerId]: this.normalizeStages(res.pipelineStages!),
                }));
            }
            if (res.postgresStats) {
                this.postgresStatsByConsumer.update((prev) => ({
                    ...prev,
                    [consumerId]: res.postgresStats!,
                }));
            }
            if (res.scannedAt) {
                this.lastScannedAt.set(new Date(res.scannedAt).toLocaleTimeString());
            }
            if (res.scope) {
                this.scanScope.set(res.scope);
            }
            if (typeof res.ignoredCount === 'number') {
                this.ignoredCount.set(res.ignoredCount);
            }
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

            this.gapsByConsumer.update((prev) => ({
                ...prev,
                [consumerId]: detectedGaps,
            }));
            if (result.pipelineStages) {
                this.pipelineStagesByConsumer.update((prev) => ({
                    ...prev,
                    [consumerId]: this.normalizeStages(result.pipelineStages!),
                }));
            }
            if (result.postgresStats) {
                this.postgresStatsByConsumer.update((prev) => ({
                    ...prev,
                    [consumerId]: result.postgresStats!,
                }));
            }
            this.lastScannedAt.set(
                result.scannedAt ? new Date(result.scannedAt).toLocaleTimeString() : new Date().toLocaleTimeString()
            );
            if (typeof result.ignoredCount === 'number') {
                this.ignoredCount.set(result.ignoredCount);
            }
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

            this.gapsByConsumer.update((prev) => ({
                ...prev,
                [consumerId]: updatedGaps,
            }));
            if (result.pipelineStages) {
                this.pipelineStagesByConsumer.update((prev) => ({
                    ...prev,
                    [consumerId]: this.normalizeStages(result.pipelineStages!),
                }));
            }
            if (result.postgresStats) {
                this.postgresStatsByConsumer.update((prev) => ({
                    ...prev,
                    [consumerId]: result.postgresStats!,
                }));
            }
            this.lastScannedAt.set(
                result.scannedAt ? new Date(result.scannedAt).toLocaleTimeString() : new Date().toLocaleTimeString()
            );
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
            this.gapsByConsumer.update((prev) => {
                const consumerGaps = prev[consumerId] || [];
                return {
                    ...prev,
                    [consumerId]: consumerGaps.map((g) => (g.id === gapId ? { ...g, status: 'staged_in_inbox' } : g)),
                };
            });

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
            this.gapsByConsumer.update((prev) => {
                const consumerGaps = prev[consumerId] || [];
                return {
                    ...prev,
                    [consumerId]: consumerGaps.filter((g) => g.id !== gapId),
                };
            });
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

        this.gapsByConsumer.update((prev) => {
            const consumerGaps = prev[targetConsumerId] || [];
            return {
                ...prev,
                [targetConsumerId]: consumerGaps.map((g) => (g.id === gapId ? { ...g, status: 'resolved' } : g)),
            };
        });
    }
}
