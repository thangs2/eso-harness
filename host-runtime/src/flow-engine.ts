/**
 * Pure flow evaluation — shared semantics, evaluated on the HOST only.
 *
 * The flow is read from the ESO config snapshot; ESO never evaluates it, never starts a run and
 * never advances a step. There is no run state here: `nextEdge` is a pure function of
 * (flow, workerId, outcome).
 */

import type { SnapshotFlow, SnapshotFlowEdge } from './config-client';

export type FlowOutcome = 'PASS' | 'FAIL' | 'BLOCKED';

/** First node of the flow (a node no edge points at), falling back to the first declared node. */
export function entryWorkerId(flow: SnapshotFlow | null | undefined): string | null {
    const nodes = flow?.nodes ?? [];
    if (!nodes.length) return null;
    const targeted = new Set((flow?.edges ?? []).map((edge) => edge.to));
    const entries = nodes.filter((node) => !targeted.has(node.workerId));
    return (entries[0] ?? nodes[0]).workerId;
}

function edgeOutcome(edge: SnapshotFlowEdge): string {
    if (typeof edge.on === 'string' && edge.on) return edge.on.toUpperCase();
    if (edge.condition?.kind === 'outcome') {
        return String(edge.condition.equals ?? '').toUpperCase();
    }
    return '';
}

function edgeMatches(edge: SnapshotFlowEdge, outcome: string): boolean {
    const wanted = String(outcome ?? '').toUpperCase();
    if (edgeOutcome(edge) === wanted) return true;
    // A condition kind other than `outcome` is not something the host can evaluate offline.
    return false;
}

/**
 * Next edge from `workerId` for `outcome`, honouring `priority` (lower wins; declaration order
 * breaks ties). Returns null when the flow has no such edge — the host stops there.
 */
export function nextEdge(
    flow: SnapshotFlow | null | undefined,
    workerId: string,
    outcome: FlowOutcome | string,
): SnapshotFlowEdge | null {
    const edges = (flow?.edges ?? []).filter((edge) => edge.from === workerId && edgeMatches(edge, outcome));
    if (!edges.length) return null;
    return edges
        .map((edge, index) => ({ edge, index }))
        .sort((left, right) => {
            const leftPriority = Number.isFinite(left.edge.priority) ? Number(left.edge.priority) : 0;
            const rightPriority = Number.isFinite(right.edge.priority) ? Number(right.edge.priority) : 0;
            if (leftPriority !== rightPriority) return leftPriority - rightPriority;
            return left.index - right.index;
        })[0].edge;
}

/** Worker id the flow advances to, or null. */
export function nextWorkerId(
    flow: SnapshotFlow | null | undefined,
    workerId: string,
    outcome: FlowOutcome | string,
): string | null {
    return nextEdge(flow, workerId, outcome)?.to ?? null;
}

/** Workers declared in the flow, in node order. */
export function flowWorkerIds(flow: SnapshotFlow | null | undefined): string[] {
    return (flow?.nodes ?? []).map((node) => node.workerId);
}
