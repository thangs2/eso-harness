#!/usr/bin/env bun
/**
 * Host runtime CLI.
 *
 *   Mode A (local worker):
 *     bun run src/cli.ts run --consumer testeso --runtime-key cursor:cursor-agent \
 *       --prompt "..." --flow that-tinh-tran --worker worker-build \
 *       --adapter dry --dry-run --max-steps 1 [--json]
 *
 *   Mode B (remote worker):
 *     bun run src/cli.ts dispatch --consumer testeso \
 *       --from-runtime-key cursor:cursor-agent --to-runtime-key agy:agy \
 *       --prompt "..." --flow that-tinh-tran --worker worker-build \
 *       --adapter dry --dry-run --remote-url http://127.0.0.1:8788 [--json]
 *
 *     bun run src/server.ts serve --runtime-key agy:agy --port 8788 [--host 127.0.0.1] [--json]
 *
 * Env: ESO_BASE_URL, ESO_CONSUMER, ESO_RUNTIME_KEY,
 *      ESO_HOST_TOKEN (scoped host bearer, preferred) or ESO_OPERATOR_TOKEN / ESO_AUTH_TOKEN,
 *      ESO_REMOTE_TOKEN (Mode B shared secret), ESO_REMOTE_ALLOWED_WS, ESO_REMOTE_URL.
 *
 * Exit codes: 0 PASS (flow-end/max-steps), 1 FAIL, 2 BLOCKED/usage/config error.
 */

import { DEFAULT_MAX_STEPS, MAX_HOST_STEPS, clampMaxSteps, runEntrypoint } from './entrypoint';
import type { AuthKind, EntrypointOptions, RunReport } from './entrypoint';
import { DEFAULT_TIMEOUT_MS } from './adapters/types';
import type { AdapterName } from './adapters/types';
import { DEFAULT_DISPATCH_TIMEOUT_MS, DispatchError, runDispatch } from './remote/dispatch';
import type { DispatchOptions, DispatchReport } from './remote/dispatch';
import { DEFAULT_REMOTE_HOST, DEFAULT_REMOTE_PORT, startRemoteServer } from './remote/server';
import { ObservationClient } from './observation-client';
import { installHostHooks } from './hooks';
import { evaluateAccess } from './write-policy';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';
export const ADAPTER_NAMES: AdapterName[] = ['dry', 'cursor', 'agy'];
const DEFAULT_REMOTE_TIMEOUT_MS = DEFAULT_DISPATCH_TIMEOUT_MS;

export type CliCommand = 'run' | 'dispatch' | 'serve' | 'flush-observations' | 'install-hooks' | 'check-write' | 'help';

export interface ParsedRunOptions {
    kind: 'run';
    baseUrl: string;
    consumer: string;
    runtimeKey: string;
    prompt: string;
    authToken?: string;
    authKind: AuthKind;
    flowId?: string;
    workerId?: string;
    adapter: AdapterName;
    model?: string;
    maxSteps: number;
    dryRun: boolean;
    timeoutMs: number;
    cwd?: string;
    traceId?: string;
    offline: boolean;
    cacheDir?: string;
    bufferDir?: string;
}

export interface ParsedDispatchOptions {
    kind: 'dispatch';
    baseUrl: string;
    consumer: string;
    fromRuntimeKey: string;
    toRuntimeKey: string;
    prompt: string;
    authToken?: string;
    authKind: AuthKind;
    remoteToken: string;
    flowId?: string;
    workerId?: string;
    adapter: AdapterName;
    model?: string;
    maxSteps: number;
    dryRun: boolean;
    timeoutMs: number;
    remoteTimeoutMs: number;
    remoteUrl?: string;
    workspaceRepo?: string;
    workspaceBranch?: string;
    workspaceCommit?: string;
    traceId?: string;
    offline: boolean;
    cacheDir?: string;
    bufferDir?: string;
}

export interface ParsedServeOptions {
    kind: 'serve';
    baseUrl: string;
    consumer: string;
    runtimeKey: string;
    host: string;
    port: number;
    hostToken: string;
    remoteToken: string;
    allowedWorkspaces: string[];
    ledgerPath?: string;
}

export interface ParsedFlushOptions {
    kind: 'flush-observations';
    baseUrl: string;
    consumer: string;
    authToken?: string;
    authKind: AuthKind;
    cacheDir?: string;
    bufferDir?: string;
}

export interface ParsedInstallHooksOptions {
    kind: 'install-hooks';
    root: string;
    host: string;
}

export interface ParsedCheckWriteOptions {
    kind: 'check-write';
    root: string;
    target: string;
    access: 'read' | 'write';
}

export type ParsedOptions = ParsedRunOptions | ParsedDispatchOptions | ParsedServeOptions | ParsedFlushOptions | ParsedInstallHooksOptions | ParsedCheckWriteOptions;

export interface ParsedCli {
    command: CliCommand;
    json: boolean;
    options?: ParsedOptions;
}

