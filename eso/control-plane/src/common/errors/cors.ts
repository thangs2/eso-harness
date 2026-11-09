/**
 * L2.2 — CORS allowlist for the local UI.
 * Plane C §1: 127.0.0.1:4200 and localhost:4200 only; GET,POST,PUT,DELETE,OPTIONS.
 */
export const CORS_ALLOWED_ORIGINS: readonly string[] = [
    'http://127.0.0.1:4200',
    'http://localhost:4200',
];

export const CORS_ALLOWED_METHODS = 'GET,POST,PUT,DELETE,OPTIONS';
export const CORS_ALLOWED_HEADERS = 'Content-Type,Authorization,X-Trace-Id';

export function corsHeaders(origin: string | undefined | null): Record<string, string> {
    const headers: Record<string, string> = {
        Vary: 'Origin',
        'Access-Control-Allow-Methods': CORS_ALLOWED_METHODS,
        'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS,
        'Access-Control-Max-Age': '600',
    };
    if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
    return Boolean(origin && CORS_ALLOWED_ORIGINS.includes(origin));
}

export function preflight(origin: string | undefined | null): { status: number; headers: Record<string, string> } {
    return { status: 204, headers: corsHeaders(origin) };
}
