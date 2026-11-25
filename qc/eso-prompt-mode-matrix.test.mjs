import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/consumers/components/prompt-mode-matrix.component.ts', import.meta.url), 'utf8');
const OVERVIEW = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/consumers/components/worker-overview.component.html', import.meta.url), 'utf8');
const DOC = readFileSync(new URL('../sdlc/02.governance/01.standard/17.prompt-mode-guideline.md', import.meta.url), 'utf8');

test('matrix is rendered inside the workers tab', () => {
  assert.match(OVERVIEW, /<eso-prompt-mode-matrix \/>/);
  assert.match(UI, /selector: 'eso-prompt-mode-matrix'/);
});

test('matrix covers host × prompt × mode × protocol', () => {
  for (const host of ["host: 'AGY'", "host: 'DSH'", "host: 'Cursor'"]) assert.match(UI, new RegExp(host));
  for (const mode of ["mode: 'A'", "mode: 'B'", "mode: 'SLP'"]) assert.match(UI, new RegExp(mode));
  assert.match(UI, /mode=A review X/);
  assert.match(UI, /mode=B review X/);
  assert.match(UI, /to=dsh:main-chat/);
});

test('status tones distinguish hard injector, skill-followed and rejected', () => {
  assert.match(UI, /'hard injector'.*'skill-followed'.*'SLP path'.*'rejected'/s);
  assert.match(UI, /tone: 'warn'/, 'cursor rows stay skill-followed');
  assert.match(UI, /tone: 'bad'/, 'invalid prompts are rejected');
});

test('documented matrix matches the rendered contract', () => {
  assert.match(DOC, /## 9\. Master matrix/);
  assert.match(DOC, /\| 4 \| AGY \| `mode=A review X`/);
  assert.match(DOC, /### 9\.1 Protocol matrix/);
  assert.match(DOC, /\| \*\*Cursor\*\* \| `beforeSubmitPrompt` \|/);
});

test('matrix explains that target comes from placement, never the prompt', () => {
  assert.match(UI, /Never write <code>to=<\/code> in the prompt/);
  assert.match(UI, /sdlc\/02\.governance\/01\.standard\/17\.prompt-mode-guideline\.md/);
});
