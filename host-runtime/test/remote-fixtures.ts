/**
 * Shared Mode B test fixtures: a snapshot with a remote runtime, a fake ESO control plane that
 * captures observations (and dedupes on idempotencyKey like the real one), and temp workspaces.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSnapshotVersion } from '../src/config-client';
import type { ConfigSnapshot, FetchLike, SnapshotPayload } from '../src/config-client';
import { snapshotPayload, TEST_CONSUMER, TEST_RUNTIME_KEY } from './fixtures';
import { spawnProcess } from '../src/adapters/types';

export { TEST_CONSUMER, TEST_RUNTIME_KEY } from './fixtures';

export const AGY_RUNTIME_KEY = 'agy:agy';
export const REMOTE_SECRET = 'modeb-shared-secret-1234';
export const A_HOST_TOKEN = 'a-host-token-value';
export const B_HOST_TOKEN = 'b-host-token-value';

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export interface FakeEso {
    snapshot: ConfigSnapshot;
    observations: Array<Record<string, any>>;
    snapshotGets: string[];
    fetchImpl: FetchLike;
    setSnapshot(snapshot: ConfigSnapshot): void;
}

export function fakeEso(initialSnapshot: ConfigSnapshot): FakeEso {
    const harness: FakeEso = {
        snapshot: initialSnapshot,
        observations: [],
        snapshotGets: [],
        setSnapshot(snapshot: ConfigSnapshot): void {
            harness.snapshot = snapshot;
        },
        fetchImpl: async (url, init) => {
            const method = init?.method ?? 'GET';
            if (method === 'GET' && url.includes('config-snapshot')) {
                harness.snapshotGets.push(url);
                return json(200, harness.snapshot);
            }
            if (method === 'POST' && url.endsWith('/observations')) {
                const body = JSON.parse(String(init?.body)) as Record<string, any>;
                const existing = harness.observations.find((row) => row.idempotencyKey === body.idempotencyKey);
                if (existing) return json(200, { ok: true, created: false, observation: { ...existing, receivedAt: '2026-11-17T00:00:01.000Z' } });
                const row = { ...body, receivedAt: new Date().toISOString() };
                harness.observations.push(row);
                return json(200, { ok: true, created: true, observation: row });
            }
            if (method === 'GET' && url.includes('/observations')) {
                return json(200, { items: harness.observations });
            }
            return json(404, { code: 'NOT_FOUND', message: `unexpected ${method} ${url}` });
        },
    };
    return harness;
}

/** Snapshot where worker-build may run on either cursor (A) or agy (B), with B's remoteUrl. */
export async function makeModeBSnapshot(
    remoteUrl: string | null,
    overrides: Partial<SnapshotPayload> = {},
    options: { modelTiers?: Record<string, unknown> } = {},
): Promise<ConfigSnapshot> {
    const payload = snapshotPayload({
        consumer: {
            id: TEST_CONSUMER,
            name: TEST_CONSUMER,
            root: '/tmp/remote-consumer-root',
            sdlcRoot: 'sdlc',
            status: 'ready',
            version: 16,
        },
        workerPlacement: [
            {
                workerId: 'worker-scout',
                allowedHosts: [TEST_RUNTIME_KEY, AGY_RUNTIME_KEY],
                modelTier: 'reasoning',
                nativeAgent: { cursor: 'cursor', agy: 'agy' },
                fallback: 'next-host',
            },
            {
                workerId: 'worker-build',
                allowedHosts: [TEST_RUNTIME_KEY, AGY_RUNTIME_KEY],
                modelTier: 'balanced',
                nativeAgent: { cursor: 'cursor', agy: 'agy' },
                fallback: 'next-host',
            },
            {
                workerId: 'worker-verify',
                allowedHosts: [TEST_RUNTIME_KEY, AGY_RUNTIME_KEY],
                modelTier: 'fast',
                nativeAgent: { cursor: 'cursor', agy: 'agy' },
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
                        remoteUrl: null,
                    },
                ],
            },
            {
                hostId: 'agy',
                hostType: 'agy',
                label: 'agy',
                runtimes: [
                    {
                        hostId: 'agy',
                        runtimeId: 'agy',
                        runtimeKey: AGY_RUNTIME_KEY,
                        hostType: 'agy',
                        runtimeKind: 'acp',
                        models: ['gemini-4-argon-medium', 'gemini-4-argon-high'],
                        defaultModel: 'gemini-4-argon-medium',
                        leadEligible: true,
                        health: 'healthy',
                        lastHeartbeat: null,
                        remoteUrl,
                        ...(options.modelTiers ? { modelTiers: options.modelTiers } : {}),
                    },
                ],
            },
        ],
        ...overrides,
    });
    const version = await computeSnapshotVersion(payload);
    return { version, generatedAt: '2026-11-17T00:00:00.000Z', ...payload };
}

export function makeTempDir(prefix = 'host-runtime-remote-'): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function initGitRepo(dir: string): Promise<{ commit: string; branch: string }> {
    const env = { ...process.env };
    const run = async (args: string[]): Promise<string> => {
        const result = await spawnProcess('git', args, { cwd: dir, env, timeoutMs: 15_000 });
        if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.slice(0, 300)}`);
        return result.stdout.trim();
    };
    await run(['init']);
    await run(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--allow-empty', '-m', 'init']);
    const commit = await run(['rev-parse', 'HEAD']);
    const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
    return { commit, branch };
}
