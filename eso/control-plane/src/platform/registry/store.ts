import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    CONSUMER_ID_PATTERN,
    CONSUMER_TABLE,
    CONSUMER_EVENT_TABLE,
    HOST_DDL,
    HOST_RUNTIME_DDL,
    HOST_RUNTIME_HEALTH,
    HOST_RUNTIME_KINDS,
    HOST_RUNTIME_LEGACY_TABLE,
    HOST_RUNTIME_TABLE,
    HOST_TYPES,
    PLATFORM_DDL,
    quoteSchema,
    schemaNameFor,
} from './ddl.js';
import { fail } from './errors.js';
import type {
    ConsumerEvent,
    ConsumerRecord,
    ConsumerStatus,
    ListConsumersOptions,
    StackVersionRecord,
} from './types.js';
import { normalizeListWindow } from './types.js';

/**
 * BUG-46: one durable home for host evidence. Both ingest write paths
 * (`/ingest/events` envelopes and `/evidence` ledger records) persist here, so a restart loses
 * nothing and there is a single source of truth for a consumer.
 *
 * `origin` keeps each route's identity namespace: an ingest envelope is idempotent by `event_id`,
 * an evidence claim by its explicit `id`. The unique key is `(origin, evidence_id)`.
 */
export type EvidenceOrigin = 'ingest' | 'evidence';

/** Input for `PlatformStore.appendEvidence` (camelCase, like the other write methods). */
export interface EvidenceWrite {
    evidenceId: string;
    origin: EvidenceOrigin;
    schema?: string | null;
    kind: string;
    occurredAt?: string | null;
    receivedAt?: string | null;
    contentHash?: string | null;
    sourceHash?: string | null;
    payload?: unknown;
    provenance?: unknown;
    redaction?: unknown;
}

/** Persisted row shape, identical for both stores (snake_case, like `listObservations`). */
export interface EvidenceRow {
    evidence_id: string;
    origin: EvidenceOrigin;
    schema: string | null;
    kind: string;
    occurred_at: string | Date | null;
    received_at: string | Date;
    content_hash: string | null;
    source_hash: string | null;
    payload: unknown;
    provenance: unknown;
    redaction: unknown;
}

export interface EvidenceAppended {
    record: EvidenceRow;
    created: boolean;
}

/**
 * PlatformDb contract (plane B §3 · plane D §1):
 *   query/exec/transaction, plus the small typed surface the registry needs.
 *
 * The in-memory implementation is the unit-test double; the Bun.SQL implementation is the
 * PostgreSQL adapter used by the running control plane and by integration tests.
 */
export interface PlatformStore {
    readonly kind: 'memory' | 'postgres';
    ensurePlatformSchema(): Promise<void>;
    tableExists(table: 'platform.consumer' | 'platform.consumer_event'): Promise<boolean>;
    transaction<T>(fn: (tx: PlatformStore) => Promise<T>): Promise<T>;
    createSchema(consumerId: string): Promise<string>;
    ensureKnowledgeSchema(consumerId: string): Promise<void>;
    dropSchema(consumerId: string): Promise<void>;
    schemaExists(consumerId: string): Promise<boolean>;
    insertConsumer(record: ConsumerRecord): Promise<void>;
    /** BUG-38: remove a half-created consumer after a provisioning failure so retry is possible. */
    removeConsumer(id: string): Promise<void>;
    getConsumer(id: string): Promise<ConsumerRecord | null>;
    listConsumers(options?: ListConsumersOptions): Promise<ConsumerRecord[]>;
    updateConsumer(
        id: string,
        patch: Partial<Pick<ConsumerRecord, 'name' | 'root' | 'sdlcRoot' | 'status' | 'version' | 'materializedHash' | 'updatedAt'>>
    ): Promise<ConsumerRecord>;
    setStatus(id: string, status: ConsumerStatus, updatedAt: string): Promise<void>;
    setMaterializedHash(id: string, hash: string | null): Promise<void>;
    appendEvent(event: ConsumerEvent): Promise<ConsumerEvent>;
    listEvents(consumerId: string, limit?: number): Promise<ConsumerEvent[]>;
    listStackVersions(consumerId: string): Promise<StackVersionRecord[]>;
    /**
     * BUG-27: replace-all with optimistic concurrency. When `expected` is supplied the write only
     * lands if the consumer version and the current versions hash still match; a stale caller gets
     * `false`. A successful conditional write bumps the consumer version.
     */
    replaceStackVersions(
        consumerId: string,
        versions: StackVersionRecord[],
        expected?: { consumerVersion: number; versionsHash: string }
    ): Promise<boolean>;
    listHosts(): Promise<any[]>;
    getHost(hostId: string): Promise<any>;
    upsertHost(host: any): Promise<any>;
    listHostRuntimes(): Promise<any[]>;
    getHostRuntime(hostId: string, runtimeId: string): Promise<any>;
    upsertHostRuntime(runtime: any): Promise<any>;
    heartbeatHostRuntime(hostId: string, runtimeId: string, patch: { health?: string; models?: string[]; defaultModel?: string; modelTiers?: any }): Promise<any>;
    createHostToken(token: any): Promise<any>;
    getHostTokenByHash(tokenHash: string): Promise<any>;
    touchHostToken(tokenId: string): Promise<any>;
    revokeHostToken(hostId: string, runtimeId: string, tokenId: string): Promise<any>;
    insertObservation(consumerId: string, observation: any): Promise<{ observation: any; created: boolean }>;
    listObservations(consumerId: string, limit?: number): Promise<any[]>;
    pruneObservations(consumerId: string, before: string): Promise<number>;
    /**
     * BUG-46: append-only evidence, idempotent by `(origin, evidence_id)`. No update/delete member
     * exists on purpose — AC-19's 405 is a property of the surface, not a route check.
     */
    appendEvidence(consumerId: string, records: ReadonlyArray<EvidenceWrite>): Promise<EvidenceAppended[]>;
    /** Oldest first (append order), so ingest echoes its batch in the host's order. */
    listEvidence(consumerId: string, options?: { origin?: EvidenceOrigin }): Promise<EvidenceRow[]>;
    getEvidence(consumerId: string, evidenceId: string, options?: { origin?: EvidenceOrigin }): Promise<EvidenceRow | null>;
    listWorkerHostPolicies(consumerId: string): Promise<any[]>;
    getWorkerHostPolicy(consumerId: string, workerId: string): Promise<any>;
    upsertWorkerHostPolicy(consumerId: string, workerId: string, config: any): Promise<any>;
    replaceWorkerIndex(
        consumerId: string,
        workers: Array<{
            workerId: string;
            name: string;
            role: string;
            layer: 'peer' | 'gate';
            scope: string;
            status: 'declared' | 'active' | 'paused' | 'retired';
            filePath: string;
            contentHash: string;
            hostBindingIds: string[];
            capabilities: string[];
            verbs: string[];
            bar: any[];
            escalation: string;
        }>,
        edges: Array<{ from: string; to: string; on: string }>
    ): Promise<void>;
    replaceFlowIndex(consumerId: string, flows: Array<{
        flowId: string;
        version: number;
        name: string;
        status: 'draft' | 'published';
        isDefault: boolean;
        definition: any;
        sourceHash: string;
        updatedAt?: string;
        publishedAt?: string;
    }>): Promise<void>;
    knowledgeFlows(consumerId: string): Promise<any[]>;
    recordEdgeClaim(consumerId: string, claim: any): Promise<void>;
    knowledgeEdgeClaims(consumerId: string, edgeId?: string): Promise<any[]>;
    knowledgeExternalRefs(consumerId: string, docId?: string): Promise<any[]>;
    listConsumerPlugins(consumerId: string): Promise<any[]>;
    upsertConsumerPlugin(consumerId: string, pluginId: string, patch: any): Promise<any>;
    listPluginManifests(): Promise<any[]>;
    upsertPluginManifest(manifest: any): Promise<any>;
    deletePluginManifest(id: string): Promise<void>;
    replaceProviderRecords(consumerId: string, providerId: string, records: any[]): Promise<void>;
    listProviderRecords(consumerId: string, providerId?: string): Promise<any[]>;
    replaceKnowledgeIndex(consumerId: string, payload: any): Promise<void>;
    knowledgeSummary(consumerId: string): Promise<any>;
    knowledgeDocs(consumerId: string, query?: string, limit?: number): Promise<any[]>;
    knowledgeFindings(consumerId: string, limit?: number): Promise<any[]>;
    knowledgeDoc(consumerId: string, docId: string): Promise<any>;
    knowledgeCoverage(consumerId: string): Promise<any[]>;
    knowledgeFtsSearch(consumerId: string, query: string, limit?: number): Promise<any[]>;
    knowledgeGraphCandidates(consumerId: string, docIds: string[], limit?: number): Promise<any[]>;
    knowledgeChunks(consumerId: string, pendingOnly?: boolean, limit?: number): Promise<any[]>;
    updateChunkEmbeddings(consumerId: string, items: Array<{ chunkId: string; vector: number[] }>): Promise<void>;
    knowledgeVectorCount(consumerId: string): Promise<number>;
    knowledgeVectorSearch(consumerId: string, vector: number[], limit?: number): Promise<any[]>;
    knowledgeWorker(consumerId: string, workerId: string): Promise<any>;
    knowledgeWorkerEdge(consumerId: string, fromWorkerId: string, toWorkerId: string): Promise<any>;
    recordWorkerEvent(consumerId: string, event: any): Promise<void>;
    listWorkerEvents(consumerId: string, workerId?: string, limit?: number): Promise<any[]>;
    createWorkerHandoff(consumerId: string, handoff: any): Promise<void>;
    acceptWorkerHandoff(consumerId: string, handoffId: string, workerId: string): Promise<any>;
    listWorkerHandoffs(consumerId: string, workerId?: string, limit?: number): Promise<any[]>;
    recordWorkerImport(consumerId: string, record: any): Promise<void>;
    listWorkerImports(consumerId: string, limit?: number): Promise<any[]>;
    withSearchPath<T>(consumerId: string, fn: (tx: PlatformStore) => Promise<T>): Promise<T>;
    getSearchPath(): string | null;
    /** Test-only fault hook (memory store). */
    fault?: ((phase: string) => void) | null;
    /** DDL statements observed (memory store). */
    readonly ddlLog?: string[];
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function rowNow(input?: string): string {
    return input ?? new Date().toISOString();
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
}

/**
 * BUG-27: deterministic hash of a consumer's stack-version set. Both the API (to hand out a
 * `baseVersion` token) and the stores (to compare-and-swap) use this one function.
 */
export function stackVersionsHash(versions: StackVersionRecord[]): string {
    const canonical = [...versions]
        .sort((a, b) => a.version - b.version)
        .map((version) => ({
            version: Number(version.version),
            status: version.status,
            layers: version.layers ?? [],
            publishedAt: version.publishedAt ?? null,
            createdAt: version.createdAt ?? null,
        }));
    return createHash('sha256').update(canonicalJson(canonical)).digest('hex');
}

export class MemoryPlatformStore implements PlatformStore {
    readonly kind = 'memory' as const;
    readonly ddlLog: string[] = [];
    private tables = new Set<string>();
    private consumers = new Map<string, ConsumerRecord>();
    private events: ConsumerEvent[] = [];
    private stackVersions = new Map<string, StackVersionRecord[]>();
    private hosts = new Map<string, any>();
    /** Keyed by `${hostId}:${runtimeId}` (runtimeKey). */
    private hostRuntimes = new Map<string, any>();
    private workerHostPolicies = new Map<string, any>();
    private hostTokens = new Map<string, any>();
    private observations = new Map<string, any[]>();
    private evidence = new Map<string, any[]>();
    private evidenceSeq = 0;
    private schemas = new Set<string>();
    private nextEventId = 1;
    private searchPath: string | null = null;
    fault: ((phase: string) => void) | null = null;

