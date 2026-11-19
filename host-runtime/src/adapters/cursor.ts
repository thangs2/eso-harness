/**
 * Cursor adapter — Mode A deterministic CLI.
 *
 * Spawns the Cursor agent CLI on the host:
 *   <cursor-agent> --trust -p --model <model> <prompt>
 * `--trust` avoids the interactive workspace-trust prompt in non-interactive `-p` mode.
 * `cursor-agent` is frequently NOT on PATH (it lives in Cursor's agent-cli folder), so the binary
 * is resolved explicitly. Nothing here runs on ESO.
 *
 * Effort: the Cursor CLI has no `--effort` flag, so this adapter NEVER invents one. Cursor encodes
 * effort in parameterized model ids (e.g. `claude-opus-4-8[context=1m,effort=high]`); when the
 * resolved model already carries `effort=`, it is left untouched. Otherwise the effort is recorded
 * in evidence only (model resolution + observation evidence).
 */

import { join } from 'node:path';
import type { AdapterRequest, AdapterResult, ExecutableAdapterOptions, HostAdapter } from './types';
import { DEFAULT_TIMEOUT_MS, blockedResult, resolveExecutable, sanitizeChildEnv, spawnProcess } from './types';

export const CURSOR_AGENT_ENV_VAR = 'ESO_CURSOR_AGENT_BIN';

/** Absolute locations known to ship the Cursor agent CLI (PATH is often missing it). */
export function cursorAgentCandidates(homeDir: string): string[] {
    return [
        join(
            homeDir,
            'Library',
            'Application Support',
            'Cursor',
            'User',
            'globalStorage',
            'anysphere.cursor-agent-worker',
            'agent-cli',
            '.local',
            'bin',
            'cursor-agent',
        ),
        join(homeDir, '.cursor', 'bin', 'cursor-agent'),
        join(homeDir, '.local', 'bin', 'cursor-agent'),
    ];
}

export class CursorAdapter implements HostAdapter {
    readonly name = 'cursor';
    private readonly options: ExecutableAdapterOptions;

    constructor(options: ExecutableAdapterOptions = {}) {
        this.options = options;
    }

    /** Absolute path to the CLI, or null when it cannot be found. */
    resolve(): string | null {
        return resolveExecutable({
            command: 'cursor-agent',
            env: this.options.env,
            homeDir: this.options.homeDir ?? process.env.HOME ?? '',
            envVar: CURSOR_AGENT_ENV_VAR,
            extraCandidates: cursorAgentCandidates(this.options.homeDir ?? process.env.HOME ?? ''),
            platform: this.options.platform,
        });
    }

    async run(request: AdapterRequest): Promise<AdapterResult> {
        const executable = this.resolve();
        if (!executable) {
            return blockedResult({
                adapter: this.name,
                reason: 'ADAPTER_UNAVAILABLE',
                detail: `cursor-agent not found (checked ${CURSOR_AGENT_ENV_VAR}, PATH and Cursor agent-cli folders)`,
            });
        }

        // Deliberately no --effort: cursor-agent does not support it (effort lives in the model id).
        const args = ['--trust', '-p', '--model', request.model, request.prompt];
        const result = await spawnProcess(executable, args, {
            cwd: request.cwd,
            env: sanitizeChildEnv(request.env ?? this.options.env ?? process.env),
            timeoutMs: request.timeoutMs || DEFAULT_TIMEOUT_MS,
        });

        return {
            adapter: this.name,
            // Prompt arg is masked: adapter results are logged and must not carry the prompt body.
            command: [executable, '--trust', '-p', '--model', request.model, '<prompt>'],
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
