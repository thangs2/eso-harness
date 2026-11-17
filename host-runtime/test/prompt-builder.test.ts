import { describe, expect, it } from 'bun:test';
import { OUTCOME_CONTRACT, buildPrompt, promptFingerprint } from '../src/prompt-builder';
import { makeSnapshot } from './fixtures';

async function input() {
    const snapshot = await makeSnapshot();
    const worker = snapshot.workers.find((item) => item.id === 'worker-build');
    const placement = snapshot.workerPlacement.find((item) => item.workerId === 'worker-build');
    if (!worker || !placement || !snapshot.flow) throw new Error('fixture is incomplete');
    return {
        consumerId: snapshot.consumer.id,
        runtimeKey: 'cursor:cursor-agent',
        flow: snapshot.flow,
        worker,
        placement,
        model: 'auto',
        adapter: 'dry',
        userPrompt: 'Implement the P3 host runtime package.',
        hostStep: 1,
        maxSteps: 1,
    };
}

describe('prompt-builder', () => {
    it('builds a deterministic prompt with worker, flow and user request context', async () => {
        const data = await input();
        const first = buildPrompt(data);
        const second = buildPrompt(data);
        expect(first).toBe(second);
        expect(first).toContain('You are worker worker-build');
        expect(first).toContain('build instructions');
        expect(first).toContain('Flow: that-tinh-tran');
        expect(first).toContain('Host runtime: cursor:cursor-agent');
        expect(first).toContain('Model: auto');
        expect(first).toContain('Implement the P3 host runtime package.');
        expect(first).toContain(OUTCOME_CONTRACT);
    });

    it('never includes a token or secret', async () => {
        const data = await input();
        const text = buildPrompt({ ...data, worker: { ...data.worker, instructions: 'instructions' } });
        expect(text.includes('eso-dev-only-token')).toBe(false);
        expect(text.toLowerCase().includes('authorization: bearer')).toBe(false);
    });

    it('reports a stable short fingerprint', async () => {
        const data = await input();
        const prompt = buildPrompt(data);
        const fingerprint = await promptFingerprint(prompt);
        expect(fingerprint).toHaveLength(16);
        expect(fingerprint).toBe(await promptFingerprint(prompt));
        expect(await promptFingerprint(`${prompt} `)).not.toBe(fingerprint);
    });
});
