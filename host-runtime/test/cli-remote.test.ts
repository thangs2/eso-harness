import { describe, expect, it } from 'bun:test';
import { CliUsageError, formatDispatchReport, helpText, main, parseArgs } from '../src/cli';
import type { ParsedDispatchOptions, ParsedFlushOptions, ParsedServeOptions } from '../src/cli';
import type { DispatchReport } from '../src/remote/dispatch';

const ENV = {
    ESO_CONSUMER: 'testeso',
    ESO_RUNTIME_KEY: 'cursor:cursor-agent',
    ESO_AUTH_TOKEN: 'operator-token',
    ESO_REMOTE_TOKEN: 'modeb-shared-secret-1234',
};

const SERVE_ENV = {
    ESO_CONSUMER: 'testeso',
    ESO_RUNTIME_KEY: 'agy:agy',
    ESO_HOST_TOKEN: 'b-host-token',
    ESO_REMOTE_TOKEN: 'modeb-shared-secret-1234',
    ESO_REMOTE_ALLOWED_WS: '/tmp/allowed-a, /tmp/allowed-b',
};

function expectUsage(fn: () => unknown, needle: string): void {
    try {
        fn();
        throw new Error(`expected CliUsageError containing: ${needle}`);
    } catch (error) {
        expect(error instanceof CliUsageError).toBe(true);
        expect((error as Error).message).toContain(needle);
    }
}

const REPORT: DispatchReport = {
    ok: true,
    jobId: 'p4-dry',
    fromRuntimeKey: 'cursor:cursor-agent',
    toRuntimeKey: 'agy:agy',
    remoteUrl: 'http://127.0.0.1:8788',
    remoteHttpStatus: 200,
    outcome: 'PASS',
    remoteObservationId: 'obs-worker-build-1-p4-dry',
    localObservationId: 'obs-remote-cursor-cursor-agent-agy-agy-p4-dry',
    localObservationCreated: true,
    workerId: 'worker-build',
    flowId: 'that-tinh-tran',
    snapshotVersion: 'a'.repeat(64),
    snapshotVersionValid: true,
    snapshotSource: 'network',
    model: 'gemini-4-argon-high',
    modelSource: 'tier',
    effort: 'high',
    tier: 'reasoning',
    transportDurationMs: 12,
    durationMs: 20,
    warnings: [],
};

