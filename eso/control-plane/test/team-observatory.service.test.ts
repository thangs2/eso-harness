import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { TeamObservatoryService } from '../src/modules/observatory/team-observatory.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const root = mkdtempSync(join(tmpdir(), 'eso-teamobs-'));
    roots.push(root);
    await store.insertConsumer({
        id: 'team-consumer', name: 'Team', root, sdlcRoot: 'sdlc', schemaName: 'c_team', status: 'ready', version: 1,
        storageMode: 'schema', materializedHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return { service: new TeamObservatoryService(store), store };
}

function observation(id: string, traceId: string, hostId: string, workerId: string, outcome: string) {
    return {
        observationId: id, traceId, hostId, runtimeKey: `${hostId}:runtime`, workerId,
        event: 'worker.completed', outcome, evidence: {}, at: '2026-11-19T00:00:00.000Z', idempotencyKey: id,
    };
}

describe('Phase 4 team observatory', () => {
    it('groups observations by trace across hosts and workers', async () => {
        const { service, store } = await fixture();
        await store.insertObservation('team-consumer', observation('o1', 'trace-1', 'host-a', 'worker-build', 'PASS'));
        await store.insertObservation('team-consumer', observation('o2', 'trace-1', 'host-b', 'worker-verify', 'PASS'));
        await store.insertObservation('team-consumer', observation('o3', 'trace-2', 'host-a', 'worker-build', 'FAIL'));
        const result = await service.summary('team-consumer');
        assert.equal(result.summary.observations, 3);
        assert.equal(result.summary.traces, 2);
        assert.equal(result.summary.hosts, 2);
        assert.equal(result.summary.workers, 2);
        assert.equal(result.traces[0].traceId, 'trace-1');
        assert.deepEqual(result.traces[0].hosts.sort(), ['host-a', 'host-b']);
    });
});
