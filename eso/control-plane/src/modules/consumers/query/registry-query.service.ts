import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../../platform/registry/store.js';
import type { ConsumerRecord, ListConsumersOptions } from '../../../platform/registry/types.js';

/**
 * L3.2 — registry list/detail.
 *
 * List: retired remains visible; deleted/purged are hidden unless `include_deleted=true`.
 * Detail: a registry-facing view with the generated profile, stripped of credential-shaped keys.
 * F-03 §3: retired/deleted detail is the same 404 as a missing id.
 */
export interface ConsumerView extends ConsumerRecord {
    profile: Record<string, unknown> | null;
}

const CREDENTIAL_KEY = /(password|passwd|token|authorization|secret|api[_-]?key|dsn|connection[_-]?string)/i;

export function sanitizeProfile(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeProfile);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (CREDENTIAL_KEY.test(key)) continue;
        out[key] = sanitizeProfile(child);
    }
    return out;
}

export function readGeneratedProfile(root: string): Record<string, unknown> | null {
    const file = join(root, '.harness', 'config.json');
    if (!existsSync(file)) return null;
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return sanitizeProfile(parsed) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export class RegistryQueryService {
    constructor(private readonly store: PlatformStore) {}

    async list(options: ListConsumersOptions = {}): Promise<ConsumerRecord[]> {
        return this.store.listConsumers({
            includeDeleted: Boolean(options.includeDeleted),
            status: options.status ?? null,
        });
    }

    async get(id: string): Promise<ConsumerView> {
        const consumerId = assertConsumerId(id);
        const record = await this.store.getConsumer(consumerId);
        if (!record) fail('CONSUMER_NOT_FOUND');
        if (record.status === 'retired' || record.status === 'deleted' || record.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }
        return { ...record, profile: readGeneratedProfile(record.root) };
    }

    /** Detail for lifecycle endpoints: a deleted/retired record still has to be reachable. */
    async getAny(id: string): Promise<ConsumerView> {
        const consumerId = assertConsumerId(id);
        const record = await this.store.getConsumer(consumerId);
        if (!record || record.status === 'purged') fail('CONSUMER_NOT_FOUND');
        return { ...record, profile: readGeneratedProfile(record.root) };
    }
}
