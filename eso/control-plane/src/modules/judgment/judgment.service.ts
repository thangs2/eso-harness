/**
 * Phase 2 judgment facade.
 *
 * ESO computes the sufficiency verdict (control-plane calls the engine); hosts consume it before
 * executing. This is a verdict, not an execution/run control plane.
 */
import { judgeSufficiency } from '../../../../core/src/judge.mjs';
import { deriveRequirements } from '../../../../core/src/derive.mjs';
import { formatGapReport } from '../../../../core/src/gaps.mjs';
import { evaluateRoleSufficiency } from '../../../../iam/src/role.mjs';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { Actor } from '../../platform/registry/types.js';

export interface VerdictRequest {
    requirements?: unknown[];
    answers?: unknown[] | Record<string, unknown>;
    host?: Record<string, unknown>;
    actor?: Record<string, unknown>;
    /** Optional role definition (name + bar). `request.actor.role` wins when both are present. */
    role?: Record<string, unknown>;
    /** Evidence used to decide role sufficiency. Defaults to actor.evidence / []. */
    roleEvidence?: unknown[];
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
    /** Per-actor sufficiency (P4/P6). Present when a role or an explicit actor is supplied. */
    role_sufficiency: Record<string, any> | null;
    verdict: Record<string, any>;
    gaps: Record<string, any>;
    wouldBlock: boolean;
    decision: 'allow' | 'block';
}

function actorFor(request: VerdictRequest, authenticated: Actor): Record<string, unknown> {
    const requested = request.actor && typeof request.actor === 'object' ? request.actor : {};
    const { kind: _ignoredKind, role: requestedRoleField, requestedRole, ...rest } = requested;
    const advisoryRole = requestedRole ?? requestedRoleField;
    return {
        ...rest,
        ...(advisoryRole !== undefined ? { requestedRole: advisoryRole } : {}),
        kind: authenticated.kind,
        label: requested.label ?? authenticated.label ?? null,
        authenticated_kind: authenticated.kind,
        authenticated_label: authenticated.label ?? null,
    };
}

function normalizeWorkerBar(rawBar: unknown): Array<{ evidence_kind: string; min_basis: string }> | null {
    let parsed: unknown = rawBar;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(parsed)) return null;
    const items: Array<{ evidence_kind: string; min_basis: string }> = [];
    for (const item of parsed) {
        if (item && typeof item === 'object') {
            const entry = item as Record<string, unknown>;
            const kind = typeof entry.evidence_kind === 'string' && entry.evidence_kind.trim()
                ? entry.evidence_kind.trim()
                : (typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind.trim() : '');
            if (!kind) continue;
            const minBasis = typeof entry.min_basis === 'string' && entry.min_basis.trim()
                ? entry.min_basis.trim()
                : (typeof entry.minBasis === 'string' && entry.minBasis.trim()
                    ? entry.minBasis.trim()
                    : 'verified');
            items.push({ evidence_kind: kind, min_basis: minBasis });
        } else if (typeof item === 'string' && item.trim()) {
            items.push({ evidence_kind: item.trim(), min_basis: 'verified' });
        }
    }
    return items;
}

async function resolveStoreRole(
    store: PlatformStore,
    consumerId: string,
    workerId?: string,
): Promise<Record<string, any> | null> {
    const trimmed = typeof workerId === 'string' ? workerId.trim() : '';
    if (!trimmed || typeof store.knowledgeWorker !== 'function') return null;
    const worker = await store.knowledgeWorker(consumerId, trimmed);
    if (!worker || typeof worker !== 'object') return null;
    const bar = normalizeWorkerBar(worker.bar);
    if (!bar || bar.length === 0) return null;
    const name = String(worker.role || worker.name || worker.worker_id || trimmed).trim();
    return { name, bar, source: 'store' };
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

/** P6 — resolve a usable role definition from the request/actor. */
function roleDefinition(request: VerdictRequest, actor: Record<string, any>): Record<string, any> | null {
    const candidates = [request.role, (request.actor as any)?.role, actor.requestedRole];
    for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object' && Array.isArray((candidate as any).bar)) {
            return candidate as Record<string, any>;
        }
    }
    return null;
}

/** P6 — a role named without a bar (bare string / `{name}`) has identity but sufficiency cannot be judged. */
function roleName(request: VerdictRequest, actor: Record<string, any>): string | null {
    const candidates = [request.role, (request.actor as any)?.role, actor.requestedRole];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        if (candidate && typeof candidate === 'object' && typeof (candidate as any).name === 'string' && (candidate as any).name.trim()) {
            return String((candidate as any).name).trim();
        }
    }
    return null;
}

function roleEvidenceFor(request: VerdictRequest, actor: Record<string, any>): unknown[] {
    if (Array.isArray(request.roleEvidence)) return request.roleEvidence;
    if (Array.isArray((request.actor as any)?.evidence)) return (request.actor as any).evidence;
    if (Array.isArray(actor.evidence)) return actor.evidence;
    return [];
}

const LEVEL_RANK: Record<string, number> = {
    'cannot-judge': 0,
    insufficient: 1,
    partial: 2,
    unsurfaced: 3,
    sufficient: 4,
};

/**
 * P4/P6 — role evidence that is not SUFFICIENT must never leave a `sufficient` verdict standing.
 * The gap entry names the role deficits so the caller sees what is missing, not just "blocked".
 */
