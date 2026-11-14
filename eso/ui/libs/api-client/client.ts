import type {
    WorkOverviewResponse,
    ConfigPreviewDto,
    ProblemDetailsDto,
    ConsumerProfile,
    ConsumerListResponse,
    ConsumerPlan,
    SetupConsumerPayload,
    ProvisionConsumerOptions,
    ProvisionConsumerResponse,
    ConsumerSetupResponse,
    FsBrowseResponse,
    McpDiscoveryDto,
    HostDiscoveryDto,
    StackVersionsDto,
    WorkerConfigDto,
    WorkerPolicyResultDto,
    WorkerImportPreviewDto,
    WorkerImportAuditDto,
    WorkerImportRecordDto,
    RuleFileDto,
    RuleImportPreviewDto,
    MaterialSummaryDto,
    FlowDefinitionDto,
    FlowSummaryDto,
    WorkerSourceStatusDto,
    FlowValidationDto,
    FlowProposalDto,
    KnowledgeSummaryDto,
    KnowledgeDocDto,
    KnowledgeFindingDto,
    KnowledgeDocDetailDto,
    KnowledgeCheckDto,
    KnowledgeRetrievalDto,
    KnowledgeEmbeddingStatusDto,
    KnowledgeEmbeddingResultDto,
} from './types.js';

export class ControlPlaneApiClient {
    private baseUrl: string;
    private tokenProvider: () => string | null;

