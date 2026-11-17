/**
 * Local observation buffer (P5).
 *
 * If ESO observation ingest is unavailable, the host must not lose evidence. Failed observations
 * are appended to a JSONL file (per consumer) and replayed later. Replay is safe because the
 * observation body keeps its server-side idempotency key.
 *
 * Never stores tokens: the buffer holds observation envelopes only (no prompt, no credentials).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ObservationBody } from './observation-client';
import { atomicWriteFile, resolveCacheDir, safeFilePart } from './offline-cache';

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

export class ObservationBuffer {
    readonly filePath: string;

    constructor(dir: string, consumer: string) {
        this.filePath = join(dir, `observations-${safeFilePart(consumer)}.jsonl`);
    }

    append(body: ObservationBody): BufferAppendResult {
        mkdirSync(dirname(this.filePath), { recursive: true });
        appendFileSync(this.filePath, `${JSON.stringify(body)}\n`, 'utf8');
        return { buffered: true, path: this.filePath };
    }

    /** Buffered observation bodies, oldest first. Corrupt lines are skipped. */
    pending(): ObservationBody[] {
        if (!existsSync(this.filePath)) return [];
        let text: string;
        try {
            text = readFileSync(this.filePath, 'utf8');
        } catch {
            return [];
        }
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

    count(): number {
        return this.pending().length;
    }

    replace(bodies: ObservationBody[]): void {
        if (!bodies.length) {
            atomicWriteFile(this.filePath, '');
            return;
        }
        atomicWriteFile(this.filePath, `${bodies.map((body) => JSON.stringify(body)).join('\n')}\n`);
    }
}
