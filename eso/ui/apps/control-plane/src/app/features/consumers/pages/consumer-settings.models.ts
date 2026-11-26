import type { EvidenceRequirementDto } from '../../../../../../../libs/api-client/types.js';

export const LEGACY_HOST_PLUGIN_KEY = 'hostPluginId' as const;

export const HOST_TYPE_LABELS: Record<string, string> = { cursor: 'Cursor', agy: 'Antigravity', dsh: 'DSH', claude: 'Claude', codex: 'Codex', paseo: 'Paseo', orca: 'Orca' };
export type LegacyHostProfile = HostProfile & { [LEGACY_HOST_PLUGIN_KEY]?: string };

export type LayerId = 'multiAgent' | 'rules' | 'skills' | 'hooks' | 'memory' | 'codeGraph' | 'documentGraph' | 'topology';

export interface StackLayer {
    id: LayerId;
    n: number;
    label: string;
    description: string;
    enabled: boolean;
    required?: boolean;
    allowedSources?: string[];
    files?: number;
    engine?: string;
    deferred?: boolean;
}

export type StackVersionStatus = 'draft' | 'published' | 'retired';

export interface StackVersion {
    version: number;
    status: StackVersionStatus;
    layers: StackLayer[];
    publishedAt?: string;
}

export interface HostProfile {
    id: string;
    userId: string;
    hostId: string;
    stackVersion: number;
    flowId?: string;
    flowVersion?: number;
    memorySource: string;
    memoryProvider?: string;
    codeGraphSource: string;
    codeGraphProvider?: string;
    materialInstall?: string[];
    mcpConfigSource?: string;
    installState: 'pending' | 'detected' | 'installed' | 'partial' | 'error';
    detected?: boolean;
}

export type WorkerLayer = 'peer' | 'gate';

export interface WorkerEntry {
    id: string;
    name: string;
    role: string;
    layer: WorkerLayer;
    hostBindingIds: string[];
    scope: string;
    status: 'declared' | 'active' | 'paused' | 'retired';
    capabilities: string[];
    verbs: string[];
    bar: EvidenceRequirementDto[];
    escalation: string;
    instructions?: string;
    sourceFile?: string;
    sourceHash?: string;
    sourceType?: string;
}

export interface WorkerEdge {
    from: string;
    to: string;
    on: string;
}

export interface PluginEntry {
    id: string;
    label: string;
    type: 'host' | 'source' | 'provider' | 'mcp';
    version: string;
    capabilities: string[];
    mcpSource?: string;
    status: 'installed' | 'available' | 'error';
}

export function defaultWorkers(): WorkerEntry[] {
    return [
        { id: 'worker-scout', name: 'Scout', role: 'scout', layer: 'peer', hostBindingIds: [], scope: '/tmp/slp/recon/', status: 'declared', capabilities: ['scout'], verbs: ['read', 'write'], bar: [], escalation: 'stop+notify' },
        { id: 'worker-plan', name: 'Plan', role: 'plan', layer: 'peer', hostBindingIds: [], scope: '/tmp/slp/plan/', status: 'declared', capabilities: ['plan'], verbs: ['read', 'write'], bar: [], escalation: 'stop+notify' },
        { id: 'worker-build', name: 'Build', role: 'build', layer: 'peer', hostBindingIds: [], scope: 'agents/, scripts/, tools/', status: 'declared', capabilities: ['be', 'fe'], verbs: ['read', 'write', 'append'], bar: [], escalation: 'stop+notify' },
        { id: 'worker-fixbug', name: 'Fixbug', role: 'fixbug', layer: 'peer', hostBindingIds: [], scope: 'findings', status: 'declared', capabilities: ['be'], verbs: ['read', 'write'], bar: [], escalation: 'stop+notify' },
        { id: 'worker-verify', name: 'Verify', role: 'verify', layer: 'gate', hostBindingIds: [], scope: '/tmp/slp/verify/', status: 'declared', capabilities: ['verify'], verbs: ['read', 'write', 'approve'], bar: [{ kind: 'verify', metric: 'status', op: '==', value: 'PASS' }], escalation: 'stop+notify' },
        { id: 'worker-audit', name: 'Audit', role: 'audit', layer: 'gate', hostBindingIds: [], scope: '/tmp/slp/audit/', status: 'declared', capabilities: ['audit'], verbs: ['read', 'write', 'approve'], bar: [{ kind: 'audit', metric: 'rubric', op: '>=', value: 85 }, { kind: 'audit', metric: 'critical', op: '==', value: 0 }], escalation: 'stop+notify' },
        { id: 'worker-qc', name: 'QC', role: 'qc', layer: 'gate', hostBindingIds: [], scope: '/tmp/slp/qc/', status: 'declared', capabilities: ['qc'], verbs: ['read', 'write', 'append', 'approve'], bar: [{ kind: 'scenario', metric: 'executed', op: 'truthy', value: true }], escalation: 'stop+notify' },
    ];
}

