import { describe, expect, it } from 'bun:test';
import { CliUsageError, formatReport, helpText, main, parseArgs } from '../src/cli';
import type { ParsedRunOptions } from '../src/cli';
import type { RunReport } from '../src/entrypoint';

const ENV = {
    ESO_CONSUMER: 'testeso',
    ESO_RUNTIME_KEY: 'cursor:cursor-agent',
    ESO_AUTH_TOKEN: 'operator-token',
};

function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
        io: {
            stdout: (text: string) => out.push(text),
            stderr: (text: string) => err.push(text),
        },
        out,
        err,
    };
}

const REPORT: RunReport = {
    ok: true,
    traceId: 'trace-1',
    consumer: 'testeso',
    runtimeKey: 'cursor:cursor-agent',
    auth: 'host',
    flowId: 'that-tinh-tran',
    adapter: 'dry',
    dryRun: true,
    maxSteps: 1,
    snapshotVersion: 'a'.repeat(64),
    snapshotVersionValid: true,
    steps: [
        {
            hostStep: 1,
            workerId: 'worker-build',
            adapter: 'dry',
            model: 'auto',
            outcome: 'PASS',
            event: 'worker.completed',
            observationId: 'obs-worker-build-1-trace-1',
            observationCreated: true,
            exitCode: 0,
            durationMs: 0,
            timedOut: false,
            nextWorkerId: null,
        },
    ],
    stoppedReason: 'max-steps',
};

describe('cli', () => {
    it('documents usage, exit codes and the sidecar law', () => {
        const text = helpText();
        expect(text).toContain('USAGE');
        expect(text).toContain('--dry-run');
        expect(text).toContain('EXIT CODES');
        expect(text).toContain('never runs, queues');
    });

    it('returns help with no args or --help', () => {
        expect(parseArgs([], {}).command).toBe('help');
        expect(parseArgs(['--help'], {}).command).toBe('help');
        expect(parseArgs(['run', '--help'], {}).command).toBe('help');
    });

    it('fills defaults from the environment', () => {
        const parsed = parseArgs(['run', '--prompt', 'do the thing'], ENV);
        const options = parsed.options as ParsedRunOptions;
        expect(parsed.command).toBe('run');
        expect(parsed.json).toBe(false);
        expect(options.baseUrl).toBe('http://127.0.0.1:8787');
        expect(options.consumer).toBe('testeso');
        expect(options.runtimeKey).toBe('cursor:cursor-agent');
        expect(options.adapter).toBe('dry');
        expect(options.maxSteps).toBe(1);
        expect(options.dryRun).toBe(false);
        expect(options.authKind).toBe('operator');
        expect(options.authToken).toBe('operator-token');
    });

    it('prefers a scoped host token', () => {
        const parsed = parseArgs(['run', '--prompt', 'x'], { ...ENV, ESO_HOST_TOKEN: 'host-token' });
        const options = parsed.options as ParsedRunOptions;
        expect(options.authKind).toBe('host');
        expect(options.authToken).toBe('host-token');
    });

    it('parses explicit flags (both --key value and --key=value)', () => {
        const parsed = parseArgs(
            [
                'run',
                '--prompt=pick the ticket',
                '--consumer',
                'testeso',
                '--runtime-key',
                'cursor:cursor-agent',
                '--flow',
                'that-tinh-tran',
                '--worker',
                'worker-verify',
                '--adapter',
                'cursor',
                '--model',
                'gpt-5.3-codex',
                '--max-steps',
                '3',
                '--timeout-ms',
                '9000',
                '--trace-id',
                'trace-x',
                '--dry-run',
                '--json',
                '--base-url',
                'http://127.0.0.1:9999',
            ],
            ENV,
        );
        expect(parsed.json).toBe(true);
        expect(parsed.options as ParsedRunOptions).toMatchObject({
            baseUrl: 'http://127.0.0.1:9999',
            prompt: 'pick the ticket',
            flowId: 'that-tinh-tran',
            workerId: 'worker-verify',
            adapter: 'cursor',
            model: 'gpt-5.3-codex',
            maxSteps: 3,
            timeoutMs: 9000,
            traceId: 'trace-x',
            dryRun: true,
        });
    });

    it('rejects invalid usage', () => {
        const cases: Array<[string[], Record<string, string | undefined>, string]> = [
            [['run', '--prompt', 'x'], {}, '--consumer is required'],
            [['run', '--prompt', 'x'], { ESO_CONSUMER: 'testeso' }, '--runtime-key must be'],
            [['run', '--prompt', 'x'], { ESO_CONSUMER: 'testeso', ESO_RUNTIME_KEY: 'a:b' }, 'no credential'],
            [['run', '--prompt', 'x', '--adapter', 'nope'], ENV, '--adapter must be'],
            [['run', '--prompt', 'x', '--max-steps', '0'], ENV, '--max-steps must be'],
            [['run', '--prompt', 'x', '--max-steps', '21'], ENV, '--max-steps must be'],
            [['run', '--prompt', 'x', '--timeout-ms', '-5'], ENV, '--timeout-ms must be'],
            [['run', '--prompt', 'x', '--bogus'], ENV, 'Unknown option'],
        ];
        for (const [argv, env, expected] of cases) {
            try {
                parseArgs(argv, env);
                throw new Error(`expected CliUsageError for ${argv.join(' ')}`);
            } catch (error) {
                expect(error instanceof CliUsageError).toBe(true);
                expect((error as Error).message).toContain(expected);
            }
        }
    });

    it('prints help and exits 0 through main', async () => {
        const captured = capture();
        const code = await main(['--help'], {}, captured.io);
        expect(code).toBe(0);
        expect(captured.out.join('')).toContain('USAGE');
    });

    it('returns exit code 2 for usage errors (text and json)', async () => {
        const textCapture = capture();
        expect(await main(['run', '--prompt', 'x'], {}, textCapture.io)).toBe(2);
        expect(textCapture.err.join('')).toContain('--consumer is required');

        const jsonCapture = capture();
        expect(await main(['run', '--prompt', 'x', '--json'], {}, jsonCapture.io)).toBe(2);
        const payload = JSON.parse(jsonCapture.out.join('')) as { ok: boolean; error: { code: string; message: string } };
        expect(payload.ok).toBe(false);
        expect(payload.error.code).toBe('ERROR');
        expect(payload.error.message).toContain('--consumer is required');
    });

    it('formats a human-readable report', () => {
        const text = formatReport(REPORT);
        expect(text).toContain('PASS  host-runtime run');
        expect(text).toContain('trace-1');
        expect(text).toContain('observation=obs-worker-build-1-trace-1');
        expect(text).toContain('stopped: max-steps');
    });
});
