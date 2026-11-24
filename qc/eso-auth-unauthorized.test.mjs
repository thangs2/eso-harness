import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CLIENT = readFileSync(new URL('../eso/ui/libs/api-client/client.ts', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../eso/ui/src/main.ts', import.meta.url), 'utf8');
const AUTH = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/core/auth/auth.service.ts', import.meta.url), 'utf8');

test('a rejected credential clears the session and redirects to /login', () => {
  assert.match(CLIENT, /private async fetchImpl/);
  assert.match(CLIENT, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(CLIENT, /this\.onUnauthorized\(\)/);
  assert.match(MAIN, /onUnauthorized:/);
  assert.match(MAIN, /removeItem\('eso\.auth'\)/);
  assert.match(MAIN, /location\.assign\(`\/login\?returnUrl=/);
  // the wrapper must call the platform fetch, never itself (recursion guard)
  assert.match(CLIENT, /const response = await fetch\(input, init\)/);
  assert.doesNotMatch(CLIENT, /const response = await this\.fetchImpl/);
});

test('a peer tab grant is verified before it is adopted', () => {
  assert.match(AUTH, /private async verify\(authorization: string\)/);
  assert.match(AUTH, /\/api\/v1\/auth\/me/);
  assert.match(AUTH, /void this\.verify\(value\)\.then\(\(ok\) =>/);
  assert.match(AUTH, /if \(ok\) this\.setAuthorization\(value\)/);
});