    constructor(options: { baseUrl?: string; tokenProvider?: () => string | null } = {}) {
        this.baseUrl = (options.baseUrl || 'http://127.0.0.1:8787').replace(/\/$/, '');
        this.tokenProvider = options.tokenProvider || (() => null);
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Accept': 'application/json, text/html',
        };
        const token = this.tokenProvider();
        if (token) {
            headers['Authorization'] = /^(Basic|Bearer)\s/i.test(token) ? token : `Bearer ${token}`;
        }
        return headers;
    }

    async getWorkOverview(project: string = 'default'): Promise<WorkOverviewResponse> {
        const url = `${this.baseUrl}/api/v1/work-overview?project=${encodeURIComponent(project)}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders(),
        });

        if (!res.ok) {
            let errorDetail: ProblemDetailsDto;
            try {
                errorDetail = await res.json() as ProblemDetailsDto;
            } catch {
                errorDetail = {
                    title: 'HTTP Error',
                    status: res.status,
                    detail: res.statusText,
                };
            }
            throw errorDetail;
        }

        return await res.json() as WorkOverviewResponse;
    }

    async getWorkOverviewHtml(project: string = 'default'): Promise<{ html: string; status: number }> {
        const url = `${this.baseUrl}/work-overview?project=${encodeURIComponent(project)}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders(),
        });
        const html = await res.text();
        return { html, status: res.status };
    }

    async previewConfig(project: string): Promise<ConfigPreviewDto> {
        const url = `${this.baseUrl}/api/config/preview?project=${encodeURIComponent(project)}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders(),
        });
        if (!res.ok) {
            throw new Error(`Preview failed with status ${res.status}`);
        }
        return await res.json() as ConfigPreviewDto;
    }

    async saveConfig(project: string, config: Record<string, unknown>, hash: string): Promise<{ success: boolean; hash: string }> {
        const url = `${this.baseUrl}/api/config/save`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                ...this.getHeaders(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ project, config, hash }),
        });
        if (!res.ok) {
            if (res.status === 409) {
                throw new Error('CONFIG_STALE_HASH: Configuration modified by another session. Please reload preview.');
            }
            throw new Error(`Save failed with status ${res.status}`);
        }
        return await res.json() as { success: boolean; hash: string };
    }
    async listConsumers(): Promise<ConsumerListResponse> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        const data = await res.json();
        return (Array.isArray(data) ? { items: data } : data) as ConsumerListResponse;
    }

    async getConsumer(project: string): Promise<ConsumerProfile> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(project)}`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ConsumerProfile;
    }

    async createConsumerSetup(payload: SetupConsumerPayload): Promise<{ id: string }> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as { id: string };
    }

    async createConsumer(profile: ConsumerProfile): Promise<ConsumerProfile> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(profile),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ConsumerProfile;
    }

    async updateConsumerProfile(
        id: string,
        payload: { name?: string; profile: Record<string, unknown>; zones?: unknown[]; expected_version: number }
    ): Promise<ConsumerProfile> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ConsumerProfile;
    }

    async updateConsumer(project: string, profile: ConsumerProfile): Promise<ConsumerProfile> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(project)}`, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(profile),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ConsumerProfile;
    }

    private async problem(res: Response): Promise<ProblemDetailsDto> {
        try {
            return (await res.json()) as ProblemDetailsDto;
        } catch {
            return { title: 'HTTP Error', status: res.status, detail: res.statusText };
        }
    }

    async planConsumer(profile: ConsumerProfile): Promise<ConsumerPlan> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/plan`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(profile),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ConsumerPlan;
    }

    async provisionConsumer(id: string, options: ProvisionConsumerOptions = {}): Promise<ProvisionConsumerResponse> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/provision`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(options),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ProvisionConsumerResponse;
    }

    async getConsumerStackVersions(id: string): Promise<StackVersionsDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/stack-versions`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as StackVersionsDto;
    }

    async saveConsumerStackVersions(id: string, versions: unknown[]): Promise<StackVersionsDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/stack-versions`, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ versions }),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as StackVersionsDto;
    }

    async getConsumerKnowledge(id: string): Promise<KnowledgeSummaryDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeSummaryDto;
    }

    async getConsumerKnowledgeDocs(id: string, query = ''): Promise<KnowledgeDocDto[]> {
        const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge/docs${qs}`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeDocDto[];
    }

    async getConsumerKnowledgeEmbeddings(id: string): Promise<KnowledgeEmbeddingStatusDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge/embeddings`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeEmbeddingStatusDto;
    }

    async embedConsumerKnowledge(id: string): Promise<KnowledgeEmbeddingResultDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge/embed`, {
            method: 'POST',
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeEmbeddingResultDto;
    }

    async retrieveConsumerKnowledge(id: string, query: string, filters: { type?: string; status?: string } = {}): Promise<KnowledgeRetrievalDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge/retrieve`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, ...filters }),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeRetrievalDto;
    }

    async checkConsumerKnowledge(id: string): Promise<KnowledgeCheckDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge/check`, {
            method: 'POST',
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeCheckDto;
    }

    async getConsumerKnowledgeDoc(id: string, docId: string): Promise<KnowledgeDocDetailDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge/docs/${encodeURIComponent(docId)}`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeDocDetailDto;
    }

    async getConsumerKnowledgeFindings(id: string): Promise<KnowledgeFindingDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge/findings`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeFindingDto[];
    }

    async indexConsumerKnowledge(id: string): Promise<KnowledgeSummaryDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/knowledge/index`, {
            method: 'POST',
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as KnowledgeSummaryDto;
    }

    async getWorkerSourceStatus(id: string): Promise<WorkerSourceStatusDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers/sync/status`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as WorkerSourceStatusDto;
    }

    async syncWorkerSources(id: string): Promise<WorkerSourceStatusDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers/sync`, { method: 'POST', headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as WorkerSourceStatusDto;
    }

    async promoteWorkerProjection(id: string, workerId: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers/sync/promote/${encodeURIComponent(workerId)}`, { method: 'POST', headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return res.json();
    }

    async getConsumerWorkers(id: string): Promise<WorkerConfigDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as WorkerConfigDto;
    }

    async getConsumerFlows(id: string): Promise<FlowSummaryDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/flows`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as FlowSummaryDto[];
    }

    async getConsumerFlowProposal(id: string): Promise<FlowProposalDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/slp/flow-proposal`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as FlowProposalDto;
    }

    async applyConsumerFlowProposal(id: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/slp/flow-proposal/apply`, { method: 'POST', headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return res.json();
    }

    async getConsumerDefaultFlow(id: string): Promise<FlowDefinitionDto | null> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/flows/default`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        const data = await res.json();
        return data && data.id ? data as FlowDefinitionDto : null;
    }

    async setConsumerDefaultFlow(id: string, flowId: string, version: number): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/flows/default`, {
            method: 'PUT', headers: { ...this.getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ flowId, version }),
        });
        if (!res.ok) throw await this.problem(res);
        return res.json();
    }

    async getConsumerFlow(id: string, flowId: string): Promise<FlowDefinitionDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/flows/${encodeURIComponent(flowId)}`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as FlowDefinitionDto;
    }

    async saveConsumerFlow(id: string, flowId: string, flow: Partial<FlowDefinitionDto>): Promise<FlowDefinitionDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/flows/${encodeURIComponent(flowId)}`, {
            method: 'PUT', headers: { ...this.getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(flow),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as FlowDefinitionDto;
    }

    async validateConsumerFlow(id: string, flowId: string, flow: Partial<FlowDefinitionDto>): Promise<FlowValidationDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/flows/${encodeURIComponent(flowId)}/validate`, {
            method: 'POST', headers: { ...this.getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(flow),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as FlowValidationDto;
    }

    async publishConsumerFlow(id: string, flowId: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/flows/${encodeURIComponent(flowId)}/publish`, {
            method: 'POST', headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return res.json();
    }

    async getConsumerMaterialSummary(id: string): Promise<MaterialSummaryDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/material/summary`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as MaterialSummaryDto;
    }

    async deleteConsumerRule(id: string, ruleId: string): Promise<{ removed: boolean }> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/rules/${encodeURIComponent(ruleId)}`, {
            method: 'DELETE',
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as { removed: boolean };
    }

    async getConsumerRules(id: string): Promise<RuleFileDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/rules`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as RuleFileDto[];
    }

    async previewConsumerRuleImport(id: string, files: Array<{ name: string; content: string }>): Promise<RuleImportPreviewDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/rules/import/preview`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ files }),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as RuleImportPreviewDto;
    }

    async applyConsumerRuleImport(id: string, candidates: any[]): Promise<{ written: any[] }> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/rules/import/apply`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidates }),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as { written: any[] };
    }

    async getConsumerWorkerImports(id: string): Promise<WorkerImportRecordDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers/imports`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as WorkerImportRecordDto[];
    }

    async recordConsumerWorkerImport(id: string, record: WorkerImportAuditDto): Promise<void> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers/import/audit`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
        });
        if (!res.ok) throw await this.problem(res);
    }

    async previewConsumerWorkerImport(id: string, files: Array<{ name: string; content: string }>): Promise<WorkerImportPreviewDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers/import/preview`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ files }),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as WorkerImportPreviewDto;
    }

    async checkConsumerWorker(id: string, workerId: string, action: { verb: string; path?: string; evidence?: any[] }): Promise<WorkerPolicyResultDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers/${encodeURIComponent(workerId)}/check`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(action),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as WorkerPolicyResultDto;
    }

    async saveConsumerWorkers(id: string, config: WorkerConfigDto): Promise<WorkerConfigDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers`, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as WorkerConfigDto;
    }

    async getConsumerHosts(id: string): Promise<HostDiscoveryDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/hosts`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as HostDiscoveryDto;
    }

    async getConsumerMcp(id: string): Promise<McpDiscoveryDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/mcp`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as McpDiscoveryDto;
    }

    async browseDirectories(path?: string): Promise<FsBrowseResponse> {
        const query = path ? `?path=${encodeURIComponent(path)}` : '';
        const res = await fetch(`${this.baseUrl}/api/v1/fs/list${query}`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as FsBrowseResponse;
    }

    async getConsumerSetup(id: string): Promise<ConsumerSetupResponse> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/setup`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ConsumerSetupResponse;
    }
}
