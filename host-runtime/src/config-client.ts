/**
 * Read-only ESO config snapshot client.
 *
 * ESO stores configuration; the host reads it. Nothing here executes, queues, claims or calls a
 * model — it is an authenticated GET of one stable document.
 *
 * Snapshot shape is the live P2 contract of:
 *   GET /api/v1/consumers/:id/config-snapshot?runtimeKey=hostId:runtimeId
 */

import { DEFAULT_CACHE_MAX_AGE_MS, SnapshotCache, resolveCacheDir } from './offline-cache';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SnapshotConsumer {
    id: string;
    name: string;
    root: string | null;
    sdlcRoot: string | null;
    status: string;
    version: number;
    jev?: { mode?: string; consent?: boolean; autoThreshold?: number; confirmThreshold?: number } | null;
}

export interface SnapshotHostRuntime {
    hostId: string;
    runtimeId: string;
    runtimeKey: string;
    hostType?: string;
    runtimeKind: string;
    models?: string[];
    defaultModel?: string | null;
    leadEligible?: boolean;
    health?: string;
    lastHeartbeat?: string | null;
    /** Mode B endpoint registered by P4 ESO config (nullable until configured). */
    remoteUrl?: string | null;
    /** P5 model catalog: placement tier -> {model, effort?}. Absent until ESO config lands. */
    modelTiers?: Record<string, unknown> | null;
}

export interface SnapshotHost {
    hostId: string;
    hostType?: string;
    label?: string;
    runtimes: SnapshotHostRuntime[];
}

export interface SnapshotFlowNode {
    workerId: string;
    x?: number;
    y?: number;
}

export interface SnapshotFlowEdge {
    id?: string;
    from: string;
    to: string;
    on?: string;
    condition?: { kind?: string; equals?: string };
    priority?: number;
}

export interface SnapshotFlow {
    id: string;
    name?: string;
    version?: number;
    status?: string;
    nodes: SnapshotFlowNode[];
    edges: SnapshotFlowEdge[];
}

export interface SnapshotWorker {
    id: string;
    name?: string;
    role?: string;
    layer?: string;
    scope?: string;
    status?: string;
    capabilities?: string[];
    verbs?: string[];
    bar?: unknown[];
    escalation?: string;
    instructions?: string;
}

export interface SnapshotPlacement {
    workerId: string;
    allowedHosts?: string[];
    modelTier?: string;
    nativeAgent?: Record<string, string>;
    fallback?: string;
}

/** The payload part of the snapshot (everything the version hash covers). */
export interface SnapshotPayload {
    consumer: SnapshotConsumer;
    flow: SnapshotFlow | null;
    workers: SnapshotWorker[];
    workerPlacement: SnapshotPlacement[];
    hosts: SnapshotHost[];
    hostBindings: unknown[];
    stackVersion: unknown;
    providerRouting: Record<string, string>;
}

export interface ConfigSnapshot extends SnapshotPayload {
    version: string;
    generatedAt?: string;
}

export interface SnapshotValidation {
    ok: boolean;
    expected: string;
    actual: string;
    /** Which canonicalization the served version matched. */
    canonicalization?: 'json' | 'eso-date-collapse';
    reason?: string;
}

export class ConfigClientError extends Error {
    readonly code: string;
    readonly status: number;
    readonly detail?: string;

    constructor(code: string, message: string, status = 0, detail?: string) {
        super(message);
        this.name = 'ConfigClientError';
        this.code = code;
        this.status = status;
        this.detail = detail;
    }
}

export interface ConfigClientOptions {
    baseUrl: string;
    consumer: string;
    runtimeKey: string;
    token?: string;
    fetchImpl?: FetchLike;
    /** Snapshot cache root (default: ESO_CONFIG_CACHE_DIR or ~/.eso/host-runtime). */
    cacheDir?: string;
    /** Cache-only mode (default: ESO_OFFLINE=1). */
    offline?: boolean;
    cacheMaxAgeMs?: number;
    nowImpl?: () => number;
}

export type SnapshotSource = 'network' | 'cache';

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item));
    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key]);
        return sorted;
    }
    return value;
}

/** Canonical JSON: recursively sorted object keys (same rule ESO uses for the snapshot hash). */
export function canonicalSnapshotJson(payload: SnapshotPayload): string {
    return JSON.stringify(canonicalize(payload));
}

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Replay the control-plane canonicalization for one known quirk: ESO's `canonical()` treats a
 * `Date` as an object with no enumerable keys, so a JS `Date` becomes `{}` in the hashed text.
 * `platform.host_runtime.last_heartbeat` comes back from SQL as a Date; every other timestamp in
 * the snapshot payload is already a JSON string. (Reported as an ESO gap: heartbeat changes do not
 * change the version/ETag for this reason.)
 */
