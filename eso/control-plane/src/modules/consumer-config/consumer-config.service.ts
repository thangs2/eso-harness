/**
 * BUG-13 — S3 Config preview/save over the consumer root `.harness/config.json`.
 *
 * The Nest `ConfigService` (DB-backed) is not mounted on the Fastify server, so this service is the
 * live contract: deterministic hash of the current config, and compare-and-swap on save.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { PlatformError } from '../../platform/registry/errors.js';
import type { ConsumerRecord } from '../../platform/registry/types.js';

export interface ConfigStore {
    getConsumer(id: string): Promise<ConsumerRecord | null>;
}

export function canonicalJson(value: unknown): string {
    const walk = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(walk);
        if (item && typeof item === 'object') {
            return Object.fromEntries(Object.keys(item as Record<string, unknown>).sort().map((key) => [key, walk((item as Record<string, unknown>)[key])]));
        }
        return item;
    };
    return JSON.stringify(walk(value));
}

export function configHash(config: unknown): string {
    return createHash('sha256').update(canonicalJson(config)).digest('hex');
}

export class ConsumerConfigService {
    constructor(private readonly store: ConfigStore) {}

    private async root(consumerId: string): Promise<string> {
        const consumer = await this.store.getConsumer(consumerId);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', `consumer ${consumerId} not found`);
        return consumer.root;
    }

    private path(root: string): string {
        return join(root, '.harness', 'config.json');
    }

    private read(root: string): Record<string, unknown> {
        const file = this.path(root);
        if (!existsSync(file)) return { version: 1 };
        try {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { version: 1 };
        } catch {
            throw new PlatformError('INVALID_STATE', 'consumer config is not valid JSON');
        }
    }

    async preview(consumerId: string): Promise<{ hash: string; config: Record<string, unknown> }> {
        const root = await this.root(consumerId);
        const config = this.read(root);
        return { hash: configHash(config), config };
    }

    async save(consumerId: string, body: { hash?: string; config?: Record<string, unknown> }): Promise<{ ok: true; hash: string }> {
        const root = await this.root(consumerId);
        const current = this.read(root);
        const provided = String(body?.hash || '');
        if (!provided) throw new PlatformError('INVALID_STATE', 'hash is required (call preview first)');
        if (provided !== configHash(current)) {
            throw new PlatformError('STALE_VERSION', 'configuration changed since preview; reload preview');
        }
        const next = body?.config && typeof body.config === 'object' ? body.config : current;
        mkdirSync(join(root, '.harness'), { recursive: true });
        writeFileSync(this.path(root), JSON.stringify(next, null, 2));
        return { ok: true, hash: configHash(next) };
    }
}
