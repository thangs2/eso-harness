import { assertConsumerId, type PlatformStore } from './store.js';
import { fail } from './errors.js';
import { schemaNameFor } from './ddl.js';
import type {
    ConsumerEvent,
    ConsumerRecord,
    CreateConsumerInput,
    ListConsumersOptions,
} from './types.js';

/**
 * L1.1 — platform registry.
 *
 * This service owns exactly one write path: create a consumer atomically
 * (schema + registry row + `created` event) inside one transaction.
 * Validation of root/profile and the HTTP surface belong to L3.1.
 */
export class RegistryService {
    constructor(private readonly store: PlatformStore) {}

    async initialize(): Promise<void> {
        await this.store.ensurePlatformSchema();
    }

    async createConsumer(input: CreateConsumerInput): Promise<ConsumerRecord> {
        const id = assertConsumerId(input.id);
        if (!input.name || !input.name.trim()) {
            fail('INVALID_CONSUMER_ID', 'name is required');
        }
        if (!input.root || !input.root.trim()) {
            fail('ROOT_NOT_FOUND', 'root is required');
        }

        const existing = await this.store.getConsumer(id);
        if (existing) fail('CONSUMER_EXISTS');

        const now = input.now ?? new Date().toISOString();
        const record: ConsumerRecord = {
            id,
            name: input.name.trim(),
            root: input.root,
            sdlcRoot: input.sdlcRoot ?? null,
            schemaName: schemaNameFor(id),
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        };

        await this.store.transaction(async (tx) => {
            const schema = await tx.createSchema(id);
            if (schema !== record.schemaName) {
                throw new Error(`SCHEMA_MISMATCH:${schema}`);
            }
            await tx.insertConsumer(record);
            await tx.appendEvent(createdEvent(record, input, now));
        });

        return (await this.store.getConsumer(id))!;
    }

    async getConsumer(id: string): Promise<ConsumerRecord | null> {
        assertConsumerId(id);
        return this.store.getConsumer(id);
    }

    async listConsumers(options: ListConsumersOptions = {}): Promise<ConsumerRecord[]> {
        return this.store.listConsumers(options);
    }
}

function createdEvent(
    record: ConsumerRecord,
    input: CreateConsumerInput,
    at: string
): ConsumerEvent {
    return {
        consumerId: record.id,
        eventType: 'created',
        actorKind: input.actor.kind,
        actorLabel: input.actor.label || null,
        at,
        detail: {
            schema: record.schemaName,
            storageMode: record.storageMode,
            version: record.version,
        },
    };
}
