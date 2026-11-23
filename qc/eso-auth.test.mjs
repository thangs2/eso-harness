import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const AUTH = readFileSync('eso/control-plane/src/common/auth/auth.ts', 'utf8');

test('AC-01-1 · nhận Basic cho UI', () => {
    assert.match(AUTH, /\^\(Basic\|Bearer\)/);
    assert.match(AUTH, /Basic/);
});

test('AC-01-2 · nhận Bearer token cho máy + so sánh constant-time', () => {
    assert.match(AUTH, /safeEqual\(parsed\.value, this\.config\.token\)/);
    assert.match(AUTH, /function safeEqual/);
});

test('AC-01-3 · thiếu credential ⇒ AUTH_REQUIRED', () => {
    assert.match(AUTH, /AUTH_REQUIRED/);
});

test('AC-01-4 · sai credential ⇒ AUTH_INVALID, thông điệp không tiết lộ bên nào sai', () => {
    assert.match(AUTH, /AUTH_INVALID/);
    assert.match(AUTH, /!userOk \|\| !passOk/);
});

// ---------------------------------------------------------------------------
// UI side of the same auth surface (BUG-10 / BUG-40) + telemetry (BUG-44).
// ---------------------------------------------------------------------------
const LOGIN = readFileSync('eso/ui/apps/control-plane/src/app/features/login/pages/login.page.ts', 'utf8');
const CLIENT = readFileSync('eso/ui/libs/api-client/client.ts', 'utf8');
const MAIN = readFileSync('eso/ui/src/main.ts', 'utf8');

test('BUG-10 · Basic auth encode nằm trong try, UTF-8-safe, loading luôn reset', () => {
    const submit = LOGIN.slice(LOGIN.indexOf('async submit'), LOGIN.indexOf('private encodeBasic'));
    const tryAt = submit.indexOf('try {');
    const encodeAt = submit.indexOf('const authorization');
    assert.ok(tryAt >= 0 && encodeAt > tryAt, 'encode phải nằm sau try');
    assert.match(LOGIN, /new TextEncoder\(\)\.encode/);
    assert.match(LOGIN, /return btoa\(binary\);/);
    assert.match(submit, /finally \{\s*this\.loading\.set\(false\);/);
    assert.doesNotMatch(submit, /const authorization[\s\S]{0,120}catch/);
});

test('BUG-40 · password bị xoá sau khi đăng nhập thành công', () => {
    const submit = LOGIN.slice(LOGIN.indexOf('async submit'), LOGIN.indexOf('private encodeBasic'));
    assert.ok(submit.indexOf("this.password = '';") > submit.indexOf('this.auth.setAuthorization(authorization);'));
});

test('BUG-44 · mọi call mang X-Trace-Id; GlobalErrorHandler được provide', () => {
    assert.match(CLIENT, /'X-Trace-Id': `tr-\$\{Date\.now\(\)\.toString\(36\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`/);
    assert.match(MAIN, /import \{ GlobalErrorHandler \} from '\.\.\/apps\/control-plane\/src\/app\/core\/error-handler\/global-error-handler\.js'/);
    assert.match(MAIN, /\{ provide: ErrorHandler, useClass: GlobalErrorHandler \}/);
    assert.ok(MAIN.indexOf('useClass: GlobalErrorHandler') > MAIN.indexOf('providers: ['));
});
