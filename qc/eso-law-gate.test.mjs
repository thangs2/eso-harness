import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GATE = readFileSync(new URL('../scripts/hooks/eso-law-gate.mjs', import.meta.url), 'utf8');
const SETUP = readFileSync(new URL('../scripts/setup-consumer-hosts.mjs', import.meta.url), 'utf8');

test('law gate denies tools until AGENTS.md/CLAUDE.md was really read', () => {
  assert.match(GATE, /const lawNames = \['AGENTS\.md', 'CLAUDE\.md'\]/);
  assert.match(GATE, /if \(isReadTool && targetLaw\) output\(true\)/);
  assert.match(GATE, /else if \(shellReadsLaw\) output\(true\)/);
  assert.match(GATE, /transcriptProvesRead/);
  assert.match(GATE, /Law gate: read \$\{presentLaws\.join\(' or '\)\} before using/);
});

test('law gate is fail-closed on bad input, missing transcript and missing law', () => {
  assert.match(GATE, /invalid hook payload \(fail-closed\)/);
  assert.match(GATE, /both missing at the repository root/);
  assert.match(GATE, /\.some\(transcriptProvesRead\)/);
  assert.match(GATE, /else deny\(/);
});

test('AGY response dialect and setup registration', () => {
  assert.match(GATE, /"decision":"allow"/);
  assert.match(GATE, /JSON\.stringify\(\{ decision: 'deny', reason \}\)/);
  assert.match(SETUP, /eso-law-gate\.mjs/);
  assert.match(SETUP, /hooks\['eso-law-gate'\]/);
  assert.match(SETUP, /PreToolUse: \[\{ matcher: '\*'/);
});

test('law gate has no legacy host-pack dependency', () => {
  assert.doesNotMatch(GATE, /host-pack/);
});
