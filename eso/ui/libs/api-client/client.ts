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
    FsResolveDirectoryResponse,
    PluginManifestDto,
    ConsumerPluginDto,
    ProviderRecordDto,
    JiraProjectDto,
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
    HostRuntimeDto,
    HostDto,
    WorkerPlacementDto,
    ObservationDto,
    LegacyHarnessReportDto,
    LegacyHarnessArchiveDto,
    HarnessMigrationPreviewDto,
    HarnessMigrationResultDto,
    BoundaryViewDto,
    FolderPolicyDto,
    BoundaryGrantDto,
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

    /** Parse an optional JSON body; 204/empty bodies yield null instead of throwing. */
    private async optionalJson(res: Response): Promise<unknown> {
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return null;
        }
    }

    /** Read a list whether the endpoint answers a bare array or an `{ items: [] }` envelope. */
    private readList<T>(body: unknown, keys: string[]): T[] {
        if (Array.isArray(body)) return body as T[];
        if (body && typeof body === 'object') {
            const record = body as Record<string, unknown>;
            for (const key of keys) {
                const value = record[key];
                if (Array.isArray(value)) return value as T[];
            }
        }
        return [];
    }

    private readObject<T>(body: unknown): T | null {
        return body && typeof body === 'object' && !Array.isArray(body) ? (body as T) : null;
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

    async getHosts(): Promise<HostDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/hosts`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return this.readList<HostDto>(await this.optionalJson(res), ['items', 'hosts']);
    }

    async saveHost(host: { hostId: string; hostType: string; label: string }): Promise<HostDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/hosts/${encodeURIComponent(host.hostId)}`, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostType: host.hostType, label: host.label }),
        });
        if (!res.ok) throw await this.problem(res);
        const saved = this.readObject<HostDto>(await this.optionalJson(res));
        return saved && typeof saved.hostId === 'string' ? saved : { ...host, runtimes: [] };
    }

    /** Flattened runtime list used by worker placement (targets `runtimeKey`). */
    async getHostRuntimes(): Promise<HostRuntimeDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/host-runtimes`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return this.readList<HostRuntimeDto>(await this.optionalJson(res), ['items', 'runtimes', 'hostRuntimes']);
    }

    async saveHostRuntime(runtime: HostRuntimeDto): Promise<HostRuntimeDto> {
        const modelTiers: Record<string, { model: string; effort?: string }> = {};
        for (const [tier, value] of Object.entries(runtime.modelTiers || {})) {
            const model = typeof value?.model === 'string' ? value.model.trim() : '';
            if (!model) continue;
            const effort = typeof value?.effort === 'string' ? value.effort.trim() : '';
            modelTiers[tier] = effort ? { model, effort } : { model };
        }
        const body: Record<string, unknown> = {
            runtimeKind: runtime.runtimeKind,
            models: [...runtime.models],
            leadEligible: runtime.leadEligible,
            health: runtime.health,
            remoteUrl: runtime.remoteUrl?.trim() ? runtime.remoteUrl.trim() : null,
            // Send {} to clear/edit tiers; never null (backend expects an object).
            modelTiers,
        };
        // Empty means "not supplied": the backend keeps/derive the default from the catalog.
        if (runtime.defaultModel?.trim()) body.defaultModel = runtime.defaultModel.trim();
        const res = await fetch(`${this.baseUrl}/api/v1/hosts/${encodeURIComponent(runtime.hostId)}/runtimes/${encodeURIComponent(runtime.runtimeId)}`, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw await this.problem(res);
        const saved = this.readObject<HostRuntimeDto>(await this.optionalJson(res));
        return saved && typeof saved.runtimeKey === 'string' ? saved : runtime;
    }

    async heartbeatHostRuntime(hostId: string, runtimeId: string): Promise<HostRuntimeDto | null> {
        const res = await fetch(`${this.baseUrl}/api/v1/hosts/${encodeURIComponent(hostId)}/runtimes/${encodeURIComponent(runtimeId)}/heartbeat`, {
            method: 'POST',
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return this.readObject<HostRuntimeDto>(await this.optionalJson(res));
    }

    async getConsumerObservations(id: string, limit = 100): Promise<ObservationDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/observations?limit=${encodeURIComponent(String(limit))}`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return this.readList<ObservationDto>(await this.optionalJson(res), ['items', 'observations']);
    }

    async createConsumerObservation(id: string, body: Partial<ObservationDto> & { event: string }): Promise<ObservationDto | null> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/observations`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw await this.problem(res);
        return this.readObject<ObservationDto>(await this.optionalJson(res));
    }

    async getConsumerWorkerPlacement(id: string): Promise<WorkerPlacementDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/worker-placement`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return this.readList<WorkerPlacementDto>(await this.optionalJson(res), ['items', 'placements', 'workerPlacement']);
    }

    async saveConsumerWorkerPlacement(id: string, workerId: string, placement: WorkerPlacementDto): Promise<WorkerPlacementDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/workers/${encodeURIComponent(workerId)}/placement`, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                allowedHosts: [...placement.allowedHosts],
                modelTier: placement.modelTier,
                nativeAgent: { ...placement.nativeAgent },
                fallback: placement.fallback,
            }),
        });
        if (!res.ok) throw await this.problem(res);
        const saved = this.readObject<WorkerPlacementDto>(await this.optionalJson(res));
        return saved && typeof saved.workerId === 'string' ? saved : { ...placement, workerId };
    }

    async getConsumerFlows(id: string): Promise<FlowSummaryDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/flows`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as FlowSummaryDto[];
    }

    async getPlugins(): Promise<PluginManifestDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/plugins`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as PluginManifestDto[];
    }

    async getConsumerPlugins(id: string): Promise<ConsumerPluginDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/plugins`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ConsumerPluginDto[];
    }

    async getPluginProjects(id: string, pluginId: string): Promise<JiraProjectDto[]> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/plugins/${encodeURIComponent(pluginId)}/projects`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        const body = await res.json() as any;
        if (body?.ok === false) throw { status: 200, detail: body.reason || 'PROJECT_DISCOVERY_FAILED' };
        return (body.projects || []) as JiraProjectDto[];
    }

    async installPlugin(manifest: any): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/plugins`, {
            method: 'POST', headers: { ...this.getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(manifest),
        });
        if (!res.ok) throw await this.problem(res);
        return res.json();
    }

    async removePlugin(pluginId: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/plugins/${encodeURIComponent(pluginId)}`, { method: 'DELETE', headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return res.json();
    }

    async syncConsumerPlugin(id: string, pluginId: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/plugins/${encodeURIComponent(pluginId)}/sync`, { method: 'POST', headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return res.json();
    }

    async getProviderRecords(id: string, provider?: string): Promise<ProviderRecordDto[]> {
        const suffix = provider ? `?provider=${encodeURIComponent(provider)}` : '';
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/provider-records${suffix}`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ProviderRecordDto[];
    }

    async configureConsumerPlugin(id: string, pluginId: string, payload: any): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/plugins/${encodeURIComponent(pluginId)}`, {
            method: 'PUT', headers: { ...this.getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw await this.problem(res);
        return res.json();
    }

    async testConsumerPlugin(id: string, pluginId: string): Promise<any> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/plugins/${encodeURIComponent(pluginId)}/test`, {
            method: 'POST', headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return res.json();
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

    async resolveDirectory(name: string): Promise<FsResolveDirectoryResponse> {
        const res = await fetch(`${this.baseUrl}/api/v1/fs/resolve-directory?name=${encodeURIComponent(name)}`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as FsResolveDirectoryResponse;
    }

    async getConsumerSetup(id: string): Promise<ConsumerSetupResponse> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/setup`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as ConsumerSetupResponse;
    }

    async getLegacyHarness(id: string): Promise<LegacyHarnessReportDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/legacy-harness`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as LegacyHarnessReportDto;
    }

    async archiveLegacyHarness(id: string): Promise<LegacyHarnessArchiveDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/legacy-harness/archive`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as LegacyHarnessArchiveDto;
    }

    async previewHarnessMigration(id: string): Promise<HarnessMigrationPreviewDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/harness-migration/preview`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as HarnessMigrationPreviewDto;
    }

    async applyHarnessMigration(id: string): Promise<HarnessMigrationResultDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/harness-migration/apply`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as HarnessMigrationResultDto;
    }

    async getBoundaries(id: string): Promise<BoundaryViewDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/boundaries`, { headers: this.getHeaders() });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as BoundaryViewDto;
    }

    async saveBoundaries(id: string, policies: FolderPolicyDto[], enforcement: 'audit' | 'enforce' = 'audit'): Promise<BoundaryViewDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/boundaries`, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ policies, enforcement }),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as BoundaryViewDto;
    }

    async createBoundaryGrant(id: string, body: Record<string, unknown>): Promise<BoundaryGrantDto> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/boundaries/grants`, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as BoundaryGrantDto;
    }

    async revokeBoundaryGrant(id: string, grantId: string): Promise<{ revoked: boolean }> {
        const res = await fetch(`${this.baseUrl}/api/v1/consumers/${encodeURIComponent(id)}/boundaries/grants/${encodeURIComponent(grantId)}`, {
            method: 'DELETE',
            headers: this.getHeaders(),
        });
        if (!res.ok) throw await this.problem(res);
        return (await res.json()) as { revoked: boolean };
    }
}
