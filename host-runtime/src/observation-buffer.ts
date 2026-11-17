/**
 * Local observation buffer (P5).
 *
 * If ESO observation ingest is unavailable, the host must not lose evidence. Failed observations
 * are appended to a JSONL file (per consumer) and replayed later. Replay is safe because the
 * observation body keeps its server-side idempotency key.
 *
 * Flush safety (R7e): a flush atomically claims the buffer with a lock directory + rename
 * (`<file>.flushing`). A concurrent flush sees the claim and skips instead of double-posting.
 * A crash leaves a stale claim, recovered after `claimTtlMs`. Remaining bodies are merged with any
 * observations appended while the flush was in flight, so the rewrite cannot clobber them.
 *
 * Multi-process limitation: the lock is a local-directory claim — it is atomic on one host
 * filesystem, not a distributed lock. Documented in the README.
 *
 * Never stores tokens: the buffer holds observation envelopes only (no prompt, no credentials).
 */

import {
    appendFileSync,
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { ObservationBody } from './observation-client';
import {
    PRIVATE_DIR_MODE,
    PRIVATE_FILE_MODE,
    atomicWriteFile,
    readTextFile,
    resolveCacheDir,
    safeFilePart,
} from './offline-cache';

export const DEFAULT_CLAIM_TTL_MS = 5 * 60 * 1000;

/** Buffer dir: explicit option → ESO_OBS_BUFFER_DIR → <cacheDir>/observations. */
export function resolveBufferDir(
    explicit?: string,
    cacheDir?: string,
    env: Record<string, string | undefined> = process.env,
): string {
    const fromOption = (explicit ?? '').trim();
    if (fromOption) return fromOption;
    const fromEnv = (env.ESO_OBS_BUFFER_DIR ?? '').trim();
    if (fromEnv) return fromEnv;
    return join(resolveCacheDir(cacheDir, env), 'observations');
}

export interface BufferAppendResult {
    buffered: true;
    path: string;
}

export interface BufferClaim {
    claimed: boolean;
    bodies: ObservationBody[];
    claimPath: string;
    reason?: 'empty' | 'claimed';
}

function parseBodies(text: string | null): ObservationBody[] {
    if (!text) return [];
    const bodies: ObservationBody[] = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = JSON.parse(trimmed) as ObservationBody;
            if (parsed && typeof parsed.idempotencyKey === 'string' && typeof parsed.traceId === 'string') {
                bodies.push(parsed);
            }
        } catch {
            // Skip a corrupt line instead of blocking the whole replay.
        }
    }
    return bodies;
}

function bodyKey(body: ObservationBody): string {
    return body.idempotencyKey || JSON.stringify(body);
}

function dedupe(bodies: ObservationBody[]): ObservationBody[] {
    const seen = new Set<string>();
    const result: ObservationBody[] = [];
    for (const body of bodies) {
        const key = bodyKey(body);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(body);
    }
    return result;
}

export class ObservationBuffer {
    readonly filePath: string;
    readonly claimPath: string;
    readonly lockPath: string;
    private readonly claimTtlMs: number;

    constructor(dir: string, consumer: string, options: { claimTtlMs?: number } = {}) {
        this.filePath = join(dir, `observations-${safeFilePart(consumer)}.jsonl`);
        this.claimPath = `${this.filePath}.flushing`;
        this.lockPath = `${this.filePath}.flush.lock`;
        this.claimTtlMs = Math.max(0, options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS);
    }