export const defaultWorkerPolicy = { capabilities: [] as string[], verbs: ['read', 'append'], bar: [] as EvidenceRequirementDto[], escalation: 'allow' };

export function splitList(value: string): string[] {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function defaultStackLayers(): StackLayer[] {
    return [
        { id: 'multiAgent', n: 1, label: 'Multi-agent / SLP', description: 'Roles, workers, permissions, and workflows.', enabled: true },
        { id: 'rules', n: 2, label: 'Rules / law', description: 'Canonical rules installed as files.', enabled: true, files: 12 },
        { id: 'skills', n: 3, label: 'Skills', description: 'Canonical skills installed as files.', enabled: true, files: 8 },
        { id: 'hooks', n: 4, label: 'Hooks', description: 'Host hook scripts installed as files.', enabled: true, files: 4 },
        { id: 'memory', n: 5, label: 'Memory', description: 'Required capability; host binding resolves source and provider.', enabled: true, required: true, allowedSources: ['host-native', 'eso-native', 'market'] },
        { id: 'codeGraph', n: 6, label: 'Code graph', description: 'Required capability; host binding resolves source and provider.', enabled: true, required: true, allowedSources: ['host-native', 'eso-native', 'market'] },
        { id: 'documentGraph', n: 7, label: 'Document graph', description: 'ESO document structure and Postgres graph index.', enabled: true, engine: 'postgres' },
        { id: 'topology', n: 8, label: 'Topology', description: 'Service and message topology; deferred.', enabled: false, deferred: true },
    ];
}

export function defaultPlugins(): PluginEntry[] {
    return [
        { id: 'cursor', label: 'Cursor', type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'hooks', 'mcp'], status: 'installed' },
        { id: 'agy', label: 'Antigravity', type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'mcp'], status: 'installed' },
        { id: 'claude', label: 'Claude', type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'mcp'], status: 'installed' },
        { id: 'codex', label: 'Codex', type: 'host', version: '0.1.0', capabilities: ['rules'], status: 'available' },
        { id: 'dsh', label: 'DSH', type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'hooks', 'mcp', 'memory'], status: 'installed' },
        { id: 'paseo', label: 'Paseo', type: 'host', version: '0.1.0', capabilities: ['orchestration', 'mcp'], status: 'available' },
        { id: 'orca', label: 'Orca', type: 'host', version: '0.1.0', capabilities: ['orchestration', 'mcp'], status: 'available' },
    ];
}

export interface ConsumerArtifactDto {
    id: string;
    consumerId: string;
    title: string;
    origin: 'host' | 'user' | 'agent' | 'machine';
    custodian: 'host-local' | 'staging' | 'repo' | 'provider';
    ktState: 'raw' | 'proposed' | 'approved' | 'retired';
    liveness: 'ephemeral' | 'living' | 'frozen';
    derivedFrom?: string[];
    contentType: string;
    body: string;
    metadata?: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

export interface HostProjectionArtifactDto {
    target: string;
    path: string;
    description: string;
    status: 'generated' | 'synced' | 'pending' | 'missing' | 'drifted';
    fileCount: number;
    lastGeneratedAt: string;
}
