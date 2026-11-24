import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ROOT = new URL('..', import.meta.url).pathname;

// 2026-11-24 (operator): the /events page was removed. Its data stays reachable through
// Observatory, request detail and the observations API; the UI route and page are gone.
test('/events page and route are removed', () => {
  const routes = read('eso/ui/apps/control-plane/src/app/routes.ts');
  assert.doesNotMatch(routes, /path: 'events'/);
  assert.doesNotMatch(routes, /event-stream\.page/);
  assert.equal(existsSync(join(ROOT, 'eso/ui/apps/control-plane/src/app/features/observatory/pages/event-stream.page.ts')), false);
});

test('no UI link points at /events any more', () => {
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|html)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const files = walk(join(ROOT, 'eso/ui/apps/control-plane/src/app'));
  const offenders = files.filter((file) => /['"`]\/events['"`]|routerLink="\/events"/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map((f) => f.replace(ROOT, '')), []);
});

test('the observations API the page used still exists for other surfaces', () => {
  const server = read('eso/control-plane/src/common/http/server.ts');
  assert.match(server, /consumers\/:id\/observations/);
  assert.match(server, /consumers\/:id\/observations\/stream/);
});
