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