export class CliUsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CliUsageError';
    }
}

export function helpText(): string {
    return [
        'ESO host runtime — Mode A local worker + Mode B host-to-host dispatch.',
        '',
        'USAGE',
        '  bun run src/cli.ts run --consumer <id> --runtime-key <hostId:runtimeId> --prompt <text> [options]',
        '  bun run src/cli.ts dispatch --consumer <id> --from-runtime-key <key> --to-runtime-key <key> --prompt <text> [options]',
        '  bun run src/server.ts serve --runtime-key <hostId:runtimeId> --port 8788 [options]',
        '  bun run src/cli.ts flush-observations --consumer <id> [options]',
        '  bun run src/cli.ts install-hooks --hook-host <host> [--consumer-root <dir>]',
        '  bun run src/cli.ts check-write --target <path> --access read|write [--consumer-root <dir>]',
        '  bun run src/cli.ts --help',
        '',
        'RUN (Mode A, local worker)',
        '  --runtime-key <key>    hostId:runtimeId, e.g. cursor:cursor-agent (env ESO_RUNTIME_KEY)',
        '  --flow <id>            flow to run; must match the snapshot published flow',
        '  --worker <id>          explicit worker (default: flow entry node, else worker-build)',
        '  --adapter <name>       dry | cursor | agy (default: dry)',
        '  --model <id>           explicit model (default: host runtime defaultModel)',
        '  --max-steps <n>        host-side flow step cap, 1..' + MAX_HOST_STEPS + ' (default: ' + DEFAULT_MAX_STEPS + ')',
        '  --dry-run              force the deterministic dry adapter; still writes a REAL observation',
        '  --timeout-ms <n>       adapter process timeout (default: ' + DEFAULT_TIMEOUT_MS + ')',
        '  --cwd <dir>            adapter working directory (default: consumer.root, else current dir)',
        '  --trace-id <id>        reuse a trace/job id (idempotency checks)',
        '  --offline              config must come from the local snapshot cache (env ESO_OFFLINE=1)',
        '  --cache-dir <dir>      local cache root (env ESO_CONFIG_CACHE_DIR, default <consumer-root>/.harness/runtime)',
        '  --buffer-dir <dir>     buffered observation dir (env ESO_OBS_BUFFER_DIR)',
        '',
        'DISPATCH (Mode B, host A -> host B)',
        '  --from-runtime-key <k> host A runtimeKey (env ESO_RUNTIME_KEY)',
        '  --to-runtime-key <k>   host B runtimeKey (must be in worker placement allowedHosts)',
        '  --remote-url <url>     host B endpoint; overrides snapshot host runtime remoteUrl (env ESO_REMOTE_URL)',
        '  --remote-token <t>     shared Mode B secret (env ESO_REMOTE_TOKEN, min 8 chars)',
        '  --remote-timeout-ms <n> dispatch timeout (default: ' + DEFAULT_REMOTE_TIMEOUT_MS + ')',
        '  --workspace-repo <p>   workspace path on host B (default: consumer.root)',
        '  --workspace-branch <b> optional branch the target checkout must be on',
        '  --workspace-commit <c> optional commit the target checkout must be at',
        '',
        'SERVE (Mode B, host B remote endpoint)',
        '  --runtime-key <key>    this host runtimeKey (env ESO_RUNTIME_KEY)',
        '  --host <addr>          listen address (default: ' + DEFAULT_REMOTE_HOST + ')',
        '  --port <n>             listen port (default: ' + DEFAULT_REMOTE_PORT + ')',
        '  --allowed-workspace <p> repeatable allowed workspace root (env ESO_REMOTE_ALLOWED_WS, comma-separated)',
        '  --ledger-path <p>      persistent Mode B job ledger (env ESO_REMOTE_LEDGER)',
        '  ESO_HOST_TOKEN         host B scoped bearer token for observation writes',
        '  ESO_REMOTE_TOKEN       shared Mode B secret (bearer + HMAC)',
        '',
        'INSTALL-HOOKS',
        '  --hook-host <host>    cursor | claude | agents | agy',
        '  --consumer-root <dir> consumer repo root (env ESO_CONSUMER_ROOT, default cwd)',
        '',
        'CHECK-WRITE',
        '  --target <path>       path the host is about to read/write',
        '  --access <mode>       read | write',
        '',
        'FLUSH-OBSERVATIONS',
        '  replay observations buffered while ESO was unavailable (idempotent)',
        '',
        'COMMON',
        '  --consumer <id>        ESO consumer (env ESO_CONSUMER)',
        '  --prompt <text>        the user prompt for this worker',
        '  --json                 print one JSON report on stdout',
        '  --base-url <url>       ESO base URL (env ESO_BASE_URL, default: ' + DEFAULT_BASE_URL + ')',
        '  --host-token <t>       scoped host bearer (env ESO_HOST_TOKEN)',
        '  --operator-token <t>   operator bearer (env ESO_OPERATOR_TOKEN or ESO_AUTH_TOKEN)',
        '  -h, --help             this help',
        '',
        'ENV',
        '  ESO_BASE_URL · ESO_CONSUMER · ESO_RUNTIME_KEY · ESO_HOST_TOKEN · ESO_OPERATOR_TOKEN ·',
        '  ESO_AUTH_TOKEN · ESO_REMOTE_TOKEN · ESO_REMOTE_ALLOWED_WS · ESO_REMOTE_URL ·',
        '  ESO_CONSUMER_ROOT · ESO_CONFIG_CACHE_DIR · ESO_OBS_BUFFER_DIR · ESO_REMOTE_LEDGER · ESO_OFFLINE',
        '',
        'EXIT CODES',
        '  0 PASS (flow-end / max-steps) · 1 FAIL · 2 BLOCKED or usage/config error',
        '',
        'LAW',
        '  This package runs on the HOST. ESO is config + observatory only: it never runs, queues,',
        '  claims or advances anything and never calls a model.',
    ].join('\n');
}

