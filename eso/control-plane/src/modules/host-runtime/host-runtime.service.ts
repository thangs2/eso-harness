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

const MODEL_TIER_NAMES = ['fast', 'balanced', 'reasoning'] as const;

/** Read a stored modelTiers jsonb value into a plain DTO object (lenient). */
function modelTiersFrom(value: unknown): Record<string, any> {
    let raw: any = value;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { return {}; }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result: Record<string, any> = {};
    for (const [tier, entry] of Object.entries(raw)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const model = typeof (entry as any).model === 'string' ? (entry as any).model : '';
        if (!model) continue;
        const effort = (entry as any).effort;
        result[tier] = typeof effort === 'string' ? { model, effort } : { model };
    }
    return result;
}

/** Validate a host-reported model tier mapping: known tiers, required model, model in catalog. */
function normalizeModelTiers(value: unknown, models: string[]): Record<string, { model: string; effort?: string }> {
    let raw: any = value;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { throw new PlatformError('HOST_RUNTIME_INVALID', 'modelTiers must be an object'); }
    }
    if (!isRecord(raw)) throw new PlatformError('HOST_RUNTIME_INVALID', 'modelTiers must be an object');
    const result: Record<string, { model: string; effort?: string }> = {};
    for (const [tier, entry] of Object.entries(raw)) {
        if (!(MODEL_TIER_NAMES as readonly string[]).includes(tier)) {
            throw new PlatformError('HOST_RUNTIME_INVALID', `modelTiers unknown tier: ${tier}`);
        }
        if (!isRecord(entry)) throw new PlatformError('HOST_RUNTIME_INVALID', `modelTiers.${tier} must be an object`);
        const model = typeof (entry as any).model === 'string' ? (entry as any).model.trim() : '';
        if (!model) throw new PlatformError('HOST_RUNTIME_INVALID', `modelTiers.${tier}.model is required`);
        if (models.length > 0 && !models.includes(model)) {
            throw new PlatformError('HOST_RUNTIME_INVALID', `modelTiers.${tier}.model must be one of the reported models`);
        }
        const effortRaw = (entry as any).effort;
        if (effortRaw !== undefined && effortRaw !== null && typeof effortRaw !== 'string') {
            throw new PlatformError('HOST_RUNTIME_INVALID', `modelTiers.${tier}.effort must be a string`);
        }
        const effort = typeof effortRaw === 'string' && effortRaw.trim() ? effortRaw.trim() : undefined;
        result[tier] = effort === undefined ? { model } : { model, effort };
    }
    return result;
}

/** Normalize the optional remote endpoint: empty -> null, non-empty must be an http(s) URL. */
function normalizeRemoteUrl(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        throw new PlatformError('HOST_RUNTIME_INVALID', 'remoteUrl must be an http(s) URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new PlatformError('HOST_RUNTIME_INVALID', 'remoteUrl must be an http(s) URL');
    }
    return text;
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

/** Stable composite identifier for a host runtime. */
function runtimeKeyOf(hostId: unknown, runtimeId: unknown): string {
    return `${String(hostId ?? '')}:${String(runtimeId ?? '')}`;
}

/** Placement values are runtimeKeys; reject malformed keys (missing/extra colon, empty side). */
function isRuntimeKey(value: string): boolean {
    return /^[^:\s]+:[^:\s]+$/.test(value);
}

function hostDto(row: any): any {
    const hostId = row.host_id ?? row.hostId;
    return {
        hostId,
        hostType: row.host_type ?? row.hostType,
        label: row.label ?? hostId,
    };
}

function hostRuntimeDto(row: any, hostType?: string | null): any {
    const hostId = row.host_id ?? row.hostId;
    const runtimeId = row.runtime_id ?? row.runtimeId;
    return {
        hostId,
        runtimeId,
        runtimeKey: runtimeKeyOf(hostId, runtimeId),
        hostType: hostType ?? row.host_type ?? row.hostType ?? null,
        runtimeKind: row.runtime_kind ?? row.runtimeKind,
        models: jsonArray(row.models),
        defaultModel: row.default_model ?? row.defaultModel ?? '',
        leadEligible: Boolean(row.lead_eligible ?? row.leadEligible),
        health: row.health ?? 'unknown',
        lastHeartbeat: row.last_heartbeat ?? row.lastHeartbeat ?? null,
        remoteUrl: row.remote_url ?? row.remoteUrl ?? null,
        modelTiers: modelTiersFrom(row.model_tiers ?? row.modelTiers),
    };
}

function workerPlacementDto(row: any, runtimeKeys?: Map<string, string>): any {
    const native = jsonObject(row.native_agent ?? row.nativeAgent);
    const nativeAgent: Record<string, any> = {};
    for (const [key, value] of Object.entries(native)) {
        nativeAgent[key.includes(':') ? key : runtimeKeys?.get(key) ?? key] = value;
    }
    return {
        workerId: row.worker_id ?? row.workerId,
        allowedHosts: textArray(row.allowed_hosts ?? row.allowedHosts),
        modelTier: row.model_tier ?? row.modelTier ?? 'balanced',
        nativeAgent,
        fallback: row.fallback ?? 'block',
    };
}

function runtimeKeyMap(rows: any[]): Map<string, string> {
    const keys = new Map<string, string>();
    for (const row of rows) {
        const hostId = String(row.host_id ?? row.hostId);
        if (!keys.has(hostId)) keys.set(hostId, row.runtimeKey ?? `${hostId}:${row.runtime_id ?? row.runtimeId}`);
    }
    return keys;
}

/** Drop mappings whose model disappeared from the runtime catalog (keeps modelTiers consistent). */
function pruneModelTiers(tiers: Record<string, any>, models: string[]): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [tier, entry] of Object.entries(tiers ?? {})) {
        if (models.includes(String(entry?.model ?? ''))) out[tier] = entry;
    }
    return out;
}

