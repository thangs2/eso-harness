/**
 * Model resolution — host-side only.
 *
 * ESO never maps models and never calls them. The snapshot carries three different things:
 *   - `workerPlacement.modelTier`    : a placement intent (fast | balanced | reasoning)
 *   - `hostRuntime.modelTiers`       : P5 host-reported catalog {tier: {model, effort?}}
 *   - `hostRuntime.defaultModel`     : the host runtime's plain default model
 *
 * Resolution order:
 *   1. explicit `--model` (wins)
 *   2. host runtime `modelTiers[placement.modelTier]` (model + optional effort recorded)
 *   3. host runtime `defaultModel` (warning MODEL_TIER_NOT_MAPPED when a tier was requested)
 *   4. block with MODEL_UNAVAILABLE
 */

import type { SnapshotHostRuntime, SnapshotPlacement } from './config-client';

export interface ModelResolution {
    model: string;
    source: 'explicit' | 'tier' | 'runtime-default';
    /** Placement tier the worker asked for, if any. */
    tier: string | null;
    /** True when a tier entry mapped the tier to a concrete model. */
    tierMapped: boolean;
    /** Effort advertised by the tier map (fast/medium/high/...), recorded in evidence. */
    effort?: string;
    /** Whether the resolved model appears in the host runtime's reported model list. */
    modelKnownOnRuntime: boolean;
    warning?: string;
}

export interface ModelTierEntry {
    model: string;
    effort?: string;
}

export class ModelUnavailableError extends Error {
    readonly code = 'MODEL_UNAVAILABLE';
    readonly runtimeKey: string;
    readonly tier: string | null;

    constructor(message: string, details: { runtimeKey: string; tier: string | null }) {
        super(message);
        this.name = 'ModelUnavailableError';
        this.runtimeKey = details.runtimeKey;
        this.tier = details.tier;
    }
}

export interface ResolveModelInput {
    explicitModel?: string | null;
    runtime?: SnapshotHostRuntime | null;
    placement?: SnapshotPlacement | null;
    runtimeKey: string;
}

/** Normalize a tier entry: `"model"` or `{model, effort?}`. Invalid entries are ignored. */
export function tierEntry(value: unknown): ModelTierEntry | null {
    if (typeof value === 'string') {
        const model = value.trim();
        return model ? { model } : null;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const model = typeof record.model === 'string' ? record.model.trim() : '';
        if (!model) return null;
        const effortRaw = record.effort;
        const effort = typeof effortRaw === 'string' && effortRaw.trim() ? effortRaw.trim() : undefined;
        return effort ? { model, effort } : { model };
    }
    return null;
}

export function resolveModel(input: ResolveModelInput): ModelResolution {
    const tier = (input.placement?.modelTier ?? '').trim() || null;
    const runtimeModels = Array.isArray(input.runtime?.models) ? input.runtime!.models! : [];
    const explicit = (input.explicitModel ?? '').trim();
    const tierMap = input.runtime?.modelTiers;
    const mapped = tier && tierMap && typeof tierMap === 'object' ? tierEntry(tierMap[tier]) : null;

    if (explicit) {
        return {
            model: explicit,
            source: 'explicit',
            tier,
            tierMapped: false,
            modelKnownOnRuntime: runtimeModels.length === 0 || runtimeModels.includes(explicit),
            warning: runtimeModels.length && !runtimeModels.includes(explicit) ? 'MODEL_NOT_IN_RUNTIME_MODELS' : undefined,
        };
    }

    if (mapped) {
        const resolution: ModelResolution = {
            model: mapped.model,
            source: 'tier',
            tier,
            tierMapped: true,
            modelKnownOnRuntime: runtimeModels.length === 0 || runtimeModels.includes(mapped.model),
        };
        if (mapped.effort) resolution.effort = mapped.effort;
        if (runtimeModels.length && !runtimeModels.includes(mapped.model)) {
            resolution.warning = 'MODEL_NOT_IN_RUNTIME_MODELS';
        }
        return resolution;
    }

    const defaultModel = (input.runtime?.defaultModel ?? '').trim();
    if (defaultModel) {
        return {
            model: defaultModel,
            source: 'runtime-default',
            tier,
            tierMapped: false,
            modelKnownOnRuntime: runtimeModels.length === 0 || runtimeModels.includes(defaultModel),
            warning: tier ? 'MODEL_TIER_NOT_MAPPED' : undefined,
        };
    }

    throw new ModelUnavailableError(
        `No model available for runtime ${input.runtimeKey}: no --model, no modelTiers entry and no defaultModel`,
        { runtimeKey: input.runtimeKey, tier },
    );
}
