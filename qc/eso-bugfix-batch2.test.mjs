import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const page = read('eso/ui/apps/control-plane/src/app/features/declaration/pages/declaration.page.ts');
const client = read('eso/ui/libs/api-client/client.ts');
const tail = read('eso/ui/apps/control-plane/src/app/features/consumers/pages/settings-tail.base.ts');

test('BUG-13 — declaration dùng API thật, không hash giả', () => {
  assert.ok(!page.includes('cfg-${Date.now()}'), 'không còn hash client giả');
  assert.match(page, /previewConfig\(this\.consumerId\)/);
  assert.match(page, /saveConfig\(this\.consumerId, \{\}, current\.hash\)/);
  assert.match(page, /CONFIG_STALE_HASH/);
});

test('BUG-13 — client gọi route consumer config', () => {
  assert.match(client, /consumers\/\$\{encodeURIComponent\(consumerId\)\}\/config\/preview/);
  assert.match(client, /consumers\/\$\{encodeURIComponent\(consumerId\)\}\/config`/);
});

test('BUG-43 — settings có ngOnDestroy dọn timer', () => {
  assert.match(tail, /ngOnDestroy\(\): void/);
  assert.match(tail, /clearTimeout\(this\.draftTimer\)/);
  assert.match(tail, /clearTimeout\(this\.baselineTimer\)/);
  assert.match(tail, /if \(this\.destroyed\) return;/);
});
