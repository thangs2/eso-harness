import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { FlowFileService } from '../flows/flow-file.service.js';
import type { HostRuntimeService } from '../host-runtime/host-runtime.service.js';
import type { WorkerFileService } from '../workers/worker-file.service.js';

/**
 * Read-only config snapshot for a host runtime (P2).
 *
 * One stable document (version = sha256 of the canonical JSON) combines consumer identity, flow,
 * worker config, worker placement, host registry, host bindings, stack version and provider routing.
 * It never contains secrets, tokens, or run/execution state.
 */

export const RUNTIME_KEY_PATTERN = /^[^:\s]+:[^:\s]+$/;

/** Compare an ETag header (raw or quoted, weak prefix allowed). */
export function etagMatches(header: string, version: string): boolean {
    const candidates = String(header || '').split(',').map((item) => item.trim());
    return candidates.some((item) => item.replace(/^W\//, '').replace(/^"|"$/g, '') === version);
}

/** Deterministic JSON: object keys sorted recursively so the hash only changes with content. */
function canonical(value: any): any {
    if (Array.isArray(value)) return value.map((item) => canonical(item));
    if (value && typeof value === 'object') {
        const result: Record<string, any> = {};
        for (const key of Object.keys(value).sort()) result[key] = canonical(value[key]);
        return result;
    }
    return value;
}

export function snapshotVersion(payload: any): string {
    return createHash('sha256').update(JSON.stringify(canonical(payload)), 'utf8').digest('hex');
}

function readSettings(root: string): any {
    const file = join(root, '.harness', 'config.json');
    if (!existsSync(file)) return {};
    try {
        const config = JSON.parse(readFileSync(file, 'utf8'));
        const settings = config?.profile?.settings ?? config?.settings;
        return settings && typeof settings === 'object' ? settings : {};
    } catch {
        return {};
    }
}

export class ConfigSnapshotService {
    constructor(
        private readonly store: PlatformStore,
        private readonly flowFiles: FlowFileService,
        private readonly workerFiles: WorkerFileService,
        private readonly hostRuntime: HostRuntimeService,
    ) {}

    async get(consumerId: string): Promise<any> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        const [flow, workerConfig, placements, hosts, stackVersions] = await Promise.all([
            this.flowFiles.defaultFlow(id),
            this.workerFiles.read(id),
            this.hostRuntime.listWorkerPlacements(id),
            this.hostRuntime.listHosts(),
            this.store.listStackVersions(id),
        ]);
        const settings = consumer.root ? readSettings(consumer.root) : {};
        const activeStack = (stackVersions as any[]).find((version) => version?.status === 'published') ?? null;
        const payload = {
            consumer: {
                id: consumer.id,
                name: consumer.name,
                root: consumer.root,
                sdlcRoot: consumer.sdlcRoot ?? null,
                status: consumer.status,
                version: consumer.version,
            },
            flow: flow
                ? {
                    id: flow.id,
                    name: flow.name,
                    version: flow.version,
                    status: 'published',
                    nodes: Array.isArray(flow.nodes) ? flow.nodes : [],
                    edges: Array.isArray(flow.edges) ? flow.edges : [],
                }
                : null,
            workers: Array.isArray(workerConfig?.workers) ? workerConfig.workers : [],
            workerPlacement: placements.items,
            hosts: hosts.items,
            hostBindings: settings?.harness?.hostProfiles ?? [],
            stackVersion: activeStack,
            providerRouting: settings?.knowledge?.providers?.routing ?? {},
        };
        return {
            version: snapshotVersion(payload),
            generatedAt: new Date().toISOString(),
            ...payload,
        };
    }
}