export class HostRuntimeService {
    constructor(private readonly store: PlatformStore) {}

    /** Nested host view: one item per machine with its advertised runtimes. */
    async listHosts(): Promise<any> {
        const [hosts, runtimes] = await Promise.all([this.store.listHosts(), this.store.listHostRuntimes()]);
        const hostTypes = new Map(hosts.map((host: any) => [String(host.host_id ?? host.hostId), String(host.host_type ?? host.hostType)]));
        const byHost = new Map<string, any[]>();
        for (const runtime of runtimes) {
            const hostId = String(runtime.host_id ?? runtime.hostId);
            const list = byHost.get(hostId) ?? [];
            list.push(hostRuntimeDto(runtime, hostTypes.get(hostId)));
            byHost.set(hostId, list);
        }
        return {
            items: hosts.map((host) => {
                const dto = hostDto(host);
                return { ...dto, runtimes: byHost.get(String(dto.hostId)) ?? [] };
            }),
        };
    }

    /** Flattened runtime view for pickers/placement. */
    async listHostRuntimes(): Promise<any> {
        const [rows, hosts] = await Promise.all([this.store.listHostRuntimes(), this.store.listHosts()]);
        const types = new Map(hosts.map((host: any) => [String(host.host_id ?? host.hostId), String(host.host_type ?? host.hostType)]));
        return {
            items: rows.map((row) => hostRuntimeDto(row, types.get(String(row.host_id ?? row.hostId)))),
        };
    }

    async putHost(hostId: string, body: any): Promise<any> {
        const host = requiredText(hostId, 'hostId', 'HOST_RUNTIME_INVALID');
        const hostType = requiredText(body?.hostType, 'hostType', 'HOST_RUNTIME_INVALID');
        const existing = await this.store.getHost(host);
        const label = body?.label === undefined
            ? (existing ? String(existing.label ?? host) : host)
            : String(body.label || host);
        const row = await this.store.upsertHost({ hostId: host, hostType, label });
        return hostDto(row);
    }

    async putHostRuntime(hostId: string, runtimeId: string, body: any): Promise<any> {
        const host = requiredText(hostId, 'hostId', 'HOST_RUNTIME_INVALID');
        const runtime = requiredText(runtimeId, 'runtimeId', 'HOST_RUNTIME_INVALID');
        const hostRow = await this.store.getHost(host);
        if (!hostRow) throw new PlatformError('HOST_RUNTIME_NOT_FOUND', `Host not registered: ${host}`);
        const existing = await this.store.getHostRuntime(host, runtime);
        const models = body?.models === undefined ? (existing ? jsonArray(existing.models) : []) : textArray(body.models);
        const healthExplicit = body?.health !== undefined;
        const defaultExplicit = body?.defaultModel !== undefined;
        const row = await this.store.upsertHostRuntime({
            hostId: host,
            runtimeId: runtime,
            runtimeKind: oneOf(body?.runtimeKind, HOST_RUNTIME_KINDS, 'runtimeKind', 'HOST_RUNTIME_INVALID'),
            models,
            defaultModel: resolveDefaultModel(body, models, existing, defaultExplicit),
            leadEligible: Boolean(body?.leadEligible),
            remoteUrl: normalizeRemoteUrl(body?.remoteUrl),
            modelTiers: body?.modelTiers === undefined
                ? pruneModelTiers(modelTiersFrom(existing?.model_tiers ?? existing?.modelTiers), models)
                : normalizeModelTiers(body.modelTiers, models),
            // Metadata edits preserve observed health; only an explicit health field (or heartbeat)
            // may change liveness. A newly registered runtime starts as 'unknown'.
            health: healthExplicit
                ? oneOf(body.health, HOST_RUNTIME_HEALTH, 'health', 'HOST_RUNTIME_INVALID')
                : String(existing?.health ?? 'unknown'),
            healthExplicit,
        });
        return hostRuntimeDto(row, hostRow.host_type ?? hostRow.hostType);
    }

