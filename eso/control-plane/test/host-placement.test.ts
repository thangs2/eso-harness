import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import type { ConsumerRecord } from '../src/platform/registry/types.js';
import { PlatformError } from '../src/platform/registry/errors.js';
import { HostRuntimeService } from '../src/modules/host-runtime/host-runtime.service.js';
import { HostTokenService, hashHostToken } from '../src/common/auth/host-token.service.js';
import { ObservationService } from '../src/modules/observations/observation.service.js';
import { ConfigSnapshotService, snapshotVersion } from '../src/modules/config-snapshot/config-snapshot.service.js';

/**
 * Host-placement backend tests (R2) — no database required (MemoryPlatformStore).
 *
 * Run: `cd eso/control-plane && bun test test/host-placement.test.ts`
 */

const NOW = '2026-11-17T00:00:00.000Z';

async function newStore(): Promise<MemoryPlatformStore> {
    const store = new MemoryPlatformStore();
    await store.ensurePlatformSchema();
    return store;
}

async function withConsumer(store: MemoryPlatformStore, id = 'testeso', root = '/tmp/eso-host-placement'): Promise<ConsumerRecord> {
    const record: ConsumerRecord = {
        id,
        name: id,
        root,
        sdlcRoot: null,
        schemaName: `c_${id}`,
        status: 'ready',
        version: 1,
        storageMode: 'schema',
        materializedHash: null,
        createdAt: NOW,
        updatedAt: NOW,
    };
    await store.insertConsumer(record);
    return record;
}

async function expectPlatformError(fn: () => Promise<unknown>, code: string, status: number): Promise<PlatformError> {
    try {
        await fn();
    } catch (error) {
        assert.ok(error instanceof PlatformError, `expected PlatformError, got ${String(error)}`);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return error;
    }
    assert.fail(`expected ${code} (${status}) to be thrown`);
}

describe('HostRuntimeService — host + runtime config', () => {
    test('registers a host and a runtime with runtimeKey/hostType DTO', async () => {
        const store = await newStore();
        const service = new HostRuntimeService(store);
        const host = await service.putHost('cursor', { hostType: 'cursor', label: 'Desk' });
        assert.equal(host.hostId, 'cursor');
        assert.equal(host.hostType, 'cursor');
        assert.equal(host.label, 'Desk');

        const runtime = await service.putHostRuntime('cursor', 'cursor-agent', {
            runtimeKind: 'cli', models: ['m1', 'm2'], defaultModel: 'm1', leadEligible: true, health: 'healthy',
        });
        assert.equal(runtime.hostId, 'cursor');
        assert.equal(runtime.runtimeId, 'cursor-agent');
        assert.equal(runtime.runtimeKey, 'cursor:cursor-agent');
        assert.equal(runtime.hostType, 'cursor');
        assert.deepEqual(runtime.models, ['m1', 'm2']);
        assert.equal(runtime.remoteUrl, null);
        assert.deepEqual(runtime.modelTiers, {});

        const hosts = await service.listHosts();
        assert.equal(hosts.items.length, 1);
        assert.equal(hosts.items[0].runtimes.length, 1);
        assert.equal(hosts.items[0].runtimes[0].runtimeKey, 'cursor:cursor-agent');
    });

    test('rejects invalid hostType / hostId / runtimeId with 422 HOST_RUNTIME_INVALID', async () => {
        const store = await newStore();
        const service = new HostRuntimeService(store);
        await expectPlatformError(() => service.putHost('cursor', { hostType: 'Cursor!' }), 'HOST_RUNTIME_INVALID', 422);
        await expectPlatformError(() => service.putHost('cursor', {}), 'HOST_RUNTIME_INVALID', 422);
        await expectPlatformError(() => service.putHost('has space', { hostType: 'cursor' }), 'HOST_RUNTIME_INVALID', 422);
        await expectPlatformError(() => service.putHost('-leading', { hostType: 'cursor' }), 'HOST_RUNTIME_INVALID', 422);
        await expectPlatformError(() => service.putHost('a'.repeat(65), { hostType: 'cursor' }), 'HOST_RUNTIME_INVALID', 422);
        await service.putHost('cursor', { hostType: 'cursor' });
        await expectPlatformError(
            () => service.putHostRuntime('cursor', 'bad/runtime', { runtimeKind: 'cli' }),
            'HOST_RUNTIME_INVALID', 422,
        );
        await expectPlatformError(
            () => service.putHostRuntime('cursor', 'r'.repeat(65), { runtimeKind: 'cli' }),
            'HOST_RUNTIME_INVALID', 422,
        );
    });

    test('heartbeat validates defaultModel against the effective model catalog', async () => {
        const store = await newStore();
        const service = new HostRuntimeService(store);
        await service.putHost('cursor', { hostType: 'cursor' });
        await service.putHostRuntime('cursor', 'cursor-agent', { runtimeKind: 'cli', models: ['m1', 'm2'], defaultModel: 'm2' });

        const error = await expectPlatformError(
            () => service.heartbeat('cursor', 'cursor-agent', { defaultModel: 'nope' }),
            'HOST_RUNTIME_INVALID', 422,
        );
        assert.match(String(error.detail), /defaultModel must be one of/);
        await expectPlatformError(
            () => service.heartbeat('cursor', 'cursor-agent', { models: ['m1'], defaultModel: 'm2' }),
            'HOST_RUNTIME_INVALID', 422,
        );
        const ok = await service.heartbeat('cursor', 'cursor-agent', { models: ['m1'] });
        assert.equal(ok.defaultModel, 'm1');
        assert.deepEqual(ok.models, ['m1']);
    });

    test('prunes modelTiers when the runtime model catalog shrinks or becomes empty', async () => {
        const store = await newStore();
        const service = new HostRuntimeService(store);
        await service.putHost('cursor', { hostType: 'cursor' });
        const seeded = await service.putHostRuntime('cursor', 'cursor-agent', {
            runtimeKind: 'cli', models: ['m1', 'm2'], defaultModel: 'm1',
            modelTiers: { fast: { model: 'm1', effort: 'low' }, balanced: { model: 'm2' } },
        });
        assert.deepEqual(seeded.modelTiers, { fast: { model: 'm1', effort: 'low' }, balanced: { model: 'm2' } });

        const shrunk = await service.putHostRuntime('cursor', 'cursor-agent', { runtimeKind: 'cli', models: ['m1'] });
        assert.deepEqual(shrunk.modelTiers, { fast: { model: 'm1', effort: 'low' } });

        const cleared = await service.putHostRuntime('cursor', 'cursor-agent', { runtimeKind: 'cli', models: [] });
        assert.deepEqual(cleared.modelTiers, {});
        assert.equal(cleared.defaultModel, '');
    });
});

