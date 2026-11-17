import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import { HOST_RUNTIME_HEALTH, HOST_RUNTIME_KINDS } from '../../platform/registry/ddl.js';
import { PlatformError } from '../../platform/registry/errors.js';

/**
 * Host runtime registry and worker host placement policy.
 *
 * ESO is sidecar/config/observatory only: it records which hosts advertised a runtime and stores
 * the placement policy the host must enforce. It never starts a host process, never queues or
 * dispatches work, never tracks runs, and never calls a model itself.
 */

const MODEL_TIERS = ['fast', 'balanced', 'reasoning'] as const;
const FALLBACKS = ['block', 'next-host', 'next-tier'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item.length > 0);
    if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        if (trimmed.startsWith('{')) {
            return trimmed.replace(/^\{|\}$/g, '').split(',').map((item) => item.replace(/^"|"$/g, '').trim()).filter(Boolean);
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter((item) => item.length > 0);
        } catch {
            return [];
        }
    }
    return [];
}

function jsonArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item));
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
        } catch {
            return [];
        }
    }
    return [];
}

function jsonObject(value: unknown): Record<string, string> {
    let raw: unknown = value;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { raw = null; }
    }
    if (!isRecord(raw)) return {};
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(raw)) {
        if (typeof item === 'string') result[key] = item;
    }
    return result;
}

function requiredText(value: unknown, field: string, code: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new PlatformError(code, `${field} is required`);
    return text;
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, field: string, code: string): T[number] {
    const text = String(value ?? '');
    if (!(allowed as readonly string[]).includes(text)) {
        throw new PlatformError(code, `${field} must be one of ${allowed.join(', ')}`);
    }
    return text as T[number];
}

/** Resolve a host default model: explicit values must be non-empty and present in the effective catalog. */
function resolveDefaultModel(body: any, models: string[], existing: any, explicit: boolean): string {
    const current = String(existing?.default_model ?? existing?.defaultModel ?? '');
    if (explicit) {
        const requested = String(body?.defaultModel ?? '').trim();
        if (!requested) throw new PlatformError('HOST_RUNTIME_INVALID', 'defaultModel is required');
        if (!models.includes(requested)) {
            throw new PlatformError('HOST_RUNTIME_INVALID', `defaultModel must be one of ${models.join(', ') || '(no models reported)'}`);
        }
        return requested;
    }
    if (models.length === 0) return '';
    return current && models.includes(current) ? current : models[0];
}

function hostRuntimeDto(row: any): any {
    return {
        hostId: row.host_id ?? row.hostId,
        runtimeId: row.runtime_id ?? row.runtimeId,
        runtimeKind: row.runtime_kind ?? row.runtimeKind,
        models: jsonArray(row.models),
        defaultModel: row.default_model ?? row.defaultModel ?? '',
        leadEligible: Boolean(row.lead_eligible ?? row.leadEligible),
        health: row.health ?? 'unknown',
        lastHeartbeat: row.last_heartbeat ?? row.lastHeartbeat ?? null,
    };
}

function workerPlacementDto(row: any): any {
    return {
        workerId: row.worker_id ?? row.workerId,
        allowedHosts: textArray(row.allowed_hosts ?? row.allowedHosts),
        modelTier: row.model_tier ?? row.modelTier ?? 'balanced',
        nativeAgent: jsonObject(row.native_agent ?? row.nativeAgent),
        fallback: row.fallback ?? 'block',
    };
}

export class HostRuntimeService {
    constructor(private readonly store: PlatformStore) {}

    private async emit(consumerId: string, event: any): Promise<void> {
        await this.store.recordWorkerEvent(consumerId, event);
    }

    async listHostRuntimes(): Promise<any> {
        const rows = await this.store.listHostRuntimes();
        return { items: rows.map(hostRuntimeDto) };
    }

