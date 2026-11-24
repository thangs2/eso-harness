import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REQ = readFileSync(new URL('../eso/control-plane/src/modules/requests/request.service.ts', import.meta.url), 'utf8');
const HOOK = readFileSync(new URL('../scripts/hooks/eso-transcript-ingest.mjs', import.meta.url), 'utf8');

test('Stage 1 accepts law.loaded as weaker evidence than decision.recorded.refs', () => {
  assert.match(REQ, /export function lawLoadedOf/);
  assert.match(REQ, /event !== 'law\.loaded'/);
  assert.match(REQ, /const lawLoaded = lawLoadedOf\(events\)/);
  assert.match(REQ, /law\.loaded — the host read this file; no decision claim attached/);
  assert.match(REQ, /no decision ref and no law\.loaded observation/);
});

test('decision refs stay the strong path and keep stage 1 ok', () => {
  assert.match(REQ, /status: lawRefs\.length \? 'ok' : 'info'/);
  assert.match(REQ, /decision\.recorded\.refs — the host decision references this law/);
});

test('AGY Stop hook emits law.loaded only for real read tool calls', () => {
  assert.match(HOOK, /LAW_FILE_PATTERN/);
  assert.match(HOOK, /\/read\|view\|cat\|open\|show\/i\.test/);
  assert.match(HOOK, /event: 'law\.loaded'/);
  assert.match(HOOK, /source: 'transcript-read'/);
  assert.match(HOOK, /host-law-loaded:/);
  assert.match(HOOK, /path: relativePath/);
});
