/**
 * Phase 5 — P8 checker for HUMAN ↔ AI document mapping.
 *
 * Read-only. A mapping is only trusted when every projection resolves to a human source and does
 * not duplicate its body. Warnings/failures are findings, not silent absences.
 *
 * The rulebook itself lives in `eso/knowledge/src/artifact-contract.mjs`, shared verbatim with the
 * CI merge gate (`scripts/check-artifact-contract.mjs`). This service is the HTTP adapter: resolve
 * the consumer, map its root, delegate the verdict.
 */
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import { buildContractReport, createBodyReader } from '../../../../knowledge/src/artifact-contract.mjs';
import { KnowledgeMappingService } from './knowledge-mapping.service.js';

export class KnowledgeMappingCheckService {
    private readonly mapping: KnowledgeMappingService;

    constructor(private readonly store: PlatformStore) {
        this.mapping = new KnowledgeMappingService(store);
    }

    async check(consumerId: string) {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const result = await this.mapping.mapping(id);
        return buildContractReport({
            consumerId: id,
            docs: result.docs,
            summary: result.summary,
            bodyOf: createBodyReader(consumer.root),
        });
    }
}
