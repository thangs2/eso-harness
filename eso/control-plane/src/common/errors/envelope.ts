import { PlatformError, ERROR_MESSAGE, ERROR_STATUS } from '../../platform/registry/errors.js';

/**
 * L2.2 — one error envelope for every endpoint.
 *
 * Contract: sdlc/05.requirements/01.specification/04.srs/04.external-interfaces.md §1 and
 * sdlc/05.requirements/01.specification/02.brd/06.use-cases.md §1.
 * The success body never carries `code`; a failure body is exactly `{code,message,detail?}`.
 */
export const BRD_ERROR_CODES: ReadonlySet<string> = new Set([
    'ROOT_NOT_FOUND',
    'CONSUMER_EXISTS',
    'STALE_VERSION',
    'CONSUMER_NOT_FOUND',
    'DATABASE_UNAVAILABLE',
    'NOT_FOUND',
    'OBSERVATION_INVALID',
    // P1 contract: registered in ERROR_STATUS and BRD/06, so the envelope set must know it too.
    'SCHEMA_UNSUPPORTED',
    'EDGES_MOVED_TO_FLOW',
    'FLOW_INVALID',
    'FLOW_NO_DRAFT',
    'WORKER_PLACEMENT_INVALID',
    'WORKER_NOT_FOUND',
    'HOST_TOKEN_NOT_FOUND',
    'HOST_RUNTIME_NOT_FOUND',
    'HOST_RUNTIME_INVALID',
    'WORKER_WRITE_FAILED',
    'WORKER_INVALID',
    'PROFILE_DRIFT',
    'PURGE_CONFIRM_MISMATCH',
    'INVALID_CONSUMER_ID',
    'AUTH_REQUIRED',
    'AUTH_INVALID',
    'AUTH_NOT_CONFIGURED',
    'INVALID_STATE',
    'MATERIALIZE_FAILED',
    'MATERIAL_FAILED',
    'PROVISION_FAILED',
    'SETUP_INFO_MISSING',
    'SCHEMA_MISMATCH',
    'PROFILE_INVALID',
    'INVALID_TASK',
    'NEEDS_APPROVAL',
    'FORBIDDEN_ACTOR',
    'UNKNOWN_ACTOR',
    'UNKNOWN_CAPABILITY',
    'SCOPE_VIOLATION',
    'NEAR_DUPLICATE',
    'DOC_CONTRACT_VIOLATION',
    'INVALID_EVENT',
    'UNKNOWN_SCHEMA',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_HOST',
    'MISSING_MANIFEST',
    'VERSION_MISMATCH',
    'CORE_IMPORTS_HOST_SDK',
    'PROBE_BLOCKED',
    'CANONICAL_MISSING',
    'HOST_UNSUPPORTED',
    'PROJECTION_CONFLICT',
    'SYNC_FAILED',
]);

export interface ErrorBody {
    code: string;
    message: string;
    detail?: string;
}

export interface ErrorResponse {
    status: number;
    body: ErrorBody;
}

/**
 * The only place an exception becomes an HTTP body. Unknown exceptions are 500 and carry a
 * non-BRD code on purpose: the caller can log it, while clients still get a stable envelope.
 */
export function toErrorResponse(error: unknown): ErrorResponse {
    if (error instanceof PlatformError) {
        const body: ErrorBody = {
            code: error.code,
            message: error.message,
        };
        if (error.detail) body.detail = error.detail;
        return { status: error.status, body };
    }

    const status = Number((error as any)?.status) || 500;
    const code = typeof (error as any)?.code === 'string' ? (error as any).code : 'INTERNAL_ERROR';
    const message =
        code === 'INTERNAL_ERROR'
            ? 'An unexpected internal error occurred'
            : String((error as any)?.message || ERROR_MESSAGE[code] || 'Request failed');
    return { status, body: { code, message } };
}

export function isErrorBody(value: unknown): value is ErrorBody {
    if (!value || typeof value !== 'object') return false;
    const body = value as Record<string, unknown>;
    return typeof body.code === 'string' && typeof body.message === 'string';
}

export function isSuccessBody(value: unknown): boolean {
    return !isErrorBody(value);
}

export function registeredCodes(): string[] {
    return [...BRD_ERROR_CODES].sort();
}

export function statusForCode(code: string): number | null {
    return ERROR_STATUS[code] ?? null;
}