function readValue(argv: string[], index: number, flag: string): { value: string; next: number } {
    const inline = argv[index];
    const eq = inline.indexOf('=');
    if (eq > 0) return { value: inline.slice(eq + 1), next: index };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new CliUsageError(`${flag} requires a value`);
    return { value, next: index + 1 };
}

function parseAdapter(value: string): AdapterName {
    if ((ADAPTER_NAMES as string[]).includes(value)) return value as AdapterName;
    throw new CliUsageError(`--adapter must be one of ${ADAPTER_NAMES.join(' | ')}, got: ${value}`);
}

function parsePositiveInt(name: string, value: string, max?: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new CliUsageError(`${name} must be a positive integer, got: ${value}`);
    if (max !== undefined && parsed > max) throw new CliUsageError(`${name} must be <= ${max}, got: ${value}`);
    return parsed;
}

const COMMANDS: CliCommand[] = ['run', 'dispatch', 'serve', 'flush-observations', 'install-hooks', 'check-write'];

interface RawFlags {
    values: Record<string, string>;
    lists: Record<string, string[]>;
    dryRun: boolean;
    offline: boolean;
    json: boolean;
    help: boolean;
    command: CliCommand | null;
}

const VALUE_FLAGS = new Set([
    '--base-url',
    '--consumer',
    '--runtime-key',
    '--prompt',
    '--flow',
    '--worker',
    '--adapter',
    '--model',
    '--max-steps',
    '--timeout-ms',
    '--cwd',
    '--trace-id',
    '--host-token',
    '--operator-token',
    '--remote-token',
    '--remote-url',
    '--remote-timeout-ms',
    '--from-runtime-key',
    '--to-runtime-key',
    '--workspace-repo',
    '--workspace-branch',
    '--workspace-commit',
    '--port',
    '--host',
    '--allowed-workspace',
    '--cache-dir',
    '--buffer-dir',
    '--ledger-path',
    '--consumer-root',
    '--hook-host',
    '--target',
    '--access',
]);

const FLAG_KEYS: Record<string, string> = {
    '--base-url': 'baseUrl',
    '--consumer': 'consumer',
    '--runtime-key': 'runtimeKey',
    '--prompt': 'prompt',
    '--flow': 'flowId',
    '--worker': 'workerId',
    '--adapter': 'adapter',
    '--model': 'model',
    '--max-steps': 'maxSteps',
    '--timeout-ms': 'timeoutMs',
    '--cwd': 'cwd',
    '--trace-id': 'traceId',
    '--host-token': 'hostToken',
    '--operator-token': 'operatorToken',
    '--remote-token': 'remoteToken',
    '--remote-url': 'remoteUrl',
    '--remote-timeout-ms': 'remoteTimeoutMs',
    '--from-runtime-key': 'fromRuntimeKey',
    '--to-runtime-key': 'toRuntimeKey',
    '--workspace-repo': 'workspaceRepo',
    '--workspace-branch': 'workspaceBranch',
    '--workspace-commit': 'workspaceCommit',
    '--port': 'port',
    '--host': 'host',
    '--allowed-workspace': 'allowedWorkspace',
    '--cache-dir': 'cacheDir',
    '--buffer-dir': 'bufferDir',
    '--ledger-path': 'ledgerPath',
    '--consumer-root': 'consumerRoot',
    '--hook-host': 'hookHost',
    '--target': 'target',
    '--access': 'access',
};

