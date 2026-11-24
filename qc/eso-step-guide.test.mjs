import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GUIDE = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/step-guide.component.ts', import.meta.url), 'utf8');
const FLOW = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/pipeline-flow.component.ts', import.meta.url), 'utf8');
const REQ = readFileSync(new URL('../eso/control-plane/src/modules/requests/request.service.ts', import.meta.url), 'utf8');

test('Step 1 guide explains all four law states, including text-only', () => {
  for (const label of ['law refs (ok)', 'law loaded (info)', 'law missing (warn)', 'law not exercised (info)']) {
    assert.match(GUIDE, new RegExp(label.replace(/[()]/g, '\\$&')), `missing state ${label}`);
  }
  assert.match(GUIDE, /A text-only answer does not read AGENTS\.md — expected, but the law remains unproven/);
  assert.match(GUIDE, /It does not prove the host followed the law/);
});

test('stage guide is a dialog reachable from every E2E step', () => {
  assert.match(GUIDE, /<dialog #dialog class="guide"/);
  assert.match(GUIDE, /showModal\(\)/);
  assert.match(FLOW, /<eso-step-guide #stepGuide \/>/);
  assert.match(FLOW, /stepGuide\?\.open\(step\)/);
  assert.match(FLOW, /aria-label="Explain this step"/);
});

test('backend distinguishes not-exercised from missing and exposes the reason', () => {
  assert.match(REQ, /const lawState = lawRefs\.length \? 'decision'/);
  assert.match(REQ, /observedTools\.length \? 'missing' : 'not-exercised'/);
  assert.match(REQ, /law not exercised \(text-only\)/);
  assert.match(REQ, /No tool\/action was recorded, so the PreToolUse law gate had nothing to evaluate/);
  assert.match(REQ, /A tool\/action was recorded .* but no law read or decision ref exists/);
});
