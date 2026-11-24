import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SETUP = readFileSync(new URL('../scripts/setup-consumer-hosts.mjs', import.meta.url), 'utf8');

test('generated prompt hook sends the rich schema, not prompt-only metadata', () => {
  for (const field of ['hostStep', 'workerId', 'adapter', 'model', 'modelSource', 'tier', 'taskType', 'flowId', 'requestHash', 'requestLength']) {
    assert.match(SETUP, new RegExp(`\\b${field}\\b`), `hook evidence must include ${field}`);
  }
  assert.match(SETUP, /tokenSummary/, 'tokenSummary only when the host reports usage');
});

test('model falls back to the transcript, never invented', () => {
  assert.match(SETUP, /transcriptModel/);
  assert.match(SETUP, /modelSource: model \? .* : 'not-reported'/);
  assert.match(SETUP, /step\.model \?\? step\.model_name \?\? step\.model_id/);
});

test('tokenSummary is only built from a real usage object', () => {
  assert.match(SETUP, /const usage = payload\.usage && typeof payload\.usage === 'object'/);
  assert.match(SETUP, /tokenSummary = usage &&/);
  assert.match(SETUP, /estimated: false/);
});

test('Stop hook posts one worker.completed with usage and tools (fills In/Out/Calls/Tools)', () => {
  const INGEST = readFileSync(new URL('../scripts/hooks/eso-transcript-ingest.mjs', import.meta.url), 'utf8');
  assert.match(INGEST, /event: 'worker\.completed'/);
  assert.match(INGEST, /idempotencyKey: `host-turn-complete:\$\{parentTraceId\}`/);
  assert.match(INGEST, /tokenSummary: \{/);
  assert.match(INGEST, /input_tokens/);
  assert.match(INGEST, /output_tokens/);
  assert.match(INGEST, /tools: toolList\.map/);
});
