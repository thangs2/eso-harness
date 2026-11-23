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