    async putHostRuntime(hostId: string, body: any): Promise<any> {
        const host = requiredText(hostId, 'hostId', 'HOST_RUNTIME_INVALID');
        const existing = await this.store.getHostRuntime(host);
        const models = body?.models === undefined ? (existing ? jsonArray(existing.models) : []) : textArray(body.models);
        const healthExplicit = body?.health !== undefined;
        const defaultExplicit = body?.defaultModel !== undefined;
        const runtime = {
            hostId: host,
            runtimeId: requiredText(body?.runtimeId, 'runtimeId', 'HOST_RUNTIME_INVALID'),
            runtimeKind: oneOf(body?.runtimeKind, HOST_RUNTIME_KINDS, 'runtimeKind', 'HOST_RUNTIME_INVALID'),
            models,
            defaultModel: resolveDefaultModel(body, models, existing, defaultExplicit),
            leadEligible: Boolean(body?.leadEligible),
            // Metadata edits preserve observed health; only an explicit health field (or heartbeat)
            // may change liveness. A newly registered host starts as 'unknown'.
            health: healthExplicit
                ? oneOf(body.health, HOST_RUNTIME_HEALTH, 'health', 'HOST_RUNTIME_INVALID')
                : String(existing?.health ?? 'unknown'),
            healthExplicit,
        };
        const row = await this.store.upsertHostRuntime(runtime);
        return hostRuntimeDto(row);
    }

    async heartbeat(hostId: string, body: any): Promise<any> {
        const host = requiredText(hostId, 'hostId', 'HOST_RUNTIME_INVALID');
        const existing = await this.store.getHostRuntime(host);
        if (!existing) throw new PlatformError('HOST_RUNTIME_NOT_FOUND', `Host runtime not registered: ${host}`);
        const modelsSupplied = body?.models !== undefined;
        const defaultSupplied = body?.defaultModel !== undefined;
        const effectiveModels = modelsSupplied ? textArray(body.models) : jsonArray(existing.models);
        const patch: { health?: string; models?: string[]; defaultModel?: string } = {};
        if (body?.health !== undefined) patch.health = oneOf(body.health, HOST_RUNTIME_HEALTH, 'health', 'HOST_RUNTIME_INVALID');
        if (modelsSupplied) patch.models = effectiveModels;
        if (defaultSupplied) {
            const requested = String(body.defaultModel ?? '').trim();
            if (!requested) throw new PlatformError('HOST_RUNTIME_INVALID', 'defaultModel is required');
            if (!effectiveModels.includes(requested)) {
                throw new PlatformError('HOST_RUNTIME_INVALID', `defaultModel must be one of ${effectiveModels.join(', ') || '(no models reported)'}`);
            }
            patch.defaultModel = requested;
        } else if (modelsSupplied) {
            const current = String(existing.default_model ?? existing.defaultModel ?? '');
            patch.defaultModel = effectiveModels.length === 0 ? '' : (current && effectiveModels.includes(current) ? current : effectiveModels[0]);
        }
        const row = await this.store.heartbeatHostRuntime(host, patch);
        if (!row) throw new PlatformError('HOST_RUNTIME_NOT_FOUND', `Host runtime not registered: ${host}`);
        return hostRuntimeDto(row);
    }

    async listWorkerPlacements(consumerId: string): Promise<any> {
        const id = assertConsumerId(consumerId);
        const rows = await this.store.listWorkerHostPolicies(id);
        return { items: rows.map(workerPlacementDto) };
    }

    async putWorkerPlacement(consumerId: string, workerId: string, body: any): Promise<any> {
        const id = assertConsumerId(consumerId);
        const worker = requiredText(workerId, 'workerId', 'WORKER_PLACEMENT_INVALID');
        const known = await this.store.knowledgeWorker(id, worker);
        if (!known) throw new PlatformError('WORKER_NOT_FOUND', `Worker not found: ${worker}`);
        const nativeAgent = body?.nativeAgent === undefined ? {} : body.nativeAgent;
        if (!isRecord(nativeAgent)) {
            throw new PlatformError('WORKER_PLACEMENT_INVALID', 'nativeAgent must be an object of hostId to agent name');
        }
        const config = {
            allowedHosts: body?.allowedHosts === undefined ? [] : textArray(body.allowedHosts),
            modelTier: body?.modelTier === undefined ? 'balanced' : oneOf(body.modelTier, MODEL_TIERS, 'modelTier', 'WORKER_PLACEMENT_INVALID'),
            nativeAgent: jsonObject(nativeAgent),
            fallback: body?.fallback === undefined ? 'block' : oneOf(body.fallback, FALLBACKS, 'fallback', 'WORKER_PLACEMENT_INVALID'),
        };
        const row = await this.store.upsertWorkerHostPolicy(id, worker, config);
        return workerPlacementDto(row);
    }

}
