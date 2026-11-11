import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { schemaNameFor } from '../../platform/registry/ddl.js';
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { RegistryService } from '../../platform/registry/service.js';
import type { ConsumerRecord } from '../../platform/registry/types.js';
import type {
    PersistSetupOptions,
    SetupInfo,
} from './types.js';

/**
 * Task L5.7 (ESO-625) — consumer setup state service.
 *
 * Implements:
 * - INV-1: Setup info persistence (consumer record update in PlatformStore, no new table).
 * - INV-2: Accurate read-back (schema existence in store, material file check, hash consistency).
 * - INV-3: Fail-closed (CONSUMER_NOT_FOUND, SETUP_INFO_MISSING on corrupt/missing when expecting ready).
 * - INV-4: Idempotency (repeated readSetup/persistSetup calls do not duplicate or mutate state unexpectedly).
 * - INV-5: No host projection / tier / recipe in this slice.
 */
export class ProvisioningStateService {
    private readonly store: PlatformStore;

    constructor(storeOrRegistry: PlatformStore | RegistryService) {
        if ('createSchema' in storeOrRegistry && 'schemaExists' in storeOrRegistry) {
            this.store = storeOrRegistry as PlatformStore;
        } else if ('store' in storeOrRegistry && (storeOrRegistry as any).store) {
            this.store = (storeOrRegistry as any).store;
        } else {
            const resolvedStore = (storeOrRegistry as any).store;
            if (resolvedStore && typeof resolvedStore.schemaExists === 'function') {
                this.store = resolvedStore;
            } else {
                throw new Error('ProvisioningStateService requires a PlatformStore or RegistryService');
            }
        }
    }

    async readSetup(consumerId: string): Promise<SetupInfo> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer) {
            fail('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        }

        const schemaExists = await this.store.schemaExists(id);
        const schemaName = consumer.schemaName || schemaNameFor(id);

        let agents = false;
        let config = false;
        let manifest = false;
        let computedHash: string | null = null;
        let materialized = false;

        if (consumer.root && typeof consumer.root === 'string' && existsSync(consumer.root)) {
            try {
                const rootStat = lstatSync(consumer.root);
                if (rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
                    const agentsPath = join(consumer.root, 'AGENTS.md');
                    const configPath = join(consumer.root, '.harness', 'config.json');
                    const manifestPath = join(consumer.root, '.harness', 'manifest.json');

                    agents = existsSync(agentsPath);
                    config = existsSync(configPath);
                    manifest = existsSync(manifestPath);

                    if (agents && config && manifest) {
                        try {
                            const agentsContent = readFileSync(agentsPath, 'utf8');
                            const configContent = readFileSync(configPath, 'utf8');
                            const manifestContent = readFileSync(manifestPath, 'utf8');

                            JSON.parse(configContent);
                            JSON.parse(manifestContent);

                            computedHash = createHash('sha256')
                                .update(agentsContent)
                                .update(configContent)
                                .update(manifestContent)
                                .digest('hex');

                            if (consumer.materializedHash && consumer.materializedHash === computedHash) {
                                materialized = true;
                            }
                        } catch {
                            computedHash = null;
                            materialized = false;
                        }
                    }
                }
            } catch {
                // Ignore stat errors; preserve safe defaults
            }
        }

        const ready = consumer.status === 'ready' && schemaExists && materialized;

        return {
            consumerId: id,
            status: consumer.status,
            schema: {
                name: schemaName,
                exists: schemaExists,
            },
            material: {
                agents,
                config,
                manifest,
                hash: computedHash,
                materialized,
            },
            setup: {
                ready,
                updatedAt: consumer.updatedAt,
            },
        };
    }

    async persistSetup(
        consumerId: string,
        options: PersistSetupOptions = {}
    ): Promise<SetupInfo> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer) {
            fail('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        }

        const now = options.now ?? new Date().toISOString();

        let hasValidFiles = false;
        let computedFileHash: string | null = null;

        if (consumer.root && typeof consumer.root === 'string' && existsSync(consumer.root)) {
            try {
                const rootStat = lstatSync(consumer.root);
                if (rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
                    const agentsPath = join(consumer.root, 'AGENTS.md');
                    const configPath = join(consumer.root, '.harness', 'config.json');
                    const manifestPath = join(consumer.root, '.harness', 'manifest.json');

                    if (existsSync(agentsPath) && existsSync(configPath) && existsSync(manifestPath)) {
                        try {
                            const agentsContent = readFileSync(agentsPath, 'utf8');
                            const configContent = readFileSync(configPath, 'utf8');
                            const manifestContent = readFileSync(manifestPath, 'utf8');

                            JSON.parse(configContent);
                            const manifest = JSON.parse(manifestContent) as {
                                files?: unknown;
                                materialVersion?: unknown;
                            };
                            if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
                                throw new Error('manifest has no files inventory');
                            }
                            if (manifest.materialVersion !== 1) {
                                throw new Error('manifest materialVersion is missing or unsupported');
                            }
                            for (const entry of manifest.files) {
                                if (!entry || typeof entry !== 'object') {
                                    throw new Error('manifest contains an invalid file entry');
                                }
                                const path = (entry as { path?: unknown }).path;
                                const sha256 = (entry as { sha256?: unknown }).sha256;
                                if (typeof path !== 'string' || typeof sha256 !== 'string') {
                                    throw new Error('manifest file entry is missing path or sha256');
                                }
                                const absolute = join(consumer.root, path);
                                if (!existsSync(absolute)) {
                                    throw new Error(`material file is missing: ${path}`);
                                }
                                const actual = createHash('sha256').update(readFileSync(absolute)).digest('hex');
                                if (actual !== sha256) {
                                    throw new Error(`material file hash mismatch: ${path}`);
                                }
                            }

                            computedFileHash = createHash('sha256')
                                .update(agentsContent)
                                .update(configContent)
                                .update(manifestContent)
                                .digest('hex');
                            hasValidFiles = true;
                        } catch (err) {
                            if (options.expectReady) {
                                fail('SETUP_INFO_MISSING', `Material corrupted: ${(err as Error).message}`);
                            }
                        }
                    }
                }
            } catch (err) {
                if (options.expectReady) {
                    fail('SETUP_INFO_MISSING', `Invalid consumer root: ${(err as Error).message}`);
                }
            }
        }

        if (options.expectReady) {
            if (!hasValidFiles || !computedFileHash) {
                fail('SETUP_INFO_MISSING', 'Required material files are missing or invalid when expecting ready');
            }
            const schemaExists = await this.store.schemaExists(id);
            if (!schemaExists) {
                fail('SETUP_INFO_MISSING', `Schema does not exist for consumer ${id} when expecting ready`);
            }
            if (!consumer.materializedHash || consumer.materializedHash !== computedFileHash) {
                fail('SETUP_INFO_MISSING', 'Material on disk does not match recorded materializedHash; re-provisioning required');
            }
        }

        const patch: Partial<Pick<ConsumerRecord, 'status' | 'materializedHash' | 'updatedAt'>> = {
            updatedAt: now,
        };
        if (options.status) {
            patch.status = options.status;
        }
        if (options.materializedHash !== undefined) {
            patch.materializedHash = options.materializedHash;
        }

        await this.store.updateConsumer(id, patch);

        return this.readSetup(id);
    }
}
