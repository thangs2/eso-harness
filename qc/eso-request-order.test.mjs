import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REQ = readFileSync(new URL('../eso/control-plane/src/modules/requests/request.service.ts', import.meta.url), 'utf8');
const GRID = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/components/request-grid.component.ts', import.meta.url), 'utf8');

test('request list is newest-first (latest ticket on top)', () => {
  assert.match(REQ, /return \{ items: items\.sort\(\(left, right\) => String\(right\.startedAt\)\.localeCompare\(String\(left\.startedAt\)\)\)/);
});

test('prompt list is newest-first inside a conversation', () => {
  assert.match(REQ, /return \{ items: items\.sort\(\(left, right\) => String\(right\.at\)\.localeCompare\(String\(left\.at\)\)\)/);
});

test('row number is chronological, newest carries the highest number (8 → 1)', () => {
  assert.match(GRID, /sequence\(row, index, group\.items\.length\)/);
  assert.match(GRID, /sequence\(row, index \+ offset\(\), filtered\(\)\.length\)/);
  assert.match(GRID, /return Math\.max\(1, total - position\)/);
});

test('grouped grid keeps parent groups and child prompts newest-first', () => {
  assert.match(GRID, /items: \[\.\.\.items\]\.sort\(\(a, b\) => String\(b\.startedAt\)\.localeCompare\(String\(a\.startedAt\)\) \|\| \(b\.boundaryIndex \?\? 0\) - \(a\.boundaryIndex \?\? 0\)\)/);
  assert.match(GRID, /\.sort\(\(a, b\) => String\(b\.latest\)\.localeCompare\(String\(a\.latest\)\)\)/);
});