describe('HostTokenService — scoped host token', () => {
    async function fixture() {
        const store = await newStore();
        await withConsumer(store);
        const hosts = new HostRuntimeService(store);
        await hosts.putHost('cursor', { hostType: 'cursor' });
        await hosts.putHostRuntime('cursor', 'cursor-agent', { runtimeKind: 'cli', models: ['m1'] });
        return { store, tokens: new HostTokenService(store) };
    }

    test('issues a plaintext token once and stores only its sha256 hash', async () => {
        const { store, tokens } = await fixture();
        const issued = await tokens.issue('cursor', 'cursor-agent', 'testeso');
        assert.ok(issued.token.length >= 40);
        assert.equal(issued.hostId, 'cursor');
        assert.equal(issued.runtimeId, 'cursor-agent');
        assert.equal(issued.consumerId, 'testeso');

        assert.equal(await store.getHostTokenByHash(issued.token), null, 'plaintext token must not be a lookup key');
        const row = await store.getHostTokenByHash(hashHostToken(issued.token));
        assert.ok(row, 'hash lookup finds the token');
        assert.equal(row.token_hash, hashHostToken(issued.token));
        assert.notEqual(row.token_hash, issued.token);
    });

    test('authenticates to a scoped host actor and updates last_used_at', async () => {
        const { store, tokens } = await fixture();
        const issued = await tokens.issue('cursor', 'cursor-agent', 'testeso');
        const actor = await tokens.authenticate(issued.token);
        assert.deepEqual(actor, {
            kind: 'host', label: issued.tokenId, hostId: 'cursor', runtimeId: 'cursor-agent', consumerId: 'testeso',
        });
        const row = await store.getHostTokenByHash(hashHostToken(issued.token));
        assert.ok(row.last_used_at, 'last_used_at is touched');
    });

    test('revoked tokens stop authenticating; unknown revoke is 404', async () => {
        const { tokens } = await fixture();
        const issued = await tokens.issue('cursor', 'cursor-agent', 'testeso');
        await expectPlatformError(() => tokens.revoke('cursor', 'cursor-agent', 'ht-missing'), 'HOST_TOKEN_NOT_FOUND', 404);
        await tokens.revoke('cursor', 'cursor-agent', issued.tokenId);
        await expectPlatformError(() => tokens.authenticate(issued.token), 'AUTH_INVALID', 401);
        await expectPlatformError(() => tokens.revoke('cursor', 'cursor-agent', issued.tokenId), 'HOST_TOKEN_NOT_FOUND', 404);
    });

    test('refuses to issue for an unknown runtime, consumer or another host scope', async () => {
        const { tokens } = await fixture();
        await expectPlatformError(() => tokens.issue('cursor', 'missing-runtime', 'testeso'), 'HOST_RUNTIME_NOT_FOUND', 404);
        await expectPlatformError(() => tokens.issue('cursor', 'cursor-agent', 'other'), 'CONSUMER_NOT_FOUND', 404);
        await expectPlatformError(() => tokens.issue('agy', 'agy', 'testeso'), 'HOST_RUNTIME_NOT_FOUND', 404);
    });
});

