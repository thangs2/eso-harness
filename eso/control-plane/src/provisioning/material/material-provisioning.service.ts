import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail, PlatformError } from '../../platform/registry/errors.js';
import type { PlatformStore } from '../../platform/registry/store.js';
import type { ConsumerRecord } from '../../platform/registry/types.js';
import {
    GENERATED_MARKER,
    HARNESS_MANIFEST_SCHEMA,
    type GeneratedConfig,
    type HarnessManifest,
    type MaterialProvisionOptions,
    type MaterialProvisionResult,
} from './types.js';

export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function assertValidRoot(root: string): void {
    if (!root || typeof root !== 'string' || !root.trim()) {
        fail('ROOT_NOT_FOUND', 'Root directory path is required');
    }
    let stats;
    try {
        stats = lstatSync(root);
    } catch {
        fail('ROOT_NOT_FOUND', `Root directory does not exist: ${root}`);
    }
    if (!stats.isDirectory()) {
        fail('ROOT_NOT_FOUND', `Root path is not a directory: ${root}`);
    }
    if (stats.isSymbolicLink()) {
        fail('ROOT_NOT_FOUND', `Root path must not be a symbolic link: ${root}`);
    }
}

export class MaterialProvisioningService {
    constructor(private readonly store?: PlatformStore) {}

    async provision(
        consumerOrId: string | ConsumerRecord,
        options: MaterialProvisionOptions = {}
    ): Promise<MaterialProvisionResult> {
        let consumer: ConsumerRecord;
        if (typeof consumerOrId === 'string') {
            if (!this.store) {
                fail('INVALID_STATE', 'PlatformStore required when consumerId string is provided');
            }
            const found = await this.store.getConsumer(consumerOrId);
            if (!found) {
                fail('CONSUMER_NOT_FOUND', `Consumer not found: ${consumerOrId}`);
            }
            consumer = found;
        } else {
            consumer = consumerOrId;
        }

        if (consumer.status !== 'ready') {
            fail('INVALID_STATE', `Consumer status must be ready, got: ${consumer.status}`);
        }

        assertValidRoot(consumer.root);

        const filesWritten: string[] = [];
        const skippedUnchanged: string[] = [];

        // 1. Prepare agents/ directory structure
        const agentsDir = join(consumer.root, 'agents');
        const harnessDir = join(consumer.root, '.harness');
        mkdirSync(agentsDir, { recursive: true });
        mkdirSync(join(agentsDir, 'rules'), { recursive: true });
        mkdirSync(join(agentsDir, 'skills'), { recursive: true });
        mkdirSync(join(agentsDir, 'subagents'), { recursive: true });
        mkdirSync(harnessDir, { recursive: true });

        // 2. Prepare bundle files
        // 2a. AGENTS.md
        const agentsMdPath = join(consumer.root, 'AGENTS.md');
        const agentsMdContent = [
            `<!-- ${GENERATED_MARKER} -->`,
            `# Agent Rules & Instructions for ${consumer.name} (${consumer.id})`,
            '',
            'All instructions and rules are managed canonically under `agents/`.',
            'Refer to `.harness/manifest.json` for path definitions.',
            '',
        ].join('\n');

        this.safeWriteFile(agentsMdPath, agentsMdContent, filesWritten, skippedUnchanged);

        // 2b. agents/README.md
        const agentsReadmePath = join(agentsDir, 'README.md');
        const agentsReadmeContent = [
            `<!-- ${GENERATED_MARKER} -->`,
            `# Agents Configuration — ${consumer.name}`,
            '',
            'Canonical subdirectories:',
            '- `rules/`: Agent instruction rules',
            '- `skills/`: Custom capability skills',
            '- `subagents/`: Specialized subagent definitions',
            '',
        ].join('\n');

        this.safeWriteFile(agentsReadmePath, agentsReadmeContent, filesWritten, skippedUnchanged);

        // 2c. .harness/config.json (INV-4, D-113)
        const configPath = join(harnessDir, 'config.json');
        let existingProfile: Record<string, unknown> = {};
        let existingZones: unknown[] = [];
        if (existsSync(configPath)) {
            try {
                const existingConfig = JSON.parse(readFileSync(configPath, 'utf8'));
                if (existingConfig && typeof existingConfig === 'object') {
                    if (existingConfig.profile && typeof existingConfig.profile === 'object') {
                        existingProfile = existingConfig.profile;
                    }
                    if (Array.isArray(existingConfig.zones)) {
                        existingZones = existingConfig.zones;
                    }
                }
            } catch (err) {
                this.raiseMaterialFailed(`Failed to parse existing config.json at ${configPath}: ${(err as Error).message}`);
            }
        }

        const configPayload = {
            id: consumer.id,
            name: consumer.name,
            root: consumer.root,
            sdlcRoot: consumer.sdlcRoot,
            profile: options.profile ?? existingProfile,
            zones: options.zones ?? existingZones,
        };
        const configHash = createHash('sha256').update(stableStringify(configPayload)).digest('hex');
        const generatedConfig: GeneratedConfig = {
            _generated: GENERATED_MARKER,
            _schema: 1,
            ...configPayload,
            hash: configHash,
        };
        const configContent = `${JSON.stringify(generatedConfig, null, 2)}\n`;
        this.safeWriteFile(configPath, configContent, filesWritten, skippedUnchanged);

        // 2d. .harness/manifest.json (INV-5, Plane D §3b)
        const manifestPath = join(harnessDir, 'manifest.json');
        const manifest: HarnessManifest = {
            _schema: HARNESS_MANIFEST_SCHEMA,
            _generated: GENERATED_MARKER,
            consumerId: consumer.id,
            version: 1,
            paths: {
                agents: 'agents',
                harness: '.harness',
            },
            projections: {},
        };
        const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
        this.safeWriteFile(manifestPath, manifestContent, filesWritten, skippedUnchanged);

        // Combined bundle hash
        const bundleHash = createHash('sha256')
            .update(agentsMdContent)
            .update(configContent)
            .update(manifestContent)
            .digest('hex');

        if (this.store && consumer.id) {
            await this.store.setMaterializedHash(consumer.id, bundleHash);
        }

        return {
            consumerId: consumer.id,
            root: consumer.root,
            hash: bundleHash,
            filesWritten,
            skippedUnchanged,
        };
    }