    async ensurePlatformSchema(): Promise<void> {
        for (const statement of PLATFORM_DDL) {
            this.ddlLog.push(statement);
            const table = /CREATE TABLE IF NOT EXISTS\s+(platform\.[a-z_]+)/i.exec(statement)?.[1];
            if (table) this.tables.add(table);
        }
        this.tables.add(CONSUMER_TABLE);
        this.tables.add(CONSUMER_EVENT_TABLE);
    }

    async tableExists(table: 'platform.consumer' | 'platform.consumer_event'): Promise<boolean> {
        return this.tables.has(table);
    }

    async transaction<T>(fn: (tx: PlatformStore) => Promise<T>): Promise<T> {
        const snapshot = {
            consumers: clone(this.consumers),
            events: clone(this.events),
            stackVersions: new Map([...this.stackVersions].map(([key, value]) => [key, clone(value)])),
            hosts: new Map([...this.hosts].map(([key, value]) => [key, clone(value)])),
            hostRuntimes: new Map([...this.hostRuntimes].map(([key, value]) => [key, clone(value)])),
            workerHostPolicies: new Map([...this.workerHostPolicies].map(([key, value]) => [key, clone(value)])),
            hostTokens: new Map([...this.hostTokens].map(([key, value]) => [key, clone(value)])),
            observations: new Map([...this.observations].map(([key, value]) => [key, clone(value)])),
            evidence: new Map([...this.evidence].map(([key, value]) => [key, clone(value)])),
            evidenceSeq: this.evidenceSeq,
            schemas: new Set(this.schemas),
            nextEventId: this.nextEventId,
            searchPath: this.searchPath,
        };
        try {
            return await fn(this);
        } catch (error) {
            this.consumers = snapshot.consumers;
            this.events = snapshot.events;
            this.stackVersions = snapshot.stackVersions;
            this.hosts = snapshot.hosts;
            this.hostRuntimes = snapshot.hostRuntimes;
            this.workerHostPolicies = snapshot.workerHostPolicies;
            this.hostTokens = snapshot.hostTokens;
            this.observations = snapshot.observations;
            this.evidence = snapshot.evidence;
            this.evidenceSeq = snapshot.evidenceSeq;
            this.schemas = snapshot.schemas;
            this.nextEventId = snapshot.nextEventId;
            this.searchPath = snapshot.searchPath;
            throw error;
        }
    }

    async createSchema(consumerId: string): Promise<string> {
        this.fault?.('beforeSchema');
        const schema = this.schemaName(consumerId);
        if (this.schemas.has(schema)) throw new Error(`SCHEMA_EXISTS:${schema}`);
        this.schemas.add(schema);
        this.fault?.('afterSchema');
        return schema;
    }

    async ensureKnowledgeSchema(_consumerId: string): Promise<void> {
        // Memory store is the unit-test double; knowledge tables are exercised through the SQL adapter.
    }

    async dropSchema(consumerId: string): Promise<void> {
        this.schemas.delete(this.schemaName(consumerId));
    }

    async schemaExists(consumerId: string): Promise<boolean> {
        return this.schemas.has(this.schemaName(consumerId));
    }

    async insertConsumer(record: ConsumerRecord): Promise<void> {
        if (this.consumers.has(record.id)) fail('CONSUMER_EXISTS');
        this.fault?.('beforeInsert');
        this.consumers.set(record.id, clone(record));
        this.fault?.('afterInsert');
    }

    async getConsumer(id: string): Promise<ConsumerRecord | null> {
        const row = this.consumers.get(id);
        return row ? clone(row) : null;
    }

    async removeConsumer(id: string): Promise<void> {
        this.consumers.delete(id);
        this.events = this.events.filter((event) => event.consumerId !== id);
    }

    async listConsumers(options: ListConsumersOptions = {}): Promise<ConsumerRecord[]> {
        const { limit, offset } = normalizeListWindow(options);
        let rows = [...this.consumers.values()];
        if (options.status) rows = rows.filter((row) => row.status === options.status);
        if (!options.includeDeleted) {
            rows = rows.filter((row) => row.status !== 'deleted' && row.status !== 'purged');
        }
        return rows
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(offset, offset + limit)
            .map((row) => clone(row));
    }

    async updateConsumer(
        id: string,
        patch: Partial<Pick<ConsumerRecord, 'name' | 'root' | 'sdlcRoot' | 'status' | 'version' | 'materializedHash' | 'updatedAt'>>
    ): Promise<ConsumerRecord> {
        const current = this.consumers.get(id);
        if (!current) fail('CONSUMER_NOT_FOUND');
        const next = { ...current, ...patch };
        this.consumers.set(id, next);
        return clone(next);
    }

    async setStatus(id: string, status: ConsumerStatus, updatedAt: string): Promise<void> {
        await this.updateConsumer(id, { status, updatedAt });
    }

    async setMaterializedHash(id: string, hash: string | null): Promise<void> {
        await this.updateConsumer(id, { materializedHash: hash });
    }

    async appendEvent(event: ConsumerEvent): Promise<ConsumerEvent> {
        const stored = { ...clone(event), id: this.nextEventId++ };
        this.events.push(stored);
        return clone(stored);
    }

    async listEvents(consumerId: string, limit = 100): Promise<ConsumerEvent[]> {
        return this.events
            .filter((event) => event.consumerId === consumerId)
            .sort((a, b) => (b.at || '').localeCompare(a.at || '') || (b.id || 0) - (a.id || 0))
            .slice(0, limit)
            .map((event) => clone(event));
    }

    async listStackVersions(consumerId: string): Promise<StackVersionRecord[]> {
        return clone(this.stackVersions.get(consumerId) || []).sort((a, b) => b.version - a.version);
    }

    async replaceStackVersions(
        consumerId: string,
        versions: StackVersionRecord[],
        expected?: { consumerVersion: number; versionsHash: string }
    ): Promise<boolean> {
        const consumer = this.consumers.get(consumerId);
        if (expected && (!consumer || consumer.version !== expected.consumerVersion)) return false;
        const current = this.stackVersions.get(consumerId) || [];
        if (expected && stackVersionsHash(current) !== expected.versionsHash) return false;
        this.stackVersions.set(consumerId, clone(versions).sort((a, b) => a.version - b.version));
        if (expected && consumer) {
            this.consumers.set(consumerId, {
                ...consumer,
                version: consumer.version + 1,
                updatedAt: rowNow(),
            });
        }
        return true;
    }

    async listHosts(): Promise<any[]> {
        return [...this.hosts.values()]
            .sort((a, b) => String(a.host_id).localeCompare(String(b.host_id)))
            .map((row) => clone(row));
    }

    async getHost(hostId: string): Promise<any> {
        const row = this.hosts.get(hostId);
        return row ? clone(row) : null;
    }

    async upsertHost(host: any): Promise<any> {
        const key = String(host.hostId);
        const current = this.hosts.get(key);
        const now = new Date().toISOString();
        const row = {
            host_id: key,
            host_type: host.hostType,
            label: host.label ?? key,
            created_at: current?.created_at ?? now,
            updated_at: now,
        };
        this.hosts.set(key, row);
        return clone(row);
    }

    async listHostRuntimes(): Promise<any[]> {
        return [...this.hostRuntimes.values()]
            .sort((a, b) => `${a.host_id}:${a.runtime_id}`.localeCompare(`${b.host_id}:${b.runtime_id}`))
            .map((row) => clone(row));
    }

    async getHostRuntime(hostId: string, runtimeId: string): Promise<any> {
        const row = this.hostRuntimes.get(`${hostId}:${runtimeId}`);
        return row ? clone(row) : null;
    }

    async upsertHostRuntime(runtime: any): Promise<any> {
        const key = `${runtime.hostId}:${runtime.runtimeId}`;
        const current = this.hostRuntimes.get(key);
        const now = new Date().toISOString();
        const row = {
            host_id: runtime.hostId,
            runtime_id: runtime.runtimeId,
            runtime_kind: runtime.runtimeKind,
            models: clone(runtime.models || []),
            default_model: runtime.defaultModel || '',
            lead_eligible: Boolean(runtime.leadEligible),
            health: runtime.health || current?.health || 'unknown',
            last_heartbeat: current?.last_heartbeat ?? null,
            remote_url: runtime.remoteUrl ?? null,
            model_tiers: clone(runtime.modelTiers ?? current?.model_tiers ?? {}),
            created_at: current?.created_at ?? now,
            updated_at: now,
        };
        this.hostRuntimes.set(key, row);
        return clone(row);
    }

    async heartbeatHostRuntime(hostId: string, runtimeId: string, patch: { health?: string; models?: string[]; defaultModel?: string; modelTiers?: any }): Promise<any> {
        const key = `${hostId}:${runtimeId}`;
        const current = this.hostRuntimes.get(key);
        if (!current) return null;
        const now = new Date().toISOString();
        const row = {
            ...current,
            health: patch.health || current.health,
            models: patch.models ? clone(patch.models) : current.models,
            default_model: patch.defaultModel !== undefined ? patch.defaultModel : current.default_model,
            model_tiers: patch.modelTiers !== undefined ? clone(patch.modelTiers) : current.model_tiers,
            last_heartbeat: now,
            updated_at: now,
        };
        this.hostRuntimes.set(key, row);
        return clone(row);
    }

    async createHostToken(token: any): Promise<any> {
        const now = new Date().toISOString();
        const row = {
            token_id: token.tokenId,
            host_id: token.hostId,
            runtime_id: token.runtimeId,
            consumer_id: token.consumerId,
            role: 'host',
            token_hash: token.tokenHash,
            created_at: token.createdAt ?? now,
            last_used_at: null,
            revoked_at: null,
        };
        this.hostTokens.set(row.token_id, row);
        return clone(row);
    }

    async getHostTokenByHash(tokenHash: string): Promise<any> {
        const row = [...this.hostTokens.values()].find((token) => token.token_hash === tokenHash);
        return row ? clone(row) : null;
    }

    async touchHostToken(tokenId: string): Promise<any> {
        const row = this.hostTokens.get(tokenId);
        if (!row) return null;
        row.last_used_at = new Date().toISOString();
        return clone(row);
    }

    async revokeHostToken(hostId: string, runtimeId: string, tokenId: string): Promise<any> {
        const row = this.hostTokens.get(tokenId);
        if (!row || row.host_id !== hostId || row.runtime_id !== runtimeId || row.revoked_at) return null;
        row.revoked_at = new Date().toISOString();
        return clone(row);
    }

    async insertObservation(consumerId: string, observation: any): Promise<{ observation: any; created: boolean }> {
        const rows = this.observations.get(consumerId) ?? [];
        const existing = rows.find((row) => row.idempotency_key === observation.idempotencyKey);
        if (existing) return { observation: clone(existing), created: false };
        const row = {
            observation_id: observation.observationId,
            trace_id: observation.traceId,
            host_id: observation.hostId,
            runtime_key: observation.runtimeKey,
            worker_id: observation.workerId ?? null,
            event: observation.event,
            outcome: observation.outcome ?? null,
            evidence: clone(observation.evidence ?? {}),
            at: observation.at ?? null,
            idempotency_key: observation.idempotencyKey,
            received_at: new Date().toISOString(),
        };
        rows.push(row);
        this.observations.set(consumerId, rows);
        return { observation: clone(row), created: true };
    }

    async listObservations(consumerId: string, limit = 100): Promise<any[]> {
        const cap = Math.max(1, Math.min(Number(limit) || 100, 500));
        return (this.observations.get(consumerId) ?? [])
            .slice()
            .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
            .slice(0, cap)
            .map((row) => clone(row));
    }

    async pruneObservations(consumerId: string, before: string): Promise<number> {
        const rows = this.observations.get(consumerId) ?? [];
        const kept = rows.filter((row) => String(row.received_at) >= String(before));
        this.observations.set(consumerId, kept);
        return rows.length - kept.length;
    }

