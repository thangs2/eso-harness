import {
    CONSUMER_ID_PATTERN,
    CONSUMER_TABLE,
    CONSUMER_EVENT_TABLE,
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
    dropSchema(consumerId: string): Promise<void>;
    schemaExists(consumerId: string): Promise<boolean>;
    insertConsumer(record: ConsumerRecord): Promise<void>;
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
    replaceStackVersions(consumerId: string, versions: StackVersionRecord[]): Promise<void>;
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

export class MemoryPlatformStore implements PlatformStore {
    readonly kind = 'memory' as const;
    readonly ddlLog: string[] = [];
    private tables = new Set<string>();
    private consumers = new Map<string, ConsumerRecord>();
    private events: ConsumerEvent[] = [];
    private stackVersions = new Map<string, StackVersionRecord[]>();
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

    async listConsumers(options: ListConsumersOptions = {}): Promise<ConsumerRecord[]> {
        let rows = [...this.consumers.values()];
        if (options.status) rows = rows.filter((row) => row.status === options.status);
        if (!options.includeDeleted) {
            rows = rows.filter((row) => row.status !== 'deleted' && row.status !== 'purged');
        }
        return rows
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

    async replaceStackVersions(consumerId: string, versions: StackVersionRecord[]): Promise<void> {
        this.stackVersions.set(consumerId, clone(versions).sort((a, b) => a.version - b.version));
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
export class BunSqlPlatformStore implements PlatformStore {
    readonly kind = 'postgres' as const;
    private readonly sql: any;
    private currentSearchPath: string | null = null;

    constructor(sql: any) {
        this.sql = sql;
    }

    async ensurePlatformSchema(): Promise<void> {
        for (const statement of PLATFORM_DDL) {
            await this.sql.unsafe(statement);
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
        await this.sql.unsafe(`CREATE SCHEMA ${quoteSchema(schema)}`);
        return schema;
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

    async listConsumers(options: ListConsumersOptions = {}): Promise<ConsumerRecord[]> {
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
        const rows = await this.sql.unsafe(
            `SELECT * FROM platform.consumer ${clause} ORDER BY updated_at DESC`,
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
                JSON.stringify(event.detail || {}),
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
        return rows.map((row: any) => ({
            consumerId: row.consumer_id,
            version: Number(row.version),
            status: row.status,
            layers: typeof row.layers === 'string' ? JSON.parse(row.layers) : (row.layers || []),
            publishedAt: row.published_at ? toIso(row.published_at) : null,
            createdAt: toIso(row.created_at),
        }));
    }

    async replaceStackVersions(consumerId: string, versions: StackVersionRecord[]): Promise<void> {
        await this.sql.begin(async (tx: any) => {
            await tx.unsafe(`DELETE FROM platform.harness_stack_version WHERE consumer_id = $1`, [consumerId]);
            for (const version of versions) {
                await tx.unsafe(
                    `INSERT INTO platform.harness_stack_version
                     (consumer_id, version, status, layers, published_at, created_at)
                     VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
                    [consumerId, version.version, version.status, JSON.stringify(version.layers || []), version.publishedAt, version.createdAt]
                );
            }
        });
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

function toIso(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    return String(value ?? '');
}

export function assertConsumerId(id: string): string {
    if (typeof id !== 'string' || !CONSUMER_ID_PATTERN.test(id)) fail('INVALID_CONSUMER_ID');
    return id;
}