function applyRoleDowngrade(verdict: Record<string, any>, roleSufficiency: Record<string, any>, identity: string | null): void {
    const deficits: any[] = Array.isArray(roleSufficiency.deficits) ? roleSufficiency.deficits : [];
    const unknownActor = roleSufficiency.code === 'UNKNOWN_ACTOR';
    const targetLevel = unknownActor ? 'cannot-judge' : 'insufficient';

    if ((LEVEL_RANK[verdict.level] ?? 0) > (LEVEL_RANK[targetLevel] ?? 0)) verdict.level = targetLevel;
    if (verdict.mode === 'permitted' || verdict.mode === 'do') verdict.mode = 'ask';
    verdict.cannot_judge_reason = verdict.cannot_judge_reason ?? (unknownActor ? 'unknown_actor' : 'role_insufficient');
    verdict.assurance = 'DEGRADED';

    const deficitSummary = deficits
        .map((deficit) => `${deficit.evidence_kind}:${deficit.reason}`)
        .join(', ');

    verdict.gaps = Array.isArray(verdict.gaps) ? verdict.gaps : [];
    verdict.gaps.push({
        what: `role:${roleSufficiency.role || identity || 'unknown'}`,
        source: 'bar',
        exists: unknownActor ? 'unknown' : 'absent',
        where_hint: unknownActor ? 'actor không khai role/bar nên không chấm được per-actor' : `role bar thiếu: ${deficitSummary || 'không rõ'}`,
        min_basis: deficits[0]?.required_basis ?? 'declared',
        actual_basis: deficits[0]?.actual_basis ?? 'none',
        dangling_source: false,
        code: unknownActor ? 'UNKNOWN_ACTOR' : 'ROLE_INSUFFICIENT',
        role: roleSufficiency.role ?? identity ?? null,
        deficits,
    });
}

const VALID_REQUIREMENT_BASES = new Set(['declared', 'inferred', 'retrieved', 'verified']);

function normalizeRequirementBasis(raw: unknown, fallback: 'declared' | 'inferred' | 'retrieved' | 'verified' = 'verified'): string {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (VALID_REQUIREMENT_BASES.has(trimmed)) return trimmed;
    if (trimmed === 'strict') return 'verified';
    return fallback;
}

async function deriveDefaultRequirements(
    store: PlatformStore,
    consumerId: string,
    storeRole: Record<string, any> | null,
): Promise<unknown[]> {
    const seenSubjects = new Set<string>();
    const bar: Array<{ subject: string; asks: string; min_basis: string; source: 'bar'; where_hint: string }> = [];
    if (storeRole && Array.isArray(storeRole.bar)) {
        const roleLabel = String(storeRole.name || 'worker').trim();
        for (const item of storeRole.bar) {
            const subject = typeof item?.evidence_kind === 'string' ? item.evidence_kind.trim() : '';
            if (!subject || seenSubjects.has(subject)) continue;
            seenSubjects.add(subject);
            bar.push({
                subject,
                asks: subject,
                min_basis: normalizeRequirementBasis(item.min_basis, 'verified'),
                source: 'bar',
                where_hint: `worker:${roleLabel} bar (${subject})`,
            });
        }
    }

    const declared: Array<{ subject: string; asks: string; min_basis: string; source: 'declared'; where_hint: string }> = [];
    if (typeof store.knowledgeDocs === 'function') {
        try {
            const docs = await store.knowledgeDocs(consumerId, undefined, 20);
            if (Array.isArray(docs)) {
                for (const doc of docs) {
                    if (!doc || typeof doc !== 'object') continue;
                    const status = typeof doc.status === 'string' ? doc.status.trim().toLowerCase() : '';
                    if (status === 'retired' || status === 'deprecated') continue;
                    const subject = String(doc.path || doc.doc_id || '').trim();
                    if (!subject || seenSubjects.has(subject)) continue;
                    seenSubjects.add(subject);
                    declared.push({
                        subject,
                        asks: String(doc.title || doc.type || 'contract').trim() || 'contract',
                        min_basis: normalizeRequirementBasis(doc.min_basis, 'retrieved'),
                        source: 'declared',
                        where_hint: subject,
                    });
                }
            }
        } catch {
            // Knowledge index may not be provisioned yet; fail closed via remaining derived requirements.
        }
    }

    return deriveRequirements({ bar, declared, blast: [] });
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
        // P4/P6 — per-actor sufficiency. Server-configured worker role/bar (when workerId is
        // present in store) always takes precedence over client-supplied request.role / actor.role
        // so a client cannot downgrade its own bar.
        const storeRole = await resolveStoreRole(this.store, id, request.workerId);

        let requirements: unknown[];
        try {
            if (request.requirements !== undefined) {
                requirements = Array.isArray(request.requirements) ? request.requirements : [];
            } else {
                requirements = await deriveDefaultRequirements(this.store, id, storeRole);
            }
        } catch (error) {
            fail('INVALID_STATE', error instanceof Error ? error.message : String(error));
        }

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

        const role = storeRole ?? roleDefinition(request, actor);
        const identity = role ? null : roleName(request, actor);
        const actorDeclared = Boolean(request.actor && typeof request.actor === 'object');
        let roleSufficiency: Record<string, any> | null = null;
        if (role || identity || actorDeclared) {
            roleSufficiency = evaluateRoleSufficiency({
                role: role ?? (identity ? { name: identity } : undefined),
                evidence: roleEvidenceFor(request, actor),
            });
            verdict.role_sufficiency = roleSufficiency;
            if (roleSufficiency.level !== 'SUFFICIENT') applyRoleDowngrade(verdict, roleSufficiency, identity);
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
            role_sufficiency: roleSufficiency,
            verdict,
            gaps: gapsFor(verdict),
            wouldBlock,
            decision,
        };
    }
}
