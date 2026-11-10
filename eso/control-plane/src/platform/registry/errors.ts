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
    SCHEMA_MISMATCH: 409,
    PROFILE_DRIFT: 409,
    DATABASE_UNAVAILABLE: 503,
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
    SCHEMA_MISMATCH: 'Schema does not match consumer id',
    PROFILE_DRIFT: 'Profile artifact differs from the registry',
    DATABASE_UNAVAILABLE: 'Database is unavailable',
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
