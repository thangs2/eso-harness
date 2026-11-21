import { Injectable, inject } from '@angular/core';
import { CONTROL_PLANE_API_CLIENT } from '../tokens.js';
import type { ConsumerListResponse, ConsumerPlan, ConsumerProfile, FsBrowseResponse, FsResolveDirectoryResponse, HostDiscoveryDto, McpDiscoveryDto, SetupConsumerPayload, StackVersionsDto, WorkerConfigDto, WorkerPolicyResultDto, WorkerImportPreviewDto, WorkerImportRecordDto, RuleFileDto, RuleImportPreviewDto, MaterialSummaryDto, FlowDefinitionDto, FlowSummaryDto, FlowValidationDto, FlowProposalDto, WorkerSourceStatusDto, PluginManifestDto, ConsumerPluginDto, ProviderRecordDto, JiraProjectDto, KnowledgeSummaryDto, KnowledgeDocDto, KnowledgeFindingDto, KnowledgeDocDetailDto, KnowledgeCheckDto, KnowledgeRetrievalDto, KnowledgeEmbeddingStatusDto, KnowledgeEmbeddingResultDto, HostRuntimeDto, HostDto, WorkerPlacementDto, ObservationDto, LegacyHarnessReportDto, LegacyHarnessArchiveDto, HarnessMigrationPreviewDto, HarnessMigrationResultDto, ConflictResolutionResultDto, JudgmentResponseDto, JevDecisionDto, GraphImpactResponseDto, LearningProposalDto, ProvisionConsumerResponse, BoundaryViewDto, FolderPolicyDto, BoundaryGrantDto } from '../../../../../../libs/api-client/types.js';

@Injectable({ providedIn: 'root' })
export class ConsumerProfileService {
    private readonly client = inject(CONTROL_PLANE_API_CLIENT, { optional: true });

    list(): Promise<ConsumerListResponse> {
        if (!this.client) return Promise.resolve({ items: [] });
        return this.client.listConsumers();
    }