function parseRaw(argv: string[]): RawFlags {
    const raw: RawFlags = { values: {}, lists: {}, dryRun: false, offline: false, json: false, help: false, command: null };
    const positionals: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('-')) {
            positionals.push(arg);
            continue;
        }
        const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
        switch (flag) {
            case '-h':
            case '--help':
                raw.help = true;
                break;
            case '--json':
                raw.json = true;
                break;
            case '--dry-run':
                raw.dryRun = true;
                break;
            case '--offline':
                raw.offline = true;
                break;
            default: {
                if (!VALUE_FLAGS.has(flag)) throw new CliUsageError(`Unknown option: ${arg} (try --help)`);
                const { value, next } = readValue(argv, index, flag);
                const key = FLAG_KEYS[flag];
                if (key === 'allowedWorkspace') {
                    raw.lists.allowedWorkspace = [...(raw.lists.allowedWorkspace ?? []), value];
                } else {
                    raw.values[key] = value;
                }
                index = next;
            }
        }
    }

    if (positionals.length > 1) {
        throw new CliUsageError(`Unknown command: ${positionals.join(' ')} (expected: ${COMMANDS.join(' | ')})`);
    }
    if (positionals.length === 1) {
        const candidate = positionals[0];
        if (!(COMMANDS as string[]).includes(candidate)) {
            throw new CliUsageError(`Unknown command: ${candidate} (expected: ${COMMANDS.join(' | ')})`);
        }
        raw.command = candidate as CliCommand;
    }
    return raw;
}

function envText(env: Record<string, string | undefined>, key: string): string {
    return (env[key] ?? '').trim();
}

function envFirst(env: Record<string, string | undefined>, keys: string[]): string {
    for (const key of keys) {
        const value = envText(env, key);
        if (value) return value;
    }
    return '';
}

function resolveCredential(raw: RawFlags, env: Record<string, string | undefined>): { token?: string; kind: AuthKind } {
    const hostToken = (raw.values.hostToken ?? '').trim() || envText(env, 'ESO_HOST_TOKEN');
    const operatorToken =
        (raw.values.operatorToken ?? '').trim() || envFirst(env, ['ESO_OPERATOR_TOKEN', 'ESO_AUTH_TOKEN']);
    if (hostToken) return { token: hostToken, kind: 'host' };
    if (operatorToken) return { token: operatorToken, kind: 'operator' };
    return { kind: 'operator' };
}

function resolveAllowedWorkspaces(raw: RawFlags, env: Record<string, string | undefined>): string[] {
    const fromEnv = envText(env, 'ESO_REMOTE_ALLOWED_WS')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return [...fromEnv, ...(raw.lists.allowedWorkspace ?? [])];
}

function requireConsumer(raw: RawFlags, env: Record<string, string | undefined>): string {
    const consumer = (raw.values.consumer ?? envText(env, 'ESO_CONSUMER')).trim();
    if (!consumer) throw new CliUsageError('--consumer is required (or set ESO_CONSUMER)');
    return consumer;
}