describe('ObservationService — validated, idempotent observation ingest', () => {
    function validBody(overrides: Record<string, unknown> = {}) {
        return {
            traceId: 'trace-1',
            hostId: 'cursor',
            runtimeKey: 'cursor:cursor-agent',
            event: 'worker.build.done',
            outcome: 'PASS',
            evidence: { summary: 'ok' },
            idempotencyKey: 'idem-1',
            ...overrides,
        };
    }

    async function fixture() {
        const store = await newStore();
        await withConsumer(store);
        return { store, observations: new ObservationService(store) };
    }

    test('ingests once and returns the existing row for the same idempotencyKey', async () => {
        const { store, observations } = await fixture();
        const first = await observations.ingest('testeso', validBody(), { kind: 'operator' });
        assert.equal(first.ok, true);
        assert.equal(first.created, true);
        assert.equal(first.observation.runtimeKey, 'cursor:cursor-agent');
        assert.deepEqual(first.observation.evidence, { summary: 'ok' });

        const second = await observations.ingest('testeso', validBody(), { kind: 'operator' });
        assert.equal(second.created, false);
        assert.equal(second.observation.observationId, first.observation.observationId);
        assert.equal((await observations.list('testeso')).items.length, 1);
        assert.equal((await store.listObservations('testeso')).length, 1);
    });

    test('rejects invalid event, oversized fields and oversize evidence with 422', async () => {
        const { observations } = await fixture();
        await expectPlatformError(
            () => observations.ingest('testeso', validBody({ event: 'bad event!' }), {}),
            'OBSERVATION_INVALID', 422,
        );
        await expectPlatformError(
            () => observations.ingest('testeso', validBody({ event: 'a'.repeat(129) }), {}),
            'OBSERVATION_INVALID', 422,
        );
        await expectPlatformError(
            () => observations.ingest('testeso', validBody({ event: '' }), {}),
            'OBSERVATION_INVALID', 422,
        );
        await expectPlatformError(
            () => observations.ingest('testeso', validBody({ outcome: 'o'.repeat(65), idempotencyKey: 'idem-outcome' }), {}),
            'OBSERVATION_INVALID', 422,
        );
        await expectPlatformError(
            () => observations.ingest('testeso', validBody({ traceId: 't'.repeat(201), idempotencyKey: 'idem-trace' }), {}),
            'OBSERVATION_INVALID', 422,
        );
        const oversize = await expectPlatformError(
            () => observations.ingest('testeso', validBody({ evidence: { data: 'x'.repeat(33000) }, idempotencyKey: 'idem-big' }), {}),
            'OBSERVATION_INVALID', 422,
        );
        assert.match(String(oversize.detail), /32768 bytes/);
        await expectPlatformError(
            () => observations.ingest('testeso', validBody({ evidence: 'not-an-object', idempotencyKey: 'idem-str' }), {}),
            'OBSERVATION_INVALID', 422,
        );
    });

    test('accepts JSON array evidence within the byte limit', async () => {
        const { observations } = await fixture();
        const result = await observations.ingest('testeso', validBody({ evidence: [{ kind: 'verify', status: 'PASS' }], idempotencyKey: 'idem-array' }), {});
        assert.equal(result.created, true);
        assert.deepEqual(result.observation.evidence, [{ kind: 'verify', status: 'PASS' }]);
    });

    test('host token scope must match consumer and runtimeKey', async () => {
        const { observations } = await fixture();
        const actor = { kind: 'host', consumerId: 'testeso', hostId: 'cursor', runtimeId: 'cursor-agent' };
        await expectPlatformError(
            () => observations.ingest('testeso', validBody({ runtimeKey: 'agy:agy', hostId: 'agy', idempotencyKey: 'idem-scope' }), actor),
            'AUTH_INVALID', 401,
        );
        await expectPlatformError(
            () => observations.ingest('other', validBody({ idempotencyKey: 'idem-consumer' }), actor),
            'CONSUMER_NOT_FOUND', 404,
        );
        const okay = await observations.ingest('testeso', validBody({ idempotencyKey: 'idem-scope-ok' }), actor);
        assert.equal(okay.created, true);
    });
});

