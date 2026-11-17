/**
 * Model resolution — host-side only.
 *
 * ESO never maps models and never calls them. The snapshot carries two different things:
 *   - `workerPlacement.modelTier`  : a placement intent (fast | balanced | reasoning)
 *   - `hostRuntimes[].defaultModel`: the model the host runtime reported for itself
 *
 * There is deliberately NO tier→model catalog on the host: inventing one would fake a mapping ESO
 * does not define. This module resolves the concrete model and reports the gap in evidence.
 *
 * Resolution order:
 *   1. explicit `--model` (wins)
 *   2. host runtime `defaultModel` (tier is recorded but NOT mapped; warned as MODEL_TIER_NOT_MAPPED)
 *   3. block with MODEL_UNAVAILABLE
 */

import type { SnapshotHostRuntime, SnapshotPlacement } from './config-client';

export interface ModelResolution {
    model: string;
    source: 'explicit' | 'runtime-default';
    /** Placement tier the worker asked for, if any (recorded, not mapped). */
    tier: string | null;
    /** True only when a real catalog mapped the tier — always false today. */
    tierMapped: boolean;
    /** Whether the resolved model appears in the host runtime's reported model list. */
    modelKnownOnRuntime: boolean;
    warning?: string;
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

export function resolveModel(input: ResolveModelInput): ModelResolution {
    const tier = (input.placement?.modelTier ?? '').trim() || null;
    const runtimeModels = Array.isArray(input.runtime?.models) ? input.runtime!.models! : [];
    const explicit = (input.explicitModel ?? '').trim();

    if (explicit) {
        return {
            model: explicit,
            source: 'explicit',
            tier,
            tierMapped: false,
            modelKnownOnRuntime: runtimeModels.includes(explicit),
            warning: runtimeModels.length && !runtimeModels.includes(explicit)
                ? 'MODEL_NOT_IN_RUNTIME_MODELS'
                : undefined,
        };
    }

    const defaultModel = (input.runtime?.defaultModel ?? '').trim();
    if (defaultModel) {
        return {
            model: defaultModel,
            source: 'runtime-default',
            tier,
            tierMapped: false,
            modelKnownOnRuntime: runtimeModels.length === 0 || runtimeModels.includes(defaultModel),
            // Documented gap: placement tier is not a model catalog. Recorded in evidence, never faked.
            warning: tier ? 'MODEL_TIER_NOT_MAPPED' : undefined,
        };
    }

    throw new ModelUnavailableError(
        `No model available for runtime ${input.runtimeKey}: no --model and the host runtime reports no defaultModel`,
        { runtimeKey: input.runtimeKey, tier },
    );
}