function canonicalizeEsoCompatible(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => canonicalizeEsoCompatible(item));
    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) {
            const child = source[key];
            if (key === 'lastHeartbeat' && typeof child === 'string' && child.length > 0) {
                sorted[key] = {};
                continue;
            }
            sorted[key] = canonicalizeEsoCompatible(child);
        }
        return sorted;
    }
    return value;
}

/** Recompute the snapshot version exactly as a pure JSON reader sees it. */
export async function computeSnapshotVersion(payload: SnapshotPayload): Promise<string> {
    return sha256Hex(canonicalSnapshotJson(payload));
}

/** Recompute the version the live control plane actually serves (Date-aware canonicalization). */
export async function computeSnapshotVersionEsoCompatible(payload: SnapshotPayload): Promise<string> {
    return sha256Hex(JSON.stringify(canonicalizeEsoCompatible(payload)));
}

export function snapshotPayload(snapshot: ConfigSnapshot): SnapshotPayload {
    return {
        consumer: snapshot.consumer,
        flow: snapshot.flow,
        workers: snapshot.workers,
        workerPlacement: snapshot.workerPlacement,
        hosts: snapshot.hosts,
        hostBindings: snapshot.hostBindings ?? [],
        stackVersion: snapshot.stackVersion ?? null,
        providerRouting: snapshot.providerRouting ?? {},
    };
}

/** Validate the snapshot shape and its self-describing version hash. */
export async function validateSnapshotVersion(snapshot: ConfigSnapshot): Promise<SnapshotValidation> {
    const actual = typeof snapshot?.version === 'string' ? snapshot.version : '';
    if (!actual) return { ok: false, expected: '', actual, reason: 'snapshot.version is missing' };
    if (!/^[0-9a-f]{64}$/i.test(actual)) {
        return { ok: false, expected: '', actual, reason: 'snapshot.version is not a sha256 hex string' };
    }
    if (!snapshot.consumer?.id) {
        return { ok: false, expected: '', actual, reason: 'snapshot.consumer.id is missing' };
    }
    if (!Array.isArray(snapshot.workers) || !Array.isArray(snapshot.hosts)) {
        return { ok: false, expected: '', actual, reason: 'snapshot.workers/hosts must be arrays' };
    }
    const payload = snapshotPayload(snapshot);
    const expected = await computeSnapshotVersion(payload);
    if (expected === actual.toLowerCase()) {
        return { ok: true, expected, actual, canonicalization: 'json' };
    }
    // ESO hashes JS Date instances as {}; host runtime lastHeartbeat is such a Date.
    const esoCompatible = await computeSnapshotVersionEsoCompatible(payload);
    if (esoCompatible === actual.toLowerCase()) {
        return { ok: true, expected, actual, canonicalization: 'eso-date-collapse' };
    }
    return { ok: false, expected, actual, reason: 'snapshot content does not match its version' };
}

/** Find the host runtime registration referenced by `runtimeKey` (hostId:runtimeId). */
export function findHostRuntime(snapshot: ConfigSnapshot, runtimeKey: string): SnapshotHostRuntime | null {
    for (const host of snapshot.hosts ?? []) {
        for (const runtime of host.runtimes ?? []) {
            const key = runtime.runtimeKey || `${runtime.hostId}:${runtime.runtimeId}`;
            if (key === runtimeKey) return runtime;
        }
    }
    return null;
}

/** Split `hostId:runtimeId`; both halves are required. */
export function splitRuntimeKey(runtimeKey: string): { hostId: string; runtimeId: string } {
    const match = /^([^:\s]+):([^:\s]+)$/.exec(runtimeKey ?? '');
    if (!match) throw new ConfigClientError('INVALID_RUNTIME_KEY', `runtimeKey must be hostId:runtimeId, got: ${runtimeKey}`);
    return { hostId: match[1], runtimeId: match[2] };
}

function errorFromResponse(status: number, text: string): ConfigClientError {
    let code = `HTTP_${status}`;
    let message = `Config snapshot request failed with HTTP ${status}`;
    let detail: string | undefined;
    try {
        const body = JSON.parse(text) as { code?: string; message?: string; detail?: string };
        if (body?.code) code = body.code;
        if (body?.message) message = body.message;
        detail = body?.detail;
    } catch {
        if (text) detail = text.slice(0, 500);
    }
    return new ConfigClientError(code, message, status, detail);
}

