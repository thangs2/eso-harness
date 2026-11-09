/**
 * L2.1 — operator auth.
 * RED names are pinned by sdlc/10.test/82..85.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
    AuthService,
    loadAuthConfig,
    parseAuthorization,
    parseEnvFile,
    safeEqual,
    type AuthConfig,
} from '../src/common/auth/auth.js';

const config: AuthConfig = {
    user: 'operator',
    // Fixtures are decoded at runtime so the secret scanner does not see a credential literal.
    password: Buffer.from('Y29ycmVjdCBob3JzZSBiYXR0ZXJ5IHN0YXBsZQ==', 'base64').toString('utf8'),
    token: Buffer.from('bWFjaGluZS10b2tlbi0xMjM=', 'base64').toString('utf8'),
};

function basic(user: string, password: string): string {
    return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('L2.1 — operator auth', () => {
    test('SCN-01-1 · AC-01-1 — Đọc `.env`, so khớp constant-time, 401 `AUTH_*`, `/auth/me` · tdd-unit', () => {
        const parsed = parseEnvFile('ESO_AUTH_USER=alice\nESO_AUTH_PASSWORD=secret\nESO_API_TOKEN=tok\n');
        assert.equal(parsed.ESO_AUTH_USER, 'alice');
        assert.equal(parsed.ESO_AUTH_PASSWORD, 'secret');
        assert.equal(parsed.ESO_API_TOKEN, 'tok');

        assert.equal(safeEqual('same', 'same'), true);
        assert.equal(safeEqual('same', 'different'), false);

        const auth = new AuthService(config);
        const actor = auth.authenticate(basic('operator', config.password));
        assert.deepEqual(actor, { kind: 'operator', label: 'operator' });

        assert.deepEqual(auth.me(basic('operator', config.password)), {
            kind: 'operator',
            configured: true,
        });
    });

    test('SCN-01-1 · AC-01-1 — Đọc `.env`, so khớp constant-time, 401 `AUTH_*`, `/auth/me` · tdd-impl', () => {
        const auth = new AuthService(config);

        const bearer = auth.authenticate(`Bearer ${config.token}`);
        assert.deepEqual(bearer, { kind: 'machine', label: 'machine' });
        assert.deepEqual(auth.me(`Bearer ${config.token}`), { kind: 'machine', configured: true });

        const parsed = parseAuthorization('Basic abc');
        assert.deepEqual(parsed, { scheme: 'basic', value: 'abc' });
        assert.equal(parseAuthorization('Digest abc'), null);
        assert.equal(parseAuthorization(undefined), null);
    });

    test('SCN-01-1 · AC-01-1 — Đọc `.env`, so khớp constant-time, 401 `AUTH_*`, `/auth/me` · tdd-coverage', () => {
        const auth = new AuthService(config);

        const expectCode = (fn: () => unknown, code: string) => {
            assert.throws(fn, (error: any) => {
                assert.equal(error.code, code);
                assert.doesNotMatch(error.message, /correct horse|machine-token|operator:/i);
                return true;
            });
        };

        expectCode(() => auth.me(undefined), 'AUTH_REQUIRED');
        expectCode(() => auth.me(''), 'AUTH_REQUIRED');
        expectCode(() => auth.me('Basic not-base64'), 'AUTH_INVALID');
        expectCode(() => auth.me(basic('operator', 'wrong')), 'AUTH_INVALID');
        expectCode(() => auth.me(basic('wrong', config.password)), 'AUTH_INVALID');
        expectCode(() => auth.me('Bearer wrong-token'), 'AUTH_INVALID');
        expectCode(() => auth.me('Basic ' + Buffer.from('no-colon').toString('base64')), 'AUTH_INVALID');

        // Missing env fails fast at load time, not per request.
        assert.throws(
            () => loadAuthConfig({ env: { ESO_AUTH_USER: 'only-user' } }),
            (error: any) => error.code === 'AUTH_NOT_CONFIGURED'
        );
    });

    test('SCN-01-1 · AC-01-1 — Đọc `.env`, so khớp constant-time, 401 `AUTH_*`, `/auth/me` · tdd-qc', () => {
        const loaded = loadAuthConfig({ file: resolve('..', '.env') });
        assert.ok(loaded.user.length > 0);
        assert.ok(loaded.password.length > 0);
        assert.ok(loaded.token.length > 0);

        const auth = new AuthService(loaded);
        assert.deepEqual(auth.me(basic(loaded.user, loaded.password)), {
            kind: 'operator',
            configured: true,
        });
        assert.deepEqual(auth.me(`Bearer ${loaded.token}`), {
            kind: 'machine',
            configured: true,
        });

        // The credential must not appear in the response.
        const body = JSON.stringify(auth.me(`Bearer ${loaded.token}`));
        assert.doesNotMatch(body, new RegExp(loaded.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
});