    append(body: ObservationBody): BufferAppendResult {
        const dir = dirname(this.filePath);
        mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
        appendFileSync(this.filePath, `${JSON.stringify(body)}\n`, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
        try {
            chmodSync(this.filePath, PRIVATE_FILE_MODE);
        } catch {
            // Best effort on filesystems without POSIX modes.
        }
        return { buffered: true, path: this.filePath };
    }

    /** Buffered observation bodies, oldest first. Corrupt lines are skipped. */
    pending(): ObservationBody[] {
        return parseBodies(readTextFile(this.filePath));
    }

    count(): number {
        return this.pending().length;
    }

    replace(bodies: ObservationBody[]): void {
        this.writeBodies(this.filePath, bodies);
    }

    /**
     * Atomically claim the buffer for replay: take the lock, then rename the JSONL to `.flushing`.
     * Returns `claimed:false` when another flush owns the buffer or the buffer is empty.
     */
    claim(now: number = Date.now()): BufferClaim {
        this.recoverStaleClaim(now);
        if (!existsSync(this.filePath)) {
            return { claimed: false, bodies: [], claimPath: this.claimPath, reason: 'empty' };
        }
        if (!this.acquireLock(now)) {
            return { claimed: false, bodies: [], claimPath: this.claimPath, reason: 'claimed' };
        }
        try {
            renameSync(this.filePath, this.claimPath);
        } catch {
            this.releaseLock();
            return { claimed: false, bodies: [], claimPath: this.claimPath, reason: 'claimed' };
        }
        return { claimed: true, bodies: this.readBodies(this.claimPath), claimPath: this.claimPath };
    }

    /** Complete a claimed flush: merge unflushed bodies with anything appended meanwhile. */
    finish(remaining: ObservationBody[]): void {
        try {
            const appendedDuringFlush = this.pending();
            this.writeBodies(this.claimPath, dedupe([...remaining, ...appendedDuringFlush]));
            if (remaining.length === 0 && appendedDuringFlush.length === 0) {
                this.writeBodies(this.filePath, []);
            } else {
                // Keep later flushes working from the canonical file name.
                renameSync(this.claimPath, this.filePath);
            }
        } finally {
            this.removeClaim();
            this.releaseLock();
        }
    }

    /** Restore a claimed buffer after an unexpected flush failure. */
    restore(): void {
        try {
            const claimed = this.readBodies(this.claimPath);
            const appendedDuringFlush = this.pending();
            if (claimed.length || appendedDuringFlush.length) {
                this.writeBodies(this.filePath, dedupe([...claimed, ...appendedDuringFlush]));
            }
        } finally {
            this.removeClaim();
            this.releaseLock();
        }
    }

    private readBodies(path: string): ObservationBody[] {
        try {
            return parseBodies(existsSync(path) ? readFileSync(path, 'utf8') : null);
        } catch {
            return [];
        }
    }

    private writeBodies(path: string, bodies: ObservationBody[]): void {
        const content = bodies.length ? `${bodies.map((body) => JSON.stringify(body)).join('\n')}\n` : '';
        atomicWriteFile(path, content, PRIVATE_FILE_MODE);
    }

    private removeClaim(): void {
        try {
            rmSync(this.claimPath, { force: true });
        } catch {
            // Best effort.
        }
    }

    private acquireLock(now: number): boolean {
        try {
            mkdirSync(this.lockPath, { recursive: false, mode: PRIVATE_DIR_MODE });
            return true;
        } catch {
            // Lock exists: recover it if it is stale (crashed flusher), otherwise skip.
        }
        try {
            const stats = statSync(this.lockPath);
            if (now - stats.mtimeMs > this.claimTtlMs) {
                rmSync(this.lockPath, { recursive: true, force: true });
                mkdirSync(this.lockPath, { recursive: false, mode: PRIVATE_DIR_MODE });
                return true;
            }
        } catch {
            // Lock disappeared or cannot be statted: treat as contended.
        }
        return false;
    }

    private releaseLock(): void {
        try {
            rmSync(this.lockPath, { recursive: true, force: true });
        } catch {
            // Best effort.
        }
    }

    /** Recover a claim left behind by a crashed flusher (claim file + lock dir older than TTL). */
    private recoverStaleClaim(now: number): void {
        if (!existsSync(this.claimPath) || !existsSync(this.lockPath)) return;
        try {
            const stats = statSync(this.lockPath);
            if (now - stats.mtimeMs <= this.claimTtlMs) return;
        } catch {
            return;
        }
        this.restore();
    }
}
