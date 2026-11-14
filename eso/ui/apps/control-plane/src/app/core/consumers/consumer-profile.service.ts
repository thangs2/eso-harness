import { Injectable, inject } from '@angular/core';
import { CONTROL_PLANE_API_CLIENT } from '../tokens.js';
import type { ConsumerListResponse, ConsumerPlan, ConsumerProfile, FsBrowseResponse, HostDiscoveryDto, McpDiscoveryDto, SetupConsumerPayload, StackVersionsDto, WorkerConfigDto, WorkerPolicyResultDto, WorkerImportPreviewDto, WorkerImportRecordDto, RuleFileDto, RuleImportPreviewDto, MaterialSummaryDto, FlowDefinitionDto, FlowSummaryDto, FlowValidationDto, FlowProposalDto, WorkerSourceStatusDto, KnowledgeSummaryDto, KnowledgeDocDto, KnowledgeFindingDto, KnowledgeDocDetailDto, KnowledgeCheckDto, KnowledgeRetrievalDto, KnowledgeEmbeddingStatusDto, KnowledgeEmbeddingResultDto } from '../../../../../../libs/api-client/types.js';

@Injectable({ providedIn: 'root' })
export class ConsumerProfileService {
    private readonly client = inject(CONTROL_PLANE_API_CLIENT, { optional: true });

    list(): Promise<ConsumerListResponse> {
        if (!this.client) return Promise.resolve({ items: [] });
        return this.client.listConsumers();
    }

    get(project: string): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumer(project);
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

    getHosts(id: string): Promise<HostDiscoveryDto> {
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
