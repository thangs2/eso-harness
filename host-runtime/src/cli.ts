#!/usr/bin/env bun
/**
 * Host runtime CLI.
 *
 *   bun run src/cli.ts run \
 *     --consumer testeso --runtime-key cursor:cursor-agent \
 *     --prompt "..." --flow that-tinh-tran --worker worker-build \
 *     --adapter dry --dry-run --max-steps 1 [--json]
 *
 * Env: ESO_BASE_URL, ESO_CONSUMER, ESO_RUNTIME_KEY,
 *      ESO_HOST_TOKEN (scoped host bearer, preferred) or ESO_OPERATOR_TOKEN / ESO_AUTH_TOKEN.
 *
 * Exit codes: 0 PASS (flow-end/max-steps), 1 FAIL, 2 BLOCKED/usage/config error.
 */

import { DEFAULT_MAX_STEPS, MAX_HOST_STEPS, clampMaxSteps, runEntrypoint } from './entrypoint';
import type { AuthKind, EntrypointOptions, RunReport } from './entrypoint';
import { DEFAULT_TIMEOUT_MS } from './adapters/types';
import type { AdapterName } from './adapters/types';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';
export const ADAPTER_NAMES: AdapterName[] = ['dry', 'cursor', 'agy'];

export interface ParsedRunOptions {
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
}

export interface ParsedCli {
    command: 'run' | 'help';
    json: boolean;
    options?: ParsedRunOptions;
}

export class CliUsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CliUsageError';
    }
}

