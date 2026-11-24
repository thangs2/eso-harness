import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REQ = readFileSync(new URL('../eso/control-plane/src/modules/requests/request.service.ts', import.meta.url), 'utf8');
const HOOK = readFileSync(new URL('../scripts/hooks/eso-transcript-ingest.mjs', import.meta.url), 'utf8');

test('Stage 1 accepts law.loaded as weaker evidence than decision.recorded.refs', () => {
  assert.match(REQ, /export function lawLoadedOf/);
  assert.match(REQ, /event !== 'law\.loaded'/);
  assert.match(REQ, /const lawLoaded = lawLoadedOf\(events\)/);
  assert.match(REQ, /law\.loaded — weak: the host read this file, no decision claim attached/);
  assert.match(REQ, /No tool\/action was recorded, so the PreToolUse law gate had nothing to evaluate/);
});

test('decision refs stay the strong path and keep stage 1 ok', () => {
  assert.match(REQ, /status: lawState === 'decision' \? 'ok' : lawState === 'missing' \? 'warn' : 'info'/);
  assert.match(REQ, /decision\.recorded\.refs — strong: the host decision cites this law/);
});

test('AGY Stop hook emits law.loaded only for real read tool calls', () => {
  assert.match(HOOK, /LAW_FILE_PATTERN/);
  assert.match(HOOK, /\/read\|view\|cat\|open\|show\/i\.test/);
  assert.match(HOOK, /event: 'law\.loaded'/);
  assert.match(HOOK, /source: 'transcript-read'/);
  assert.match(HOOK, /host-law-loaded:/);
  assert.match(HOOK, /path: relativePath/);
});
