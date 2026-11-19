/**
 * Phase 4 M7 — deterministic evidence score.
 *
 * Score is arithmetic over supplied counts, not an LLM confidence. It explains why a turn/change
 * can be audited; it does not replace a sufficiency verdict.
 */
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

const BASIS_WEIGHT: Record<string, number> = { declared: 0, inferred: 0.33, retrieved: 0.66, verified: 1 };

export interface EvidenceScoreInput {
    verdict?: { level?: string; basis?: string };
    provenance?: { covered?: number; total?: number };
    observations?: { present?: number; required?: number };
    requiredEvidence?: { present?: number; required?: number };
}

function ratio(value: any, label: string): number {
    const present = Number(value?.present ?? value?.covered ?? 0);
    const required = Number(value?.required ?? value?.total ?? 0);
    if (!Number.isFinite(present) || !Number.isFinite(required) || required < 0 || present < 0 || present > required) {
        fail('INVALID_STATE', `${label} must have 0 <= present <= required`);
    }
    return required === 0 ? 0 : present / required;
}

export class EvidenceScoreService {
    constructor(private readonly store: PlatformStore) {}

    async score(consumerId: string, input: EvidenceScoreInput) {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const basis = String(input?.verdict?.basis || 'declared');
        if (!(basis in BASIS_WEIGHT)) fail('INVALID_STATE', 'verdict.basis must be declared|inferred|retrieved|verified');
        const components = {
            verdictBasis: BASIS_WEIGHT[basis],
            provenance: ratio(input?.provenance, 'provenance'),
            observations: ratio(input?.observations, 'observations'),
            requiredEvidence: ratio(input?.requiredEvidence, 'requiredEvidence'),
        };
        const score = Math.round((0.35 * components.verdictBasis + 0.25 * components.provenance + 0.20 * components.observations + 0.20 * components.requiredEvidence) * 100);
        const band = score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low';
        return {
            consumerId: consumer.id,
            score,
            band,
            components,
            verdict: input?.verdict ?? null,
            formula: '0.35*basis + 0.25*provenance + 0.20*observations + 0.20*requiredEvidence',
            note: 'deterministic; shadow only; does not replace the sufficiency verdict',
        };
    }
}
