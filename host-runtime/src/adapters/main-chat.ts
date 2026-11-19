/**
 * Main-chat adapter — last-resort fallback to the DSH headless model.
 *
 * The host owns execution: this spawns the locally installed DSH CLI in headless mode.
 * It is used only after provider adapters are exhausted (quota/auth/transport).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterRequest, AdapterResult, ExecutableAdapterOptions, HostAdapter } from './types';
import { DEFAULT_TIMEOUT_MS, blockedResult, resolveExecutable, sanitizeChildEnv, spawnProcess } from './types';

export const MAIN_CHAT_ENV_VAR = 'ESO_MAIN_CHAT_BIN';

export function mainChatCandidates(homeDir: string): string[] {
    return [join(homeDir, '.local', 'bin', 'dsh')];
}

/** The DSH desktop stores model keys in ~/.dsh/.credentials.yaml refs. Never log this value. */
function resolveDeepSeekKey(homeDir: string): string {
    const fromEnv = (process.env.DEEPSEEK_API_KEY ?? '').trim();
    if (fromEnv) return fromEnv;
    try {
        const text = readFileSync(join(homeDir, '.dsh', '.credentials.yaml'), 'utf8');
        const match = text.match(/^\s*DEEPSEEK_API_KEY:\s*(.+)$/m);
        return (match?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
    } catch {
        return '';
    }
}

export class MainChatAdapter implements HostAdapter {
    readonly name = 'main-chat';
    private readonly options: ExecutableAdapterOptions;

    constructor(options: ExecutableAdapterOptions = {}) {
        this.options = options;
    }

    resolve(): string | null {
        return resolveExecutable({
            command: 'dsh',
            env: this.options.env,
            homeDir: this.options.homeDir ?? process.env.HOME ?? '',
            envVar: MAIN_CHAT_ENV_VAR,
            extraCandidates: mainChatCandidates(this.options.homeDir ?? process.env.HOME ?? ''),
            platform: this.options.platform,
        });
    }

    async run(request: AdapterRequest): Promise<AdapterResult> {
        const executable = this.resolve();
        if (!executable) {
            return blockedResult({
                adapter: this.name,
                reason: 'ADAPTER_UNAVAILABLE',
                detail: `dsh not found (checked ${MAIN_CHAT_ENV_VAR}, PATH and ~/.local/bin)`,
            });
        }
        const args = ['--profile', 'headless', '--approval-policy', 'never', request.prompt];
        const deepseekKey = resolveDeepSeekKey(this.options.homeDir ?? process.env.HOME ?? '');
        const result = await spawnProcess(executable, args, {
            cwd: request.cwd,
            env: sanitizeChildEnv({ ...(request.env ?? this.options.env ?? process.env), DSH_SKIP_MEMORY: '1', ...(deepseekKey ? { DEEPSEEK_API_KEY: deepseekKey } : {}) }),
            timeoutMs: request.timeoutMs || DEFAULT_TIMEOUT_MS,
        });
        return {
            adapter: this.name,
            command: [executable, '--profile', 'headless', '--approval-policy', 'never', '<prompt>'],
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
