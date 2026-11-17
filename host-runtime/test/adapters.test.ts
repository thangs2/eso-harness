import { describe, expect, it } from 'bun:test';
import { CURSOR_AGENT_ENV_VAR, CursorAdapter, cursorAgentCandidates } from '../src/adapters/cursor';
import { AgyAdapter, AGY_ENV_VAR } from '../src/adapters/agy';
import { sanitizeChildEnv, spawnProcess } from '../src/adapters/types';

const request = {
    workerId: 'worker-build',
    model: 'auto',
    prompt: 'Implement the P3 host runtime package for the ESO ticket.',
    timeoutMs: 5000,
};

describe('cursor adapter', () => {
    it('resolves the CLI from the env override', () => {
        const adapter = new CursorAdapter({ env: { [CURSOR_AGENT_ENV_VAR]: '/bin/echo' }, homeDir: '/nonexistent' });
        expect(adapter.resolve()).toBe('/bin/echo');
    });

    it('spawns the CLI with -p --model <model> <prompt> and captures output', async () => {
        const adapter = new CursorAdapter({ env: { [CURSOR_AGENT_ENV_VAR]: '/bin/echo', PATH: '' }, homeDir: '/nonexistent' });
        const result = await adapter.run(request);
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.blocked).toBe(false);
        expect(result.dry).toBe(false);
        expect(result.stdout).toContain('-p --model auto');
        expect(result.stdout).toContain(request.prompt);
        // The command recorded for logs masks the prompt body.
        expect(result.command).toEqual(['/bin/echo', '-p', '--model', 'auto', '<prompt>']);
        expect(result.command?.includes(request.prompt)).toBe(false);
    });

    it('blocks with ADAPTER_UNAVAILABLE when the CLI is missing', async () => {
        const adapter = new CursorAdapter({
            env: { [CURSOR_AGENT_ENV_VAR]: '/nonexistent/cursor-agent', PATH: '' },
            homeDir: '/nonexistent',
        });
        const result = await adapter.run(request);
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('ADAPTER_UNAVAILABLE');
        expect(result.command).toBe(null);
        expect(result.exitCode).toBe(null);
    });

    it('lists the known absolute Cursor agent locations', () => {
        const candidates = cursorAgentCandidates('/Users/someone');
        expect(candidates[0]).toContain('anysphere.cursor-agent-worker');
        expect(candidates[0].startsWith('/Users/someone/')).toBe(true);
    });
});

describe('agy adapter', () => {
    it('resolves from the env override and spawns the same contract', async () => {
        const adapter = new AgyAdapter({ env: { [AGY_ENV_VAR]: '/bin/echo', PATH: '' }, homeDir: '/nonexistent' });
        expect(adapter.resolve()).toBe('/bin/echo');
        const result = await adapter.run(request);
        expect(result.ok).toBe(true);
        expect(result.stdout).toContain('-p --model auto');
    });

    it('blocks when agy cannot be found', async () => {
        const adapter = new AgyAdapter({
            env: { [AGY_ENV_VAR]: '/nonexistent/agy', PATH: '' },
            homeDir: '/nonexistent',
        });
        const result = await adapter.run(request);
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('ADAPTER_UNAVAILABLE');
    });
});

describe('adapter plumbing', () => {
    it('enforces the process timeout', async () => {
        const result = await spawnProcess('/bin/sleep', ['5'], { timeoutMs: 120 });
        expect(result.timedOut).toBe(true);
        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(null);
        expect(result.durationMs).toBeLessThan(4000);
    });

    it('captures a successful process', async () => {
        const result = await spawnProcess('/bin/echo', ['hello'], { timeoutMs: 5000 });
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('hello');
        expect(result.timedOut).toBe(false);
    });

    it('strips ESO credentials from the child env', () => {
        const clean = sanitizeChildEnv({
            HOME: '/Users/x',
            ESO_HOST_TOKEN: 'host-token',
            ESO_OPERATOR_TOKEN: 'operator-token',
            ESO_AUTH_TOKEN: 'auth-token',
            PATH: '/usr/bin',
        });
        expect(clean.ESO_HOST_TOKEN).toBe(undefined);
        expect(clean.ESO_OPERATOR_TOKEN).toBe(undefined);
        expect(clean.ESO_AUTH_TOKEN).toBe(undefined);
        expect(clean.HOME).toBe('/Users/x');
        expect(clean.PATH).toBe('/usr/bin');
    });
});