/** Parse argv + env into a CLI invocation. Exported for tests (no process state touched). */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): ParsedCli {
    const raw = parseRaw(argv);
    if (raw.help || argv.length === 0) return { command: 'help', json: raw.json };
    const command = raw.command ?? 'run';

    const baseUrl = (raw.values.baseUrl ?? '').trim() || envText(env, 'ESO_BASE_URL') || DEFAULT_BASE_URL;

    if (command === 'check-write') {
        const root = (raw.values.consumerRoot ?? '').trim() || envText(env, 'ESO_CONSUMER_ROOT') || process.cwd();
        const target = (raw.values.target ?? '').trim();
        const access = (raw.values.access ?? '').trim();
        if (!target) throw new CliUsageError('check-write requires --target <path>');
        if (access !== 'read' && access !== 'write') throw new CliUsageError('check-write requires --access read|write');
        return { command, json: raw.json, options: { kind: 'check-write', root, target, access } };
    }

    if (command === 'install-hooks') {
        const root = (raw.values.consumerRoot ?? '').trim() || envText(env, 'ESO_CONSUMER_ROOT') || process.cwd();
        const host = (raw.values.hookHost ?? '').trim();
        if (!host) throw new CliUsageError('install-hooks requires --hook-host <cursor|claude|agents|agy>');
        return { command, json: raw.json, options: { kind: 'install-hooks', root, host } };
    }

    if (command === 'run') {
        const consumer = requireConsumer(raw, env);
        const runtimeKey = (raw.values.runtimeKey ?? '').trim() || envText(env, 'ESO_RUNTIME_KEY');
        if (!/^[^:\s]+:[^:\s]+$/.test(runtimeKey)) {
            throw new CliUsageError('--runtime-key must be hostId:runtimeId (or set ESO_RUNTIME_KEY)');
        }
        const prompt = raw.values.prompt ?? '';
        if (!prompt.trim()) throw new CliUsageError('--prompt is required');
        const credential = resolveCredential(raw, env);
        if (!credential.token) {
            throw new CliUsageError('no credential: set ESO_HOST_TOKEN or ESO_OPERATOR_TOKEN/ESO_AUTH_TOKEN');
        }
        const options: ParsedRunOptions = {
            kind: 'run',
            baseUrl,
            consumer,
            runtimeKey,
            prompt,
            authToken: credential.token,
            authKind: credential.kind,
            adapter: raw.values.adapter ? parseAdapter(raw.values.adapter) : 'dry',
            maxSteps: raw.values.maxSteps ? parsePositiveInt('--max-steps', raw.values.maxSteps, MAX_HOST_STEPS) : DEFAULT_MAX_STEPS,
            dryRun: raw.dryRun,
            timeoutMs: raw.values.timeoutMs ? parsePositiveInt('--timeout-ms', raw.values.timeoutMs) : DEFAULT_TIMEOUT_MS,
            offline: raw.offline || envText(env, 'ESO_OFFLINE') === '1',
        };
        if (raw.values.flowId) options.flowId = raw.values.flowId;
        if (raw.values.workerId) options.workerId = raw.values.workerId;
        if (raw.values.model) options.model = raw.values.model;
        if (raw.values.cwd) options.cwd = raw.values.cwd;
        if (raw.values.traceId) options.traceId = raw.values.traceId;
        if (raw.values.cacheDir) options.cacheDir = raw.values.cacheDir;
        if (raw.values.bufferDir) options.bufferDir = raw.values.bufferDir;
        return { command, json: raw.json, options };
    }

    if (command === 'dispatch') {
        const consumer = requireConsumer(raw, env);
        const fromRuntimeKey =
            (raw.values.fromRuntimeKey ?? '').trim() || (raw.values.runtimeKey ?? '').trim() || envText(env, 'ESO_RUNTIME_KEY');
        const toRuntimeKey = (raw.values.toRuntimeKey ?? '').trim();
        const pattern = /^[^:\s]+:[^:\s]+$/;
        if (!pattern.test(fromRuntimeKey)) {
            throw new CliUsageError('--from-runtime-key must be hostId:runtimeId (or set ESO_RUNTIME_KEY)');
        }
        if (!pattern.test(toRuntimeKey)) {
            throw new CliUsageError('--to-runtime-key must be hostId:runtimeId');
        }
        if (fromRuntimeKey === toRuntimeKey) {
            throw new CliUsageError('--from-runtime-key and --to-runtime-key must differ');
        }
        const prompt = raw.values.prompt ?? '';
        if (!prompt.trim()) throw new CliUsageError('--prompt is required');
        const credential = resolveCredential(raw, env);
        if (!credential.token) {
            throw new CliUsageError('no credential: set ESO_HOST_TOKEN or ESO_OPERATOR_TOKEN/ESO_AUTH_TOKEN');
        }
        const remoteToken = (raw.values.remoteToken ?? '').trim() || envText(env, 'ESO_REMOTE_TOKEN');
        if (remoteToken.length < 8) {
            throw new CliUsageError('ESO_REMOTE_TOKEN is required for Mode B dispatch (min 8 characters, or --remote-token)');
        }
        const options: ParsedDispatchOptions = {
            kind: 'dispatch',
            baseUrl,
            consumer,
            fromRuntimeKey,
            toRuntimeKey,
            prompt,
            authToken: credential.token,
            authKind: credential.kind,
            remoteToken,
            adapter: raw.values.adapter ? parseAdapter(raw.values.adapter) : 'dry',
            maxSteps: raw.values.maxSteps ? parsePositiveInt('--max-steps', raw.values.maxSteps, MAX_HOST_STEPS) : DEFAULT_MAX_STEPS,
            dryRun: raw.dryRun,
            timeoutMs: raw.values.timeoutMs ? parsePositiveInt('--timeout-ms', raw.values.timeoutMs) : DEFAULT_TIMEOUT_MS,
            remoteTimeoutMs: raw.values.remoteTimeoutMs
                ? parsePositiveInt('--remote-timeout-ms', raw.values.remoteTimeoutMs)
                : DEFAULT_REMOTE_TIMEOUT_MS,
            offline: raw.offline || envText(env, 'ESO_OFFLINE') === '1',
        };
        const remoteUrl = (raw.values.remoteUrl ?? '').trim() || envText(env, 'ESO_REMOTE_URL');
        if (remoteUrl) options.remoteUrl = remoteUrl;
        if (raw.values.flowId) options.flowId = raw.values.flowId;
        if (raw.values.workerId) options.workerId = raw.values.workerId;
        if (raw.values.model) options.model = raw.values.model;
        if (raw.values.workspaceRepo) options.workspaceRepo = raw.values.workspaceRepo;
        if (raw.values.workspaceBranch) options.workspaceBranch = raw.values.workspaceBranch;
        if (raw.values.workspaceCommit) options.workspaceCommit = raw.values.workspaceCommit;
        if (raw.values.traceId) options.traceId = raw.values.traceId;
        if (raw.values.cacheDir) options.cacheDir = raw.values.cacheDir;
        if (raw.values.bufferDir) options.bufferDir = raw.values.bufferDir;
        return { command, json: raw.json, options };
    }

    if (command === 'flush-observations') {
        const consumer = requireConsumer(raw, env);
        const credential = resolveCredential(raw, env);
        if (!credential.token) {
            throw new CliUsageError('no credential: set ESO_HOST_TOKEN or ESO_OPERATOR_TOKEN/ESO_AUTH_TOKEN');
        }
        const options: ParsedFlushOptions = {
            kind: 'flush-observations',
            baseUrl,
            consumer,
            authToken: credential.token,
            authKind: credential.kind,
        };
        if (raw.values.cacheDir) options.cacheDir = raw.values.cacheDir;
        if (raw.values.bufferDir) options.bufferDir = raw.values.bufferDir;
        return { command, json: raw.json, options };
    }

    // serve
    const consumer = requireConsumer(raw, env);
    const runtimeKey = (raw.values.runtimeKey ?? '').trim() || envText(env, 'ESO_RUNTIME_KEY');
    if (!/^[^:\s]+:[^:\s]+$/.test(runtimeKey)) {
        throw new CliUsageError('serve --runtime-key must be hostId:runtimeId (or set ESO_RUNTIME_KEY)');
    }
    const hostToken = (raw.values.hostToken ?? '').trim() || envText(env, 'ESO_HOST_TOKEN');
    if (!hostToken) throw new CliUsageError('serve requires ESO_HOST_TOKEN (host B scoped token)');
    const remoteToken = (raw.values.remoteToken ?? '').trim() || envText(env, 'ESO_REMOTE_TOKEN');
    if (remoteToken.length < 8) {
        throw new CliUsageError('serve requires ESO_REMOTE_TOKEN (min 8 characters, or --remote-token)');
    }
    const options: ParsedServeOptions = {
        kind: 'serve',
        baseUrl,
        consumer,
        runtimeKey,
        host: (raw.values.host ?? DEFAULT_REMOTE_HOST).trim() || DEFAULT_REMOTE_HOST,
        port: raw.values.port ? parsePositiveInt('--port', raw.values.port, 65535) : DEFAULT_REMOTE_PORT,
        hostToken,
        remoteToken,
        allowedWorkspaces: resolveAllowedWorkspaces(raw, env),
    };
    if (raw.values.ledgerPath) options.ledgerPath = raw.values.ledgerPath;
    return { command, json: raw.json, options };
}

