/**
 * Phase 3 M5/M6 — HUMAN/AI document mapping + freshness.
 *
 * One source, two projections. The human document is the source of truth; an AI projection is
 * derived (`human_sot`). Freshness compares the indexed content hash with the current file hash.
 *
 * Scan/classification/hash rules live in `eso/knowledge/src/artifact-contract.mjs` — the same module
 * the CI merge gate (`scripts/check-artifact-contract.mjs`) runs. Do not re-implement them here.
 */
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import { collectDocuments } from '../../../../knowledge/src/artifact-contract.mjs';

export class KnowledgeMappingService {
    constructor(private readonly store: PlatformStore) {}

    async mapping(consumerId: string) {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const { docs, summary, manifestPresent } = collectDocuments(consumer.root);

        const projections = docs.filter((doc) => doc.representation === 'agent' || doc.humanSot).map((doc) => ({
            aiPath: doc.path,
            humanPath: doc.humanSot,
            sourceOfTruth: doc.sourceOfTruth,
            freshness: doc.freshness,
            inSync: Boolean(doc.humanSot && docs.some((candidate) => candidate.path === doc.humanSot && candidate.freshness === 'fresh')),
        }));

        return {
            consumerId: consumer.id,
            summary,
            manifestPresent,
            projections,
            docs,
        };
    }
}
