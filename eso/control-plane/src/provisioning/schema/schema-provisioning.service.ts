import { schemaNameFor } from '../../platform/registry/ddl.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { RegistryService } from '../../platform/registry/service.js';
import type { ConsumerRecord } from '../../platform/registry/types.js';

export class SchemaMismatchError extends Error {
    readonly code = 'SCHEMA_MISMATCH';

    constructor(message = 'SCHEMA_MISMATCH') {
        super(message.startsWith('SCHEMA_MISMATCH') ? message : `SCHEMA_MISMATCH: ${message}`);
        this.name = 'SchemaMismatchError';
    }
}

export interface ProvisionSchemaOptions {
    schemaName?: string;
}

export interface ProvisionSchemaResult {
    consumerId: string;
    schemaName: string;
    created: boolean;
}

/**
 * Task L5.5 (ESO-615) — consumer schema provisioning service.
 *
 * Implements:
 * - INV-1: Schema-expanded schema `c_<id>` in existing Postgres.
 * - INV-2: Idempotent rerun: does not duplicate or fail on existing matching schema.
 * - INV-3: Schema must match `consumer.id`; mismatch fails closed with SCHEMA_MISMATCH.
 * - INV-4: No host/source/tier/recipe field; no host projection.
 * - INV-5: No material files and no setup-info table.
 */
export class SchemaProvisioningService {
    private readonly store: PlatformStore;

    constructor(storeOrRegistry: PlatformStore | RegistryService) {
        if ('createSchema' in storeOrRegistry && 'schemaExists' in storeOrRegistry) {
            this.store = storeOrRegistry as PlatformStore;
        } else if ('store' in storeOrRegistry && (storeOrRegistry as any).store) {
            this.store = (storeOrRegistry as any).store;
        } else {
            // In case store is a private field on RegistryService
            const resolvedStore = (storeOrRegistry as any).store;
            if (resolvedStore && typeof resolvedStore.schemaExists === 'function') {
                this.store = resolvedStore;
            } else {
                throw new Error('SchemaProvisioningService requires a PlatformStore or RegistryService');
            }
        }
    }

    async provision(
        consumerId: string,
        options: ProvisionSchemaOptions = {}
    ): Promise<ProvisionSchemaResult> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer) {
            throw new Error(`CONSUMER_NOT_FOUND:${id}`);
        }

        const expectedSchema = schemaNameFor(id);

        // INV-3 / AC-40-3: Check consumer record schemaName if present
        if (consumer.schemaName && consumer.schemaName !== expectedSchema) {
            throw new SchemaMismatchError(
                `SCHEMA_MISMATCH: record schema '${consumer.schemaName}' does not match expected '${expectedSchema}'`
            );
        }

        // INV-3 / AC-40-3: Check optional schemaName parameter if supplied
        if (options.schemaName && options.schemaName !== expectedSchema) {
            throw new SchemaMismatchError(
                `SCHEMA_MISMATCH: requested schema '${options.schemaName}' does not match expected '${expectedSchema}'`
            );
        }

        // INV-2: Idempotent check
        const exists = await this.store.schemaExists(id);
        if (exists) {
            return {
                consumerId: id,
                schemaName: expectedSchema,
                created: false,
            };
        }

        const createdSchemaName = await this.store.createSchema(id);
        if (createdSchemaName !== expectedSchema) {
            throw new SchemaMismatchError(
                `SCHEMA_MISMATCH: created schema '${createdSchemaName}' does not match expected '${expectedSchema}'`
            );
        }

        return {
            consumerId: id,
            schemaName: expectedSchema,
            created: true,
        };
    }
}