describe('ConfigSnapshotService — normalization and stable version', () => {
    test('normalizes hostBindings (no hostPluginId) and nativeAgent keys to runtimeKey', async () => {
        const store = await newStore();
        const root = mkdtempSync(join(tmpdir(), 'eso-snapshot-test-'));
        try {
            mkdirSync(join(root, '.harness'), { recursive: true });
            writeFileSync(join(root, '.harness', 'config.json'), JSON.stringify({
                profile: {
                    settings: {
                        harness: { hostProfiles: [{ id: 'hp-1', hostPluginId: 'cursor', stackVersion: 1 }] },
                        knowledge: { providers: { routing: { work: 'md', design: 'md' } } },
                    },
                },
            }), 'utf8');
            await withConsumer(store, 'testeso', root);
            const hosts = new HostRuntimeService(store);
            await hosts.putHost('cursor', { hostType: 'cursor' });
            await hosts.putHostRuntime('cursor', 'cursor-agent', { runtimeKind: 'cli', models: ['m1'] });
            await store.upsertWorkerHostPolicy('testeso', 'w1', {
                allowedHosts: ['cursor:cursor-agent'],
                modelTier: 'balanced',
                nativeAgent: { cursor: 'cursor' },
                fallback: 'next-host',
            });
            const flowFiles: any = {
                defaultFlow: async () => ({ id: 'flow-1', name: 'Flow', version: 1, status: 'published', nodes: [{ workerId: 'w1' }], edges: [] }),
            };
            const workerFiles: any = { read: async () => ({ workers: [{ id: 'w1', name: 'Build' }], edges: [], flow: null }) };
            const snapshot = new ConfigSnapshotService(store, flowFiles, workerFiles, hosts);

            const first = await snapshot.get('testeso');
            assert.equal(first.hostBindings.length, 1);
            assert.equal(first.hostBindings[0].hostId, 'cursor');
            assert.equal('hostPluginId' in first.hostBindings[0], false);
            assert.equal(first.hostBindings[0].hostPluginId, undefined);
            assert.deepEqual(Object.keys(first.workerPlacement[0].nativeAgent), ['cursor:cursor-agent']);
            assert.deepEqual(first.providerRouting, { work: 'md', design: 'md' });
            assert.equal(first.hosts[0].runtimes[0].runtimeKey, 'cursor:cursor-agent');
            assert.equal(first.flow.nodes.length, 1);
            assert.ok(!JSON.stringify(first).includes('hostPluginId'), 'serialized snapshot must not expose hostPluginId');

            assert.match(first.version, /^[0-9a-f]{64}$/);
            const second = await snapshot.get('testeso');
            assert.equal(second.version, first.version, 'version is stable for identical content');
            assert.equal(second.version, snapshotVersion({
                consumer: first.consumer,
                flow: first.flow,
                workers: first.workers,
                workerPlacement: first.workerPlacement,
                hosts: first.hosts,
                hostBindings: first.hostBindings,
                stackVersion: first.stackVersion,
                providerRouting: first.providerRouting,
            }));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('Observation retention', () => {
    test('prunes observations older than the retention cutoff', async () => {
        const store = await newStore();
        await withConsumer(store);
        await store.insertObservation('testeso', {
            observationId: 'obs-retention-1',
            traceId: 'trace-retention',
            hostId: 'cursor',
            runtimeKey: 'cursor:cursor-agent',
            event: 'worker.completed',
            outcome: 'PASS',
            evidence: {},
            idempotencyKey: 'retention-1',
        });
        assert.equal((await store.listObservations('testeso')).length, 1);
        const removed = await store.pruneObservations('testeso', new Date(Date.now() + 60_000).toISOString());
        assert.equal(removed, 1);
        assert.equal((await store.listObservations('testeso')).length, 0);
    });
});
