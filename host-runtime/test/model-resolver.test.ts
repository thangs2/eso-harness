import { describe, expect, it } from 'bun:test';
import { ModelUnavailableError, resolveModel, tierEntry } from '../src/model-resolver';
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

    it('resolves fast/balanced/reasoning from the runtime modelTiers map', () => {
        const runtime = {
            hostId: 'agy',
            runtimeId: 'agy',
            runtimeKey: 'agy:agy',
            runtimeKind: 'acp',
            models: ['gemini-4-argon-high', 'gemini-4-argon-medium', 'gemini-4-argon-low'],
            defaultModel: 'gemini-4-argon-medium',
            modelTiers: {
                fast: { model: 'gemini-4-argon-low', effort: 'low' },
                balanced: { model: 'gemini-4-argon-medium', effort: 'medium' },
                reasoning: { model: 'gemini-4-argon-high', effort: 'high' },
            },
        };
        for (const [tier, expected] of [
            ['fast', 'gemini-4-argon-low'],
            ['balanced', 'gemini-4-argon-medium'],
            ['reasoning', 'gemini-4-argon-high'],
        ] as const) {
            const resolution = resolveModel({ runtime, placement: { workerId: 'w', modelTier: tier }, runtimeKey: 'agy:agy' });
            expect(resolution.model).toBe(expected);
            expect(resolution.source).toBe('tier');
            expect(resolution.tier).toBe(tier);
            expect(resolution.tierMapped).toBe(true);
            expect(resolution.effort).toBe(tier === 'fast' ? 'low' : tier === 'balanced' ? 'medium' : 'high');
            expect(resolution.warning).toBe(undefined);
        }
    });

    it('accepts a string tier entry and no effort', () => {
        const runtime = {
            hostId: 'agy',
            runtimeId: 'agy',
            runtimeKey: 'agy:agy',
            runtimeKind: 'acp',
            models: ['m'],
            defaultModel: 'd',
            modelTiers: { reasoning: 'm' },
        };
        const resolution = resolveModel({ runtime, placement: { workerId: 'w', modelTier: 'reasoning' }, runtimeKey: 'agy:agy' });
        expect(resolution.model).toBe('m');
        expect(resolution.source).toBe('tier');
        expect(resolution.effort).toBe(undefined);
    });

    it('falls back to defaultModel with MODEL_TIER_NOT_MAPPED when the tier is missing', () => {
        const runtime = {
            hostId: 'agy',
            runtimeId: 'agy',
            runtimeKey: 'agy:agy',
            runtimeKind: 'acp',
            models: ['gemini-4-argon-medium'],
            defaultModel: 'gemini-4-argon-medium',
            modelTiers: { fast: { model: 'gemini-4-argon-low' } },
        };
        const resolution = resolveModel({
            runtime,
            placement: { workerId: 'w', modelTier: 'reasoning' },
            runtimeKey: 'agy:agy',
        });
        expect(resolution.source).toBe('runtime-default');
        expect(resolution.tierMapped).toBe(false);
        expect(resolution.model).toBe('gemini-4-argon-medium');
        expect(resolution.warning).toBe('MODEL_TIER_NOT_MAPPED');
    });

    it('warns when a tier maps to a model outside the reported catalog', () => {
        const runtime = {
            hostId: 'agy',
            runtimeId: 'agy',
            runtimeKey: 'agy:agy',
            runtimeKind: 'acp',
            models: ['known'],
            defaultModel: 'known',
            modelTiers: { reasoning: { model: 'unlisted', effort: 'high' } },
        };
        const resolution = resolveModel({ runtime, placement: { workerId: 'w', modelTier: 'reasoning' }, runtimeKey: 'agy:agy' });
        expect(resolution.model).toBe('unlisted');
        expect(resolution.warning).toBe('MODEL_NOT_IN_RUNTIME_MODELS');
    });

    it('lets an explicit --model win over the tier map', () => {
        const runtime = {
            hostId: 'agy',
            runtimeId: 'agy',
            runtimeKey: 'agy:agy',
            runtimeKind: 'acp',
            models: ['tiered', 'explicit'],
            defaultModel: 'tiered',
            modelTiers: { reasoning: { model: 'tiered', effort: 'high' } },
        };
        const resolution = resolveModel({
            explicitModel: 'explicit',
            runtime,
            placement: { workerId: 'w', modelTier: 'reasoning' },
            runtimeKey: 'agy:agy',
        });
        expect(resolution.model).toBe('explicit');
        expect(resolution.source).toBe('explicit');
        expect(resolution.tierMapped).toBe(false);
    });

    it('normalizes tier entries and ignores invalid ones', () => {
        expect(tierEntry('m')).toEqual({ model: 'm' });
        expect(tierEntry({ model: 'm', effort: 'high' })).toEqual({ model: 'm', effort: 'high' });
        expect(tierEntry({ effort: 'high' })).toBe(null);
        expect(tierEntry('')).toBe(null);
        expect(tierEntry(42)).toBe(null);
        const runtime = {
            hostId: 'agy',
            runtimeId: 'agy',
            runtimeKey: 'agy:agy',
            runtimeKind: 'acp',
            models: ['default'],
            defaultModel: 'default',
            modelTiers: { reasoning: { effort: 'high' } },
        };
        const resolution = resolveModel({ runtime, placement: { workerId: 'w', modelTier: 'reasoning' }, runtimeKey: 'agy:agy' });
        expect(resolution.source).toBe('runtime-default');
        expect(resolution.warning).toBe('MODEL_TIER_NOT_MAPPED');
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