export class ConfigClient {
    private readonly baseUrl: string;
    private readonly consumer: string;
    private readonly runtimeKey: string;
    private readonly token?: string;
    private readonly fetchImpl: FetchLike;
    private readonly cache: SnapshotCache;
    private readonly offline: boolean;
    private readonly cacheMaxAgeMs: number;
    private readonly nowImpl: () => number;
    private cached: ConfigSnapshot | null = null;
    private etag: string | null = null;
    /** Where the last getSnapshot() came from (for warnings/tests). */
    lastSource: SnapshotSource | null = null;
    /** Age of the cached snapshot in ms when lastSource === 'cache'. */
    lastCacheAgeMs: number | null = null;
    /** Warning code explaining a cache fallback, if any. */
    lastWarning: string | null = null;

    constructor(options: ConfigClientOptions) {
        this.baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
        this.consumer = options.consumer;
        this.runtimeKey = options.runtimeKey;
        this.token = options.token;
        this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
        this.nowImpl = options.nowImpl ?? (() => Date.now());
        this.cacheMaxAgeMs = options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
        this.offline = options.offline ?? process.env.ESO_OFFLINE === '1';
        const cacheDir = resolveCacheDir(options.cacheDir);
        this.cache = new SnapshotCache(SnapshotCache.filePathFor(cacheDir, options.consumer, options.runtimeKey));
    }

    /** Persist this snapshot as the last valid offline fallback (call after version validation). */
    saveSnapshot(snapshot: ConfigSnapshot): void {
        this.cache.save(this.consumer, this.runtimeKey, snapshot);
    }

    cacheFilePath(): string {
        return this.cache.filePath;
    }

    private loadCachedSnapshot(offline: boolean): ConfigSnapshot | null {
        const loaded = this.cache.load(this.consumer, this.runtimeKey, this.nowImpl);
        if (!loaded.ok) {
            if (offline) throw new ConfigClientError(loaded.code, loaded.reason);
            return null;
        }
        if (offline && this.cacheMaxAgeMs > 0 && loaded.ageMs > this.cacheMaxAgeMs) {
            throw new ConfigClientError(
                'SNAPSHOT_CACHE_STALE',
                `cached snapshot is older than ${this.cacheMaxAgeMs} ms (age ${loaded.ageMs} ms)`,
            );
        }
        this.lastSource = 'cache';
        this.lastCacheAgeMs = loaded.ageMs;
        this.lastWarning = `SNAPSHOT_CACHE_USED ageMs=${loaded.ageMs}`;
        return loaded.snapshot;
    }

    /** Snapshot URL for this consumer/runtime (exposed for logs and tests — never includes the token). */
    snapshotUrl(): string {
        return `${this.baseUrl}/api/v1/consumers/${encodeURIComponent(this.consumer)}/config-snapshot?runtimeKey=${encodeURIComponent(this.runtimeKey)}`;
    }

    /**
     * Fetch the snapshot. With `useEtag` the previous ETag is sent and a 304 returns the cached
     * document instead of a body.
     */
    async getSnapshot(options: { useEtag?: boolean; offline?: boolean } = {}): Promise<ConfigSnapshot> {
        this.lastSource = null;
        this.lastCacheAgeMs = null;
        this.lastWarning = null;
        const offline = options.offline ?? this.offline;
        if (offline) {
            const cachedSnapshot = this.loadCachedSnapshot(true);
            if (!cachedSnapshot) throw new ConfigClientError('SNAPSHOT_CACHE_MISSING', 'no cached snapshot available');
            return cachedSnapshot;
        }

        const headers: Record<string, string> = { accept: 'application/json' };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        if (options.useEtag && this.etag) headers['if-none-match'] = this.etag;

        let response: Response;
        try {
            response = await this.fetchImpl(this.snapshotUrl(), { method: 'GET', headers });
        } catch (error) {
            const cachedSnapshot = this.loadCachedSnapshot(false);
            if (cachedSnapshot) return cachedSnapshot;
            throw new ConfigClientError(
                'CONFIG_SNAPSHOT_UNREACHABLE',
                `Cannot reach ESO at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        if (response.status === 304) {
            if (!this.cached) {
                throw new ConfigClientError('CONFIG_SNAPSHOT_EMPTY', 'Server returned 304 without a cached snapshot');
            }
            return this.cached;
        }

        const text = await response.text();
        if (!response.ok) {
            if (response.status >= 500) {
                const cachedSnapshot = this.loadCachedSnapshot(false);
                if (cachedSnapshot) return cachedSnapshot;
            }
            throw errorFromResponse(response.status, text);
        }

        let snapshot: ConfigSnapshot;
        try {
            snapshot = JSON.parse(text) as ConfigSnapshot;
        } catch {
            throw new ConfigClientError('CONFIG_SNAPSHOT_INVALID', 'Config snapshot body is not valid JSON', response.status);
        }
        this.cached = snapshot;
        this.lastSource = 'network';
        const etag = response.headers?.get?.('etag') ?? null;
        this.etag = etag;
        return snapshot;
    }
}