    async appendEvidence(consumerId: string, records: ReadonlyArray<EvidenceWrite>): Promise<EvidenceAppended[]> {
        const rows = this.evidence.get(consumerId) ?? [];
        const appended = records.map((record) => {
            const existing = rows.find((row) => row.origin === record.origin && row.evidence_id === record.evidenceId);
            if (existing) return { record: clone(existing), created: false };
            const row = {
                seq: ++this.evidenceSeq,
                evidence_id: record.evidenceId,
                origin: record.origin,
                schema: record.schema ?? null,
                kind: record.kind,
                occurred_at: record.occurredAt ?? null,
                received_at: record.receivedAt ?? new Date().toISOString(),
                content_hash: record.contentHash ?? null,
                source_hash: record.sourceHash ?? null,
                payload: clone(record.payload ?? {}),
                provenance: clone(record.provenance ?? {}),
                redaction: clone(record.redaction ?? {}),
            };
            rows.push(row);
            return { record: clone(row), created: true };
        });
        this.evidence.set(consumerId, rows);
        return appended;
    }

    async listEvidence(consumerId: string, options: { origin?: EvidenceOrigin } = {}): Promise<EvidenceRow[]> {
        return (this.evidence.get(consumerId) ?? [])
            .filter((row) => !options.origin || row.origin === options.origin)
            .slice()
            .sort((a, b) => Number(a.seq) - Number(b.seq))
            .map((row) => clone(row));
    }

    async getEvidence(consumerId: string, evidenceId: string, options: { origin?: EvidenceOrigin } = {}): Promise<EvidenceRow | null> {
        const row = (this.evidence.get(consumerId) ?? []).find(
            (entry) => entry.evidence_id === evidenceId && (!options.origin || entry.origin === options.origin)
        );
        return row ? clone(row) : null;
    }

    async listWorkerHostPolicies(consumerId: string): Promise<any[]> {
        return [...this.workerHostPolicies.values()]
            .filter((row) => row.consumer_id === consumerId)
            .sort((a, b) => String(a.worker_id).localeCompare(String(b.worker_id)))
            .map((row) => clone(row));
    }

    async getWorkerHostPolicy(consumerId: string, workerId: string): Promise<any> {
        const row = this.workerHostPolicies.get(`${consumerId}:${workerId}`);
        return row ? clone(row) : null;
    }

    async upsertWorkerHostPolicy(consumerId: string, workerId: string, config: any): Promise<any> {
        const row = {
            consumer_id: consumerId,
            worker_id: workerId,
            allowed_hosts: clone(config.allowedHosts || []),
            model_tier: config.modelTier || 'balanced',
            model: config.model || '',
            models: clone(config.models || {}),
            modes: Array.isArray(config.modes) ? [...config.modes] : ['A', 'B'],
            native_agent: clone(config.nativeAgent || {}),
            fallback: config.fallback || 'block',
            updated_at: new Date().toISOString(),
        };
        this.workerHostPolicies.set(`${consumerId}:${workerId}`, row);
        return clone(row);
    }

    async replaceWorkerIndex(
        _consumerId: string,
        _workers: Array<{
            workerId: string;
            name: string;
            role: string;
            layer: 'peer' | 'gate';
            scope: string;
            status: 'declared' | 'active' | 'paused' | 'retired';
            filePath: string;
            contentHash: string;
            hostBindingIds: string[];
            capabilities: string[];
            verbs: string[];
            bar: any[];
            escalation: string;
        }>,
        _edges: Array<{ from: string; to: string; on: string }>
    ): Promise<void> {
        // Files are canonical for workers; the memory store has no index surface.
    }

    async replaceFlowIndex(_consumerId: string, _flows: any[]): Promise<void> {
        // Files are canonical for flows; the memory store has no index surface.
    }

    async knowledgeFlows(_consumerId: string): Promise<any[]> {
        return [];
    }

    async recordEdgeClaim(_consumerId: string, _claim: any): Promise<void> {}

    async knowledgeEdgeClaims(_consumerId: string, _edgeId?: string): Promise<any[]> {
        return [];
    }

    async knowledgeExternalRefs(_consumerId: string, _docId?: string): Promise<any[]> {
        return [];
    }

    async listConsumerPlugins(_consumerId: string): Promise<any[]> {
        return [];
    }

    async upsertConsumerPlugin(_consumerId: string, _pluginId: string, patch: any): Promise<any> {
        return patch;
    }

    async listPluginManifests(): Promise<any[]> { return []; }
    async upsertPluginManifest(manifest: any): Promise<any> { return manifest; }
    async deletePluginManifest(_id: string): Promise<void> {}
    async replaceProviderRecords(_consumerId: string, _providerId: string, _records: any[]): Promise<void> {}
    async listProviderRecords(_consumerId: string, _providerId?: string): Promise<any[]> { return []; }

    async replaceKnowledgeIndex(_consumerId: string, _payload: any): Promise<void> {
        // Files are canonical; the memory store has no knowledge index surface.
    }

    async knowledgeSummary(_consumerId: string): Promise<any> {
        return { docs: 0, sections: 0, edges: 0, findings: 0, links: 0, manifest: null, run: null };
    }

    async knowledgeDocs(_consumerId: string, _query?: string, _limit?: number): Promise<any[]> {
        return [];
    }

    async knowledgeFindings(_consumerId: string, _limit?: number): Promise<any[]> {
        return [];
    }

    async knowledgeDoc(_consumerId: string, _docId: string): Promise<any> {
        return { doc: null, sections: [], outgoing: [], incoming: [], descendants: [], links: [] };
    }

    async knowledgeCoverage(_consumerId: string): Promise<any[]> {
        return [];
    }

    async knowledgeFtsSearch(_consumerId: string, _query: string, _limit?: number): Promise<any[]> {
        return [];
    }

    async knowledgeGraphCandidates(_consumerId: string, _docIds: string[], _limit?: number): Promise<any[]> {
        return [];
    }

    async knowledgeChunks(_consumerId: string, _pendingOnly?: boolean, _limit?: number): Promise<any[]> {
        return [];
    }

    async updateChunkEmbeddings(_consumerId: string, _items: Array<{ chunkId: string; vector: number[] }>): Promise<void> {}

    async knowledgeVectorCount(_consumerId: string): Promise<number> {
        return 0;
    }

    async knowledgeVectorSearch(_consumerId: string, _vector: number[], _limit?: number): Promise<any[]> {
        return [];
    }

    async knowledgeWorker(_consumerId: string, _workerId: string): Promise<any> {
        return null;
    }

    async knowledgeWorkerEdge(_consumerId: string, _fromWorkerId: string, _toWorkerId: string): Promise<any> {
        return null;
    }

    async recordWorkerEvent(_consumerId: string, _event: any): Promise<void> {}

    async listWorkerEvents(_consumerId: string, _workerId?: string, _limit?: number): Promise<any[]> {
        return [];
    }

    async createWorkerHandoff(_consumerId: string, _handoff: any): Promise<void> {}

    async acceptWorkerHandoff(_consumerId: string, _handoffId: string, _workerId: string): Promise<any> {
        return null;
    }

    async listWorkerHandoffs(_consumerId: string, _workerId?: string, _limit?: number): Promise<any[]> {
        return [];
    }

    async recordWorkerImport(_consumerId: string, _record: any): Promise<void> {}

    async listWorkerImports(_consumerId: string, _limit?: number): Promise<any[]> {
        return [];
    }

    async withSearchPath<T>(consumerId: string, fn: (tx: PlatformStore) => Promise<T>): Promise<T> {
        const schema = this.schemaName(consumerId);
        return this.transaction(async (tx) => {
            (tx as MemoryPlatformStore).searchPath = schema;
            try {
                return await fn(tx);
            } finally {
                (tx as MemoryPlatformStore).searchPath = null;
            }
        });
    }

    getSearchPath(): string | null {
        return this.searchPath;
    }

