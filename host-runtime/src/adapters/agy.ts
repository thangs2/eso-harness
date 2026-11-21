/**
 * AGY adapter — Mode A deterministic CLI.
 *
 * Spawns the Antigravity CLI on the host:
 *   <agy> --model <model> [-p <prompt>]
 * The prompt must be the value of `-p`; the CLI otherwise treats the next flag as the prompt.
 * Nothing here runs on ESO.
 */

import { join } from 'node:path';
import type { AdapterRequest, AdapterResult, ExecutableAdapterOptions, HostAdapter } from './types';
import { DEFAULT_TIMEOUT_MS, blockedResult, resolveExecutable, sanitizeChildEnv, spawnProcess } from './types';

export const AGY_ENV_VAR = 'ESO_AGY_BIN';

/** Effort values the AGY CLI accepts (`agy --effort`). */
export const AGY_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function agyEffortArgs(effort: string | undefined): string[] {
    const value = (effort ?? '').trim().toLowerCase();
    return (AGY_EFFORT_VALUES as readonly string[]).includes(value) ? ['--effort', value] : [];
}

export function agyCandidates(homeDir: string): string[] {
    return [join(homeDir, '.gemini', 'bin', 'agy'), join(homeDir, '.local', 'bin', 'agy')];
}

export class AgyAdapter implements HostAdapter {
    readonly name = 'agy';
    private readonly options: ExecutableAdapterOptions;

    constructor(options: ExecutableAdapterOptions = {}) {
        this.options = options;
    }

    resolve(): string | null {
        return resolveExecutable({
            command: 'agy',
            env: this.options.env,
            homeDir: this.options.homeDir ?? process.env.HOME ?? '',
            envVar: AGY_ENV_VAR,
            extraCandidates: agyCandidates(this.options.homeDir ?? process.env.HOME ?? ''),
            platform: this.options.platform,
        });
    }

    async run(request: AdapterRequest): Promise<AdapterResult> {
        const executable = this.resolve();
        if (!executable) {
            return blockedResult({
                adapter: this.name,
                reason: 'ADAPTER_UNAVAILABLE',
                detail: `agy not found (checked ${AGY_ENV_VAR}, PATH and ~/.gemini/bin)`,
            });
        }

        const effortArgs = agyEffortArgs(request.effort);
        const args = ['--model', request.model, ...effortArgs, '-p', request.prompt];
        const result = await spawnProcess(executable, args, {
            cwd: request.cwd,
            // The host-runtime already emits the Mode A prompt/worker observations.
            // Prevent the child AGY hook from double-posting the worker prompt.
            env: sanitizeChildEnv({ ...(request.env ?? this.options.env ?? process.env), ESO_OBSERVE_DISABLED: '1' }),
            timeoutMs: request.timeoutMs || DEFAULT_TIMEOUT_MS,
        });

        return {
            adapter: this.name,
            command: [executable, '--model', request.model, ...effortArgs, '-p', '<prompt>'],
            ok: result.ok,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
            blocked: Boolean(result.spawnError),
            dry: false,
            reason: result.spawnError ? 'ADAPTER_UNAVAILABLE' : undefined,
            detail: result.spawnError,
        };
    }
}