describe('cli — Mode B dispatch', () => {
    it('parses dispatch defaults from env', () => {
        const parsed = parseArgs(['dispatch', '--to-runtime-key', 'agy:agy', '--prompt', 'do the remote work'], ENV);
        expect(parsed.command).toBe('dispatch');
        const options = parsed.options as ParsedDispatchOptions;
        expect(options.kind).toBe('dispatch');
        expect(options.baseUrl).toBe('http://127.0.0.1:8787');
        expect(options.consumer).toBe('testeso');
        expect(options.fromRuntimeKey).toBe('cursor:cursor-agent');
        expect(options.toRuntimeKey).toBe('agy:agy');
        expect(options.adapter).toBe('dry');
        expect(options.dryRun).toBe(false);
        expect(options.maxSteps).toBe(1);
        expect(options.remoteToken).toBe('modeb-shared-secret-1234');
        expect(options.authKind).toBe('operator');
        expect(options.remoteTimeoutMs).toBeGreaterThan(0);
    });

    it('parses explicit dispatch flags', () => {
        const parsed = parseArgs(
            [
                'dispatch',
                '--from-runtime-key',
                'cursor:cursor-agent',
                '--to-runtime-key',
                'agy:agy',
                '--prompt',
                'remote work',
                '--flow',
                'that-tinh-tran',
                '--worker',
                'worker-build',
                '--adapter',
                'dry',
                '--model',
                'gemini-4-argon-medium',
                '--max-steps',
                '2',
                '--remote-url',
                'http://127.0.0.1:8788',
                '--remote-token',
                'another-secret-123',
                '--remote-timeout-ms',
                '5000',
                '--workspace-repo',
                '/tmp/ws',
                '--workspace-branch',
                'main',
                '--workspace-commit',
                'abc123',
                '--trace-id',
                'p4-dry',
                '--job-id',
                'p4-dry-step-1',
                '--dry-run',
                '--offline',
                '--cache-dir',
                '/tmp/cache',
                '--buffer-dir',
                '/tmp/buffer',
                '--json',
            ],
            ENV,
        );
        const options = parsed.options as ParsedDispatchOptions;
        expect(parsed.json).toBe(true);
        expect(options).toMatchObject({
            flowId: 'that-tinh-tran',
            workerId: 'worker-build',
            adapter: 'dry',
            model: 'gemini-4-argon-medium',
            maxSteps: 2,
            remoteUrl: 'http://127.0.0.1:8788',
            remoteToken: 'another-secret-123',
            remoteTimeoutMs: 5000,
            workspaceRepo: '/tmp/ws',
            workspaceBranch: 'main',
            workspaceCommit: 'abc123',
            traceId: 'p4-dry',
            jobId: 'p4-dry-step-1',
            dryRun: true,
            offline: true,
            cacheDir: '/tmp/cache',
            bufferDir: '/tmp/buffer',
        });
    });

    it('falls back to ESO_REMOTE_URL and a scoped host token', () => {
        const parsed = parseArgs(['dispatch', '--to-runtime-key', 'agy:agy', '--prompt', 'x'], {
            ...ENV,
            ESO_REMOTE_URL: 'http://127.0.0.1:9999',
            ESO_HOST_TOKEN: 'a-host-token',
        });
        const options = parsed.options as ParsedDispatchOptions;
        expect(options.remoteUrl).toBe('http://127.0.0.1:9999');
        expect(options.authKind).toBe('host');
        expect(options.authToken).toBe('a-host-token');
    });

    it('rejects invalid dispatch usage', () => {
        expectUsage(() => parseArgs(['dispatch', '--prompt', 'x'], ENV), '--to-runtime-key');
        expectUsage(
            () => parseArgs(['dispatch', '--from-runtime-key', 'agy:agy', '--to-runtime-key', 'agy:agy', '--prompt', 'x'], ENV),
            'must differ',
        );
        expectUsage(() => parseArgs(['dispatch', '--to-runtime-key', 'agy:agy'], ENV), '--prompt is required');
        expectUsage(
            () => parseArgs(['dispatch', '--to-runtime-key', 'agy:agy', '--prompt', 'x'], { ...ENV, ESO_REMOTE_TOKEN: '' }),
            'ESO_REMOTE_TOKEN is required',
        );
        expectUsage(
            () => parseArgs(['dispatch', '--to-runtime-key', 'agy:agy', '--prompt', 'x', '--adapter', 'nope'], ENV),
            '--adapter must be',
        );
    });
});

describe('cli — Mode B serve', () => {
    it('parses serve defaults, env tokens and allowed workspaces', () => {
        const parsed = parseArgs(['serve', '--runtime-key', 'agy:agy', '--allowed-workspace', '/tmp/allowed-c'], SERVE_ENV);
        expect(parsed.command).toBe('serve');
        const options = parsed.options as ParsedServeOptions;
        expect(options.kind).toBe('serve');
        expect(options.runtimeKey).toBe('agy:agy');
        expect(options.host).toBe('127.0.0.1');
        expect(options.port).toBe(8788);
        expect(options.hostToken).toBe('b-host-token');
        expect(options.remoteToken).toBe('modeb-shared-secret-1234');
        expect(options.allowedWorkspaces).toEqual(['/tmp/allowed-a', '/tmp/allowed-b', '/tmp/allowed-c']);
    });

    it('honours explicit host and port', () => {
        const parsed = parseArgs(
            ['serve', '--runtime-key', 'agy:agy', '--host', '0.0.0.0', '--port', '9100', '--ledger-path', '/tmp/ledger.json'],
            SERVE_ENV,
        );
        const options = parsed.options as ParsedServeOptions;
        expect(options.host).toBe('0.0.0.0');
        expect(options.port).toBe(9100);
        expect(options.ledgerPath).toBe('/tmp/ledger.json');
    });

    it('rejects invalid serve usage', () => {
        expectUsage(() => parseArgs(['serve', '--runtime-key', 'agy:agy'], { ...SERVE_ENV, ESO_HOST_TOKEN: '' }), 'ESO_HOST_TOKEN');
        expectUsage(
            () => parseArgs(['serve', '--runtime-key', 'agy:agy'], { ...SERVE_ENV, ESO_REMOTE_TOKEN: 'short' }),
            'ESO_REMOTE_TOKEN',
        );
        expectUsage(() => parseArgs(['serve', '--runtime-key', 'agy'], SERVE_ENV), 'serve --runtime-key');
        expectUsage(() => parseArgs(['serve', '--runtime-key', 'agy:agy', '--port', '0'], SERVE_ENV), '--port must be');
        expectUsage(() => parseArgs(['serve', '--runtime-key', 'agy:agy', '--port', '70000'], SERVE_ENV), '--port must be');
    });
});