    async get(project: string): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        const profile = await this.client.getConsumer(project);
        // The API returns the generated `.harness/config.json` wrapper; the UI edits the
        // canonical profile inside it. Older consumers may contain more than one wrapper.
        let inner = profile.profile as unknown as Record<string, any>;
        for (let depth = 0; depth < 4 && inner && typeof inner === 'object' && inner.profile && typeof inner.profile === 'object'; depth += 1) {
            inner = inner.profile;
        }
        if (inner && typeof inner === 'object') profile.profile = inner as ConsumerProfile['profile'];
        return profile;
    }

    getLegacyHarness(id: string): Promise<LegacyHarnessReportDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getLegacyHarness(id);
    }

    archiveLegacyHarness(id: string): Promise<LegacyHarnessArchiveDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.archiveLegacyHarness(id);
    }

    provision(id: string): Promise<ProvisionConsumerResponse> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.provisionConsumer(id);
    }

    resolveMigrationConflict(id: string, entryId: string, strategy: 'keep-eso' | 'adopt-legacy'): Promise<ConflictResolutionResultDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.resolveMigrationConflict(id, entryId, strategy);
    }

    evaluateSufficiency(id: string, body: Record<string, unknown>): Promise<JudgmentResponseDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.evaluateSufficiency(id, body);
    }

    decideJev(id: string, confidence: number): Promise<JevDecisionDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.decideJev(id, confidence);
    }

    learningProposals(id: string): Promise<{ consumerId: string; proposals: LearningProposalDto[] }> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.learningProposals(id);
    }

    learningAction(id: string, proposalId: string, action: 'approve' | 'reject' | 'apply' | 'revert', body: Record<string, unknown> = {}): Promise<LearningProposalDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.learningAction(id, proposalId, action, body);
    }

    graphImpact(id: string, query: Record<string, string | number | undefined>): Promise<GraphImpactResponseDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.graphImpact(id, query);
    }

    getBoundaries(id: string): Promise<BoundaryViewDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getBoundaries(id);
    }

    saveBoundaries(id: string, policies: FolderPolicyDto[], enforcement: 'audit' | 'enforce' = 'audit'): Promise<BoundaryViewDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.saveBoundaries(id, policies, enforcement);
    }

    createBoundaryGrant(id: string, body: Record<string, unknown>): Promise<BoundaryGrantDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.createBoundaryGrant(id, body);
    }

    revokeBoundaryGrant(id: string, grantId: string): Promise<{ revoked: boolean }> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.revokeBoundaryGrant(id, grantId);
    }

    previewHarnessMigration(id: string): Promise<HarnessMigrationPreviewDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.previewHarnessMigration(id);
    }

    applyHarnessMigration(id: string): Promise<HarnessMigrationResultDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.applyHarnessMigration(id);
    }

    plan(profile: ConsumerProfile): Promise<ConsumerPlan> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.planConsumer(profile);
    }

    getStackVersions(id: string): Promise<StackVersionsDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerStackVersions(id);
    }

    saveStackVersions(id: string, versions: unknown[]): Promise<StackVersionsDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.saveConsumerStackVersions(id, versions);
    }

    getKnowledge(id: string): Promise<KnowledgeSummaryDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerKnowledge(id);
    }

    getKnowledgeDocs(id: string, query = ''): Promise<KnowledgeDocDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerKnowledgeDocs(id, query);
    }

    getKnowledgeEmbeddings(id: string): Promise<KnowledgeEmbeddingStatusDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerKnowledgeEmbeddings(id);
    }

    embedKnowledge(id: string): Promise<KnowledgeEmbeddingResultDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.embedConsumerKnowledge(id);
    }

    retrieveKnowledge(id: string, query: string, filters: { type?: string; status?: string } = {}): Promise<KnowledgeRetrievalDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.retrieveConsumerKnowledge(id, query, filters);
    }

    checkKnowledge(id: string): Promise<KnowledgeCheckDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.checkConsumerKnowledge(id);
    }

    getKnowledgeDoc(id: string, docId: string): Promise<KnowledgeDocDetailDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerKnowledgeDoc(id, docId);
    }

    getKnowledgeFindings(id: string): Promise<KnowledgeFindingDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerKnowledgeFindings(id);
    }

    indexKnowledge(id: string): Promise<KnowledgeSummaryDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.indexConsumerKnowledge(id);
    }

    getPlugins(): Promise<PluginManifestDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getPlugins();
    }

    getConsumerPlugins(id: string): Promise<ConsumerPluginDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerPlugins(id);
    }

    configureConsumerPlugin(id: string, pluginId: string, payload: any): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.configureConsumerPlugin(id, pluginId, payload);
    }

    getPluginProjects(id: string, pluginId: string): Promise<JiraProjectDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getPluginProjects(id, pluginId);
    }

    installPlugin(manifest: any): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.installPlugin(manifest);
    }

    removePlugin(pluginId: string): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.removePlugin(pluginId);
    }

    syncConsumerPlugin(id: string, pluginId: string): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.syncConsumerPlugin(id, pluginId);
    }

    getProviderRecords(id: string, provider?: string): Promise<ProviderRecordDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getProviderRecords(id, provider);
    }

    testConsumerPlugin(id: string, pluginId: string): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.testConsumerPlugin(id, pluginId);
    }

    getWorkerSourceStatus(id: string): Promise<WorkerSourceStatusDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getWorkerSourceStatus(id);
    }

    syncWorkerSources(id: string): Promise<WorkerSourceStatusDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.syncWorkerSources(id);
    }

    promoteWorkerProjection(id: string, workerId: string): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.promoteWorkerProjection(id, workerId);
    }

    getFlows(id: string): Promise<FlowSummaryDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerFlows(id);
    }

    getFlowProposal(id: string): Promise<FlowProposalDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerFlowProposal(id);
    }

    applyFlowProposal(id: string): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.applyConsumerFlowProposal(id);
    }

    getDefaultFlow(id: string): Promise<FlowDefinitionDto | null> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerDefaultFlow(id);
    }

    setDefaultFlow(id: string, flowId: string, version: number): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.setConsumerDefaultFlow(id, flowId, version);
    }

    getFlow(id: string, flowId: string): Promise<FlowDefinitionDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerFlow(id, flowId);
    }

    saveFlow(id: string, flowId: string, flow: Partial<FlowDefinitionDto>): Promise<FlowDefinitionDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.saveConsumerFlow(id, flowId, flow);
    }

    validateFlow(id: string, flowId: string, flow: Partial<FlowDefinitionDto>): Promise<FlowValidationDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.validateConsumerFlow(id, flowId, flow);
    }

    publishFlow(id: string, flowId: string): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.publishConsumerFlow(id, flowId);
    }

    deleteFlowDraft(id: string, flowId: string): Promise<any> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.deleteConsumerFlowDraft(id, flowId);
    }

    getMaterialSummary(id: string): Promise<MaterialSummaryDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerMaterialSummary(id);
    }

    deleteRule(id: string, ruleId: string): Promise<{ removed: boolean }> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.deleteConsumerRule(id, ruleId);
    }

    getRules(id: string): Promise<RuleFileDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerRules(id);
    }

    previewRuleImport(id: string, files: Array<{ name: string; content: string }>): Promise<RuleImportPreviewDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.previewConsumerRuleImport(id, files);
    }

    applyRuleImport(id: string, candidates: any[]): Promise<{ written: any[] }> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.applyConsumerRuleImport(id, candidates);
    }

    getWorkerImports(id: string): Promise<WorkerImportRecordDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerWorkerImports(id);
    }

    recordWorkerImport(id: string, record: any): Promise<void> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.recordConsumerWorkerImport(id, record);
    }

    previewWorkerImport(id: string, files: Array<{ name: string; content: string }>): Promise<WorkerImportPreviewDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.previewConsumerWorkerImport(id, files);
    }

    checkWorker(id: string, workerId: string, action: { verb: string; path?: string; evidence?: any[] }): Promise<WorkerPolicyResultDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.checkConsumerWorker(id, workerId, action);
    }

    getWorkers(id: string): Promise<WorkerConfigDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerWorkers(id);
    }

    saveWorkers(id: string, config: WorkerConfigDto): Promise<WorkerConfigDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.saveConsumerWorkers(id, config);
    }

    getHosts(): Promise<HostDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getHosts();
    }

    saveHost(host: { hostId: string; hostType: string; label: string }): Promise<HostDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.saveHost(host);
    }

    getHostRuntimes(): Promise<HostRuntimeDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getHostRuntimes();
    }

    saveHostRuntime(runtime: HostRuntimeDto): Promise<HostRuntimeDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.saveHostRuntime(runtime);
    }

    heartbeatHostRuntime(hostId: string, runtimeId: string): Promise<HostRuntimeDto | null> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.heartbeatHostRuntime(hostId, runtimeId);
    }

    getObservations(id: string, limit = 100): Promise<ObservationDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerObservations(id, limit);
    }

    createObservation(id: string, body: Partial<ObservationDto> & { event: string }): Promise<ObservationDto | null> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.createConsumerObservation(id, body);
    }

    getWorkerPlacement(id: string): Promise<WorkerPlacementDto[]> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerWorkerPlacement(id);
    }

    saveWorkerPlacement(id: string, workerId: string, placement: WorkerPlacementDto): Promise<WorkerPlacementDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.saveConsumerWorkerPlacement(id, workerId, placement);
    }

    getDetectedHosts(id: string): Promise<HostDiscoveryDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerHosts(id);
    }

    getMcp(id: string): Promise<McpDiscoveryDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerMcp(id);
    }

    listDirectories(path?: string): Promise<FsBrowseResponse> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.browseDirectories(path);
    }

    resolveDirectory(name: string): Promise<FsResolveDirectoryResponse> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.resolveDirectory(name);
    }

    createSetup(payload: SetupConsumerPayload): Promise<{ id: string }> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.createConsumerSetup(payload);
    }

    create(profile: ConsumerProfile): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.createConsumer(profile);
    }

    updateSettings(
        id: string,
        name: string,
        profile: Record<string, unknown>,
        expectedVersion: number
    ): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.updateConsumerProfile(id, { name, profile, expected_version: expectedVersion });
    }

    update(project: string, profile: ConsumerProfile): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.updateConsumer(project, profile);
    }
}
