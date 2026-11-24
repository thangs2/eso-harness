/**
 * Domain errors for the platform registry.
 *
 * Codes are registered in sdlc/05.requirements/01.specification/04.srs/04.external-interfaces.md.
 * The HTTP envelope (L2.2) maps them to `{code,message,detail?}`; the registry itself never
 * invents a code.
 */

export const ERROR_STATUS: Readonly<Record<string, number>> = {
    AUTH_REQUIRED: 401,
    AUTH_INVALID: 401,
    AUTH_NOT_CONFIGURED: 500,
    INVALID_CONSUMER_ID: 400,
    ROOT_NOT_FOUND: 422,
    PROFILE_INVALID: 422,
    CONSUMER_EXISTS: 409,
    CONSUMER_NOT_FOUND: 404,
    STALE_VERSION: 409,
    INVALID_STATE: 409,
    PURGE_CONFIRM_MISMATCH: 409,
    MATERIALIZE_FAILED: 500,
    MATERIAL_FAILED: 500,
    PROVISION_FAILED: 500,
    SETUP_INFO_MISSING: 500,
    SCHEMA_MISMATCH: 409,
    PROFILE_DRIFT: 409,
    DATABASE_UNAVAILABLE: 503,
    WORKER_INVALID: 422,
    WORKER_WRITE_FAILED: 500,
    EDGES_MOVED_TO_FLOW: 422,
    // BUG-39: flow publish/default failures must not return HTTP 200 {ok:false}.
    FLOW_INVALID: 422,
    FLOW_NO_DRAFT: 409,
    HOST_RUNTIME_INVALID: 422,
    HOST_RUNTIME_NOT_FOUND: 404,
    HOST_TOKEN_NOT_FOUND: 404,
    NOT_FOUND: 404,
    DOC_CONTRACT_VIOLATION: 409,
    WORKER_NOT_FOUND: 404,
    WORKER_PLACEMENT_INVALID: 422,
    OBSERVATION_INVALID: 422,
    SCHEMA_UNSUPPORTED: 422,
    // P8 pipeline v2 — a JEV report in shadow/active must carry the confidence it came from (B0-3).
    JEV_CONFIDENCE_REQUIRED: 422,
    // F-28 evidence ingest (AC-36)
    INVALID_EVENT: 400,
    UNKNOWN_SCHEMA: 400,
    PAYLOAD_TOO_LARGE: 413,
    // F-29 harness adapter packaging (AC-37)
    UNSUPPORTED_HOST: 422,
    MISSING_MANIFEST: 422,
    VERSION_MISMATCH: 409,
    CORE_IMPORTS_HOST_SDK: 422,
    // F-12/F-16 human approval (AC-20, AC-24)
    NEEDS_APPROVAL: 409,
    FORBIDDEN_ACTOR: 403,
    UNKNOWN_ACTOR: 403,
    // F-30 host capability probe (AC-38) / F-33 host sync (AC-41)
    PROBE_BLOCKED: 403,
    CANONICAL_MISSING: 422,
    HOST_UNSUPPORTED: 422,
    PROJECTION_CONFLICT: 409,
    SYNC_FAILED: 500,
};

export const ERROR_MESSAGE: Readonly<Record<string, string>> = {
    AUTH_REQUIRED: 'Authentication required',
    AUTH_INVALID: 'Invalid credentials',
    AUTH_NOT_CONFIGURED: 'Authentication is not configured',
    INVALID_CONSUMER_ID: 'Invalid consumer id',
    ROOT_NOT_FOUND: 'Consumer root does not exist or is not a directory',
    PROFILE_INVALID: 'Profile artifact is not valid JSON',
    CONSUMER_EXISTS: 'Consumer already exists',
    CONSUMER_NOT_FOUND: 'Consumer not found',
    STALE_VERSION: 'Consumer version is stale',
    INVALID_STATE: 'Transition is not allowed from the current state',
    PURGE_CONFIRM_MISMATCH: 'Purge confirmation does not match the consumer id',
    MATERIALIZE_FAILED: 'Could not materialize the consumer profile',
    MATERIAL_FAILED: 'Could not provision material bundle',
    PROVISION_FAILED: 'Consumer provisioning failed',
    SETUP_INFO_MISSING: 'Setup info is missing or could not be persisted',
    SCHEMA_MISMATCH: 'Schema does not match consumer id',
    PROFILE_DRIFT: 'Profile artifact differs from the registry',
    DATABASE_UNAVAILABLE: 'Database is unavailable',
    WORKER_INVALID: 'Worker definition is invalid',
    WORKER_WRITE_FAILED: 'Could not write worker files',
    EDGES_MOVED_TO_FLOW: 'Worker edges are defined by flows',
    FLOW_INVALID: 'Flow definition is invalid',
    FLOW_NO_DRAFT: 'Flow has no draft to publish',
    HOST_RUNTIME_INVALID: 'Host runtime registration is invalid',
    HOST_RUNTIME_NOT_FOUND: 'Host runtime not found',
    HOST_TOKEN_NOT_FOUND: 'Host token not found',
    NOT_FOUND: 'Record not found',
    DOC_CONTRACT_VIOLATION: 'Derived content contradicts its source',
    WORKER_NOT_FOUND: 'Worker not found',
    WORKER_PLACEMENT_INVALID: 'Worker host placement is invalid',
    OBSERVATION_INVALID: 'Observation is invalid',
    SCHEMA_UNSUPPORTED: 'Observation schema version is not supported',
    JEV_CONFIDENCE_REQUIRED: 'JEV report requires a confidence when mode is shadow or active',
    INVALID_EVENT: 'Evidence event is invalid',
    UNKNOWN_SCHEMA: 'Event schema is not registered',
    PAYLOAD_TOO_LARGE: 'Batch or payload exceeds the ingest limit',
    UNSUPPORTED_HOST: 'Host is not in the adapter catalog',
    MISSING_MANIFEST: 'Adapter manifest, component or entrypoint is missing',
    VERSION_MISMATCH: 'Manifest version does not match protocol/core',
    CORE_IMPORTS_HOST_SDK: 'Harness core must not import a host SDK or adapter',
    NEEDS_APPROVAL: 'Human approval is required for this action',
    FORBIDDEN_ACTOR: 'Actor is not allowed to perform this action',
    UNKNOWN_ACTOR: 'Actor identity is unknown',
    PROBE_BLOCKED: 'Host probe is blocked by policy',
    CANONICAL_MISSING: 'Canonical harness is missing',
    HOST_UNSUPPORTED: 'Host is not supported',
    PROJECTION_CONFLICT: 'Projection merge is not safe',
    SYNC_FAILED: 'Could not write host projection',
};

export class PlatformError extends Error {
    readonly code: string;
    readonly status: number;
    readonly detail?: string;

    constructor(code: string, detail?: string) {
        if (!(code in ERROR_STATUS)) {
            throw new Error(`unregistered platform error code: ${code}`);
        }
        super(ERROR_MESSAGE[code]);
        this.name = 'PlatformError';
        this.code = code;
        this.status = ERROR_STATUS[code];
        this.detail = detail;
    }
}

export function fail(code: string, detail?: string): never {
    throw new PlatformError(code, detail);
}

export function isPlatformError(error: unknown): error is PlatformError {
    return error instanceof PlatformError;
}