    private safeWriteFile(
        filePath: string,
        newContent: string,
        filesWritten: string[],
        skippedUnchanged: string[]
    ): void {
        if (existsSync(filePath)) {
            let existing: string;
            try {
                existing = readFileSync(filePath, 'utf8');
            } catch (err) {
                this.raiseMaterialFailed(`Cannot read existing file ${filePath}: ${(err as Error).message}`);
            }

            // INV-2: If file exists without the ESO generated marker, fail closed to protect user file
            if (!existing.includes(GENERATED_MARKER)) {
                this.raiseMaterialFailed(
                    `Conflict: User file ${filePath} already exists without ESO generated marker`
                );
            }

            // INV-3: Idempotent - if content matches, do not rewrite
            if (existing === newContent) {
                skippedUnchanged.push(filePath);
                return;
            }
        }

        // Atomic write via temp file
        const dir = join(filePath, '..');
        const tempPath = join(dir, `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`);
        try {
            writeFileSync(tempPath, newContent, 'utf8');
            renameSync(tempPath, filePath);
            filesWritten.push(filePath);
        } catch (err) {
            try {
                rmSync(tempPath, { force: true });
            } catch {}
            this.raiseMaterialFailed(`Failed to write file ${filePath}: ${(err as Error).message}`);
        }
    }

    private raiseMaterialFailed(detail: string): never {
        fail('MATERIAL_FAILED', detail);
    }
}
