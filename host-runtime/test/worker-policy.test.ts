import { describe, expect, it } from 'bun:test';
import { FALLBACK_WORKER_ID, placementAllows, selectWorker, selectWorkerById } from '../src/worker-policy';
import { makeSnapshot, TEST_RUNTIME_KEY } from './fixtures';
import type { SnapshotPayload } from '../src/config-client';

function expectCode(fn: () => unknown, code: string): void {
    try {
        fn();
        throw new Error(`expected ${code}`);
    } catch (error) {
        expect((error as { code?: string }).code).toBe(code);
    }
}

describe('worker-policy', () => {
    it('uses an explicit worker', async () => {
        const snapshot = await makeSnapshot();
        const selection = selectWorker(snapshot, TEST_RUNTIME_KEY, 'worker-verify');
        expect(selection.worker.id).toBe('worker-verify');
        expect(selection.source).toBe('explicit');
        expect(selection.placement.modelTier).toBe('fast');
    });

    it('falls back to the flow entry worker', async () => {
        const snapshot = await makeSnapshot();
        const selection = selectWorker(snapshot, TEST_RUNTIME_KEY);
        expect(selection.worker.id).toBe('worker-scout');
        expect(selection.source).toBe('flow-entry');
    });

    it('falls back to worker-build when the flow is missing', async () => {
        const snapshot = await makeSnapshot({ flow: null });
        const selection = selectWorker(snapshot, TEST_RUNTIME_KEY);
        expect(selection.worker.id).toBe(FALLBACK_WORKER_ID);
        expect(selection.source).toBe('fallback');
    });

    it('rejects an unknown worker', async () => {
        const snapshot = await makeSnapshot();
        expectCode(() => selectWorker(snapshot, TEST_RUNTIME_KEY, 'worker-nope'), 'WORKER_NOT_FOUND');
    });

    it('rejects an inactive worker', async () => {
        const payload: Partial<SnapshotPayload> = {
            workers: [{ id: 'worker-build', status: 'retired' }],
            workerPlacement: [{ workerId: 'worker-build', allowedHosts: [TEST_RUNTIME_KEY] }],
        };
        const snapshot = await makeSnapshot(payload);
        expectCode(() => selectWorker(snapshot, TEST_RUNTIME_KEY, 'worker-build'), 'WORKER_NOT_FOUND');
    });

    it('rejects a worker without placement', async () => {
        const snapshot = await makeSnapshot({ workerPlacement: [] });
        expectCode(() => selectWorker(snapshot, TEST_RUNTIME_KEY, 'worker-build'), 'WORKER_NOT_PLACED');
    });

    it('rejects a worker not placed on this runtime', async () => {
        const snapshot = await makeSnapshot({
            workerPlacement: [{ workerId: 'worker-build', allowedHosts: ['agy:agy'] }],
        });
        expectCode(() => selectWorker(snapshot, TEST_RUNTIME_KEY, 'worker-build'), 'WORKER_NOT_PLACED');
    });

    it('treats an empty allowedHosts list as unrestricted', async () => {
        const snapshot = await makeSnapshot({
            workerPlacement: [{ workerId: 'worker-build', allowedHosts: [] }],
        });
        const selection = selectWorker(snapshot, TEST_RUNTIME_KEY, 'worker-build');
        expect(selection.worker.id).toBe('worker-build');
        expect(placementAllows(selection.placement, TEST_RUNTIME_KEY)).toBe(true);
    });

    it('selects a specific worker by id for the next flow step', async () => {
        const snapshot = await makeSnapshot();
        expect(selectWorkerById(snapshot, TEST_RUNTIME_KEY, 'worker-verify').worker.id).toBe('worker-verify');
    });
});
