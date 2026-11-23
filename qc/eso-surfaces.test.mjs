import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/routes.ts', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/layout/shell/shell.component.ts', import.meta.url), 'utf8');

// CR-008: /diagnosis · /risk · /audit were placeholder stubs; removed with their routes + nav.
test('removed surfaces are not routable', () => {
  for (const path of ['diagnosis', 'risk', 'audit']) {
    assert.equal(routes.includes(`path: '${path}'`), false, `${path} route must be gone`);
    assert.equal(routes.includes(`features/${path}/`), false, `${path} feature import must be gone`);
  }
});

test('removed surfaces are not in the shell nav', () => {
  for (const link of ['/diagnosis', '/risk', '/audit']) {
    assert.equal(shell.includes(`routerLink="${link}"`), false, `${link} nav link must be gone`);
  }
});

test('declaration surface stays', () => {
  assert.equal(routes.includes("path: 'declaration'"), true);
  assert.equal(shell.includes('routerLink="/declaration"'), true);
});

// --- dead code + silent caps on surfaces -----------------------------------
const flows = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/consumers/pages/flows.page.ts', import.meta.url), 'utf8');
const observatory = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/observatory.page.ts', import.meta.url), 'utf8');
const observationPanel = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/consumers/components/observation-panel.component.ts', import.meta.url), 'utf8');
const observationPanelHtml = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/consumers/components/observation-panel.component.html', import.meta.url), 'utf8');

test('BUG-05 · flows không còn helper back() chết', () => {
  assert.equal(/\bback\(\): void \{/.test(flows), false);
  assert.equal(/\binject\(Router\)/.test(flows), false);
});

test('BUG-06 · observatory không còn openTrace() chết', () => {
  assert.equal(/openTrace\(/.test(observatory), false);
});

test('BUG-41 · observation panel nói rõ giới hạn 100 dòng', () => {
  assert.match(observationPanel, /readonly observationLimit = 100;/);
  assert.match(observationPanel, /getObservations\(this\.consumerId\(\), this\.observationLimit\)/);
  assert.match(observationPanelHtml, /latest \{\{ observationLimit \}\}/);
  assert.match(observationPanelHtml, /Newest \{\{ observationLimit \}\} rows only/);
});
