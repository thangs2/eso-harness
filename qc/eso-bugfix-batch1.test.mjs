import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const store = read('eso/control-plane/src/platform/registry/store.ts');
const boundaries = read('eso/control-plane/src/modules/boundaries/boundary-policy.service.ts');
const events = read('eso/ui/apps/control-plane/src/app/features/observatory/pages/event-stream.page.ts');
const detail = read('eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail.page.ts');

test('BUG-37 — CREATE SCHEMA idempotent (IF NOT EXISTS)', () => {
  assert.match(store, /CREATE SCHEMA IF NOT EXISTS/);
});

test('BUG-33 — grant hết hạn không còn "active"', () => {
  assert.match(boundaries, /!grant\.expiresAt \|\| Date\.parse\(grant\.expiresAt\) > Date\.now\(\)/);
});

test('BUG-21 — chip All reset cả outcomeFilter', () => {
  assert.match(events, /resetFilters\(\): void \{[\s\S]{0,120}eventFilter\.set\('all'\)[\s\S]{0,80}outcomeFilter\.set\(''\)/);
  assert.match(events, /\(click\)="resetFilters\(\)"/);
});

test('BUG-31 — evidence không auto-open và che prompt text', () => {
  assert.ok(!/<details open>[\s\S]{0,40}<summary>Evidence<\/summary>/.test(events), 'Evidence phải đóng mặc định');
  assert.match(events, /'userQuery'/);
  assert.match(events, /\[redacted\]/);
});

test('BUG-30 — requestId subscribe paramMap, không đóng băng snapshot', () => {
  assert.match(detail, /readonly requestId = signal\(/);
  assert.match(detail, /this\.route\.paramMap\.subscribe/);
  assert.match(detail, /getRequestDetail\(this\.consumerId\(\), this\.requestId\(\)\)/);
});
