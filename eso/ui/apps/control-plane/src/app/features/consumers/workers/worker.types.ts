import type { EvidenceRequirementDto } from '../../../../../../../libs/api-client/types.js';

export type WorkerLayer = 'peer' | 'gate';

export interface WorkerHostProfile {
    id: string;
    userId: string;
    hostId: string;
    detected?: boolean;
}

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

export type WorkerInspectorTab = 'identity' | 'policy' | 'deployment';

export const WORKER_ROLES = ['scout', 'plan', 'build', 'fixbug', 'verify', 'audit', 'qc'] as const;
export const WORKER_STATUSES = ['declared', 'active', 'paused', 'retired'] as const;
export const WORKER_ORDER = ['worker-scout', 'worker-plan', 'worker-build', 'worker-verify', 'worker-audit', 'worker-fixbug', 'worker-qc', 'worker-qc-2'];
