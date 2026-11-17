import { describe, expect, it } from 'bun:test';
import {
    ConfigClient,
    ConfigClientError,
    computeSnapshotVersion,
    computeSnapshotVersionEsoCompatible,
    findHostRuntime,
    splitRuntimeKey,
    validateSnapshotVersion,
} from '../src/config-client';
import type { FetchLike, SnapshotPayload } from '../src/config-client';
import { makeSnapshot, snapshotPayload, TEST_RUNTIME_KEY } from './fixtures';
import { makeTempDir } from './remote-fixtures';

describe('config-client', () => {
    it('computes the same version regardless of object key order', async () => {
        const payload = snapshotPayload();
        const reordered = JSON.parse(JSON.stringify(payload)) as SnapshotPayload;
        reordered.consumer = { version: reordered.consumer.version, status: reordered.consumer.status, sdlcRoot: reordered.consumer.sdlcRoot, root: reordered.consumer.root, name: reordered.consumer.name, id: reordered.consumer.id };
        expect(await computeSnapshotVersion(reordered)).toBe(await computeSnapshotVersion(payload));
    });

    it('validates a matching snapshot version', async () => {
        const snapshot = await makeSnapshot();
        const validation = await validateSnapshotVersion(snapshot);
        expect(validation.ok).toBe(true);
        expect(validation.actual).toBe(snapshot.version);
        expect(validation.expected).toBe(snapshot.version);
    });

    it('accepts the ESO Date-collapse canonicalization for host liveness timestamps', async () => {
        const payload = snapshotPayload();
        const runtime = payload.hosts[0].runtimes[0];
        runtime.lastHeartbeat = '2026-11-17T11:26:29.618Z';
        const version = await computeSnapshotVersionEsoCompatible(payload);
        // The live control plane hashes the heartbeat Date as {} — the strict JSON hash differs.
        expect(await computeSnapshotVersion(payload)).not.toBe(version);
        const snapshot = { version, generatedAt: '2026-11-17T00:00:00.000Z', ...payload };
        const validation = await validateSnapshotVersion(snapshot);
        expect(validation.ok).toBe(true);
        expect(validation.canonicalization).toBe('eso-date-collapse');
    });

    it('rejects a tampered snapshot', async () => {
        const snapshot = await makeSnapshot();
        if (snapshot.flow) snapshot.flow.name = 'tampered';
        const validation = await validateSnapshotVersion(snapshot);
        expect(validation.ok).toBe(false);
        expect(validation.reason).toContain('does not match');
    });

    it('rejects a missing or malformed version', async () => {
        const snapshot = await makeSnapshot();
        const missing = await validateSnapshotVersion({ ...snapshot, version: '' });
        expect(missing.ok).toBe(false);
        const malformed = await validateSnapshotVersion({ ...snapshot, version: 'not-a-hash' });
        expect(malformed.ok).toBe(false);
    });

    it('finds a host runtime by runtimeKey and splits runtime keys', async () => {
        const snapshot = await makeSnapshot();
        const runtime = findHostRuntime(snapshot, TEST_RUNTIME_KEY);
        expect(runtime?.runtimeId).toBe('cursor-agent');
        expect(findHostRuntime(snapshot, 'agy:agy')).toBe(null);
        expect(splitRuntimeKey(TEST_RUNTIME_KEY)).toEqual({ hostId: 'cursor', runtimeId: 'cursor-agent' });
        expect(() => splitRuntimeKey('cursor')).toThrow();
    });

    it('fetches the snapshot with auth, caching the ETag for a 304', async () => {
        const snapshot = await makeSnapshot();
        const calls: { url: string; headers: Record<string, string> }[] = [];
        let responseIndex = 0;
        const fetchImpl: FetchLike = async (url, init) => {
            calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
            responseIndex += 1;
            if (responseIndex === 1) {
                return new Response(JSON.stringify(snapshot), {
                    status: 200,
                    headers: { 'content-type': 'application/json', etag: snapshot.version },
                });
            }
            return new Response(null, { status: 304, headers: { etag: snapshot.version } });
        };

        const client = new ConfigClient({
            baseUrl: 'http://cp.test/',
            consumer: 'testeso',
            runtimeKey: TEST_RUNTIME_KEY,
            token: 'secret-token',
            fetchImpl,
        });

        const first = await client.getSnapshot();
        expect(first.version).toBe(snapshot.version);
        expect(calls[0].url).toBe('http://cp.test/api/v1/consumers/testeso/config-snapshot?runtimeKey=cursor%3Acursor-agent');
        expect(calls[0].headers.authorization).toBe('Bearer secret-token');

        const second = await client.getSnapshot({ useEtag: true });
        expect(second.version).toBe(snapshot.version);
        expect(calls[1].headers['if-none-match']).toBe(snapshot.version);
    });

    it('maps HTTP errors to typed ConfigClientError', async () => {
        const fetchImpl: FetchLike = async () =>
            new Response(JSON.stringify({ code: 'AUTH_INVALID', message: 'Invalid credentials' }), {
                status: 401,
                headers: { 'content-type': 'application/json' },
            });
        const client = new ConfigClient({ baseUrl: 'http://cp.test', consumer: 'testeso', runtimeKey: TEST_RUNTIME_KEY, fetchImpl });
        try {
            await client.getSnapshot();
            throw new Error('expected getSnapshot to throw');
        } catch (error) {
            expect(error instanceof ConfigClientError).toBe(true);
            expect((error as ConfigClientError).code).toBe('AUTH_INVALID');
            expect((error as ConfigClientError).status).toBe(401);
        }
    });

    it('reports an unreachable control plane', async () => {
        const temp = makeTempDir('hr-cfg-');
        const fetchImpl: FetchLike = async () => {
            throw new Error('connection refused');
        };
        const client = new ConfigClient({
            baseUrl: 'http://cp.test',
            consumer: 'testeso',
            runtimeKey: TEST_RUNTIME_KEY,
            fetchImpl,
            cacheDir: temp.dir,
        });
        try {
            await client.getSnapshot();
            throw new Error('expected getSnapshot to throw');
        } catch (error) {
            expect(error instanceof ConfigClientError).toBe(true);
            expect((error as ConfigClientError).code).toBe('CONFIG_SNAPSHOT_UNREACHABLE');
        } finally {
            temp.cleanup();
        }
    });
});
