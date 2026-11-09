import { quoteSchema, schemaNameFor, CONSUMER_ID_PATTERN } from '../../platform/registry/ddl.js';
import { fail } from '../../platform/registry/errors.js';
import type { PlatformStore } from '../../platform/registry/store.js';
import type { ConsumerRecord } from '../../platform/registry/types.js';

/**
 * L6.1 — consumer-scoped isolation.
 *
 * A data request is: validate slug → registry must say `ready` → transaction with
 * `SET LOCAL search_path = c_<id>, platform, public` → handler → commit. The search_path is
 * transaction-local, so a pooled connection cannot leak it into the next consumer.
 */
export function assertConsumerSlug(raw: string): string {
    let decoded: string;
    try {
        decoded = decodeURIComponent(String(raw ?? ''));
    } catch {
        fail('INVALID_CONSUMER_ID');
    }
    if (!CONSUMER_ID_PATTERN.test(decoded)) fail('INVALID_CONSUMER_ID');
    // `c_b` is reserved: it would collide with the c_<id> schema namespace.
    if (decoded.startsWith('c_')) fail('INVALID_CONSUMER_ID');
    // Defence in depth: no path segment can survive the slug check.
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) {
        fail('INVALID_CONSUMER_ID');
    }
    return decoded;
}

export interface ScopedSession {
    searchPath: string;
    tx: PlatformStore;
    query?: (sql: string, params?: unknown[]) => Promise<any[]>;
}

export interface ScopedDb {
    withConsumer<T>(consumerId: string, fn: (session: ScopedSession) => Promise<T>): Promise<T>;
}

export class IsolationService {
    constructor(
        private readonly store: PlatformStore,
        private readonly scoped?: ScopedDb
    ) {}

    async resolve(raw: string): Promise<ConsumerRecord> {
        const id = assertConsumerSlug(raw);
        const record = await this.store.getConsumer(id);
        if (!record || record.status !== 'ready') fail('CONSUMER_NOT_FOUND');
        return record;
    }

    async run<T>(raw: string, fn: (session: ScopedSession) => Promise<T>): Promise<T> {
        const record = await this.resolve(raw);
        const schema = schemaNameFor(record.id);
        if (this.scoped) return this.scoped.withConsumer(record.id, fn);
        return this.store.withSearchPath(record.id, async (tx) => {
            return fn({ searchPath: schema, tx });
        });
    }

    async canRead(raw: string): Promise<boolean> {
        try {
            await this.resolve(raw);
            return true;
        } catch {
            return false;
        }
    }
}

/** Bun.SQL implementation used by the running server and the qc scenario. */
export class BunScopedDb implements ScopedDb {
    constructor(private readonly sql: any) {}

    async withConsumer<T>(consumerId: string, fn: (session: ScopedSession) => Promise<T>): Promise<T> {
        const schema = schemaNameFor(consumerId);
        return this.sql.begin(async (tx: any) => {
            await tx.unsafe(`SET LOCAL search_path = ${quoteSchema(schema)}, platform, public`);
            return fn({
                searchPath: schema,
                tx: null as any,
                query: (text: string, params?: unknown[]) => tx.unsafe(text, params ?? []),
            });
        });
    }
}
