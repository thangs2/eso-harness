import type { ConsumerStatus } from '../../platform/registry/types.js';

export interface SetupSchemaInfo {
    name: string;
    exists: boolean;
}

export interface SetupMaterialInfo {
    agents: boolean;
    config: boolean;
    manifest: boolean;
    hash: string | null;
    materialized: boolean;
}

export interface SetupStatusInfo {
    ready: boolean;
    updatedAt: string;
}

export interface SetupInfo {
    consumerId: string;
    status: ConsumerStatus;
    schema: SetupSchemaInfo;
    material: SetupMaterialInfo;
    setup: SetupStatusInfo;
}

export interface PersistSetupOptions {
    status?: ConsumerStatus;
    materializedHash?: string;
    expectReady?: boolean;
    now?: string;
}