export function toEntrypointOptions(parsed: ParsedRunOptions): EntrypointOptions {
    const options: EntrypointOptions = {
        baseUrl: parsed.baseUrl,
        authToken: parsed.authToken,
        authKind: parsed.authKind,
        consumer: parsed.consumer,
        runtimeKey: parsed.runtimeKey,
        prompt: parsed.prompt,
        adapter: parsed.adapter,
        maxSteps: parsed.maxSteps,
        dryRun: parsed.dryRun,
        timeoutMs: parsed.timeoutMs,
        offline: parsed.offline,
        env: process.env,
    };
    if (parsed.flowId) options.flowId = parsed.flowId;
    if (parsed.workerId) options.workerId = parsed.workerId;
    if (parsed.model) options.model = parsed.model;
    if (parsed.cwd) options.cwd = parsed.cwd;
    if (parsed.traceId) options.traceId = parsed.traceId;
    if (parsed.cacheDir) options.cacheDir = parsed.cacheDir;
    if (parsed.bufferDir) options.bufferDir = parsed.bufferDir;
    return options;
}

export function toDispatchOptions(parsed: ParsedDispatchOptions, log?: (line: string) => void): DispatchOptions {
    const options: DispatchOptions = {
        baseUrl: parsed.baseUrl,
        authToken: parsed.authToken,
        authKind: parsed.authKind,
        consumer: parsed.consumer,
        fromRuntimeKey: parsed.fromRuntimeKey,
        toRuntimeKey: parsed.toRuntimeKey,
        prompt: parsed.prompt,
        adapter: parsed.adapter,
        dryRun: parsed.dryRun,
        maxSteps: parsed.maxSteps,
        timeoutMs: parsed.timeoutMs,
        remoteTimeoutMs: parsed.remoteTimeoutMs,
        remoteToken: parsed.remoteToken,
        offline: parsed.offline,
    };
    if (parsed.flowId) options.flowId = parsed.flowId;
    if (parsed.workerId) options.workerId = parsed.workerId;
    if (parsed.model) options.model = parsed.model;
    if (parsed.remoteUrl) options.remoteUrl = parsed.remoteUrl;
    if (parsed.workspaceRepo) options.workspaceRepo = parsed.workspaceRepo;
    if (parsed.workspaceBranch) options.workspaceBranch = parsed.workspaceBranch;
    if (parsed.workspaceCommit) options.workspaceCommit = parsed.workspaceCommit;
    if (parsed.traceId) options.traceId = parsed.traceId;
    if (parsed.cacheDir) options.cacheDir = parsed.cacheDir;
    if (parsed.bufferDir) options.bufferDir = parsed.bufferDir;
    if (log) options.log = log;
    return options;
}