    private schemaName(consumerId: string): string {
        try {
            return schemaNameFor(consumerId);
        } catch {
            fail('INVALID_CONSUMER_ID');
        }
    }
}

/**
 * PostgreSQL adapter over Bun.SQL.
 *
 * Deliberately no `pg` dependency: Bun ships the SQL client, and the control plane runs on Bun in
 * Initialization. Identifiers are generated by `schemaNameFor` and quoted; values are parameterised.
 */
function pgTextArray(values: string[]): string {
    return `{${(values || []).map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

/** Normalize a Postgres text[] value (JS array or `{a,b}` literal) to string[]. */
function normalizeTextArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item));
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('{')) {
            return trimmed.replace(/^\{|\}$/g, '').split(',').map((item) => item.replace(/^"|"$/g, '').trim()).filter(Boolean);
        }
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
        } catch {
            return [];
        }
    }
    return [];
}

/** Normalize a stored modelTiers jsonb value to a plain object (no validation; lenient for reads). */
function normalizeModelTiersValue(value: unknown): Record<string, any> {
    let raw: any = value;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            return {};
        }
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

/** Normalize a jsonb array value that Bun may return as an array or JSON text. */
function normalizeJsonArray(value: unknown): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function normalizeRuntimeKind(value: unknown): string {
    const text = String(value ?? '');
    return (HOST_RUNTIME_KINDS as readonly string[]).includes(text) ? text : 'cli';
}

function normalizeHealth(value: unknown): string {
    const text = String(value ?? '');
    return (HOST_RUNTIME_HEALTH as readonly string[]).includes(text) ? text : 'unknown';
}

/** Infer a machine host type from a legacy host/runtime id (host id wins, then runtime family). */
function inferHostType(hostId: string, runtimeId: string): string {
    const known = HOST_TYPES as readonly string[];
    if (known.includes(hostId)) return hostId;
    const runtime = String(runtimeId || '').trim();
    if (known.includes(runtime)) return runtime;
    const family = runtime.replace(/[-_](agent|cli|native)$/i, '');
    if (known.includes(family)) return family;
    return hostId;
}

export class BunSqlPlatformStore implements PlatformStore {
    readonly kind = 'postgres' as const;
    private readonly sql: any;
    private currentSearchPath: string | null = null;

    constructor(sql: any) {
        this.sql = sql;
    }

    async ensurePlatformSchema(): Promise<void> {
        // Reshape the host registry (platform.host + composite platform.host_runtime) before the DDL
        // runs; CREATE TABLE IF NOT EXISTS would otherwise keep a legacy shape. Fresh DB is a no-op.
        await this.migrateHostRegistry();
        for (const statement of PLATFORM_DDL) {
            await this.sql.unsafe(statement);
        }
        await this.normalizeJsonbEncoding('platform');
    }

    /**
     * Early P0/P1 writes passed JSON.stringify(x) into `$n::jsonb`, which stores a JSON *string*
     * instead of an object/array. Rewrite those values in place, idempotently.
     */
    private async normalizeJsonbEncoding(schema: string): Promise<void> {
        const columns = await this.sql.unsafe(
            `SELECT table_name, column_name FROM information_schema.columns
             WHERE table_schema=$1 AND data_type='jsonb'`,
            [schema]
        );
        for (const column of columns) {
            const table = `"${schema}"."${String(column.table_name).replace(/"/g, '""')}"`;
            const name = `"${String(column.column_name).replace(/"/g, '""')}"`;
            await this.sql.unsafe(
                `UPDATE ${table} SET ${name} = (${name} #>> '{}')::jsonb
                 WHERE jsonb_typeof(${name}) = 'string'
                   AND (${name} #>> '{}') ~ '^[\[{]'
                   AND pg_input_is_valid(${name} #>> '{}', 'jsonb')`
            );
        }
    }

    private async migrateHostRegistry(): Promise<void> {
        const currentExists = await this.relationExists(HOST_RUNTIME_TABLE);
        const legacyExists = await this.relationExists(HOST_RUNTIME_LEGACY_TABLE);
        if (!currentExists && !legacyExists) return;
        const alreadyComposite = currentExists ? await this.hostRuntimeIsComposite() : false;
        if (alreadyComposite && !legacyExists) return;

        await this.sql.begin(async (tx: any) => {
            if (currentExists && !alreadyComposite) {
                // A leftover staging table can only come from a manual/partial run; the live table wins.
                await tx.unsafe(`DROP TABLE IF EXISTS ${HOST_RUNTIME_LEGACY_TABLE}`);
                await tx.unsafe(`ALTER TABLE ${HOST_RUNTIME_TABLE} RENAME TO host_runtime_legacy`);
            }
            await tx.unsafe(HOST_DDL);
            await tx.unsafe(HOST_RUNTIME_DDL);
            const legacyColumns = await this.columnsOf(tx, 'host_runtime_legacy');
            if (legacyColumns.size > 0) {
                const select = [
                    'host_id',
                    'runtime_id',
                    legacyColumns.has('runtime_kind') ? 'runtime_kind' : `'cli' AS runtime_kind`,
                    legacyColumns.has('models') ? 'models' : `'[]'::jsonb AS models`,
                    legacyColumns.has('default_model') ? 'default_model' : `'' AS default_model`,
                    legacyColumns.has('lead_eligible') ? 'lead_eligible' : 'false AS lead_eligible',
                    legacyColumns.has('health') ? 'health' : `'unknown' AS health`,
                    legacyColumns.has('last_heartbeat') ? 'last_heartbeat' : 'NULL::timestamptz AS last_heartbeat',
                    legacyColumns.has('remote_url') ? 'remote_url' : 'NULL::text AS remote_url',
                    legacyColumns.has('model_tiers') ? 'model_tiers' : `'{}'::jsonb AS model_tiers`,
                    legacyColumns.has('created_at') ? 'created_at' : 'now() AS created_at',
                    legacyColumns.has('updated_at') ? 'updated_at' : 'now() AS updated_at',
                ].join(',');
                const rows = await tx.unsafe(
                    `SELECT ${select} FROM ${HOST_RUNTIME_LEGACY_TABLE} ORDER BY updated_at DESC NULLS LAST`
                );
                const hosts = new Map<string, any>();
                const runtimes = new Map<string, any>();
                for (const row of rows) {
                    const hostId = String(row.host_id || '').trim();
                    const runtimeId = String(row.runtime_id || '').trim();
                    if (!hostId || !runtimeId) continue;
                    if (!hosts.has(hostId)) {
                        hosts.set(hostId, {
                            hostId,
                            hostType: inferHostType(hostId, runtimeId),
                            label: hostId,
                            createdAt: row.created_at ?? new Date(),
                            updatedAt: row.updated_at ?? new Date(),
                        });
                    }
                    const key = `${hostId}:${runtimeId}`;
                    if (runtimes.has(key)) continue; // newest row per (host, runtime) wins
                    runtimes.set(key, {
                        hostId,
                        runtimeId,
                        runtimeKind: normalizeRuntimeKind(row.runtime_kind),
                        models: normalizeJsonArray(row.models),
                        defaultModel: String(row.default_model ?? ''),
                        leadEligible: Boolean(row.lead_eligible),
                        health: normalizeHealth(row.health),
                        lastHeartbeat: row.last_heartbeat ?? null,
                        remoteUrl: row.remote_url ?? null,
                        modelTiers: normalizeModelTiersValue(row.model_tiers),
                        createdAt: row.created_at ?? new Date(),
                        updatedAt: row.updated_at ?? new Date(),
                    });
                }
                for (const host of hosts.values()) {
                    await tx.unsafe(
                        `INSERT INTO platform.host (host_id,host_type,label,created_at,updated_at)
                         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (host_id) DO NOTHING`,
                        [host.hostId, host.hostType, host.label, host.createdAt, host.updatedAt]
                    );
                }
                for (const runtime of runtimes.values()) {
                    await tx.unsafe(
                        `INSERT INTO platform.host_runtime
                         (host_id,runtime_id,runtime_kind,models,default_model,lead_eligible,health,last_heartbeat,remote_url,model_tiers,created_at,updated_at)
                         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
                         ON CONFLICT (host_id,runtime_id) DO NOTHING`,
                        [runtime.hostId, runtime.runtimeId, runtime.runtimeKind, runtime.models,
                         runtime.defaultModel, runtime.leadEligible, runtime.health, runtime.lastHeartbeat,
                         runtime.remoteUrl, runtime.modelTiers ?? {}, runtime.createdAt, runtime.updatedAt]
                    );
                }
            }
            await tx.unsafe(`DROP TABLE ${HOST_RUNTIME_LEGACY_TABLE}`);
        });
    }

    private async relationExists(name: string): Promise<boolean> {
        const rows = await this.sql.unsafe(`SELECT to_regclass($1) AS oid`, [name]);
        return Boolean(rows[0]?.oid);
    }

    private async columnsOf(tx: any, tableName: string): Promise<Set<string>> {
        const rows = await tx.unsafe(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'platform' AND table_name = $1`,
            [tableName]
        );
        return new Set(rows.map((row: any) => String(row.column_name)));
    }

    private async hostRuntimeIsComposite(): Promise<boolean> {
        const rows = await this.sql.unsafe(
            `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
             WHERE conrelid = $1::regclass AND contype = 'p'`,
            [HOST_RUNTIME_TABLE]
        );
        if (!rows.length) return false;
        const definition = String(rows[0].def || '');
        return definition.includes('host_id') && definition.includes('runtime_id');
    }

    /** Migrate legacy bare hostIds in worker placement to the first runtimeKey of that host. */
    private async migrateWorkerHostPolicyRuntimeKeys(consumerId: string): Promise<void> {
        const schemaName = schemaNameFor(consumerId);
        const relation = await this.sql.unsafe(`SELECT to_regclass($1) AS oid`, [`${schemaName}.knowledge_worker_host_policy`]);
        if (!relation[0]?.oid) return;
        const runtimes = await this.sql.unsafe(
            `SELECT host_id, runtime_id FROM platform.host_runtime ORDER BY host_id, runtime_id`
        );
        const firstKey = new Map<string, string>();
        for (const row of runtimes) {
            const hostId = String(row.host_id);
            if (!firstKey.has(hostId)) firstKey.set(hostId, `${hostId}:${row.runtime_id}`);
        }
        const rows = await this.sql.unsafe(
            `SELECT worker_id, allowed_hosts, native_agent FROM ${quoteSchema(schemaName)}.knowledge_worker_host_policy`
        );
        const keyFor = (hostId: string) => (hostId.includes(':') ? hostId : (firstKey.get(hostId) ?? hostId));
        for (const row of rows) {
            const current = normalizeTextArray(row.allowed_hosts);
            const next = current.map(keyFor);
            let native: Record<string, any> = {};
            try {
                native = typeof row.native_agent === 'string' ? JSON.parse(row.native_agent) : (row.native_agent ?? {});
            } catch {
                native = {};
            }
            const nextNative: Record<string, any> = {};
            for (const [key, value] of Object.entries(native)) nextNative[keyFor(key)] = value;
            if (JSON.stringify(next) === JSON.stringify(current) && JSON.stringify(nextNative) === JSON.stringify(native)) continue;
            await this.sql.unsafe(
                `UPDATE ${quoteSchema(schemaName)}.knowledge_worker_host_policy
                 SET allowed_hosts = $2::text[], native_agent = $3::jsonb, updated_at = now() WHERE worker_id = $1`,
                [row.worker_id, pgTextArray(next), nextNative]
            );
        }
    }

    async tableExists(table: 'platform.consumer' | 'platform.consumer_event'): Promise<boolean> {
        const rows = await this.sql.unsafe(
            `SELECT 1 FROM information_schema.tables WHERE table_schema = 'platform' AND table_name = $1`,
            [table.split('.')[1]]
        );
        return rows.length > 0;
    }

    async transaction<T>(fn: (tx: PlatformStore) => Promise<T>): Promise<T> {
        return this.sql.begin(async (tx: any) => {
            const scoped = new BunSqlPlatformStore(tx);
            return fn(scoped);
        });
    }

    async createSchema(consumerId: string): Promise<string> {
        const schema = schemaNameFor(consumerId);
        await this.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quoteSchema(schema)}`);
        await this.ensureKnowledgeSchema(consumerId);
        return schema;
    }

    async ensureKnowledgeSchema(consumerId: string): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const file = fileURLToPath(new URL('../../../sql/knowledge.bootstrap.sql', import.meta.url));
        const source = readFileSync(file, 'utf8');
        const statements = source.split(/;\s*(?:\r?\n|$)/).map((item) => item.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim()).filter(Boolean);
        const extensions = statements.filter((statement) => /^CREATE EXTENSION/i.test(statement));
        const ddl = statements.filter((statement) => !/^CREATE EXTENSION/i.test(statement));
        for (const statement of extensions) await this.sql.unsafe(statement);
        await this.sql.unsafe(`SET search_path TO ${schema}, public`);
        try {
            for (const statement of ddl) await this.sql.unsafe(statement);
            await this.sql.unsafe(`ALTER TABLE knowledge_worker_event ADD COLUMN IF NOT EXISTS trace_id text, ADD COLUMN IF NOT EXISTS span_id text, ADD COLUMN IF NOT EXISTS parent_span_id text, ADD COLUMN IF NOT EXISTS host_binding_id text, ADD COLUMN IF NOT EXISTS flow_edge_id text, ADD COLUMN IF NOT EXISTS duration_ms integer`);
        } finally {
            await this.sql.unsafe('SET search_path TO public');
        }
        // Placement policy stores runtimeKeys now; rewrite legacy bare hostIds idempotently.
        await this.migrateWorkerHostPolicyRuntimeKeys(consumerId);
        await this.normalizeJsonbEncoding(schemaNameFor(consumerId));
    }

    async dropSchema(consumerId: string): Promise<void> {
        const schema = schemaNameFor(consumerId);
        await this.sql.unsafe(`DROP SCHEMA IF EXISTS ${quoteSchema(schema)} CASCADE`);
    }

    async schemaExists(consumerId: string): Promise<boolean> {
        const schema = schemaNameFor(consumerId);
        const rows = await this.sql.unsafe(
            `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
            [schema]
        );
        return rows.length > 0;
    }

    async insertConsumer(record: ConsumerRecord): Promise<void> {
        await this.sql.unsafe(
            `INSERT INTO platform.consumer
             (id, name, root, sdlc_root, schema_name, status, version, storage_mode, materialized_hash, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'schema',$8,$9,$10)`,
            [
                record.id,
                record.name,
                record.root,
                record.sdlcRoot,
                record.schemaName,
                record.status,
                record.version,
                record.materializedHash,
                record.createdAt,
                record.updatedAt,
            ]
        );
    }

    async getConsumer(id: string): Promise<ConsumerRecord | null> {
        const rows = await this.sql.unsafe(`SELECT * FROM platform.consumer WHERE id = $1`, [id]);
        return rows.length ? mapConsumer(rows[0]) : null;
    }

    async removeConsumer(id: string): Promise<void> {
        await this.sql.begin(async (tx: any) => {
            await tx.unsafe(`DELETE FROM platform.consumer_event WHERE consumer_id = $1`, [id]);
            await tx.unsafe(`DELETE FROM platform.consumer WHERE id = $1`, [id]);
        });
    }

    async listConsumers(options: ListConsumersOptions = {}): Promise<ConsumerRecord[]> {
        const { limit, offset } = normalizeListWindow(options);
        const where: string[] = [];
        const params: unknown[] = [];
        if (options.status) {
            params.push(options.status);
            where.push(`status = $${params.length}`);
        }
        if (!options.includeDeleted) {
            where.push(`status <> 'deleted'`, `status <> 'purged'`);
        }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        params.push(limit);
        const limitParam = `$${params.length}`;
        params.push(offset);
        const offsetParam = `$${params.length}`;
        const rows = await this.sql.unsafe(
            `SELECT * FROM platform.consumer ${clause} ORDER BY updated_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
            params
        );
        return rows.map(mapConsumer);
    }

    async updateConsumer(
        id: string,
        patch: Partial<Pick<ConsumerRecord, 'name' | 'root' | 'sdlcRoot' | 'status' | 'version' | 'materializedHash' | 'updatedAt'>>
    ): Promise<ConsumerRecord> {
        const columns: string[] = [];
        const params: unknown[] = [];
        const mapping: Record<string, string> = {
            name: 'name',
            root: 'root',
            sdlcRoot: 'sdlc_root',
            status: 'status',
            version: 'version',
            materializedHash: 'materialized_hash',
            updatedAt: 'updated_at',
        };
        for (const [key, value] of Object.entries(patch)) {
            if (!(key in mapping) || value === undefined) continue;
            params.push(value);
            columns.push(`${mapping[key]} = $${params.length}`);
        }
        if (!columns.length) {
            const current = await this.getConsumer(id);
            if (!current) fail('CONSUMER_NOT_FOUND');
            return current;
        }
        params.push(id);
        const rows = await this.sql.unsafe(
            `UPDATE platform.consumer SET ${columns.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (!rows.length) fail('CONSUMER_NOT_FOUND');
        return mapConsumer(rows[0]);
    }

    async setStatus(id: string, status: ConsumerStatus, updatedAt: string): Promise<void> {
        await this.updateConsumer(id, { status, updatedAt });
    }

    async setMaterializedHash(id: string, hash: string | null): Promise<void> {
        await this.updateConsumer(id, { materializedHash: hash });
    }

    async appendEvent(event: ConsumerEvent): Promise<ConsumerEvent> {
        const rows = await this.sql.unsafe(
            `INSERT INTO platform.consumer_event
             (consumer_id, event_type, actor_kind, actor_label, at, detail)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
            [
                event.consumerId,
                event.eventType,
                event.actorKind,
                event.actorLabel,
                event.at,
                event.detail || {},
            ]
        );
        return mapEvent(rows[0]);
    }

    async listEvents(consumerId: string, limit = 100): Promise<ConsumerEvent[]> {
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
        const rows = await this.sql.unsafe(
            `SELECT * FROM platform.consumer_event WHERE consumer_id = $1 ORDER BY at DESC, id DESC LIMIT ${safeLimit}`,
            [consumerId]
        );
        return rows.map(mapEvent);
    }

    async listStackVersions(consumerId: string): Promise<StackVersionRecord[]> {
        const rows = await this.sql.unsafe(
            `SELECT * FROM platform.harness_stack_version WHERE consumer_id = $1 ORDER BY version DESC`,
            [consumerId]
        );
        return rows.map(mapStackVersion);
    }

    async replaceStackVersions(
        consumerId: string,
        versions: StackVersionRecord[],
        expected?: { consumerVersion: number; versionsHash: string }
    ): Promise<boolean> {
        return this.sql.begin(async (tx: any) => {
            // Lock the consumer row so two tabs cannot both pass the version/hash check.
            const consumerRows = await tx.unsafe(
                `SELECT version FROM platform.consumer WHERE id = $1 FOR UPDATE`,
                [consumerId]
            );
            const consumer = consumerRows[0];
            const currentRows = await tx.unsafe(
                `SELECT * FROM platform.harness_stack_version WHERE consumer_id = $1 ORDER BY version ASC`,
                [consumerId]
            );
            if (expected) {
                if (!consumer || Number(consumer.version) !== expected.consumerVersion) return false;
                if (stackVersionsHash(currentRows.map(mapStackVersion)) !== expected.versionsHash) return false;
            }
            await tx.unsafe(`DELETE FROM platform.harness_stack_version WHERE consumer_id = $1`, [consumerId]);
            for (const version of versions) {
                await tx.unsafe(
                    `INSERT INTO platform.harness_stack_version
                     (consumer_id, version, status, layers, published_at, created_at)
                     VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
                    [consumerId, version.version, version.status, version.layers || [], version.publishedAt, version.createdAt]
                );
            }
            if (expected && consumer) {
                await tx.unsafe(
                    `UPDATE platform.consumer SET version = version + 1, updated_at = now() WHERE id = $1`,
                    [consumerId]
                );
            }
            return true;
        });
    }

    async listHosts(): Promise<any[]> {
        return await this.sql.unsafe(
            `SELECT host_id,host_type,label,created_at,updated_at FROM platform.host ORDER BY host_id`
        );
    }

    async getHost(hostId: string): Promise<any> {
        const rows = await this.sql.unsafe(
            `SELECT host_id,host_type,label,created_at,updated_at FROM platform.host WHERE host_id=$1`,
            [hostId]
        );
        return rows[0] || null;
    }

    async upsertHost(host: any): Promise<any> {
        const rows = await this.sql.unsafe(
            `INSERT INTO platform.host (host_id,host_type,label,created_at,updated_at)
             VALUES ($1,$2,$3,now(),now())
             ON CONFLICT (host_id) DO UPDATE SET
               host_type=EXCLUDED.host_type,
               label=EXCLUDED.label,
               updated_at=now()
             RETURNING host_id,host_type,label,created_at,updated_at`,
            [host.hostId, host.hostType, host.label ?? host.hostId]
        );
        return rows[0] || null;
    }

    async listHostRuntimes(): Promise<any[]> {
        return await this.sql.unsafe(
            `SELECT host_id,runtime_id,runtime_kind,models,default_model,lead_eligible,health,last_heartbeat,remote_url,model_tiers,created_at,updated_at
             FROM platform.host_runtime ORDER BY host_id, runtime_id`
        );
    }

    async getHostRuntime(hostId: string, runtimeId: string): Promise<any> {
        const rows = await this.sql.unsafe(
            `SELECT host_id,runtime_id,runtime_kind,models,default_model,lead_eligible,health,last_heartbeat,remote_url,model_tiers,created_at,updated_at
             FROM platform.host_runtime WHERE host_id=$1 AND runtime_id=$2`,
            [hostId, runtimeId]
        );
        return rows[0] || null;
    }

    async upsertHostRuntime(runtime: any): Promise<any> {
        const rows = await this.sql.unsafe(
            `INSERT INTO platform.host_runtime
             (host_id,runtime_id,runtime_kind,models,default_model,lead_eligible,health,last_heartbeat,remote_url,model_tiers,updated_at)
             VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,NULL,$9,$10::jsonb,now())
             ON CONFLICT (host_id,runtime_id) DO UPDATE SET
               runtime_kind=EXCLUDED.runtime_kind,
               models=EXCLUDED.models, default_model=EXCLUDED.default_model,
               lead_eligible=EXCLUDED.lead_eligible,
               health=CASE WHEN $8 THEN EXCLUDED.health ELSE platform.host_runtime.health END,
               remote_url=EXCLUDED.remote_url,
               model_tiers=EXCLUDED.model_tiers,
               updated_at=now()
             RETURNING host_id,runtime_id,runtime_kind,models,default_model,lead_eligible,health,last_heartbeat,remote_url,model_tiers,created_at,updated_at`,
            [runtime.hostId, runtime.runtimeId, runtime.runtimeKind, runtime.models || [],
             runtime.defaultModel || '', Boolean(runtime.leadEligible), runtime.health || 'unknown',
             Boolean(runtime.healthExplicit), runtime.remoteUrl ?? null, runtime.modelTiers ?? {}]
        );
        return rows[0] || null;
    }

    async heartbeatHostRuntime(hostId: string, runtimeId: string, patch: { health?: string; models?: string[]; defaultModel?: string; modelTiers?: any }): Promise<any> {
        const rows = await this.sql.unsafe(
            `UPDATE platform.host_runtime
             SET health=COALESCE($3,health),
                 models=COALESCE($4::jsonb,models),
                 default_model=COALESCE($5,default_model),
                 model_tiers=COALESCE($6::jsonb,model_tiers),
                 last_heartbeat=now(), updated_at=now()
             WHERE host_id=$1 AND runtime_id=$2
             RETURNING host_id,runtime_id,runtime_kind,models,default_model,lead_eligible,health,last_heartbeat,remote_url,model_tiers,created_at,updated_at`,
            [hostId, runtimeId, patch.health || null, patch.models ?? null,
             patch.defaultModel !== undefined ? patch.defaultModel : null,
             patch.modelTiers ?? null]
        );
        return rows[0] || null;
    }

    async createHostToken(token: any): Promise<any> {
        const rows = await this.sql.unsafe(
            `INSERT INTO platform.host_token
             (token_id,host_id,runtime_id,consumer_id,role,token_hash,created_at)
             VALUES ($1,$2,$3,$4,'host',$5,COALESCE($6::timestamptz, now()))
             RETURNING token_id,host_id,runtime_id,consumer_id,role,token_hash,created_at,last_used_at,revoked_at`,
            [token.tokenId, token.hostId, token.runtimeId, token.consumerId, token.tokenHash, token.createdAt ?? null]
        );
        return rows[0] || null;
    }

    async getHostTokenByHash(tokenHash: string): Promise<any> {
        const rows = await this.sql.unsafe(
            `SELECT token_id,host_id,runtime_id,consumer_id,role,token_hash,created_at,last_used_at,revoked_at
             FROM platform.host_token WHERE token_hash=$1`,
            [tokenHash]
        );
        return rows[0] || null;
    }

    async touchHostToken(tokenId: string): Promise<any> {
        const rows = await this.sql.unsafe(
            `UPDATE platform.host_token SET last_used_at=now() WHERE token_id=$1
             RETURNING token_id,last_used_at`,
            [tokenId]
        );
        return rows[0] || null;
    }

    async revokeHostToken(hostId: string, runtimeId: string, tokenId: string): Promise<any> {
        const rows = await this.sql.unsafe(
            `UPDATE platform.host_token SET revoked_at=now()
             WHERE token_id=$1 AND host_id=$2 AND runtime_id=$3 AND revoked_at IS NULL
             RETURNING token_id,host_id,runtime_id,consumer_id,revoked_at`,
            [tokenId, hostId, runtimeId]
        );
        return rows[0] || null;
    }

    async insertObservation(consumerId: string, observation: any): Promise<{ observation: any; created: boolean }> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `INSERT INTO ${schema}.knowledge_observation
             (observation_id,trace_id,host_id,runtime_key,worker_id,event,outcome,evidence,at,idempotency_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,COALESCE($9::timestamptz, now()),$10)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING observation_id,trace_id,host_id,runtime_key,worker_id,event,outcome,evidence,at,idempotency_key,received_at`,
            [observation.observationId, observation.traceId, observation.hostId, observation.runtimeKey,
             observation.workerId ?? null, observation.event, observation.outcome ?? null,
             observation.evidence ?? {}, observation.at ?? null, observation.idempotencyKey]
        );
        if (rows.length) return { observation: rows[0], created: true };
        const existing = await this.sql.unsafe(
            `SELECT observation_id,trace_id,host_id,runtime_key,worker_id,event,outcome,evidence,at,idempotency_key,received_at
             FROM ${schema}.knowledge_observation WHERE idempotency_key=$1`,
            [observation.idempotencyKey]
        );
        return { observation: existing[0] || null, created: false };
    }

    async listObservations(consumerId: string, limit = 100): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const cap = Math.max(1, Math.min(Number(limit) || 100, 500));
        return await this.sql.unsafe(
            `SELECT observation_id,trace_id,host_id,runtime_key,worker_id,event,outcome,evidence,at,idempotency_key,received_at
             FROM ${schema}.knowledge_observation ORDER BY received_at DESC, observation_id DESC LIMIT $1`,
            [cap]
        );
    }

    async pruneObservations(consumerId: string, before: string): Promise<number> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `DELETE FROM ${schema}.knowledge_observation WHERE received_at < $1::timestamptz RETURNING observation_id`,
            [before]
        );
        return rows.length;
    }

    async appendEvidence(consumerId: string, records: ReadonlyArray<EvidenceWrite>): Promise<EvidenceAppended[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const appended: EvidenceAppended[] = [];
        for (const record of records) {
            const rows = await this.sql.unsafe(
                `INSERT INTO ${schema}.knowledge_evidence
                 (evidence_id,origin,schema,kind,occurred_at,received_at,content_hash,source_hash,payload,provenance,redaction)
                 VALUES ($1,$2,$3,$4,$5::timestamptz,COALESCE($6::timestamptz, now()),$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)
                 ON CONFLICT (origin,evidence_id) DO NOTHING
                 RETURNING evidence_id,origin,schema,kind,occurred_at,received_at,content_hash,source_hash,payload,provenance,redaction`,
                [record.evidenceId, record.origin, record.schema ?? null, record.kind,
                 record.occurredAt ?? null, record.receivedAt ?? null,
                 record.contentHash ?? null, record.sourceHash ?? null,
                 record.payload ?? {}, record.provenance ?? {}, record.redaction ?? {}]
            );
            if (rows.length) {
                appended.push({ record: rows[0], created: true });
                continue;
            }
            // `DO NOTHING` swallowed a duplicate: echo the row that already exists (AC-36 keeps
            // the original `received_at`).
            const existing = await this.sql.unsafe(
                `SELECT evidence_id,origin,schema,kind,occurred_at,received_at,content_hash,source_hash,payload,provenance,redaction
                 FROM ${schema}.knowledge_evidence WHERE origin=$1 AND evidence_id=$2`,
                [record.origin, record.evidenceId]
            );
            if (!existing.length) throw new Error(`EVIDENCE_CONFLICT_MISSING:${record.origin}:${record.evidenceId}`);
            appended.push({ record: existing[0], created: false });
        }
        return appended;
    }

    async listEvidence(consumerId: string, options: { origin?: EvidenceOrigin } = {}): Promise<EvidenceRow[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const columns = 'evidence_id,origin,schema,kind,occurred_at,received_at,content_hash,source_hash,payload,provenance,redaction';
        return options.origin
            ? await this.sql.unsafe(
                `SELECT ${columns} FROM ${schema}.knowledge_evidence WHERE origin=$1 ORDER BY seq ASC`,
                [options.origin]
            )
            : await this.sql.unsafe(`SELECT ${columns} FROM ${schema}.knowledge_evidence ORDER BY seq ASC`);
    }

    async getEvidence(consumerId: string, evidenceId: string, options: { origin?: EvidenceOrigin } = {}): Promise<EvidenceRow | null> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const columns = 'evidence_id,origin,schema,kind,occurred_at,received_at,content_hash,source_hash,payload,provenance,redaction';
        const rows = options.origin
            ? await this.sql.unsafe(
                `SELECT ${columns} FROM ${schema}.knowledge_evidence WHERE origin=$1 AND evidence_id=$2`,
                [options.origin, evidenceId]
            )
            : await this.sql.unsafe(
                `SELECT ${columns} FROM ${schema}.knowledge_evidence WHERE evidence_id=$1`,
                [evidenceId]
            );
        return rows[0] || null;
    }

    async listWorkerHostPolicies(consumerId: string): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        return await this.sql.unsafe(
            `SELECT worker_id,allowed_hosts,model_tier,model,models,modes,native_agent,fallback,updated_at
             FROM ${schema}.knowledge_worker_host_policy ORDER BY worker_id`
        );
    }

    async getWorkerHostPolicy(consumerId: string, workerId: string): Promise<any> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `SELECT worker_id,allowed_hosts,model_tier,model,models,modes,native_agent,fallback,updated_at
             FROM ${schema}.knowledge_worker_host_policy WHERE worker_id=$1`,
            [workerId]
        );
        return rows[0] || null;
    }

    async upsertWorkerHostPolicy(consumerId: string, workerId: string, config: any): Promise<any> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `INSERT INTO ${schema}.knowledge_worker_host_policy
             (worker_id,allowed_hosts,model_tier,model,models,modes,native_agent,fallback,updated_at)
             VALUES ($1,$2::text[],$3,$4,$5::jsonb,$6::text[],$7::jsonb,$8,now())
             ON CONFLICT (worker_id) DO UPDATE SET
               allowed_hosts=EXCLUDED.allowed_hosts, model_tier=EXCLUDED.model_tier,
               model=EXCLUDED.model, models=EXCLUDED.models, modes=EXCLUDED.modes,
               native_agent=EXCLUDED.native_agent, fallback=EXCLUDED.fallback, updated_at=now()
             RETURNING worker_id,allowed_hosts,model_tier,model,models,modes,native_agent,fallback,updated_at`,
            [workerId, pgTextArray(config.allowedHosts || []), config.modelTier || 'balanced', config.model || '',
             config.models || {}, pgTextArray(config.modes || ['A', 'B']), config.nativeAgent || {}, config.fallback || 'block']
        );
        return rows[0] || null;
    }

    async replaceWorkerIndex(
        consumerId: string,
        workers: Array<{
            workerId: string;
            name: string;
            role: string;
            layer: 'peer' | 'gate';
            scope: string;
            status: 'declared' | 'active' | 'paused' | 'retired';
            filePath: string;
            contentHash: string;
            hostBindingIds: string[];
            capabilities: string[];
            verbs: string[];
            bar: any[];
            escalation: string;
        }>,
        edges: Array<{ from: string; to: string; on: string }>
    ): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const ids = new Set(workers.map((worker) => worker.workerId));
        await this.sql.begin(async (tx: any) => {
            await tx.unsafe(`SET LOCAL search_path = ${schema}, platform, public`);
            await tx.unsafe(`DELETE FROM knowledge_worker_edge`);
            await tx.unsafe(`DELETE FROM knowledge_worker_placement`);
            // Keep rows that still exist so the worker host policy (FK, ON DELETE CASCADE) survives a save.
            await tx.unsafe(`DELETE FROM knowledge_worker WHERE worker_id <> ALL($1::text[])`, [pgTextArray(workers.map((worker) => worker.workerId))]);
            for (const worker of workers) {
                await tx.unsafe(
                    `INSERT INTO knowledge_worker
                     (worker_id, name, role, layer, scope, status, file_path, content_hash, capabilities, verbs, bar, escalation, indexed_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11,$12,now())
                     ON CONFLICT (worker_id) DO UPDATE SET
                       name=EXCLUDED.name, role=EXCLUDED.role, layer=EXCLUDED.layer, scope=EXCLUDED.scope,
                       status=EXCLUDED.status, file_path=EXCLUDED.file_path, content_hash=EXCLUDED.content_hash,
                       capabilities=EXCLUDED.capabilities, verbs=EXCLUDED.verbs, bar=EXCLUDED.bar,
                       escalation=EXCLUDED.escalation, indexed_at=now()`,
                    [worker.workerId, worker.name, worker.role, worker.layer, worker.scope, worker.status, worker.filePath, worker.contentHash, pgTextArray(worker.capabilities), pgTextArray(worker.verbs), worker.bar, worker.escalation]
                );
                for (const hostBindingId of worker.hostBindingIds) {
                    await tx.unsafe(
                        `INSERT INTO knowledge_worker_placement (worker_id, host_binding_id) VALUES ($1,$2)`,
                        [worker.workerId, hostBindingId]
                    );
                }
            }
            for (const edge of edges) {
                if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
                await tx.unsafe(
                    `INSERT INTO knowledge_worker_edge (from_worker_id, to_worker_id, on_label) VALUES ($1,$2,$3)
                     ON CONFLICT DO NOTHING`,
                    [edge.from, edge.to, edge.on]
                );
            }
        });
    }

    async replaceFlowIndex(consumerId: string, flows: Array<{
        flowId: string; version: number; name: string; status: 'draft' | 'published';
        isDefault: boolean; definition: any; sourceHash: string; updatedAt?: string; publishedAt?: string;
    }>): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        await this.sql.begin(async (tx: any) => {
            await tx.unsafe(`SET LOCAL search_path = ${schema}, platform, public`);
            await tx.unsafe(`DELETE FROM knowledge_flow`);
            for (const flow of flows) {
                await tx.unsafe(
                    `INSERT INTO knowledge_flow
                     (flow_id,version,name,status,is_default,definition,source_hash,updated_at,published_at)
                     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
                    [flow.flowId, flow.version, flow.name, flow.status, flow.isDefault,
                     flow.definition || {}, flow.sourceHash,
                     flow.updatedAt || new Date().toISOString(), flow.publishedAt || null]
                );
            }
        });
    }

    async knowledgeFlows(consumerId: string): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        return await this.sql.unsafe(
            `SELECT flow_id,version,name,status,is_default,definition,source_hash,updated_at,published_at
             FROM ${schema}.knowledge_flow ORDER BY is_default DESC, flow_id, version DESC`
        );
    }

    async recordEdgeClaim(consumerId: string, claim: any): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        await this.sql.unsafe(
            `INSERT INTO ${schema}.knowledge_edge_claim
             (edge_id,seq,provenance,source,claim,at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
            [claim.edgeId, claim.seq || 1, claim.provenance || 'declared', claim.source || null,
             claim.claim || {}, claim.at || new Date().toISOString()]
        );
    }

    async knowledgeEdgeClaims(consumerId: string, edgeId?: string): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        return await this.sql.unsafe(
            `SELECT edge_id,seq,provenance,source,claim,at
             FROM ${schema}.knowledge_edge_claim
             WHERE ($1::text IS NULL OR edge_id=$1)
             ORDER BY edge_id,seq`,
            [edgeId || null]
        );
    }

    async knowledgeExternalRefs(consumerId: string, docId?: string): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        return await this.sql.unsafe(
            `SELECT doc_id,provider,external_id,kind,url,direction
             FROM ${schema}.knowledge_external_ref
             WHERE ($1::text IS NULL OR doc_id=$1)
             ORDER BY provider,external_id`,
            [docId || null]
        );
    }

    async listConsumerPlugins(consumerId: string): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `SELECT consumer_id,plugin_id,enabled,config,secret_refs,health,last_checked_at,updated_at
             FROM platform.consumer_plugin WHERE consumer_id=$1 ORDER BY plugin_id`,
            [consumerId]
        );
        return rows;
    }

    async upsertConsumerPlugin(consumerId: string, pluginId: string, patch: any): Promise<any> {
        const rows = await this.sql.unsafe(
            `INSERT INTO platform.consumer_plugin
             (consumer_id,plugin_id,enabled,config,secret_refs,health,last_checked_at,updated_at)
             VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,now(),now())
             ON CONFLICT (consumer_id,plugin_id) DO UPDATE SET
               enabled=EXCLUDED.enabled, config=EXCLUDED.config, secret_refs=EXCLUDED.secret_refs,
               health=EXCLUDED.health, last_checked_at=now(), updated_at=now()
             RETURNING consumer_id,plugin_id,enabled,config,secret_refs,health,last_checked_at,updated_at`,
            [consumerId, pluginId, Boolean(patch.enabled), patch.config || {}, patch.secretRefs || {}, patch.health || 'unknown']
        );
        return rows[0] || null;
    }

    async listPluginManifests(): Promise<any[]> {
        return await this.sql.unsafe(
            `SELECT id,label,type,category,version,capabilities,status,description,config_schema,source,installed_at,updated_at
             FROM platform.plugin_manifest ORDER BY type,category,label`
        );
    }

    async upsertPluginManifest(manifest: any): Promise<any> {
        const rows = await this.sql.unsafe(
            `INSERT INTO platform.plugin_manifest
             (id,label,type,category,version,capabilities,status,description,config_schema,source,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,now())
             ON CONFLICT (id) DO UPDATE SET
               label=EXCLUDED.label, type=EXCLUDED.type, category=EXCLUDED.category, version=EXCLUDED.version,
               capabilities=EXCLUDED.capabilities, status=EXCLUDED.status, description=EXCLUDED.description,
               config_schema=EXCLUDED.config_schema, source=EXCLUDED.source, updated_at=now()
             RETURNING *`,
            [manifest.id, manifest.label, manifest.type, manifest.category || 'other', manifest.version || '1.0.0',
             manifest.capabilities || [], manifest.status || 'installed', manifest.description || '',
             manifest.configSchema || {}, manifest.source || 'custom']
        );
        return rows[0] || null;
    }

    async deletePluginManifest(id: string): Promise<void> {
        await this.sql.unsafe(`DELETE FROM platform.plugin_manifest WHERE id=$1`, [id]);
    }

    async replaceProviderRecords(consumerId: string, providerId: string, records: any[]): Promise<void> {
        await this.sql.begin(async (tx: any) => {
            await tx.unsafe(`DELETE FROM platform.provider_record WHERE consumer_id=$1 AND provider_id=$2`, [consumerId, providerId]);
            for (const record of records) {
                await tx.unsafe(
                    `INSERT INTO platform.provider_record
                     (consumer_id,provider_id,external_id,kind,title,status,url,payload)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
                    [consumerId, providerId, record.externalId, record.kind, record.title, record.status || null,
                     record.url || null, record.payload || {}]
                );
            }
        });
    }

    async listProviderRecords(consumerId: string, providerId?: string): Promise<any[]> {
        return await this.sql.unsafe(
            `SELECT consumer_id,provider_id,external_id,kind,title,status,url,payload,synced_at
             FROM platform.provider_record
             WHERE consumer_id=$1 AND ($2::text IS NULL OR provider_id=$2)
             ORDER BY provider_id, kind, external_id`,
            [consumerId, providerId || null]
        );
    }

    async replaceKnowledgeIndex(consumerId: string, payload: any): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const txBody = async (tx: any) => {
            await tx.unsafe(`SET LOCAL search_path = ${schema}, platform, public`);
            await tx.unsafe(`DELETE FROM knowledge_link`);
            await tx.unsafe(`DELETE FROM knowledge_finding`);
            await tx.unsafe(`DELETE FROM knowledge_doc_search`);
            await tx.unsafe(`DELETE FROM knowledge_edge_claim`);
            await tx.unsafe(`DELETE FROM knowledge_edge`);
            await tx.unsafe(`DELETE FROM knowledge_doc_section`);
            await tx.unsafe(`DELETE FROM knowledge_doc_path`);
            await tx.unsafe(`DELETE FROM knowledge_manifest`);
            await tx.unsafe(`DROP TABLE IF EXISTS pg_temp.eso_embedding_keep`);
            await tx.unsafe(`CREATE TEMP TABLE eso_embedding_keep ON COMMIT DROP AS
                SELECT content_hash, embedding, model FROM knowledge_doc_chunk
                WHERE embedding IS NOT NULL AND content_hash IS NOT NULL`);
            await tx.unsafe(`DELETE FROM knowledge_doc_chunk`);
            await tx.unsafe(`DELETE FROM knowledge_doc`);
            await tx.unsafe(`DELETE FROM knowledge_index_build`);

            for (const type of payload.types || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_type (type, label, required_sections, header_profile, representation, default_liveness)
                     VALUES ($1,$2,'[]'::jsonb,'{}'::jsonb,$3,'living') ON CONFLICT (type) DO NOTHING`,
                    [type.type, type.label || type.type, type.representation || 'human']
                );
            }
            for (const doc of payload.docs || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_doc
                     (doc_id,path,type,status,owner,representation,origin,custodian,liveness,kt_state,
                      source_pointer,human_sot_pointer,title,content_hash,header_json,indexed_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,now())`,
                    [doc.docId, doc.path, doc.type, doc.status, doc.owner, doc.representation, doc.origin,
                     doc.custodian, doc.liveness, doc.ktState, doc.sourcePointer, doc.humanSotPointer,
                     doc.title, doc.contentHash, doc.header || {}]
                );
            }
            for (const doc of payload.docs || []) {
                await tx.unsafe(
                    `UPDATE knowledge_doc SET source_doc_id=$2, human_sot_doc_id=$3 WHERE doc_id=$1`,
                    [doc.docId, doc.sourceDocId || null, doc.humanSotDocId || null]
                );
                await tx.unsafe(
                    `INSERT INTO knowledge_doc_path (doc_id,path,valid_from,valid_to) VALUES ($1,$2,now(),NULL)`,
                    [doc.docId, doc.path]
                );
            }
            for (const section of payload.sections || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_doc_section
                     (doc_id,section_id,parent_section_id,ordinal,level,heading,anchor,content_hash)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [section.docId, section.sectionId, section.parentSectionId || null, section.ordinal,
                     section.level, section.heading, section.anchor, section.contentHash || null]
                );
            }
            for (const link of payload.links || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_link
                     (doc_id,raw_target,resolved_doc_id,resolved_anchor,resolved_section_id,status,provenance)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [link.docId, link.rawTarget, link.resolvedDocId || null, link.resolvedAnchor || null,
                     link.resolvedSectionId || null, link.status, link.provenance || 'declared']
                );
            }
            for (const edge of payload.edges || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_edge (edge_id,from_doc_id,to_doc_id,kind,conflict)
                     VALUES ($1,$2,$3,$4,false) ON CONFLICT DO NOTHING`,
                    [edge.edgeId, edge.fromDocId, edge.toDocId, edge.kind]
                );
            }
            for (const chunk of payload.chunks || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_doc_chunk (chunk_id,doc_id,ordinal,anchor,text,content_hash,embedding,model)
                     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7)`,
                    [chunk.chunkId, chunk.docId, chunk.ordinal, chunk.anchor || null, chunk.text, chunk.contentHash || null, 'BAAI/bge-m3']
                );
            }
            await tx.unsafe(`UPDATE knowledge_doc_chunk c
                SET embedding = k.embedding, model = k.model
                FROM pg_temp.eso_embedding_keep k
                WHERE c.content_hash = k.content_hash AND c.embedding IS NULL`);
            for (const search of payload.search || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_doc_search (doc_id,tsv,excerpt)
                     VALUES ($1,to_tsvector('simple',$2),$3)`,
                    [search.docId, search.text, search.excerpt]
                );
            }
            for (const finding of payload.findings || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_finding (doc_id,severity,code,detail)
                     VALUES ($1,$2,$3,$4::jsonb)`,
                    [finding.docId || null, finding.severity || 'warning', finding.code, finding.detail || {}]
                );
            }
            for (const run of payload.runs || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_index_build (build_id,source_hash,status,stats,started_at,finished_at)
                     VALUES ($1,$2,$3,$4::jsonb,now(),now())`,
                    [run.buildId, run.sourceHash, run.status, run.stats || {}]
                );
            }
            for (const manifest of payload.manifests || []) {
                await tx.unsafe(
                    `INSERT INTO knowledge_manifest
                     (manifest_id,build_id,manifest_version,generator_version,source_hash,payload)
                     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
                    [manifest.manifestId, manifest.buildId || null, manifest.manifestVersion || 1,
                     manifest.generatorVersion || 'eso-indexer@1', manifest.sourceHash, manifest.payload]
                );
            }
            await tx.unsafe(
                `UPDATE knowledge_meta SET manifest_path=$1, manifest_version=$2, generator_version=$3, updated_at=now()`,
                ['.harness/manifest.json', 1, 'eso-indexer@1']
            );
        };
        await this.sql.begin(txBody);
    }

    async knowledgeWorkerEdge(consumerId: string, fromWorkerId: string, toWorkerId: string): Promise<any> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `SELECT from_worker_id,to_worker_id,on_label FROM ${schema}.knowledge_worker_edge
             WHERE from_worker_id=$1 AND to_worker_id=$2`,
            [fromWorkerId, toWorkerId]
        );
        return rows[0] || null;
    }

    async recordWorkerEvent(consumerId: string, event: any): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        await this.sql.unsafe(
            `INSERT INTO ${schema}.knowledge_worker_event
             (worker_id,event,verb,path,decision,reasons,evidence,trace_id,span_id,parent_span_id,host_binding_id,flow_edge_id,duration_ms)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)`,
            [event.workerId, event.event, event.verb || null, event.path || null,
             event.decision, event.reasons || [], event.evidence || [],
             event.traceId || null, event.spanId || null, event.parentSpanId || null,
             event.hostBindingId || null, event.flowEdgeId || null, event.durationMs ?? null]
        );
    }

    async recordWorkerImport(consumerId: string, record: any): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        await this.sql.unsafe(
            `INSERT INTO ${schema}.knowledge_worker_import
             (source_file,source_hash,source_type,worker_id,action,detail)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
            [record.sourceFile, record.sourceHash, record.sourceType || 'unknown',
             record.workerId, record.action || 'import', record.detail || {}]
        );
    }

    async listWorkerImports(consumerId: string, limit = 50): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
        return await this.sql.unsafe(
            `SELECT import_id,source_file,source_hash,source_type,worker_id,action,detail,imported_at
             FROM ${schema}.knowledge_worker_import ORDER BY imported_at DESC LIMIT $1`,
            [cap]
        );
    }

    async createWorkerHandoff(consumerId: string, handoff: any): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        await this.sql.unsafe(
            `INSERT INTO ${schema}.knowledge_worker_handoff
             (handoff_id,from_worker_id,to_worker_id,condition,status,work,evidence)
             VALUES ($1,$2,$3,$4,'pending',$5::jsonb,$6::jsonb)`,
            [handoff.handoffId, handoff.fromWorkerId, handoff.toWorkerId, handoff.condition || null,
             handoff.work || {}, handoff.evidence || []]
        );
    }

    async acceptWorkerHandoff(consumerId: string, handoffId: string, workerId: string): Promise<any> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `UPDATE ${schema}.knowledge_worker_handoff
             SET status='accepted', accepted_at=now()
             WHERE handoff_id=$1 AND to_worker_id=$2 AND status='pending'
             RETURNING *`,
            [handoffId, workerId]
        );
        return rows[0] || null;
    }

    async listWorkerHandoffs(consumerId: string, workerId?: string, limit = 50): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
        return await this.sql.unsafe(
            `SELECT handoff_id,from_worker_id,to_worker_id,condition,status,work,evidence,created_at,accepted_at
             FROM ${schema}.knowledge_worker_handoff
             WHERE ($1::text IS NULL OR to_worker_id=$1 OR from_worker_id=$1)
             ORDER BY created_at DESC LIMIT $2`,
            [workerId || null, cap]
        );
    }

    async listWorkerEvents(consumerId: string, workerId?: string, limit = 50): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
        return await this.sql.unsafe(
            `SELECT event_id,worker_id,event,verb,path,decision,reasons,evidence,trace_id,span_id,parent_span_id,host_binding_id,flow_edge_id,duration_ms,created_at
             FROM ${schema}.knowledge_worker_event
             WHERE ($1::text IS NULL OR worker_id=$1)
             ORDER BY created_at DESC,event_id DESC LIMIT $2`,
            [workerId || null, cap]
        );
    }

    async knowledgeWorker(consumerId: string, workerId: string): Promise<any> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `SELECT worker_id,name,role,layer,scope,status,file_path,content_hash,
                    capabilities,verbs,bar,escalation,indexed_at,
                    (SELECT array_agg(host_binding_id ORDER BY host_binding_id)
                     FROM ${schema}.knowledge_worker_placement p WHERE p.worker_id=k.worker_id) AS host_binding_ids
             FROM ${schema}.knowledge_worker k WHERE worker_id=$1`,
            [workerId]
        );
        return rows[0] || null;
    }

    async knowledgeChunks(consumerId: string, pendingOnly = false, limit = 500): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const cap = Math.max(1, Math.min(Number(limit) || 500, 5000));
        return await this.sql.unsafe(
            `SELECT chunk_id,doc_id,ordinal,anchor,text,model,
                    (embedding IS NOT NULL) AS embedded
             FROM ${schema}.knowledge_doc_chunk
             ${pendingOnly ? 'WHERE embedding IS NULL' : ''}
             ORDER BY doc_id,ordinal LIMIT $1`,
            [cap]
        );
    }

    async updateChunkEmbeddings(consumerId: string, items: Array<{ chunkId: string; vector: number[] }>): Promise<void> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        await this.sql.begin(async (tx: any) => {
            await tx.unsafe(`SET LOCAL search_path = ${schema}, platform, public`);
            for (const item of items) {
                const literal = `[${item.vector.map((value) => Number(value).toFixed(8)).join(',')}]`;
                await tx.unsafe(
                    `UPDATE knowledge_doc_chunk SET embedding=$2::vector, model=$3 WHERE chunk_id=$1`,
                    [item.chunkId, literal, 'BAAI/bge-m3']
                );
            }
        });
    }

    async knowledgeVectorCount(consumerId: string): Promise<number> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `SELECT count(*)::int AS count FROM ${schema}.knowledge_doc_chunk WHERE embedding IS NOT NULL`
        );
        return Number(rows[0]?.count || 0);
    }

    async knowledgeVectorSearch(consumerId: string, vector: number[], limit = 20): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const literal = `[${vector.map((value) => Number(value).toFixed(8)).join(',')}]`;
        const cap = Math.max(1, Math.min(Number(limit) || 20, 100));
        return await this.sql.unsafe(
            `SELECT d.doc_id,d.path,d.type,d.status,d.owner,d.title,d.content_hash,d.indexed_at,
                    (SELECT count(*) FROM ${schema}.knowledge_doc_section s WHERE s.doc_id=d.doc_id)::int AS sections,
                    min(c.embedding <=> $1::vector) AS distance
             FROM ${schema}.knowledge_doc_chunk c
             JOIN ${schema}.knowledge_doc d ON d.doc_id=c.doc_id
             WHERE c.embedding IS NOT NULL
             GROUP BY d.doc_id,d.path,d.type,d.status,d.owner,d.title,d.content_hash,d.indexed_at
             ORDER BY distance LIMIT $2`,
            [literal, cap]
        );
    }

    async knowledgeFtsSearch(consumerId: string, query: string, limit = 20): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const q = (query || '').trim();
        if (!q) return [];
        const cap = Math.max(1, Math.min(Number(limit) || 20, 100));
        return await this.sql.unsafe(
            `SELECT d.doc_id,d.path,d.type,d.status,d.owner,d.title,d.content_hash,d.indexed_at,
                    (SELECT count(*) FROM ${schema}.knowledge_doc_section s WHERE s.doc_id=d.doc_id)::int AS sections,
                    ts_rank(se.tsv, websearch_to_tsquery('simple',$1)) AS rank,
                    ts_headline('simple', se.excerpt, websearch_to_tsquery('simple',$1), 'MaxWords=30,MinWords=10') AS headline
             FROM ${schema}.knowledge_doc_search se
             JOIN ${schema}.knowledge_doc d ON d.doc_id=se.doc_id
             WHERE se.tsv @@ websearch_to_tsquery('simple',$1)
             ORDER BY rank DESC, d.path LIMIT $2`,
            [q, cap]
        );
    }

    async knowledgeGraphCandidates(consumerId: string, docIds: string[], limit = 50): Promise<any[]> {
        if (!docIds.length) return [];
        const schema = quoteSchema(schemaNameFor(consumerId));
        const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
        return await this.sql.unsafe(
            `SELECT d.doc_id,d.path,d.type,d.status,d.owner,d.title,d.content_hash,d.indexed_at,
                    (SELECT count(*) FROM ${schema}.knowledge_doc_section s WHERE s.doc_id=d.doc_id)::int AS sections,
                    count(*)::int AS connections,
                    string_agg(DISTINCT e.kind, ',' ORDER BY e.kind) AS kinds
             FROM ${schema}.knowledge_edge e
             JOIN ${schema}.knowledge_doc d
               ON d.doc_id = CASE WHEN e.from_doc_id IN (SELECT jsonb_array_elements_text($1::jsonb)) THEN e.to_doc_id ELSE e.from_doc_id END
             WHERE (e.from_doc_id IN (SELECT jsonb_array_elements_text($1::jsonb)) OR e.to_doc_id IN (SELECT jsonb_array_elements_text($1::jsonb)))
               AND NOT (d.doc_id IN (SELECT jsonb_array_elements_text($1::jsonb)))
             GROUP BY d.doc_id,d.path,d.type,d.status,d.owner,d.title,d.content_hash,d.indexed_at
             ORDER BY connections DESC, d.path LIMIT $2`,
            [docIds, cap]
        );
    }

    async knowledgeCoverage(consumerId: string): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        return await this.sql.unsafe(
            `SELECT t.type, t.label,
                    (SELECT count(*) FROM ${schema}.knowledge_doc d WHERE d.type=t.type)::int AS docs,
                    (SELECT count(*) FROM ${schema}.knowledge_doc_section s JOIN ${schema}.knowledge_doc d ON d.doc_id=s.doc_id WHERE d.type=t.type)::int AS sections,
                    (SELECT count(*) FROM ${schema}.knowledge_finding f JOIN ${schema}.knowledge_doc d ON d.doc_id=f.doc_id WHERE d.type=t.type AND f.resolved_at IS NULL)::int AS findings
             FROM ${schema}.knowledge_type t
             ORDER BY t.type`
        );
    }

    async knowledgeDoc(consumerId: string, docId: string): Promise<any> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const docs = await this.sql.unsafe(
            `SELECT doc_id,path,type,status,owner,representation,title,content_hash,indexed_at
             FROM ${schema}.knowledge_doc WHERE doc_id=$1`,
            [docId]
        );
        if (!docs[0]) return { doc: null, sections: [], outgoing: [], incoming: [], descendants: [], links: [] };
        const sections = await this.sql.unsafe(
            `SELECT section_id,parent_section_id,ordinal,level,heading,anchor
             FROM ${schema}.knowledge_doc_section WHERE doc_id=$1 ORDER BY ordinal`,
            [docId]
        );
        const outgoing = await this.sql.unsafe(
            `SELECT e.edge_id,e.kind,d.doc_id,d.path,d.title
             FROM ${schema}.knowledge_edge e JOIN ${schema}.knowledge_doc d ON d.doc_id=e.to_doc_id
             WHERE e.from_doc_id=$1 ORDER BY e.kind,d.path`,
            [docId]
        );
        const incoming = await this.sql.unsafe(
            `SELECT e.edge_id,e.kind,d.doc_id,d.path,d.title
             FROM ${schema}.knowledge_edge e JOIN ${schema}.knowledge_doc d ON d.doc_id=e.from_doc_id
             WHERE e.to_doc_id=$1 ORDER BY e.kind,d.path`,
            [docId]
        );
        const descendants = await this.sql.unsafe(
            `WITH RECURSIVE walk(doc_id, depth) AS (
                SELECT e.to_doc_id, 1 FROM ${schema}.knowledge_edge e WHERE e.from_doc_id=$1
                UNION ALL
                SELECT e.to_doc_id, w.depth + 1
                FROM walk w JOIN ${schema}.knowledge_edge e ON e.from_doc_id = w.doc_id
                WHERE w.depth < 2
             )
             SELECT DISTINCT w.doc_id, w.depth, d.path, d.title
             FROM walk w JOIN ${schema}.knowledge_doc d ON d.doc_id = w.doc_id
             ORDER BY w.depth, d.path`,
            [docId]
        );
        const links = await this.sql.unsafe(
            `SELECT raw_target,resolved_doc_id,resolved_section_id,status
             FROM ${schema}.knowledge_link WHERE doc_id=$1 ORDER BY link_id`,
            [docId]
        );
        return { doc: docs[0], sections, outgoing, incoming, descendants, links };
    }

    async knowledgeDocs(consumerId: string, query?: string, limit = 50): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const q = (query || '').trim();
        const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
        const params: any[] = [];
        let sql = `SELECT d.doc_id, d.path, d.type, d.status, d.owner, d.title, d.content_hash, d.indexed_at,
                          (SELECT count(*) FROM ${schema}.knowledge_doc_section s WHERE s.doc_id=d.doc_id)::int AS sections
                   FROM ${schema}.knowledge_doc d`;
        if (q) {
            sql += ` JOIN ${schema}.knowledge_doc_search se ON se.doc_id=d.doc_id
                     WHERE se.tsv @@ websearch_to_tsquery('simple', $1)`;
            params.push(q);
        }
        sql += ` ORDER BY d.path LIMIT $${params.length + 1}`;
        params.push(cap);
        return await this.sql.unsafe(sql, params);
    }

    async knowledgeFindings(consumerId: string, limit = 50): Promise<any[]> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
        return await this.sql.unsafe(
            `SELECT f.finding_id, f.doc_id, d.path, f.severity, f.code, f.detail, f.created_at
             FROM ${schema}.knowledge_finding f
             LEFT JOIN ${schema}.knowledge_doc d ON d.doc_id=f.doc_id
             WHERE f.resolved_at IS NULL
             ORDER BY f.created_at DESC, f.finding_id DESC LIMIT $1`,
            [cap]
        );
    }

    async knowledgeSummary(consumerId: string): Promise<any> {
        const schema = quoteSchema(schemaNameFor(consumerId));
        const rows = await this.sql.unsafe(
            `SELECT
                (SELECT count(*) FROM ${schema}.knowledge_doc)::int AS docs,
                (SELECT count(*) FROM ${schema}.knowledge_doc_section)::int AS sections,
                (SELECT count(*) FROM ${schema}.knowledge_edge)::int AS edges,
                (SELECT count(*) FROM ${schema}.knowledge_finding WHERE resolved_at IS NULL)::int AS findings,
                (SELECT count(*) FROM ${schema}.knowledge_link)::int AS links`
        );
        const manifest = await this.sql.unsafe(
            `SELECT manifest_id, build_id, manifest_version, generator_version, source_hash, created_at
             FROM ${schema}.knowledge_manifest ORDER BY created_at DESC LIMIT 1`
        );
        return { ...rows[0], manifest: manifest[0] || null };
    }

    async withSearchPath<T>(consumerId: string, fn: (tx: PlatformStore) => Promise<T>): Promise<T> {
        const schema = schemaNameFor(consumerId);
        return this.sql.begin(async (tx: any) => {
            const scoped = new BunSqlPlatformStore(tx);
            scoped.currentSearchPath = schema;
            try {
                await tx.unsafe(`SET LOCAL search_path = ${quoteSchema(schema)}, platform, public`);
                return await fn(scoped);
            } finally {
                scoped.currentSearchPath = null;
            }
        });
    }

    getSearchPath(): string | null {
        return this.currentSearchPath;
    }
}

function mapConsumer(row: any): ConsumerRecord {
    return {
        id: row.id,
        name: row.name,
        root: row.root,
        sdlcRoot: row.sdlc_root ?? null,
        schemaName: row.schema_name,
        status: row.status,
        version: Number(row.version),
        storageMode: 'schema',
        materializedHash: row.materialized_hash ?? null,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
    };
}

function mapEvent(row: any): ConsumerEvent {
    return {
        id: Number(row.id),
        consumerId: row.consumer_id,
        eventType: row.event_type,
        actorKind: row.actor_kind,
        actorLabel: row.actor_label ?? null,
        at: toIso(row.at),
        detail: typeof row.detail === 'string' ? JSON.parse(row.detail) : (row.detail || {}),
    };
}

function mapStackVersion(row: any): StackVersionRecord {
    return {
        consumerId: row.consumer_id,
        version: Number(row.version),
        status: row.status,
        layers: typeof row.layers === 'string' ? JSON.parse(row.layers) : (row.layers || []),
        publishedAt: row.published_at ? toIso(row.published_at) : null,
        createdAt: toIso(row.created_at),
    };
}

function toIso(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    return String(value ?? '');
}

export function assertConsumerId(id: string): string {
    if (typeof id !== 'string' || !CONSUMER_ID_PATTERN.test(id)) fail('INVALID_CONSUMER_ID');
    return id;
}
