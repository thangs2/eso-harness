/**
 * API Contract Types (Generated from Control Plane OpenAPI / RFC 9457)
 * NEVER hand-write DTOs in feature code.
 */

export interface WorkOverviewTurnDto {
    turn_id: string;
    work: string;
    level: 'sufficient' | 'partial' | 'missing' | 'none';
    missing_count: number;
    distinct_styling: string;
    timestamp?: string;
}

export interface WorkOverviewResponse {
    project: string;
    total: number;
    items: WorkOverviewTurnDto[];
}

export interface ConfigPreviewDto {
    config: Record<string, unknown>;
    hash: string;
    impactSummary?: string;
}

export interface ProblemDetailsDto {
    type?: string;
    title: string;
    status: number;
    detail?: string;
    instance?: string;
}

export interface ConsumerZone {
    name: 'human' | 'agent';
    path: string;
    headerProfile?: string;
}

export interface ConsumerProfile {
    id: string;
    name: string;
    root: string;
    repoUrl?: string;
    hostMode?: string;
    observePort?: number;
    sdlcRoot: string;
    profile: { recipe?: string; hostProfile?: string; host?: string; source?: string; description?: string; canonical?: { agents: string; harness: string }; observation?: { consent: boolean; events: string[] } };
    integration: { jevMode: string; consent: boolean; hostPack: string; memoryAdapter: string };
    zones: ConsumerZone[];
    headerProfile: string;
    presetVersion?: string;
    tools: Record<string, unknown>;
    team: { roles: string[]; presets?: string[] };
    gates: Record<string, unknown>;
    sources: Record<string, unknown>;
    protectedPaths: string[];
    // The detail endpoint returns the snapshot's own bookkeeping alongside the profile; the type must say so
    // or every consumer of it has to reach for a cast (D-72 bans casts that only silence the compiler).
    version?: number;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface ConsumerSummary {
    id: string;
    name: string;
    root: string;
    sdlcRoot: string;
    profile: { recipe?: string; hostProfile?: string; host?: string; source?: string; description?: string; canonical?: { agents: string; harness: string }; observation?: { consent: boolean; events: string[] } };
    integration: { jevMode: string; consent: boolean; hostPack: string; memoryAdapter: string };
    version: number;
    status: string;
    updatedAt: string;
}

export interface KnowledgeDocDto {
    doc_id: string;
    path: string;
    type: string;
    status: string;
    owner: string | null;
    title: string | null;
    content_hash: string;
    indexed_at: string;
    sections: number;
}

export interface KnowledgeRetrievalHitDto {
    rank: number;
    doc: KnowledgeDocDto;
    score: number;
    why: string[];
    signals: { fts: number; graph: number; vector: number; exact: number };
}

export interface KnowledgeRetrievalDto {
    query: string;
    mode: 'hybrid';
    vector: { enabled: boolean; reason?: string; count?: number; model?: string };
    filters: { type: string | null; status: string | null };
    weights: { fts: number; graph: number; vector: number };
    counts: { fts: number; graph: number; vector: number; merged: number };
    results: KnowledgeRetrievalHitDto[];
}

export interface KnowledgeCoverageDto {
    type: string;
    label: string;
    docs: number;
    sections: number;
    findings: number;
}

export interface KnowledgeEmbeddingStatusDto {
    model: string;
    embedded: number;
    chunks: number;
    ready: boolean;
}

export interface KnowledgeEmbeddingResultDto {
    model: string;
    embedded: number;
    pending: number;
    total: number;
}

export interface KnowledgeCheckDto {
    status: 'PASS' | 'FAIL';
    checks: Array<{ id: string; label: string; status: 'PASS' | 'FAIL' | 'INFO'; detail: string }>;
    coverage: KnowledgeCoverageDto[];
    summary: KnowledgeSummaryDto;
}

export interface KnowledgeDocDetailDto {
    doc: KnowledgeDocDto | null;
    sections: Array<{ section_id: string; parent_section_id: string | null; ordinal: number; level: number; heading: string; anchor: string }>;
    outgoing: Array<{ edge_id: string; kind: string; doc_id: string; path: string; title: string | null }>;
    incoming: Array<{ edge_id: string; kind: string; doc_id: string; path: string; title: string | null }>;
    descendants: Array<{ doc_id: string; depth: number; path: string; title: string | null }>;
    links: Array<{ raw_target: string; resolved_doc_id: string | null; resolved_section_id: string | null; status: string }>;
}

export interface KnowledgeFindingDto {
    finding_id: string;
    doc_id: string | null;
    path: string | null;
    severity: string;
    code: string;
    detail: unknown;
    created_at: string;
}

export interface WorkerSourceStatusDto {
    source: number;
    projections: number;
    drift: Array<{ file: string; kind: string }>;
}

export interface PluginPropertyDto {
    type: string;
    label: string;
    enum?: string[];
    format?: string;
    secret?: boolean;
    help?: string;
}

export interface PluginManifestDto {
    id: string;
    label: string;
    type: 'host' | 'provider' | 'capability' | 'source';
    category: 'host' | 'work' | 'design' | 'content' | 'other';
    version: string;
    capabilities: string[];
    status: 'installed' | 'available';
    installed: boolean;
    description: string;
    source?: string;
    configSchema: { required: string[]; properties: Record<string, PluginPropertyDto> };
}

export interface JiraProjectDto {
    id: string;
    key: string;
    name: string;
    type: string;
}

export interface ProviderRecordDto {
    consumer_id: string;
    provider_id: string;
    external_id: string;
    kind: string;
    title: string;
    status: string | null;
    url: string | null;
    payload: any;
    synced_at: string;
}

export interface ConsumerPluginDto extends PluginManifestDto {
    enabled: boolean;
    config: Record<string, any>;
    secretRefs: Record<string, string>;
    health: string;
    lastCheckedAt: string | null;
}

export interface FlowNodeDto {
    workerId: string;
    x: number;
    y: number;
}

export interface FlowEdgeDto {
    id: string;
    from: string;
    to: string;
    on: string;
    condition?: { kind: string; equals?: string; [key: string]: unknown };
    priority?: number;
}

export interface FlowDefinitionDto {
    id: string;
    name: string;
    version: number;
    status: 'draft' | 'published';
    nodes: FlowNodeDto[];
    edges: FlowEdgeDto[];
    viewport: { x: number; y: number; zoom: number };
    createdAt?: string;
    updatedAt?: string;
    publishedAt?: string;
}

export interface FlowSummaryDto {
    id: string;
    name: string;
    version: number;
    status: 'draft' | 'published';
    publishedVersions: number[];
    updatedAt: string | null;
    isDefault?: boolean;
}

export interface FlowProposalDto {
    available: boolean;
    reason?: string;
    sourceFile?: string;
    sourceHash?: string;
    flow?: FlowDefinitionDto;
    warnings?: string[];
    files?: string[];
}

export interface FlowValidationDto {
    ok: boolean;
    errors: string[];
    warnings: string[];
}

export interface MaterialSummaryDto {
    skills: number;
    hooks: number;
    subagents: number;
    rules: number;
}

export interface RuleFileDto {
    id: string;
    description: string;
    globs: string;
    alwaysApply: boolean;
    body: string;
    sourceFile?: string;
    sourceHash?: string;
}

export interface RuleImportCandidateDto {
    sourceFile: string;
    sourceType: 'cursor-rule' | 'markdown-rule';
    sourceHash: string;
    rule: RuleFileDto;
    conflict: boolean;
    conflictWith: string | null;
    warnings?: string[];
}

export interface RuleImportPreviewDto {
    candidates: RuleImportCandidateDto[];
    skipped: Array<{ sourceFile: string; reason: string }>;
}

export interface WorkerImportCandidateDto {
    sourceFile: string;
    sourceType: 'eso-worker' | 'claude-subagent';
    sourceHash: string;
    worker: WorkerRecordDto;
    warnings: string[];
    conflict: boolean;
    conflictWith?: string | null;
}

export interface WorkerImportAuditDto {
    sourceFile: string;
    sourceHash: string;
    sourceType: string;
    workerId: string;
    action: 'import' | 'replace' | 'copy' | 'skip' | 'audit';
    detail?: Record<string, unknown>;
}

export interface WorkerImportSkippedDto {
    sourceFile: string;
    reason: string;
    sourceType?: string;
}

export interface WorkerImportRecordDto {
    import_id: string;
    source_file: string;
    source_hash: string;
    source_type: string;
    worker_id: string;
    action: string;
    detail: unknown;
    imported_at: string;
}

export interface WorkerImportPreviewDto {
    candidates: WorkerImportCandidateDto[];
    skipped: WorkerImportSkippedDto[];
}

export interface KnowledgeSummaryDto {
    docs: number;
    sections: number;
    edges: number;
    findings: number;
    links: number;
    manifest: null | {
        manifest_id: string;
        build_id: string | null;
        manifest_version: number;
        generator_version: string;
        source_hash: string;
        created_at: string;
    };
    manifestPath?: string;
    buildId?: string;
}

export interface EvidenceRequirementDto {
    kind: 'test' | 'verify' | 'audit' | 'scenario' | 'manual';
    metric?: string;
    op?: '>=' | '<=' | '==' | 'truthy';
    value?: string | number | boolean;
    label?: string;
}

export interface WorkerRecordDto {
    id: string;
    name: string;
    role: string;
    layer: 'peer' | 'gate';
    scope: string;
    status: 'declared' | 'active' | 'paused' | 'retired';
    hostBindingIds: string[];
}

export interface WorkerEdgeDto {
    from: string;
    to: string;
    on: string;
}

export interface WorkerPolicyResultDto {
    decision: 'ALLOW' | 'DENY';
    workerId: string;
    reasons: string[];
    warnings?: string[];
    worker?: Record<string, unknown>;
}

export interface WorkerBindingDto {
    id: string;
    developer: string;
    hostId: string;
    stackVersion: number;
    memorySource: string;
    codeGraphSource: string;
    installState: string;
}

export interface WorkerConfigDto {
    workers: WorkerRecordDto[];
    edges: WorkerEdgeDto[];
    bindings?: WorkerBindingDto[];
}

export type HostRuntimeKind = 'ide-native' | 'cli' | 'acp';

export type HostRuntimeHealth = 'unknown' | 'healthy' | 'degraded' | 'offline';

/** A runtime registered under one host machine. Placement targets `runtimeKey`. */
export interface HostRuntimeDto {
    hostId: string;
    hostType: string;
    runtimeId: string;
    /** `${hostId}:${runtimeId}` — the placement target for worker allowed hosts. */
    runtimeKey: string;
    runtimeKind: HostRuntimeKind;
    models: string[];
    defaultModel?: string;
    leadEligible: boolean;
    health: HostRuntimeHealth;
    lastHeartbeat: string | null;
}

/** A host machine with its registered runtimes. Consumers bind hosts by `hostId`. */
export interface HostDto {
    hostId: string;
    hostType: string;
    label: string;
    createdAt?: string;
    updatedAt?: string;
    runtimes: HostRuntimeDto[];
}

export type WorkerModelTier = 'fast' | 'balanced' | 'reasoning';

export type WorkerPlacementFallback = 'block' | 'next-host' | 'next-tier';

/** How a worker is placed: allowed host runtimes, model tier, native agent map, fallback. */
export interface WorkerPlacementDto {
    workerId: string;
    allowedHosts: string[];
    modelTier: WorkerModelTier;
    /** runtimeKey → host-native agent name, e.g. `{ 'host-a:cursor': 'cursor' }`. */
    nativeAgent: Record<string, string>;
    fallback: WorkerPlacementFallback;
}

export interface ConsumerListResponse {
    items: ConsumerSummary[];
}

export interface ConsumerPlanFile {
    relative: string;
    action: string;
    preview: unknown;
}

export interface ConsumerPlan {
    root: string;
    consumer: string;
    profile: { recipe?: string; hostProfile?: string; host?: string; source?: string; description?: string; canonical?: { agents: string; harness: string }; observation?: { consent: boolean; events: string[] } };
    files: ConsumerPlanFile[];
    warnings: string[];
    generatedAt: string;
}

/** Phase 1 setup payload — no Lite/Pro/recipe fields. */
export interface SetupProfilePayload {
    canonical: { agents: string; harness: string };
    observation: { consent: boolean; events: string[] };
}

export interface SetupConsumerPayload {
    id: string;
    name: string;
    root: string;
    sdlcRoot: string;
    profile: SetupProfilePayload;
}

export interface ProvisionConsumerOptions {
    profile?: Record<string, unknown>;
    zones?: unknown[];
}

export interface ProvisionConsumerResponse {
    consumer: string;
    status: 'provisioned';
    schema: string;
    material: {
        agents: boolean;
        harness: string;
        manifest: string;
    };
    setup: {
        ready: boolean;
        updated_at: string;
    };
}

export interface ConsumerSetupResponse {
    consumerId: string;
    status: string;
    schema: {
        name: string;
        exists: boolean;
    };
    material: {
        agents: boolean;
        config: boolean;
        manifest: boolean;
        hash: string | null;
        materialized: boolean;
    };
    setup: {
        ready: boolean;
        updatedAt: string;
    };
}


export interface FsDirectoryEntry {
    name: string;
    path: string;
}

export interface FsBrowseResponse {
    path: string;
    parent: string | null;
    directories: FsDirectoryEntry[];
}

export interface FsResolveDirectoryResponse {
    name: string;
    matches: string[];
}

export interface McpProviderDto {
    id: string;
    label: string;
    capabilities: string[];
    source: string;
    status: 'configured';
}

export interface McpDiscoveryDto {
    consumerId: string;
    root: string;
    sources: string[];
    providers: McpProviderDto[];
    warnings: string[];
}

export interface DetectedHostDto {
    hostId: string;
    label: string;
    markers: string[];
}

export interface HostDiscoveryDto {
    consumerId: string;
    root: string;
    detected: DetectedHostDto[];
}

export interface StackVersionDto {
    version: number;
    status: 'draft' | 'published' | 'retired';
    layers: unknown[];
    publishedAt?: string | null;
    createdAt?: string;
}

export interface StackVersionsDto {
    consumerId: string;
    versions: StackVersionDto[];
}
