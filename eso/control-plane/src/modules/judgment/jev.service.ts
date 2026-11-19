/**
 * JEV decision facade (Phase 2).
 *
 * JEV selects a decision band from a supplied confidence. It is NOT the P4 sufficiency judge and
 * must never replace a verdict. It does not invent confidence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { Actor } from '../../platform/registry/types.js';

export interface JevDecision {
    consumerId: string;
    mode: 'off' | 'shadow' | 'active';
    consent: boolean;
    confidence: number;
    band: 'auto' | 'confirm' | 'open' | null;
    decision: 'auto' | 'confirm' | 'ask' | 'observe';
    reason: string;
}

function jevConfig(root: string): any {
    try {
        const config = JSON.parse(readFileSync(join(root, '.harness', 'config.json'), 'utf8'));
        const profile = config?.profile?.profile ?? config?.profile ?? {};
        return profile?.integration?.jev ?? { mode: 'off' };
    } catch {
        return { mode: 'off' };
    }
}

export class JevService {
    constructor(private readonly store: PlatformStore) {}

    async decide(consumerId: string, input: any, actor: Actor = { kind: 'operator', label: 'jev' }): Promise<JevDecision> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const config = jevConfig(consumer.root);
        const mode = config?.mode === 'shadow' || config?.mode === 'active' ? config.mode : 'off';
        const consent = config?.consent === true;
        const confidence = Number(input?.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail('INVALID_STATE', 'confidence must be between 0 and 1');
        if (mode === 'off') {
            const decision: JevDecision = { consumerId: consumer.id, mode, consent, confidence, band: null, decision: 'ask', reason: 'JEV mode off' };
            await this.audit(consumer.id, decision, actor);
            return decision;
        }
        if (!consent) fail('INVALID_STATE', 'JEV shadow/active requires observation consent');
        const auto = config?.autoThreshold === undefined ? 0.8 : Number(config.autoThreshold);
        const confirm = config?.confirmThreshold === undefined ? 0.5 : Number(config.confirmThreshold);
        const band = confidence >= auto ? 'auto' : confidence >= confirm ? 'confirm' : 'open';
        if (mode === 'shadow') {
            const decision: JevDecision = { consumerId: consumer.id, mode, consent, confidence, band, decision: 'observe', reason: `shadow: would ${band}` };
            await this.audit(consumer.id, decision, actor);
            return decision;
        }
        const decision = band === 'auto' ? 'auto' : band === 'confirm' ? 'confirm' : 'ask';
        const result: JevDecision = { consumerId: consumer.id, mode, consent, confidence, band, decision, reason: `active: ${band}` };
        await this.audit(consumer.id, result, actor);
        return result;
    }

    private async audit(consumerId: string, decision: JevDecision, actor: Actor): Promise<void> {
        await this.store.appendEvent({
            consumerId,
            eventType: 'updated',
            actorKind: actor.kind,
            actorLabel: actor.label || 'jev',
            at: new Date().toISOString(),
            detail: { jevDecision: decision },
        });
    }
}
