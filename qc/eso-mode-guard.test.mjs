import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../scripts/hooks/eso-mode-guard.mjs', import.meta.url));

function run(prompt) {
  const result = spawnSync(process.execPath, [HOOK, '--host', 'agy'], {
    input: JSON.stringify({ conversationId: 'c1', invocationNum: 1, prompt }),
    encoding: 'utf8',
  });
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function runDsh(prompt) {
  const result = spawnSync(process.execPath, [HOOK, '--host', 'dsh'], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt }),
    encoding: 'utf8',
  });
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

test('valid mode injects the exact router command', () => {
  const out = run('mode=A review X');
  assert.match(out.injectSteps[0].userMessage, /eso-mode-router\.mjs --host agy --prompt/);
  assert.match(out.injectSteps[0].userMessage, /do not perform the task yourself/);
});

test('to= is injected as a system error, no router command', () => {
  const out = run('mode=B review X to=dsh:main-chat');
  assert.match(out.injectSteps[0].systemMessage.systemMessage, /to=.*not allowed/);
  assert.doesNotMatch(JSON.stringify(out), /userMessage/);
});

test('SLP + mode is rejected for now', () => {
  const out = run('mode=A impl ESO-1 slp g test');
  assert.match(out.injectSteps[0].systemMessage.systemMessage, /SLP \+ mode is not wired/);
});

test('ordinary prompts are untouched', () => {
  assert.equal(run('just a question'), null);
});


test('DSH valid mode returns hookSpecificOutput.additionalContext with the exact command', () => {
  const out = runDsh('mode=A review X');
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /eso-mode-router\.mjs --host dsh --prompt/);
  assert.match(out.hookSpecificOutput.additionalContext, /do not perform the task yourself/);
});

test('DSH invalid mode blocks with decision=block and no router command', () => {
  const out = runDsh('mode=B review X to=dsh:main-chat');
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /to=.*not allowed/);
  assert.doesNotMatch(JSON.stringify(out), /eso-mode-router/);
});

test('DSH ordinary prompts are untouched', () => {
  assert.equal(runDsh('just a question'), null);
});

test('injectors never execute host-runtime (source guard)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(HOOK, 'utf8');
  assert.doesNotMatch(source, /spawnSync|execFile|child_process/);
});
