import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModePrompt, chooseTarget } from '../scripts/slp-mode-router.mjs';

test('mode=A|B is a standalone prompt directive', () => {
  assert.deepEqual(parseModePrompt('mode=A review file X'), { mode: 'A', slp: false, task: 'review file X', key: null, error: null });
  assert.deepEqual(parseModePrompt('mode=B review file X'), { mode: 'B', slp: false, task: 'review file X', key: null, error: null });
});

test('SLP is optional and mode still parses', () => {
  const parsed = parseModePrompt('impl ESO-123 slp g mode=B run the pack');
  assert.equal(parsed.mode, 'B');
  assert.equal(parsed.slp, true);
  assert.equal(parsed.task, 'run the pack');
});

test('mode directive needs a task and rejects to=', () => {
  assert.match(parseModePrompt('mode=A').error, /needs a task/);
  assert.match(parseModePrompt('mode=B x to=dsh:main-chat').error, /to=.*not allowed/);
  assert.match(parseModePrompt('review file X').error, /missing mode/);
});

test('target comes from placement modes/allowedHosts, not the prompt', () => {
  const placement = { workerId: 'worker-build', modes: ['A', 'B'], allowedHosts: ['agy:agy', 'dsh:main-chat'] };
  assert.deepEqual(chooseTarget({ mode: 'A', localRuntime: 'agy:agy', placement }), { runtimeKey: 'agy:agy', local: true });
  assert.deepEqual(chooseTarget({ mode: 'B', localRuntime: 'agy:agy', placement }), { runtimeKey: 'dsh:main-chat', local: false });
  assert.throws(() => chooseTarget({ mode: 'B', localRuntime: 'agy:agy', placement: { ...placement, modes: ['A'] } }), /does not enable mode B/);
  assert.throws(() => chooseTarget({ mode: 'B', localRuntime: 'agy:agy', placement: { ...placement, allowedHosts: ['agy:agy'] } }), /no allowed remote/);
});
