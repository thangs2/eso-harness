import { describe, expect, it } from 'bun:test';
import { DryAdapter } from '../src/adapters/dry';

const request = {
    workerId: 'worker-build',
    model: 'auto',
    prompt: 'Implement the P3 host runtime package for the ESO ticket.',
    timeoutMs: 1000,
};

describe('dry adapter', () => {
    it('is deterministic, spawns nothing and passes', async () => {
        const adapter = new DryAdapter();
        const first = await adapter.run(request);
        const second = await adapter.run(request);
        expect(first).toEqual(second);
        expect(first.adapter).toBe('dry');
        expect(first.command).toBe(null);
        expect(first.dry).toBe(true);
        expect(first.blocked).toBe(false);
        expect(first.exitCode).toBe(0);
        expect(first.ok).toBe(true);
        expect(first.durationMs).toBe(0);
        expect(first.stdout).toContain('OUTCOME: PASS');
    });

    it('never echoes the prompt body', async () => {
        const result = await new DryAdapter().run(request);
        expect(result.stdout.includes(request.prompt)).toBe(false);
        expect(result.stderr).toBe('');
        expect(result.stdout).toContain('worker=worker-build');
        expect(result.stdout).toContain('model=auto');
    });
});
