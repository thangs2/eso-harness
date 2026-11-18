import { describe, expect, it } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigClient, ConfigClientError } from '../src/config-client';
import type { FetchLike } from '../src/config-client';
import { SnapshotCache, resolveCacheDir, safeFilePart } from '../src/offline-cache';
import { fakeEso, makeModeBSnapshot, makeTempDir, TEST_CONSUMER, TEST_RUNTIME_KEY } from './remote-fixtures';
import { validateSnapshotVersion } from '../src/config-client';

async function snapshotFor(remoteUrl = 'http://127.0.0.1:8788') {
    const snapshot = await makeModeBSnapshot(remoteUrl);
    const validation = await validateSnapshotVersion(snapshot);
    expect(validation.ok).toBe(true);
    return snapshot;
}

function cachingClient(cacheDir: string, fetchImpl: FetchLike, overrides: Partial<ConfigClientOptions> = {}): ConfigClient {
    return new ConfigClient({
        baseUrl: 'http://cp.test',
        consumer: TEST_CONSUMER,
        runtimeKey: TEST_RUNTIME_KEY,
        fetchImpl,
        cacheDir,
        ...overrides,
    });
}

type ConfigClientOptions = ConstructorParameters<typeof ConfigClient>[0];

async function expectClientCode(fn: () => Promise<unknown>, code: string): Promise<void> {
    try {
        await fn();
        throw new Error(`expected ConfigClientError ${code}`);
    } catch (error) {
        expect(error instanceof ConfigClientError).toBe(true);
        expect((error as ConfigClientError).code).toBe(code);
    }
}

