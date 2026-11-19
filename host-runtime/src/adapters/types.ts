/**
 * Adapter contract + shared process plumbing.
 *
 * Adapters are the ONLY place a host process is spawned. They run on the host, never in ESO.
 * `types.ts` also hosts the small shared executable-resolution / process helpers so the adapter
 * directory stays exactly the four files declared by the P3 ticket.
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir as osHomedir, platform as osPlatform } from 'node:os';

export type AdapterName = 'dry' | 'cursor' | 'agy' | 'main-chat';

export interface AdapterRequest {
    workerId: string;
    model: string;
    /** Placement effort (from modelTiers); only adapters that support a flag may use it. */
    effort?: string;
    prompt: string;
    timeoutMs: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
}

export interface AdapterResult {
    adapter: string;
    /** argv used to spawn, or null when nothing was spawned (dry mode / blocked). */
    command: string[] | null;
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
    blocked: boolean;
    dry: boolean;
    reason?: string;
    detail?: string;
}

export interface HostAdapter {
    readonly name: AdapterName | string;
    run(request: AdapterRequest): Promise<AdapterResult>;
}

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_CAPTURE_CHARS = 200_000;
export const KILL_GRACE_MS = 2_000;

export interface ExecutableAdapterOptions {
    env?: Record<string, string | undefined>;
    homeDir?: string;
    platform?: string;
}

/** Resolve a command to an absolute executable path — PATH may not contain the CLI. */
export function resolveExecutable(input: {
    command: string;
    env?: Record<string, string | undefined>;
    homeDir?: string;
    envVar?: string;
    extraCandidates?: string[];
    platform?: string;
}): string | null {
    const env = input.env ?? process.env;
    const homeDir = input.homeDir ?? osHomedir();
    const platform = input.platform ?? osPlatform();
    const candidates: string[] = [];

    const fromEnv = input.envVar ? (env[input.envVar] ?? '').trim() : '';
    if (fromEnv) candidates.push(fromEnv);

    const isWindows = platform === 'win32';
    for (const dir of (env.PATH ?? '').split(isWindows ? ';' : ':')) {
        const trimmed = dir.trim();
        if (trimmed) candidates.push(join(trimmed, input.command));
    }
    for (const candidate of input.extraCandidates ?? []) candidates.push(candidate);

    const seen = new Set<string>();
    for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        try {
            if (!existsSync(candidate)) continue;
            const stats = statSync(candidate);
            if (!stats.isFile()) continue;
            if (!isWindows && (stats.mode & 0o111) === 0) continue;
            return candidate;
        } catch {
            // Unreadable candidate: keep looking.
        }
    }
    return null;
}

export interface ProcessResult {
    ok: boolean;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
    spawnError?: string;
}

export interface SpawnProcessOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
}

function appendCapped(current: string, chunk: string): string {
    const next = current + chunk;
    return next.length > MAX_CAPTURE_CHARS ? next.slice(-MAX_CAPTURE_CHARS) : next;
}

/**
 * Spawn one process, capture bounded stdout/stderr, enforce a timeout (SIGTERM then SIGKILL).
 * Never throws for spawn/timeout failures — the caller turns them into evidence.
 */
export function spawnProcess(command: string, args: string[], options: SpawnProcessOptions = {}): Promise<ProcessResult> {
    const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const startedAt = Date.now();

    return new Promise<ProcessResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        let killTimer: ReturnType<typeof setTimeout> | null = null;

        const clearTimers = () => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            if (killTimer) clearTimeout(killTimer);
        };

        const finish = (result: Omit<ProcessResult, 'durationMs'>) => {
            if (settled) return;
            settled = true;
            clearTimers();
            resolve({ ...result, durationMs: Date.now() - startedAt });
        };

        let child;
        try {
            child = spawn(command, args, {
                cwd: options.cwd,
                env: options.env ?? process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (error) {
            finish({
                ok: false,
                exitCode: null,
                signal: null,
                stdout: '',
                stderr: '',
                timedOut: false,
                spawnError: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            stdout = appendCapped(stdout, chunk);
        });
        child.stderr?.on('data', (chunk: string) => {
            stderr = appendCapped(stderr, chunk);
        });

        child.on('error', (error: Error) => {
            finish({
                ok: false,
                exitCode: null,
                signal: null,
                stdout,
                stderr,
                timedOut,
                spawnError: error.message,
            });
        });

        child.on('close', (code: number | null, signal: string | null) => {
            finish({
                ok: !timedOut && code === 0,
                exitCode: code,
                signal,
                stdout,
                stderr,
                timedOut,
            });
        });

        timeoutTimer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill('SIGTERM');
            } catch {
                // Process already gone.
            }
            killTimer = setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                } catch {
                    // Process already gone.
                }
            }, KILL_GRACE_MS);
        }, timeoutMs);
    });
}

/** Child env must not inherit ESO credentials: adapters call models, they do not talk to ESO. */
export function sanitizeChildEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
    const clean: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
        if (/^ESO_.*TOKEN$/i.test(key) || /^ESO_AUTH_TOKEN$/i.test(key)) continue;
        clean[key] = value;
    }
    return clean;
}

export function blockedResult(input: {
    adapter: string;
    reason: string;
    detail: string;
    command?: string[] | null;
    stderr?: string;
    stdout?: string;
}): AdapterResult {
    return {
        adapter: input.adapter,
        command: input.command ?? null,
        ok: false,
        exitCode: null,
        stdout: input.stdout ?? '',
        stderr: input.stderr ?? '',
        durationMs: 0,
        timedOut: false,
        blocked: true,
        dry: false,
        reason: input.reason,
        detail: input.detail,
    };
}
