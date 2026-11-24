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
import type { JevBand, JevMode } from '../observations/event-contract.js';

export interface JevDecision {
    consumerId: string;
    mode: 'off' | 'shadow' | 'active';
    consent: boolean;
    confidence: number;
    band: 'auto' | 'confirm' | 'open' | null;
    decision: 'auto' | 'confirm' | 'ask' | 'observe';
    reason: string;
}

/** P8 — the consumer defaults, used whenever `.harness/config.json` carries no threshold. */
export const JEV_DEFAULT_AUTO_THRESHOLD = 0.8;
export const JEV_DEFAULT_CONFIRM_THRESHOLD = 0.5;

/** P8 — ESO's adjudication of a host-reported JEV block (`decision.recorded.evidence.jev`). */
export interface JevAdjudication {
    /** Band the reported confidence maps to under the consumer thresholds, or `null` when off. */
    expectedBand: JevBand | null;
    /** `false` only when a band was reported and contradicts the expected one. */
    match: boolean;
    mode: JevMode;
    consent: boolean;
}

function threshold(config: any, key: 'autoThreshold' | 'confirmThreshold', fallback: number): number {
    const value = Number(config?.[key]);
    return Number.isFinite(value) ? value : fallback;
}

/**
 * P8 — adjudicate what the host *reported*, never what ESO wishes it had reported.
 *
 * The reported mode decides whether a band exists at all (`off` ⇒ nothing to verify); the
 * confidence and the consumer's `jevConfig` thresholds (defaults 0.8/0.5) decide the expected
 * band. A report that omits `band` cannot contradict itself, so `match` stays `true` — an absent
 * band is "not reported", not a mismatch. This function never throws and never invents a band.
 */
export function adjudicateReported(consumerRoot: string, reported: unknown): JevAdjudication {
    const config = jevConfig(consumerRoot || '');
    const record = reported && typeof reported === 'object' && !Array.isArray(reported)
        ? reported as Record<string, unknown>
        : {};
    const rawMode = record['mode'];
    const mode: JevMode = rawMode === 'shadow' || rawMode === 'active' ? rawMode : 'off';
    const consent = typeof record['consent'] === 'boolean' ? record['consent'] as boolean : config?.consent === true;
    if (mode === 'off') return { expectedBand: null, match: true, mode, consent };
    const confidence = record['confidence'];
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        return { expectedBand: null, match: true, mode, consent };
    }
    const auto = threshold(config, 'autoThreshold', JEV_DEFAULT_AUTO_THRESHOLD);
    const confirm = threshold(config, 'confirmThreshold', JEV_DEFAULT_CONFIRM_THRESHOLD);
    const expectedBand: JevBand = confidence >= auto ? 'auto' : confidence >= confirm ? 'confirm' : 'open';
    const reportedBand = record['band'];
    const match = typeof reportedBand !== 'string' || reportedBand === expectedBand;
    return { expectedBand, match, mode, consent };
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
