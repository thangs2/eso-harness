/**
 * Snapshot fixtures shaped exactly like the live P2 config-snapshot contract.
 * The version is recomputed so `validateSnapshotVersion` accepts them.
 */

import { computeSnapshotVersion } from '../src/config-client';
import type { ConfigSnapshot, SnapshotPayload } from '../src/config-client';

export const TEST_RUNTIME_KEY = 'cursor:cursor-agent';
export const TEST_CONSUMER = 'testeso';

export function snapshotPayload(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
    const payload: SnapshotPayload = {
        consumer: {
            id: TEST_CONSUMER,
            name: TEST_CONSUMER,
            root: '/tmp/test-eso',
            sdlcRoot: 'sdlc',
            status: 'ready',
            version: 16,
        },
        flow: {
            id: 'that-tinh-tran',
            name: '7 Tinh Tran',
            version: 1,
            status: 'published',
            nodes: [
                { workerId: 'worker-scout', x: 60, y: 50 },
                { workerId: 'worker-build', x: 540, y: 50 },
                { workerId: 'worker-verify', x: 540, y: 210 },
            ],
            edges: [
                {
                    id: 'e-scout-build',
                    from: 'worker-scout',
                    to: 'worker-build',
                    on: 'PASS',
                    condition: { kind: 'outcome', equals: 'PASS' },
                    priority: 0,
                },
                { id: 'e-build-verify', from: 'worker-build', to: 'worker-verify', on: 'PASS', priority: 0 },
                { id: 'e-verify-build', from: 'worker-verify', to: 'worker-build', on: 'FAIL', priority: 0 },
            ],
        },
        workers: [
            { id: 'worker-scout', name: 'Scout', role: 'scout', layer: 'peer', status: 'active', instructions: 'scout instructions' },
            { id: 'worker-build', name: 'Build', role: 'build', layer: 'peer', status: 'active', instructions: 'build instructions' },
            { id: 'worker-verify', name: 'Verify', role: 'verify', layer: 'gate', status: 'active', instructions: 'verify instructions' },
        ],
        workerPlacement: [
            {
                workerId: 'worker-scout',
                allowedHosts: [TEST_RUNTIME_KEY],
                modelTier: 'reasoning',
                nativeAgent: { cursor: 'cursor' },
                fallback: 'next-host',
            },
            {
                workerId: 'worker-build',
                allowedHosts: [TEST_RUNTIME_KEY],
                modelTier: 'balanced',
                nativeAgent: { cursor: 'cursor' },
                fallback: 'next-host',
            },
            {
                workerId: 'worker-verify',
                allowedHosts: [TEST_RUNTIME_KEY],
                modelTier: 'fast',
                nativeAgent: { cursor: 'cursor' },
                fallback: 'next-host',
            },
        ],
        hosts: [
            {
                hostId: 'cursor',
                hostType: 'cursor',
                label: 'cursor',
                runtimes: [
                    {
                        hostId: 'cursor',
                        runtimeId: 'cursor-agent',
                        runtimeKey: TEST_RUNTIME_KEY,
                        hostType: 'cursor',
                        runtimeKind: 'cli',
                        models: ['auto', 'gpt-5.3-codex'],
                        defaultModel: 'auto',
                        leadEligible: true,
                        health: 'healthy',
                        lastHeartbeat: null,
                    },
                ],
            },
        ],
        hostBindings: [],
        stackVersion: { version: 1, status: 'published' },
        providerRouting: {},
    };
    return { ...payload, ...overrides };
}

export async function makeSnapshot(overrides: Partial<SnapshotPayload> = {}): Promise<ConfigSnapshot> {
    const payload = snapshotPayload(overrides);
    const version = await computeSnapshotVersion(payload);
    return { version, generatedAt: '2026-11-17T00:00:00.000Z', ...payload };
}