    async heartbeat(hostId: string, runtimeId: string, body: any): Promise<any> {
        const host = requiredText(hostId, 'hostId', 'HOST_RUNTIME_INVALID');
        const runtime = requiredText(runtimeId, 'runtimeId', 'HOST_RUNTIME_INVALID');
        const [existing, hostRow] = await Promise.all([
            this.store.getHostRuntime(host, runtime),
            this.store.getHost(host),
        ]);
        if (!existing) throw new PlatformError('HOST_RUNTIME_NOT_FOUND', `Host runtime not registered: ${host}:${runtime}`);
        const modelsSupplied = body?.models !== undefined;
        const defaultSupplied = body?.defaultModel !== undefined;
        const tiersSupplied = body?.modelTiers !== undefined;
        const effectiveModels = modelsSupplied ? textArray(body.models) : jsonArray(existing.models);
        const patch: { health?: string; models?: string[]; defaultModel?: string; modelTiers?: any } = {};
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
        if (tiersSupplied) patch.modelTiers = normalizeModelTiers(body.modelTiers, effectiveModels);
        else if (modelsSupplied) {
            patch.modelTiers = pruneModelTiers(modelTiersFrom(existing.model_tiers ?? existing.modelTiers), effectiveModels);
        }
        const row = await this.store.heartbeatHostRuntime(host, runtime, patch);
        if (!row) throw new PlatformError('HOST_RUNTIME_NOT_FOUND', `Host runtime not registered: ${host}:${runtime}`);
        return hostRuntimeDto(row, hostRow?.host_type ?? hostRow?.hostType ?? null);
    }

    async listWorkerPlacements(consumerId: string): Promise<any> {
        const id = assertConsumerId(consumerId);
        const [rows, hostRuntimes] = await Promise.all([
            this.store.listWorkerHostPolicies(id),
            this.store.listHostRuntimes(),
        ]);
        const keys = runtimeKeyMap(hostRuntimes as any[]);
        return { items: rows.map((row) => workerPlacementDto(row, keys)) };
    }

    async putWorkerPlacement(consumerId: string, workerId: string, body: any): Promise<any> {
        const id = assertConsumerId(consumerId);
        const worker = requiredText(workerId, 'workerId', 'WORKER_PLACEMENT_INVALID');
        const known = await this.store.knowledgeWorker(id, worker);
        if (!known) throw new PlatformError('WORKER_NOT_FOUND', `Worker not found: ${worker}`);
        const nativeAgent = body?.nativeAgent === undefined ? {} : body.nativeAgent;
        if (!isRecord(nativeAgent)) {
            throw new PlatformError('WORKER_PLACEMENT_INVALID', 'nativeAgent must be an object keyed by runtimeKey');
        }
        const allowedHosts = body?.allowedHosts === undefined ? [] : textArray(body.allowedHosts);
        for (const key of allowedHosts) {
            if (!isRuntimeKey(key)) {
                throw new PlatformError('WORKER_PLACEMENT_INVALID', `allowedHosts entries must be runtimeKey hostId:runtimeId (got ${key})`);
            }
        }
        const config = {
            allowedHosts,
            modelTier: body?.modelTier === undefined ? 'balanced' : oneOf(body.modelTier, MODEL_TIERS, 'modelTier', 'WORKER_PLACEMENT_INVALID'),
            nativeAgent: jsonObject(nativeAgent),
            fallback: body?.fallback === undefined ? 'block' : oneOf(body.fallback, FALLBACKS, 'fallback', 'WORKER_PLACEMENT_INVALID'),
        };
        const row = await this.store.upsertWorkerHostPolicy(id, worker, config);
        return workerPlacementDto(row, runtimeKeyMap((await this.store.listHostRuntimes()) as any[]));
    }

}