function exitCodeFor(report: RunReport): number {
    if (report.ok) return 0;
    if (report.stoppedReason === 'FAIL') return 1;
    return 2;
}

export function formatReport(report: RunReport): string {
    const lines: string[] = [];
    lines.push(`${report.ok ? 'PASS' : 'BLOCKED'}  host-runtime run`);
    lines.push(`  trace      ${report.traceId}`);
    lines.push(`  consumer   ${report.consumer}`);
    lines.push(`  runtime    ${report.runtimeKey} (auth: ${report.auth})`);
    lines.push(`  flow       ${report.flowId ?? 'n/a'}`);
    lines.push(`  adapter    ${report.adapter}${report.dryRun ? ' (dry-run)' : ''}`);
    lines.push(`  snapshot   ${report.snapshotVersion.slice(0, 12)}… ${report.snapshotVersionValid ? 'validated' : 'NOT VALIDATED'}`);
    for (const step of report.steps) {
        lines.push(
            `  [${step.hostStep}] ${step.workerId ?? 'n/a'}  ${step.outcome}  exit=${step.exitCode ?? 'n/a'}  ` +
                `${step.durationMs}ms  model=${step.model ?? 'n/a'}  observation=${step.observationId}` +
                `${step.observationCreated ? '' : ' (existing)'}`,
        );
    }
    lines.push(`  result     ${report.ok ? 'PASS' : 'BLOCKED'} — stopped: ${report.stoppedReason}`);
    if (report.warnings.length) lines.push(`  warnings   ${report.warnings.join(', ')}`);
    return `${lines.join('\n')}\n`;
}

export function formatDispatchReport(report: DispatchReport): string {
    const lines: string[] = [];
    lines.push(`${report.ok ? 'PASS' : 'BLOCKED'}  host-runtime dispatch (Mode B)`);
    lines.push(`  job        ${report.jobId}`);
    lines.push(`  route      ${report.fromRuntimeKey} -> ${report.toRuntimeKey}`);
    lines.push(`  remote     ${report.remoteUrl} (HTTP ${report.remoteHttpStatus})`);
    lines.push(`  worker     ${report.workerId} / flow ${report.flowId}`);
    lines.push(`  outcome    ${report.outcome}`);
    lines.push(`  model      ${report.model ?? 'n/a'}${report.effort ? ` (effort ${report.effort})` : ''} [${report.modelSource ?? 'n/a'}]`);
    lines.push(`  remoteObs  ${report.remoteObservationId ?? 'none'}`);
    lines.push(`  localObs   ${report.localObservationId ?? 'none'}${report.localObservationCreated ? '' : ' (existing)'}`);
    lines.push(`  snapshot   ${report.snapshotVersion.slice(0, 12)}… ${report.snapshotVersionValid ? 'validated' : 'NOT VALIDATED'}`);
    lines.push(`  timing     transport=${report.transportDurationMs}ms total=${report.durationMs}ms`);
    if (report.warnings.length) lines.push(`  warnings   ${report.warnings.join(', ')}`);
    return `${lines.join('\n')}\n`;
}

export interface CliIo {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
}

const defaultIo: CliIo = {
    stdout: (text) => {
        process.stdout.write(text);
    },
    stderr: (text) => {
        process.stderr.write(text);
    },
};

