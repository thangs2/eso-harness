/**
 * Worker selection and placement policy — resolved on the host from the config snapshot.
 *
 * A worker definition is host-neutral; placement says which host runtimes may execute it.
 * Nothing here starts or claims anything at ESO: it only decides whether this host runtime is
 * allowed to run the worker for this prompt.
 */

import type { ConfigSnapshot, SnapshotPlacement, SnapshotWorker } from './config-client';
import { entryWorkerId } from './flow-engine';

export type WorkerSelectionSource = 'explicit' | 'flow-entry' | 'fallback';

export interface WorkerSelection {
    worker: SnapshotWorker;
    placement: SnapshotPlacement;
    source: WorkerSelectionSource;
}

export type WorkerPolicyCode = 'WORKER_NOT_FOUND' | 'WORKER_NOT_PLACED' | 'WORKER_PLACEMENT_INVALID';

export class WorkerPolicyError extends Error {
    readonly code: WorkerPolicyCode;

    constructor(code: WorkerPolicyCode, message: string) {
        super(message);
        this.name = 'WorkerPolicyError';
        this.code = code;
    }
}

/** Documented host fallback when the flow has no node to enter from. */
export const FALLBACK_WORKER_ID = 'worker-build';

export function findWorker(snapshot: ConfigSnapshot, workerId: string): SnapshotWorker | null {
    return (snapshot.workers ?? []).find((worker) => worker.id === workerId) ?? null;
}

export function findPlacement(snapshot: ConfigSnapshot, workerId: string): SnapshotPlacement | null {
    return (snapshot.workerPlacement ?? []).find((placement) => placement.workerId === workerId) ?? null;
}

/**
 * Placement allows this runtime when `allowedHosts` is empty (not restricted) or contains the
 * runtime key. Non-empty lists are authoritative — the host does not invent a fallback.
 */
export function placementAllows(placement: SnapshotPlacement, runtimeKey: string): boolean {
    const allowed = placement.allowedHosts ?? [];
    return allowed.length === 0 || allowed.includes(runtimeKey);
}

function selectionFor(
    snapshot: ConfigSnapshot,
    runtimeKey: string,
    workerId: string,
    source: WorkerSelectionSource,
): WorkerSelection {
    const worker = findWorker(snapshot, workerId);
    if (!worker) throw new WorkerPolicyError('WORKER_NOT_FOUND', `Worker not found in config snapshot: ${workerId}`);
    if (worker.status && worker.status !== 'active') {
        throw new WorkerPolicyError('WORKER_NOT_FOUND', `Worker ${workerId} is not active (status=${worker.status})`);
    }
    const placement = findPlacement(snapshot, workerId);
    if (!placement) {
        throw new WorkerPolicyError('WORKER_NOT_PLACED', `No host placement configured for worker: ${workerId}`);
    }
    const allowed = placement.allowedHosts ?? [];
    if (!Array.isArray(allowed)) {
        throw new WorkerPolicyError('WORKER_PLACEMENT_INVALID', `Worker ${workerId} placement.allowedHosts must be an array`);
    }
    if (!placementAllows(placement, runtimeKey)) {
        throw new WorkerPolicyError(
            'WORKER_NOT_PLACED',
            `Worker ${workerId} is not placed on runtime ${runtimeKey} (allowed: ${allowed.join(', ') || 'none'})`,
        );
    }
    return { worker, placement, source };
}

/**
 * Pick the worker for this invocation:
 *   1. explicit `--worker`
 *   2. the flow entry node
 *   3. documented fallback `worker-build`
 */
export function selectWorker(
    snapshot: ConfigSnapshot,
    runtimeKey: string,
    requestedWorkerId?: string | null,
): WorkerSelection {
    const requested = (requestedWorkerId ?? '').trim();
    if (requested) return selectionFor(snapshot, runtimeKey, requested, 'explicit');

    const entry = entryWorkerId(snapshot.flow);
    if (entry) return selectionFor(snapshot, runtimeKey, entry, 'flow-entry');

    return selectionFor(snapshot, runtimeKey, FALLBACK_WORKER_ID, 'fallback');
}

/** Select a specific worker (used for subsequent flow steps selected host-side). */
export function selectWorkerById(snapshot: ConfigSnapshot, runtimeKey: string, workerId: string): WorkerSelection {
    return selectionFor(snapshot, runtimeKey, workerId, 'explicit');
}