export function helpText(): string {
    return [
        'ESO host runtime (Mode A) — config snapshot -> worker -> model -> adapter -> evidence -> observation.',
        '',
        'USAGE',
        '  bun run src/cli.ts run --consumer <id> --runtime-key <hostId:runtimeId> --prompt <text> [options]',
        '  bun run src/cli.ts --help',
        '',
        'REQUIRED',
        '  --consumer <id>        ESO consumer (env ESO_CONSUMER)',
        '  --runtime-key <key>    hostId:runtimeId, e.g. cursor:cursor-agent (env ESO_RUNTIME_KEY)',
        '  --prompt <text>        the user prompt for this worker',
        '',
        'OPTIONS',
        '  --flow <id>            flow to run; must match the snapshot published flow (default: snapshot flow)',
        '  --worker <id>          explicit worker (default: flow entry node, else worker-build)',
        '  --adapter <name>       dry | cursor | agy (default: dry)',
        '  --model <id>           explicit model (default: host runtime defaultModel)',
        '  --max-steps <n>        host-side flow step cap, 1..' + MAX_HOST_STEPS + ' (default: ' + DEFAULT_MAX_STEPS + ')',
        '  --dry-run              force the deterministic dry adapter; still writes a REAL observation',
        '  --timeout-ms <n>       adapter process timeout (default: ' + DEFAULT_TIMEOUT_MS + ')',
        '  --cwd <dir>            adapter working directory (default: consumer.root, else current dir)',
        '  --trace-id <id>        reuse a trace id (useful for idempotency checks)',
        '  --json                 print one JSON report on stdout',
        '  --base-url <url>       ESO base URL (env ESO_BASE_URL, default: ' + DEFAULT_BASE_URL + ')',
        '  --host-token <t>       scoped host bearer (env ESO_HOST_TOKEN)',
        '  --operator-token <t>   operator bearer (env ESO_OPERATOR_TOKEN or ESO_AUTH_TOKEN)',
        '  -h, --help             this help',
        '',
        'ENV',
        '  ESO_BASE_URL · ESO_CONSUMER · ESO_RUNTIME_KEY · ESO_HOST_TOKEN · ESO_OPERATOR_TOKEN · ESO_AUTH_TOKEN',
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

/** Parse argv + env into a CLI invocation. Exported for tests (no process state touched). */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): ParsedCli {
    let json = false;
    let help = false;
    let command: 'run' | 'help' = 'run';

    const options: Partial<{
        baseUrl: string;
        consumer: string;
        runtimeKey: string;
        prompt: string;
        hostToken: string;
        operatorToken: string;
        flowId: string;
        workerId: string;
        adapter: string;
        model: string;
        maxSteps: string;
        timeoutMs: string;
        cwd: string;
        traceId: string;
    }> = {};
    let dryRun = false;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('-')) {
            if (arg === 'run') continue;
            throw new CliUsageError(`Unknown command: ${arg} (expected: run)`);
        }
        const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
        switch (flag) {
            case '-h':
            case '--help':
                help = true;
                break;
            case '--json':
                json = true;
                break;
            case '--dry-run':
                dryRun = true;
                break;
            case '--base-url':
            case '--consumer':
            case '--runtime-key':
            case '--prompt':
            case '--flow':
            case '--worker':
            case '--adapter':
            case '--model':
            case '--max-steps':
            case '--timeout-ms':
            case '--cwd':
            case '--trace-id':
            case '--host-token':
            case '--operator-token': {
                const { value, next } = readValue(argv, index, flag);
                const key: keyof typeof options = {
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
                }[flag] as keyof typeof options;
                (options as Record<string, string>)[key] = value;
                index = next;
                break;
            }
            default:
                throw new CliUsageError(`Unknown option: ${arg} (try --help)`);
        }
    }

    if (help || argv.length === 0) return { command: 'help', json };
    command = 'run';

    const baseUrl = (options.baseUrl ?? env.ESO_BASE_URL ?? DEFAULT_BASE_URL).trim();
    const consumer = (options.consumer ?? env.ESO_CONSUMER ?? '').trim();
    const runtimeKey = (options.runtimeKey ?? env.ESO_RUNTIME_KEY ?? '').trim();
    const prompt = options.prompt ?? '';
    if (!consumer) throw new CliUsageError('--consumer is required (or set ESO_CONSUMER)');
    if (!/^[^:\s]+:[^:\s]+$/.test(runtimeKey)) {
        throw new CliUsageError('--runtime-key must be hostId:runtimeId (or set ESO_RUNTIME_KEY)');
    }
    if (!prompt.trim()) throw new CliUsageError('--prompt is required');

    const hostToken = (options.hostToken ?? env.ESO_HOST_TOKEN ?? '').trim();
    const operatorToken = (options.operatorToken ?? env.ESO_OPERATOR_TOKEN ?? env.ESO_AUTH_TOKEN ?? '').trim();
    if (!hostToken && !operatorToken) {
        throw new CliUsageError('no credential: set ESO_HOST_TOKEN or ESO_OPERATOR_TOKEN/ESO_AUTH_TOKEN');
    }

    const parsed: ParsedRunOptions = {
        baseUrl,
        consumer,
        runtimeKey,
        prompt,
        authToken: hostToken || operatorToken,
        authKind: hostToken ? 'host' : 'operator',
        adapter: options.adapter ? parseAdapter(options.adapter) : 'dry',
        maxSteps: options.maxSteps ? parsePositiveInt('--max-steps', options.maxSteps, MAX_HOST_STEPS) : DEFAULT_MAX_STEPS,
        dryRun,
        timeoutMs: options.timeoutMs ? parsePositiveInt('--timeout-ms', options.timeoutMs) : DEFAULT_TIMEOUT_MS,
    };
    if (options.flowId) parsed.flowId = options.flowId;
    if (options.workerId) parsed.workerId = options.workerId;
    if (options.model) parsed.model = options.model;
    if (options.cwd) parsed.cwd = options.cwd;
    if (options.traceId) parsed.traceId = options.traceId;

    return { command, json, options: parsed };
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
        env: process.env,
    };
    if (parsed.flowId) options.flowId = parsed.flowId;
    if (parsed.workerId) options.workerId = parsed.workerId;
    if (parsed.model) options.model = parsed.model;
    if (parsed.cwd) options.cwd = parsed.cwd;
    if (parsed.traceId) options.traceId = parsed.traceId;
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
        const options = toEntrypointOptions(parsed.options!);
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