async function serveCommand(parsed: ParsedServeOptions, json: boolean, io: CliIo): Promise<number> {
    let handle;
    try {
        handle = startRemoteServer({
            runtimeKey: parsed.runtimeKey,
            port: parsed.port,
            host: parsed.host,
            secret: parsed.remoteToken,
            esoBaseUrl: parsed.baseUrl,
            consumer: parsed.consumer,
            hostToken: parsed.hostToken,
            allowedWorkspaces: parsed.allowedWorkspaces,
            ...(parsed.ledgerPath ? { ledgerPath: parsed.ledgerPath } : {}),
            log: (line) => io.stderr(`${line}\n`),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (json) io.stdout(`${JSON.stringify({ ok: false, error: { code: 'SERVE_FAILED', message } }, null, 2)}\n`);
        else io.stderr(`error: SERVE_FAILED: ${message}\n`);
        return 2;
    }

    const startup = { ok: true, mode: 'B', runtimeKey: handle.runtimeKey, url: handle.url, host: handle.host, port: handle.port };
    io.stdout(json ? `${JSON.stringify(startup)}\n` : `serving Mode B on ${handle.url} as ${handle.runtimeKey}\n`);

    await new Promise<void>((resolve) => {
        const stop = () => {
            void handle.stop().then(() => resolve()).catch(() => resolve());
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
    });
    io.stderr('[remote] stopped\n');
    return 0;
}

async function flushCommand(parsed: ParsedFlushOptions, json: boolean, io: CliIo): Promise<number> {
    const client = new ObservationClient({
        baseUrl: parsed.baseUrl,
        consumer: parsed.consumer,
        token: parsed.authToken,
        cacheDir: parsed.cacheDir,
        bufferDir: parsed.bufferDir,
    });
    try {
        const result = await client.flushBuffer();
        const ok = result.remaining === 0;
        if (json) {
            io.stdout(`${JSON.stringify({ ok, flushed: result.flushed, remaining: result.remaining, bufferPath: client.bufferPath() }, null, 2)}\n`);
        } else {
            io.stdout(`flushed ${result.flushed}, remaining ${result.remaining} (${client.bufferPath()})\n`);
        }
        return ok ? 0 : 2;
    } catch (error) {
        const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'FLUSH_FAILED';
        const message = error instanceof Error ? error.message : String(error);
        if (json) io.stdout(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`);
        else io.stderr(`error: ${code}: ${message}\n`);
        return 2;
    }
}

async function dispatchCommand(parsed: ParsedDispatchOptions, json: boolean, io: CliIo): Promise<number> {
    try {
        const report = await runDispatch(toDispatchOptions(parsed, (line) => io.stderr(`${line}\n`)));
        io.stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatDispatchReport(report));
        return report.ok ? 0 : report.outcome === 'FAIL' ? 1 : 2;
    } catch (error) {
        if (error instanceof DispatchError) {
            const payload = {
                ok: false,
                error: {
                    code: error.code,
                    message: error.message,
                    ...(error.detail ? { detail: error.detail } : {}),
                    ...(error.localObservationId ? { localObservationId: error.localObservationId } : {}),
                },
            };
            if (json) io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
            else io.stderr(`error: ${error.code}: ${error.message}\n`);
            return 2;
        }
        throw error;
    }
}

export async function main(
    argv: string[],
    env: Record<string, string | undefined> = process.env,
    io: CliIo = defaultIo,
): Promise<number> {
    const wantsJson = argv.includes('--json');

    try {
        const parsed = parseArgs(argv, env);
        if (parsed.command === 'help') {
            io.stdout(`${helpText()}\n`);
            return 0;
        }
        if (parsed.command === 'serve') {
            return await serveCommand(parsed.options as ParsedServeOptions, parsed.json, io);
        }
        if (parsed.command === 'dispatch') {
            return await dispatchCommand(parsed.options as ParsedDispatchOptions, parsed.json, io);
        }
        if (parsed.command === 'flush-observations') {
            return await flushCommand(parsed.options as ParsedFlushOptions, parsed.json, io);
        }
        if (parsed.command === 'check-write') {
            const options = parsed.options as ParsedCheckWriteOptions;
            const policyFile = join(options.root, '.harness', 'policy', 'folder-policy.json');
            const grantsFile = join(options.root, '.harness', 'policy', 'grants.json');
            const policyDoc = existsSync(policyFile) ? JSON.parse(readFileSync(policyFile, 'utf8')) : {};
            const policies = policyDoc.policies ?? [];
            const grants = existsSync(grantsFile) ? JSON.parse(readFileSync(grantsFile, 'utf8')) : [];
            const decision = evaluateAccess({ root: options.root, target: options.target, kind: options.access, policies, grants });
            const enforcement = policyDoc.enforcement === 'enforce' ? 'enforce' : 'audit';
            const auditOnly = enforcement === 'audit' && !decision.allowed;
            const allowed = decision.allowed || auditOnly;
            const payload = { ...decision, allowed, enforcement, auditOnly };
            io.stdout(parsed.json ? `${JSON.stringify(payload, null, 2)}\n` : `${allowed ? (auditOnly ? 'AUDIT-ALLOW' : 'ALLOW') : 'DENY'} ${decision.effect} ${decision.reason}\n`);
            return allowed ? 0 : 1;
        }
        if (parsed.command === 'install-hooks') {
            const options = parsed.options as ParsedInstallHooksOptions;
            const result = installHostHooks(options.root, options.host);
            io.stdout(parsed.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.installed ? 'installed' : 'skipped'} ${result.host} ${result.file}\n`);
            return 0;
        }

        const options = toEntrypointOptions(parsed.options as ParsedRunOptions);
        options.env = env;
        options.log = (line) => io.stderr(`${line}\n`);

        const report = await runEntrypoint(options);
        io.stdout(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
        return exitCodeFor(report);
    } catch (error) {
        const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'ERROR';
        const message = error instanceof Error ? error.message : String(error);
        if (wantsJson) {
            io.stdout(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`);
        } else {
            io.stderr(`error: ${code}: ${message}\n`);
            if (error instanceof CliUsageError) io.stderr('Run with --help for usage.\n');
        }
        return 2;
    }
}

if (import.meta.main) {
    void main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}

/** Exported for tests: kept in one place with help text. */
export { clampMaxSteps };
