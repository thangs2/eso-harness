import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const AUTH = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/core/auth/auth.service.ts', import.meta.url), 'utf8');
const GUARD = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/core/auth/auth.guard.ts', import.meta.url), 'utf8');
const LOGIN = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/login/pages/login.page.ts', import.meta.url), 'utf8');

test('credential stays in sessionStorage (never localStorage)', () => {
  assert.match(AUTH, /sessionStorage\.setItem\('eso\.auth'/);
  assert.doesNotMatch(AUTH, /localStorage\./);
});

test('new tab asks an authenticated peer tab over BroadcastChannel', () => {
  assert.match(AUTH, /new BroadcastChannel\(CHANNEL\)/);
  assert.match(AUTH, /postMessage\(\{ type: 'request' \}\)/);
  assert.match(AUTH, /data\.type === 'grant' && !this\._authorization\(\)/);
  assert.match(AUTH, /readonly ready: Promise<void>/);
  assert.match(AUTH, /setTimeout\(\(\) => resolve\(\), HANDSHAKE_MS\)/);
});

test('guard waits for the handshake before redirecting to /login', () => {
  assert.match(GUARD, /await authService\.ready/);
  assert.match(GUARD, /isAuthenticated\(\)/);
  assert.match(GUARD, /createUrlTree\(\['\/login'\]/);
});

test('login page resumes the requested URL after a cross-tab grant', () => {
  assert.match(LOGIN, /this\.auth\.ready\.then/);
  assert.match(LOGIN, /redirectBack\(\)/);
  assert.match(LOGIN, /returnUrl && \/\^\\\/\(\?!\\\/\)\//);
  assert.match(LOGIN, /Dev credential:/);
});