describe('offline config snapshot cache', () => {
    it('persists the last valid snapshot atomically, without tokens', async () => {
        const temp = makeTempDir('hr-cache-');
        const snapshot = await snapshotFor();
        const fake = fakeEso(snapshot);
        const client = cachingClient(temp.dir, fake.fetchImpl, { token: 'secret-host-token-abc' });
        try {
            const fetched = await client.getSnapshot();
            expect(client.lastSource).toBe('network');
            client.saveSnapshot(fetched);

            const file = join(temp.dir, `config-snapshot-${safeFilePart(TEST_CONSUMER)}-${safeFilePart(TEST_RUNTIME_KEY)}.json`);
            expect(client.cacheFilePath()).toBe(file);
            const text = readFileSync(file, 'utf8');
            expect(text.includes('secret-host-token-abc')).toBe(false);
            const parsed = JSON.parse(text) as { cacheVersion: number; consumer: string; runtimeKey: string; cachedAt: string; snapshot: { version: string } };
            expect(parsed.cacheVersion).toBe(1);
            expect(parsed.consumer).toBe(TEST_CONSUMER);
            expect(parsed.runtimeKey).toBe(TEST_RUNTIME_KEY);
            expect(parsed.snapshot.version).toBe(snapshot.version);
            expect(Number.isNaN(Date.parse(parsed.cachedAt))).toBe(false);
        } finally {
            temp.cleanup();
        }
    });

    it('falls back to the cache when the control plane is unreachable', async () => {
        const temp = makeTempDir('hr-cache-');
        const snapshot = await snapshotFor();
        try {
            const online = cachingClient(temp.dir, fakeEso(snapshot).fetchImpl);
            online.saveSnapshot(await online.getSnapshot());

            const offlineFetch: FetchLike = async () => {
                throw new Error('connection refused');
            };
            const client = cachingClient(temp.dir, offlineFetch);
            const fallback = await client.getSnapshot();
            expect(fallback.version).toBe(snapshot.version);
            expect(client.lastSource).toBe('cache');
            expect(client.lastCacheAgeMs).not.toBe(null);
            expect(client.lastWarning).toContain('SNAPSHOT_CACHE_USED');
        } finally {
            temp.cleanup();
        }
    });

    it('falls back on 5xx but never on 401', async () => {
        const temp = makeTempDir('hr-cache-');
        const snapshot = await snapshotFor();
        try {
            cachingClient(temp.dir, fakeEso(snapshot).fetchImpl).saveSnapshot(snapshot);
            const fiveHundred: FetchLike = async () => new Response('{"code":"BOOM","message":"boom"}', { status: 503 });
            const fallback = await cachingClient(temp.dir, fiveHundred).getSnapshot();
            expect(fallback.version).toBe(snapshot.version);

            const unauthorized: FetchLike = async () =>
                new Response('{"code":"AUTH_INVALID","message":"Invalid credentials"}', { status: 401 });
            const client = cachingClient(temp.dir, unauthorized);
            await expectClientCode(() => client.getSnapshot(), 'AUTH_INVALID');
            expect(client.lastSource).toBe(null);
        } finally {
            temp.cleanup();
        }
    });

    it('offline mode uses the cache and never touches the network', async () => {
        const temp = makeTempDir('hr-cache-');
        const snapshot = await snapshotFor();
        try {
            cachingClient(temp.dir, fakeEso(snapshot).fetchImpl).saveSnapshot(snapshot);
            let calls = 0;
            const failingFetch: FetchLike = async () => {
                calls += 1;
                throw new Error('must not be called');
            };
            const client = cachingClient(temp.dir, failingFetch, { offline: true });
            const cached = await client.getSnapshot();
            expect(cached.version).toBe(snapshot.version);
            expect(calls).toBe(0);
            expect(client.lastSource).toBe('cache');
        } finally {
            temp.cleanup();
        }
    });

    it('offline mode fails with exit-worthy errors when the cache is missing, stale or corrupt', async () => {
        const temp = makeTempDir('hr-cache-');
        try {
            await expectClientCode(
                () => cachingClient(temp.dir, async () => new Response('', { status: 500 }), { offline: true }).getSnapshot(),
                'SNAPSHOT_CACHE_MISSING',
            );

            const snapshot = await snapshotFor();
            const writer = cachingClient(temp.dir, fakeEso(snapshot).fetchImpl);
            writer.saveSnapshot(snapshot);

            await expectClientCode(
                () =>
                    cachingClient(temp.dir, async () => new Response('', { status: 500 }), {
                        offline: true,
                        cacheMaxAgeMs: 1000,
                        nowImpl: () => Date.now() + 60_000,
                    }).getSnapshot(),
                'SNAPSHOT_CACHE_STALE',
            );

            const corrupt = cachingClient(temp.dir, async () => new Response('', { status: 500 }));
            writeFileSync(corrupt.cacheFilePath(), '{not json', 'utf8');
            await expectClientCode(
                () => cachingClient(temp.dir, async () => new Response('', { status: 500 }), { offline: true }).getSnapshot(),
                'SNAPSHOT_CACHE_INVALID',
            );
            // Online + corrupt cache still surfaces the real network failure.
            await expectClientCode(
                () => cachingClient(temp.dir, async () => {
                    throw new Error('offline');
                }).getSnapshot(),
                'CONFIG_SNAPSHOT_UNREACHABLE',
            );
        } finally {
            temp.cleanup();
        }
    });

    it('never uses a cache written for another consumer/runtimeKey', async () => {
        const temp = makeTempDir('hr-cache-');
        const snapshot = await snapshotFor();
        try {
            const cache = new SnapshotCache(SnapshotCache.filePathFor(temp.dir, TEST_CONSUMER, TEST_RUNTIME_KEY));
            // Tamper the scope even though the file path matched: scope check must reject it.
            cache.save(TEST_CONSUMER, 'agy:agy', snapshot);
            await expectClientCode(
                () => cachingClient(temp.dir, async () => new Response('', { status: 503 }), { offline: true }).getSnapshot(),
                'SNAPSHOT_CACHE_SCOPE_MISMATCH',
            );
        } finally {
            temp.cleanup();
        }
    });

    it('writes cache files 0600 and directories 0700 (R7f)', async () => {
        if (process.platform === 'win32') return;
        const temp = makeTempDir('hr-cache-');
        const snapshot = await snapshotFor();
        const cacheDir = join(temp.dir, 'private', 'cache');
        try {
            const client = cachingClient(cacheDir, fakeEso(snapshot).fetchImpl);
            client.saveSnapshot(await client.getSnapshot());
            expect(statSync(client.cacheFilePath()).mode & 0o777).toBe(0o600);
            expect(statSync(cacheDir).mode & 0o777).toBe(0o700);
        } finally {
            temp.cleanup();
        }
    });

    it('online 5xx fallback returns the cache without rewriting cachedAt (R6)', async () => {
        const temp = makeTempDir('hr-cache-');
        const snapshot = await snapshotFor();
        try {
            const writer = cachingClient(temp.dir, fakeEso(snapshot).fetchImpl);
            writer.saveSnapshot(await writer.getSnapshot());
            const before = readFileSync(writer.cacheFilePath(), 'utf8');

            const fiveHundred: FetchLike = async () => new Response('{"code":"BOOM","message":"boom"}', { status: 503 });
            const client = cachingClient(temp.dir, fiveHundred);
            const fallback = await client.getSnapshot();
            expect(fallback.version).toBe(snapshot.version);
            expect(client.lastSource).toBe('cache');
            const after = readFileSync(writer.cacheFilePath(), 'utf8');
            expect(after).toBe(before);
            expect((JSON.parse(after) as { cachedAt: string }).cachedAt).toBe((JSON.parse(before) as { cachedAt: string }).cachedAt);
        } finally {
            temp.cleanup();
        }
    });

    it('resolves the cache dir from options and the environment', () => {
        expect(resolveCacheDir('/tmp/explicit', {})).toBe('/tmp/explicit');
        expect(resolveCacheDir(undefined, { ESO_CONFIG_CACHE_DIR: '/tmp/env-dir' })).toBe('/tmp/env-dir');
        expect(resolveCacheDir(undefined, {}).endsWith(join('.harness', 'runtime'))).toBe(true);
    });

    it('keeps the cache valid across host token rotation and never persists a token', async () => {
        const temp = makeTempDir('hr-cache-');
        const snapshot = await snapshotFor();
        try {
            const oldClient = cachingClient(temp.dir, fakeEso(snapshot).fetchImpl, { token: 'old-host-token-111' });
            oldClient.saveSnapshot(await oldClient.getSnapshot());
            const cacheText = readFileSync(oldClient.cacheFilePath(), 'utf8');
            expect(cacheText.includes('old-host-token-111')).toBe(false);

            const rotated = cachingClient(temp.dir, async () => {
                throw new Error('rotated token must not matter offline');
            }, { token: 'new-host-token-222', offline: true });
            const cached = await rotated.getSnapshot();
            expect(cached.version).toBe(snapshot.version);
            expect(readFileSync(oldClient.cacheFilePath(), 'utf8').includes('new-host-token-222')).toBe(false);
        } finally {
            temp.cleanup();
        }
    });
});
