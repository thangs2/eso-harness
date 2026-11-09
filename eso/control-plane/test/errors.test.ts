/**
 * L2.2 — error envelope + CORS.
 * RED names are pinned by sdlc/10.test/86..89.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

import { PlatformError, ERROR_STATUS } from '../src/platform/registry/errors.js';
import {
    BRD_ERROR_CODES,
    isErrorBody,
    isSuccessBody,
    registeredCodes,
    toErrorResponse,
} from '../src/common/errors/envelope.js';
import {
    CORS_ALLOWED_METHODS,
    CORS_ALLOWED_ORIGINS,
    corsHeaders,
    isAllowedOrigin,
    preflight,
} from '../src/common/errors/cors.js';

describe('L2.2 — error envelope + CORS', () => {
    test('SCN-16-1 · AC-16-1 — Error envelope + CORS · tdd-unit', () => {
        const success = { kind: 'operator', configured: true };
        assert.equal(isSuccessBody(success), true);
        assert.equal('code' in success, false);
        assert.equal(isErrorBody(success), false);

        const response = toErrorResponse(new PlatformError('AUTH_REQUIRED'));
        assert.equal(response.status, 401);
        assert.deepEqual(response.body, {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
        });
        assert.equal('type' in response.body, false);
        assert.equal('title' in response.body, false);
        assert.equal('status' in response.body, false);

        const withDetail = toErrorResponse(new PlatformError('STALE_VERSION', 'expected 3, current 4'));
        assert.deepEqual(withDetail.body, {
            code: 'STALE_VERSION',
            message: 'Consumer version is stale',
            detail: 'expected 3, current 4',
        });
    });

    test('SCN-16-1 · AC-16-1 — Error envelope + CORS · tdd-impl', () => {
        assert.ok(registeredCodes().length >= 20);
        for (const code of registeredCodes()) {
            assert.equal(BRD_ERROR_CODES.has(code), true, `${code} must be registered in BRD/06`);
        }

        for (const [code, status] of Object.entries(ERROR_STATUS)) {
            const response = toErrorResponse(new PlatformError(code));
            assert.equal(response.status, status);
            assert.equal(response.body.code, code);
            assert.equal(typeof response.body.message, 'string');
        }

        // Unknown exceptions never leak their message or stack.
        const unknown = toErrorResponse(new Error('connection string postgres://secret'));
        assert.equal(unknown.status, 500);
        assert.equal(unknown.body.code, 'INTERNAL_ERROR');
        assert.doesNotMatch(unknown.body.message, /postgres:\/\/|secret/);
    });

    test('SCN-16-1 · AC-16-1 — Error envelope + CORS · tdd-coverage', () => {
        assert.deepEqual([...CORS_ALLOWED_ORIGINS].sort(), [
            'http://127.0.0.1:4200',
            'http://localhost:4200',
        ]);
        assert.equal(CORS_ALLOWED_METHODS, 'GET,POST,PUT,DELETE,OPTIONS');

        const allowed = corsHeaders('http://127.0.0.1:4200');
        assert.equal(allowed['Access-Control-Allow-Origin'], 'http://127.0.0.1:4200');
        assert.equal(allowed.Vary, 'Origin');
        assert.match(allowed['Access-Control-Allow-Methods'], /DELETE/);

        const denied = corsHeaders('http://evil.example');
        assert.equal(denied['Access-Control-Allow-Origin'], undefined);
        assert.equal(isAllowedOrigin('http://evil.example'), false);
        assert.equal(isAllowedOrigin('http://localhost:4200'), true);

        const options = preflight('http://localhost:4200');
        assert.equal(options.status, 204);
        assert.equal(options.headers['Access-Control-Allow-Origin'], 'http://localhost:4200');
    });

    test('SCN-16-1 · AC-16-1 — Error envelope + CORS · tdd-qc', async () => {
        let server: Server | null = null;
        await new Promise<void>((resolve) => {
            server = createServer((req, res) => {
                const origin = req.headers.origin;
                if (req.method === 'OPTIONS') {
                    res.writeHead(204, corsHeaders(origin));
                    res.end();
                    return;
                }
                const { status, body } = toErrorResponse(new PlatformError('CONSUMER_NOT_FOUND'));
                res.writeHead(status, {
                    'content-type': 'application/json; charset=utf-8',
                    ...corsHeaders(origin),
                });
                res.end(JSON.stringify(body));
            });
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server!.address() as any;
        const base = `http://127.0.0.1:${address.port}`;
        try {
            const res = await fetch(`${base}/api/v1/consumers/missing`, {
                headers: { Origin: 'http://127.0.0.1:4200' },
            });
            assert.equal(res.status, 404);
            assert.equal(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4200');
            const body = await res.json();
            assert.deepEqual(body, {
                code: 'CONSUMER_NOT_FOUND',
                message: 'Consumer not found',
            });

            const opt = await fetch(`${base}/api/v1/consumers`, {
                method: 'OPTIONS',
                headers: { Origin: 'http://localhost:4200' },
            });
            assert.equal(opt.status, 204);
        } finally {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
        }
    });
});