describe('cli — flush buffered observations', () => {
    it('parses flush-observations with cache/buffer dirs', () => {
        const parsed = parseArgs(
            ['flush-observations', '--consumer', 'testeso', '--cache-dir', '/tmp/cache', '--buffer-dir', '/tmp/buffer', '--json'],
            ENV,
        );
        expect(parsed.command).toBe('flush-observations');
        expect(parsed.json).toBe(true);
        const options = parsed.options as ParsedFlushOptions;
        expect(options.kind).toBe('flush-observations');
        expect(options.consumer).toBe('testeso');
        expect(options.cacheDir).toBe('/tmp/cache');
        expect(options.bufferDir).toBe('/tmp/buffer');
        expect(options.authToken).toBe('operator-token');
    });

    it('requires a consumer and a credential', () => {
        expectUsage(() => parseArgs(['flush-observations'], {}), '--consumer is required');
        expectUsage(
            () => parseArgs(['flush-observations', '--consumer', 'testeso'], { ESO_CONSUMER: 'testeso' }),
            'no credential',
        );
    });

    it('returns exit code 2 with a JSON error when used without a credential', async () => {
        const out: string[] = [];
        const code = await main(
            ['flush-observations', '--consumer', 'testeso', '--json'],
            { ESO_CONSUMER: 'testeso' },
            { stdout: (text) => out.push(text), stderr: () => undefined },
        );
        expect(code).toBe(2);
        const payload = JSON.parse(out.join('')) as { ok: boolean; error: { message: string } };
        expect(payload.ok).toBe(false);
        expect(payload.error.message).toContain('no credential');
    });

    it('documents flush-observations in --help', () => {
        expect(helpText()).toContain('flush-observations');
        expect(helpText()).toContain('--offline');
    });
});

describe('cli — Mode B entry points', () => {
    it('documents dispatch and serve in --help', () => {
        const text = helpText();
        expect(text).toContain('DISPATCH (Mode B');
        expect(text).toContain('SERVE (Mode B');
        expect(text).toContain('--to-runtime-key');
        expect(text).toContain('ESO_REMOTE_TOKEN');
    });

    it('prints help through main', async () => {
        const out: string[] = [];
        const code = await main(['--help'], {}, { stdout: (text) => out.push(text), stderr: () => undefined });
        expect(code).toBe(0);
        expect(out.join('')).toContain('DISPATCH (Mode B');
    });

    it('returns exit code 2 with a JSON error for dispatch usage errors', async () => {
        const out: string[] = [];
        const code = await main(
            ['dispatch', '--to-runtime-key', 'agy:agy', '--prompt', 'x', '--json'],
            { ESO_CONSUMER: 'testeso', ESO_RUNTIME_KEY: 'cursor:cursor-agent', ESO_AUTH_TOKEN: 'tok' },
            { stdout: (text) => out.push(text), stderr: () => undefined },
        );
        expect(code).toBe(2);
        const payload = JSON.parse(out.join('')) as { ok: boolean; error: { message: string } };
        expect(payload.ok).toBe(false);
        expect(payload.error.message).toContain('ESO_REMOTE_TOKEN');
    });

    it('returns exit code 2 for a serve config error', async () => {
        const err: string[] = [];
        const code = await main(
            ['serve', '--runtime-key', 'agy:agy'],
            { ESO_CONSUMER: 'testeso' },
            { stdout: () => undefined, stderr: (text) => err.push(text) },
        );
        expect(code).toBe(2);
        expect(err.join('')).toContain('ESO_HOST_TOKEN');
    });

    it('formats a dispatch report', () => {
        const text = formatDispatchReport(REPORT);
        expect(text).toContain('PASS  host-runtime dispatch (Mode B)');
        expect(text).toContain('route      cursor:cursor-agent -> agy:agy');
        expect(text).toContain('model      gemini-4-argon-high (effort high) [tier]');
        expect(text).toContain('remoteObs  obs-worker-build-1-p4-dry');
        expect(text).toContain('localObs   obs-remote-cursor-cursor-agent-agy-agy-p4-dry');
    });

    it('surfaces hardening warnings in the dispatch report', () => {
        const text = formatDispatchReport({
            ...REPORT,
            warnings: ['SNAPSHOT_CACHE_USED:ageMs=1200', 'OBSERVATIONS_BUFFERED:obs-x'],
        });
        expect(text).toContain('warnings   SNAPSHOT_CACHE_USED:ageMs=1200, OBSERVATIONS_BUFFERED:obs-x');
    });
});
