/**
 * Phase 2 judgment facade.
 *
 * ESO computes the sufficiency verdict (control-plane calls the engine); hosts consume it before
 * executing. This is a verdict, not an execution/run control plane.
 */
import { judgeSufficiency } from '../../../../core/src/judge.mjs';
import { formatGapReport } from '../../../../core/src/gaps.mjs';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { Actor } from '../../platform/registry/types.js';

export interface VerdictRequest {
    requirements?: unknown[];
    answers?: unknown[] | Record<string, unknown>;
    host?: Record<string, unknown>;
    actor?: Record<string, unknown>;
    flowId?: string;
    workerId?: string;
    intent?: string;
    enforcement?: 'shadow' | 'enforce';
    mode?: string;
}

export interface VerdictResponse {
    consumerId: string;
    flowId: string | null;
    workerId: string | null;
    intent: string | null;
    enforcement: 'shadow' | 'enforce';
    actor: Record<string, unknown>;
    verdict: Record<string, any>;
    gaps: Record<string, any>;
    wouldBlock: boolean;
    decision: 'allow' | 'block';
}

function actorFor(request: VerdictRequest, authenticated: Actor): Record<string, unknown> {
    const requested = request.actor && typeof request.actor === 'object' ? request.actor : {};
    return {
        ...requested,
        kind: requested.kind ?? authenticated.kind,
        label: requested.label ?? authenticated.label ?? null,
        authenticated_kind: authenticated.kind,
        authenticated_label: authenticated.label ?? null,
    };
}

function gapsFor(verdict: any): Record<string, any> {
    if (!verdict || typeof verdict !== 'object') return { level: 'cannot-judge', total_gaps: 0, gap_items: [] };
    try {
        return formatGapReport(verdict);
    } catch {
        return {
            level: verdict.level,
            total_gaps: Array.isArray(verdict.gaps) ? verdict.gaps.length : 0,
            gap_items: Array.isArray(verdict.gaps) ? verdict.gaps : [],
        };
    }
}

export class JudgmentService {
    constructor(private readonly store: PlatformStore) {}

    async evaluate(consumerId: string, request: VerdictRequest, authenticated: Actor): Promise<VerdictResponse> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        if (consumer.status !== 'ready' && consumer.status !== 'error') fail('INVALID_STATE', `judgment requires ready/error consumer, got ${consumer.status}`);

        const enforcement = request.enforcement === 'enforce' ? 'enforce' : 'shadow';
        const actor = actorFor(request, authenticated);
        const requirements = Array.isArray(request.requirements) ? request.requirements : [];

        let verdict: any;
        try {
            verdict = judgeSufficiency({
                requirements,
                answers: request.answers ?? [],
                actor,
                host: request.host ?? {},
                mode: request.mode ?? null,
                mode_selected_by: request.mode ? 'actor' : 'system',
            });
        } catch (error) {
            fail('INVALID_STATE', error instanceof Error ? error.message : String(error));
        }

        // AC P2-5: cannot-judge never becomes allow/permitted.
        if (verdict.level === 'cannot-judge' && verdict.mode === 'permitted') verdict.mode = 'block';
        if (verdict.level === 'cannot-judge') verdict.mode = 'block';

        const wouldBlock = verdict.level !== 'sufficient';
        const decision = enforcement === 'enforce' && wouldBlock ? 'block' : 'allow';
        return {
            consumerId: consumer.id,
            flowId: request.flowId ?? null,
            workerId: request.workerId ?? null,
            intent: request.intent ?? null,
            enforcement,
            actor,
            verdict,
            gaps: gapsFor(verdict),
            wouldBlock,
            decision,
        };
    }
}
