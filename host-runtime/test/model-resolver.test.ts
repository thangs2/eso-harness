import { describe, expect, it } from 'bun:test';
import { ModelUnavailableError, resolveModel } from '../src/model-resolver';
import { makeSnapshot, TEST_RUNTIME_KEY } from './fixtures';

describe('model-resolver', () => {
    it('lets an explicit --model win', async () => {
        const snapshot = await makeSnapshot();
        const runtime = snapshot.hosts[0].runtimes[0];
        const resolution = resolveModel({
            explicitModel: 'gpt-5.3-codex',
            runtime,
            placement: { workerId: 'worker-build', modelTier: 'balanced' },
            runtimeKey: TEST_RUNTIME_KEY,
        });
        expect(resolution.model).toBe('gpt-5.3-codex');
        expect(resolution.source).toBe('explicit');
        expect(resolution.modelKnownOnRuntime).toBe(true);
        expect(resolution.tier).toBe('balanced');
    });

    it('falls back to the host runtime default model and records the tier gap', async () => {
        const snapshot = await makeSnapshot();
        const runtime = snapshot.hosts[0].runtimes[0];
        const resolution = resolveModel({
            runtime,
            placement: { workerId: 'worker-build', modelTier: 'balanced' },
            runtimeKey: TEST_RUNTIME_KEY,
        });
        expect(resolution.model).toBe('auto');
        expect(resolution.source).toBe('runtime-default');
        expect(resolution.tier).toBe('balanced');
        expect(resolution.tierMapped).toBe(false);
        expect(resolution.warning).toBe('MODEL_TIER_NOT_MAPPED');
    });

    it('warns when an explicit model is not in the runtime model list', async () => {
        const snapshot = await makeSnapshot();
        const runtime = snapshot.hosts[0].runtimes[0];
        const resolution = resolveModel({ explicitModel: 'custom-model', runtime, runtimeKey: TEST_RUNTIME_KEY });
        expect(resolution.warning).toBe('MODEL_NOT_IN_RUNTIME_MODELS');
    });

    it('records no warning when the runtime reports no models', () => {
        const resolution = resolveModel({
            explicitModel: 'anything',
            runtime: { hostId: 'x', runtimeId: 'y', runtimeKey: 'x:y', runtimeKind: 'cli', models: [] },
            runtimeKey: 'x:y',
        });
        expect(resolution.warning).toBe(undefined);
    });

    it('blocks with MODEL_UNAVAILABLE when nothing resolves', () => {
        try {
            resolveModel({
                runtime: { hostId: 'x', runtimeId: 'y', runtimeKey: 'x:y', runtimeKind: 'cli', models: ['m'], defaultModel: null },
                placement: { workerId: 'w', modelTier: 'fast' },
                runtimeKey: 'x:y',
            });
            throw new Error('expected ModelUnavailableError');
        } catch (error) {
            expect(error instanceof ModelUnavailableError).toBe(true);
            expect((error as ModelUnavailableError).code).toBe('MODEL_UNAVAILABLE');
            expect((error as ModelUnavailableError).tier).toBe('fast');
        }
    });

    it('ignores a blank explicit model', async () => {
        const snapshot = await makeSnapshot();
        const resolution = resolveModel({
            explicitModel: '   ',
            runtime: snapshot.hosts[0].runtimes[0],
            runtimeKey: TEST_RUNTIME_KEY,
        });
        expect(resolution.source).toBe('runtime-default');
        expect(resolution.model).toBe('auto');
    });
});
