/**
 * BR-05 — durable knowledge needs a human approval record.
 *
 * Agents (`machine`) may propose, never approve. A machine that tries to approve is escalated with
 * `NEEDS_APPROVAL`; any other non-human actor is denied with `FORBIDDEN_ACTOR`. Both codes come
 * from sdlc/06.analysis/02.ac/AC-20.md and AC-24.md.
 */
import { fail } from '../../platform/registry/errors.js';
import type { Actor } from '../../platform/registry/types.js';

export type KnowledgeStatus = 'proposed' | 'approved' | 'rejected';

export type ApprovalDecision = 'approve' | 'reject';

export interface ApprovalStamp {
    status: KnowledgeStatus;
    createdBy: string;
    createdAt: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    rejectedBy?: string | null;
    rejectedAt?: string | null;
    rejectReason?: string | null;
}

/** Only a human operator is a valid approver. Machine attempts escalate; anything else is denied. */
export function assertApprover(actor: Actor): void {
    if (actor?.kind === 'operator') return;
    if (actor?.kind === 'machine') {
        fail('NEEDS_APPROVAL', 'a machine may propose but a human operator must approve');
    }
    const kind = (actor as Actor | undefined)?.kind;
    if (!kind) fail('UNKNOWN_ACTOR', 'actor identity is missing');
    fail('FORBIDDEN_ACTOR', `actor kind '${String(kind)}' cannot approve`);
}

/**
 * The one state machine for `proposed → approved | rejected`.
 *
 * Actor check comes first so an agent attempting to approve a record still gets
 * `NEEDS_APPROVAL` (not a state error), and a failed decision never mutates the stored record.
 */
export function applyDecision<T extends ApprovalStamp>(
    record: T,
    decision: ApprovalDecision,
    actor: Actor,
    at: string,
    reason?: string | null,
): T {
    assertApprover(actor);
    if (record.status !== 'proposed') {
        fail('INVALID_STATE', `record is ${record.status}, not proposed`);
    }
    const by = actor.label || actor.kind;
    if (decision === 'approve') {
        return {
            ...record,
            status: 'approved',
            approvedBy: by,
            approvedAt: at,
            rejectedBy: null,
            rejectedAt: null,
            rejectReason: null,
        };
    }
    return {
        ...record,
        status: 'rejected',
        approvedBy: null,
        approvedAt: null,
        rejectedBy: by,
        rejectedAt: at,
        rejectReason: reason ?? null,
    };
}
