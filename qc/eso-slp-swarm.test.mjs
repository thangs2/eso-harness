import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseModePrompt, SWARM_SCOPE } from '../scripts/slp-mode-router.mjs';

const GUARD = fileURLToPath(new URL('../scripts/hooks/eso-mode-guard.mjs', import.meta.url));
const SKILL = readFileSync(new URL('../agents/skills/harness-engineering-team/SKILL.md', import.meta.url), 'utf8');
const REQ = readFileSync(new URL('../eso/control-plane/src/modules/requests/request.service.ts', import.meta.url), 'utf8');

function guard(prompt, host = 'agy', env = {}) {
  const result = spawnSync(process.execPath, [GUARD, '--host', host], {
    input: JSON.stringify(host === 'dsh'
      ? { hook_event_name: 'UserPromptSubmit', prompt }
      : { conversationId: 'c1', invocationNum: 1, prompt }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

test('swarm is an SLP shape, not a mode', () => {
  assert.deepEqual([...SWARM_SCOPE], ['all', 'build', 'qc']);
  const parsed = parseModePrompt('impl ESO-1 slp g swarm=qc');
  assert.equal(parsed.swarm, 'qc');
  assert.equal(parsed.slp, true);
  assert.equal(parsed.mode, null);
  assert.equal(parsed.error, null);
});

test('default SLP prompt carries no swarm', () => {
  assert.equal(parseModePrompt('impl ESO-1 slp g').swarm, null);
});

test('invalid swarm scope and swarm + mode=B are rejected', () => {
  assert.match(parseModePrompt('impl ESO-1 slp g swarm=bogus').error, /swarm scope must be one of/);
  assert.match(parseModePrompt('mode=B impl ESO-1 slp g swarm').error, /swarm \+ mode=B is not supported/);
  assert.equal(parseModePrompt('mode=B impl ESO-1 slp g').slp, false, 'mode directive is parsed first; SLP+mode handled by the router');
  assert.match(parseModePrompt('swarm').error, /needs a task/);
});

test('AGY guard injects the swarm instruction, plain SLP stays untouched', () => {
  const swarm = guard('impl ESO-1 slp g swarm');
  assert.match(swarm.injectSteps[0].userMessage, /swarm=all/);
  assert.equal(guard('impl ESO-1 slp g'), null);
});

test('DSH blocks swarm unless the host declares support', () => {
  const blocked = guard('impl ESO-1 slp g swarm', 'dsh');
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /swarm is not supported on this host/);
  const allowed = guard('impl ESO-1 slp g swarm', 'dsh', { ESO_SWARM_SUPPORTED: '1' });
  assert.match(allowed.hookSpecificOutput.additionalContext, /swarm=all/);
});

test('SLP skill documents the swarm contract', () => {
  assert.match(SKILL, /## 5\.1 Execution shape — subagent \(default\) vs swarm/);
  assert.match(SKILL, /\*\*AGY only\.\*\*/);
  assert.match(SKILL, /Never mix swarm and subagent in the same turn/);
  assert.match(SKILL, /swarm_wait/);
});

test('trace stage reports the execution shape', () => {
  assert.match(REQ, /const executionShape = shapeMarkers\.includes\('swarm'\)/);
  assert.match(REQ, /swarm workers \(post_message \/ read_board \/ swarm_wait\)/);
});
