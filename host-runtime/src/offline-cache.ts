/**
 * Local cache helpers for host-side hardening (P5).
 *
 * The control plane can be offline; the host must keep working from the last valid config
 * snapshot. This module owns the cache directory convention, safe file names and atomic writes.
 * No token is ever written here — caches key on consumer + runtimeKey only.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ConfigSnapshot } from './config-client';

export const DEFAULT_CACHE_DIR = join(homedir(), '.eso', 'host-runtime');
export const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Cache root: explicit option → ESO_CONFIG_CACHE_DIR → ~/.eso/host-runtime. */
export function resolveCacheDir(explicit?: string, env: Record<string, string | undefined> = process.env): string {
    const fromOption = (explicit ?? '').trim();
    if (fromOption) return fromOption;
    const fromEnv = (env.ESO_CONFIG_CACHE_DIR ?? '').trim();
    return fromEnv || DEFAULT_CACHE_DIR;
}

/** One path segment that cannot escape the directory or collide on `:`/`/`. */
export function safeFilePart(value: string): string {
    return (value || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
}

/** Write a file atomically (tmp in the same directory + rename). */
export function atomicWriteFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, path);
}

/** Read a UTF-8 file, returning null instead of throwing. */
export function readTextFile(path: string): string | null {
    try {
        return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
        return null;
    }
}

export function removeFile(path: string): void {
    try {
        rmSync(path, { force: true });
    } catch {
        // Best effort.
    }
}

export type SnapshotCacheErrorCode =
    | 'SNAPSHOT_CACHE_MISSING'
    | 'SNAPSHOT_CACHE_INVALID'
    | 'SNAPSHOT_CACHE_SCOPE_MISMATCH'
    | 'SNAPSHOT_CACHE_STALE';

export interface CacheLoadSuccess {
    ok: true;
    snapshot: ConfigSnapshot;
    cachedAt: string;
    ageMs: number;
}

export interface CacheLoadFailure {
    ok: false;
    code: SnapshotCacheErrorCode;
    reason: string;
}

export type CacheLoadResult = CacheLoadSuccess | CacheLoadFailure;

interface SnapshotCacheFile {
    cacheVersion: 1;
    consumer: string;
    runtimeKey: string;
    cachedAt: string;
    snapshot: ConfigSnapshot;
}

const CACHE_VERSION = 1;

/** Last-valid config snapshot on disk, keyed per consumer + runtimeKey (never by token). */
export class SnapshotCache {
    readonly filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    static filePathFor(cacheDir: string, consumer: string, runtimeKey: string): string {
        return join(cacheDir, `config-snapshot-${safeFilePart(consumer)}-${safeFilePart(runtimeKey)}.json`);
    }

    save(consumer: string, runtimeKey: string, snapshot: ConfigSnapshot): void {
        const payload: SnapshotCacheFile = {
            cacheVersion: CACHE_VERSION,
            consumer,
            runtimeKey,
            cachedAt: new Date().toISOString(),
            snapshot,
        };
        atomicWriteFile(this.filePath, JSON.stringify(payload));
    }

    load(consumer: string, runtimeKey: string, now: () => number = () => Date.now()): CacheLoadResult {
        const text = readTextFile(this.filePath);
        if (text === null) {
            return { ok: false, code: 'SNAPSHOT_CACHE_MISSING', reason: 'no cached snapshot for this consumer/runtime' };
        }
        let parsed: SnapshotCacheFile;
        try {
            parsed = JSON.parse(text) as SnapshotCacheFile;
        } catch {
            return { ok: false, code: 'SNAPSHOT_CACHE_INVALID', reason: 'cached snapshot is not valid JSON' };
        }
        if (!parsed || parsed.cacheVersion !== CACHE_VERSION) {
            return { ok: false, code: 'SNAPSHOT_CACHE_INVALID', reason: 'cached snapshot has an unsupported cache version' };
        }
        if (parsed.consumer !== consumer || parsed.runtimeKey !== runtimeKey) {
            return {
                ok: false,
                code: 'SNAPSHOT_CACHE_SCOPE_MISMATCH',
                reason: 'cached snapshot belongs to another consumer/runtime',
            };
        }
        const snapshot = parsed.snapshot;
        if (!snapshot || typeof snapshot.version !== 'string' || !snapshot.version) {
            return { ok: false, code: 'SNAPSHOT_CACHE_INVALID', reason: 'cached snapshot has no version' };
        }
        if (!snapshot.consumer || snapshot.consumer.id !== consumer) {
            return { ok: false, code: 'SNAPSHOT_CACHE_INVALID', reason: 'cached snapshot consumer does not match' };
        }
        if (!Array.isArray(snapshot.workers) || !Array.isArray(snapshot.hosts)) {
            return { ok: false, code: 'SNAPSHOT_CACHE_INVALID', reason: 'cached snapshot is missing workers/hosts arrays' };
        }
        const cachedAtMs = Date.parse(parsed.cachedAt);
        if (Number.isNaN(cachedAtMs)) {
            return { ok: false, code: 'SNAPSHOT_CACHE_INVALID', reason: 'cached snapshot has an invalid cachedAt' };
        }
        return {
            ok: true,
            snapshot,
            cachedAt: parsed.cachedAt,
            ageMs: Math.max(0, now() - cachedAtMs),
        };
    }

    clear(): void {
        removeFile(this.filePath);
    }
}
