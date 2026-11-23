/**
 * Canonical capability vocabulary (REQ-30 / AC-30-3).
 *
 * This list is the *definition* of a valid capability kind. It is static on purpose: a kind that
 * has never shipped must be `UNKNOWN_CAPABILITY`, not "some host did not have it" (`none`).
 * Measured host support lives in host-capability.json — it never defines the vocabulary.
 */
export const CAPABILITY_KINDS = Object.freeze([
    'llm',
    'embedding',
    'tool',
    'mcp',
    'vision',
    'subagent',
    'memory',
    'remote',
    'ci',
]);

export function isCapabilityKind(value) {
    return typeof value === 'string' && CAPABILITY_KINDS.includes(value);
}

/** Throws a coded error so the API layer can answer 422 `UNKNOWN_CAPABILITY`. */
export function assertCapabilityKind(value) {
    if (!isCapabilityKind(value)) {
        const err = new Error(`UNKNOWN_CAPABILITY: '${String(value)}' is not a declared capability kind`);
        err.code = 'UNKNOWN_CAPABILITY';
        err.capabilityKind = value;
        throw err;
    }
    return value;
}
