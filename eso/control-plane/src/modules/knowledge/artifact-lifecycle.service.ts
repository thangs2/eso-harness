import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import {
    assertConsumerId,
    type ArtifactCustodian,
    type ArtifactKtState,
    type ArtifactLiveness,
    type ArtifactOrigin,
    type ConsumerArtifact,
    type ListArtifactsQuery,
    type PlatformStore,
} from '../../platform/registry/store.js';
import type { KnowledgeIndexService } from './knowledge-index.service.js';

function atomicWrite(path: string, body: string): void {
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, body, 'utf8');
    renameSync(temp, path);
}

export interface IngestArtifactInput {
    id?: string;
    title: string;
    origin?: ArtifactOrigin;
    custodian?: ArtifactCustodian;
    ktState?: ArtifactKtState;
    liveness?: ArtifactLiveness;
    derivedFrom?: string[];
    contentType?: string;
    body: string;
    metadata?: Record<string, any>;
}

export class ArtifactLifecycleService {
    constructor(
        private readonly store: PlatformStore,
        private readonly knowledgeIndex?: KnowledgeIndexService,
    ) {}

    async ingest(consumerId: string, input: IngestArtifactInput): Promise<ConsumerArtifact> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }
        const now = new Date().toISOString();
        const artifactId = (input.id || '').trim() ||
            `art-${createHash('sha256').update(`${id}:${input.title || 'untitled'}:${now}:${Math.random()}`).digest('hex').slice(0, 16)}`;

        const artifact: ConsumerArtifact = {
            id: artifactId,
            consumerId: id,
            title: input.title || 'Untitled Artifact',
            origin: input.origin || 'agent',
            custodian: input.custodian || 'staging',
            ktState: input.ktState || 'proposed',
            liveness: input.liveness || 'living',
            derivedFrom: Array.isArray(input.derivedFrom) ? input.derivedFrom : [],
            contentType: input.contentType || 'text/markdown',
            body: input.body || '',
            metadata: input.metadata || {},
            createdAt: now,
            updatedAt: now,
        };

        return await this.store.saveArtifact(artifact);
    }

    async list(consumerId: string, query?: ListArtifactsQuery): Promise<ConsumerArtifact[]> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }
        return await this.store.listArtifacts(id, query);
    }

    async get(consumerId: string, artifactId: string): Promise<ConsumerArtifact | null> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }
        return await this.store.getArtifact(id, artifactId);
    }

    async promote(consumerId: string, artifactId: string): Promise<ConsumerArtifact> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }
        const existing = await this.store.getArtifact(id, artifactId);
        if (!existing) {
            fail('NOT_FOUND', `Artifact ${artifactId} not found`);
        }
        const updated = await this.store.updateArtifactState(id, artifactId, 'approved');
        if (!updated) {
            fail('NOT_FOUND', `Artifact ${artifactId} not found`);
        }

        let promotedTargetPath: string | undefined;
        let promotedSha256: string | undefined;

        // Materialize reverse-extraction artifacts to their canonical sdlc/ target on promotion
        if (
            consumer.root &&
            updated.metadata?.originType === 'reverse-extraction' &&
            typeof updated.metadata?.suggestedTarget === 'string'
        ) {
            const rawTarget = updated.metadata.suggestedTarget.trim();
            const normalizedTarget = rawTarget.replace(/\\/g, '/').replace(/^\.\//, '');
            const hasTraversal = normalizedTarget.split('/').some((seg) => seg === '..');
            if (
                rawTarget &&
                !isAbsolute(rawTarget) &&
                !hasTraversal &&
                normalizedTarget.startsWith('sdlc/')
            ) {
                const rootAbs = resolve(consumer.root);
                const sdlcRootAbs = resolve(rootAbs, 'sdlc');
                const targetAbs = resolve(rootAbs, normalizedTarget);
                const relFromSdlc = relative(sdlcRootAbs, targetAbs);
                const relFromRoot = relative(rootAbs, targetAbs);
                if (
                    relFromSdlc &&
                    !relFromSdlc.startsWith('..') &&
                    !isAbsolute(relFromSdlc) &&
                    relFromRoot &&
                    !relFromRoot.startsWith('..') &&
                    !isAbsolute(relFromRoot)
                ) {
                    mkdirSync(dirname(targetAbs), { recursive: true });
                    atomicWrite(targetAbs, updated.body);
                    promotedTargetPath = relFromRoot.split(sep).join('/');
                    promotedSha256 = createHash('sha256').update(updated.body, 'utf8').digest('hex');
                }
            }
        }

        // update manifest in .harness/knowledge-manifest.json if consumer root has it
        try {
            if (consumer.root && existsSync(join(consumer.root, '.harness', 'knowledge-manifest.json'))) {
                const manifestPath = join(consumer.root, '.harness', 'knowledge-manifest.json');
                const content = JSON.parse(readFileSync(manifestPath, 'utf8'));
                if (!Array.isArray(content.artifacts)) {
                    content.artifacts = [];
                }
                const idx = content.artifacts.findIndex((a: any) => a.id === updated.id);
                const artSummary: Record<string, any> = {
                    id: updated.id,
                    title: updated.title,
                    origin: updated.origin,
                    custodian: updated.custodian,
                    kt_state: updated.ktState,
                    liveness: updated.liveness,
                    content_type: updated.contentType,
                    created_at: updated.createdAt,
                    updated_at: updated.updatedAt,
                };
                if (promotedTargetPath && promotedSha256) {
                    artSummary.target_path = promotedTargetPath;
                    artSummary.sha256 = promotedSha256;
                }
                if (idx >= 0) {
                    content.artifacts[idx] = artSummary;
                } else {
                    content.artifacts.push(artSummary);
                }
                content.generated_at = new Date().toISOString();
                atomicWrite(manifestPath, `${JSON.stringify(content, null, 2)}\n`);
            }
        } catch {
            // best-effort manifest update
        }

        // Best-effort re-index so PostgreSQL knowledge_doc stays synced with promoted files
        if (this.knowledgeIndex) {
            try {
                await this.knowledgeIndex.index(id);
            } catch {
                // best-effort sync
            }
        }

        return updated;
    }
}
