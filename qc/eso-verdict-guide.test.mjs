import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GUIDE = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/verdict-guide.component.ts', import.meta.url), 'utf8');
const GLANCE = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/glance-cards.component.ts', import.meta.url), 'utf8');

test('verdict guide is a modal dialog with all ten explainer sections', () => {
  assert.match(GUIDE, /<dialog #dialog class="guide"/);
  assert.match(GUIDE, /showModal\(\)/);
  assert.match(GUIDE, /onBackdrop/);
  for (const heading of ['What the Turn verdict is', 'Why it exists', 'How it is computed', 'Inputs ESO reads', 'The four levels', 'The score', 'The gap catalogue', 'This trace', 'How it relates to the rest of the page', 'Reading checklist and limits']) {
    assert.match(GUIDE, new RegExp(heading), `missing section: ${heading}`);
  }
});

test('guide explains the score arithmetic, the floor and what it does not affect', () => {
  assert.match(GUIDE, /max\(0, 100 − 25 × số_gap\)/);
  assert.match(GUIDE, /0<\/td><td>100/);
  assert.match(GUIDE, /does <strong>not<\/strong> block a write by itself/);
  assert.match(GUIDE, /not model quality/);
});

test('guide explains all four levels and the JEV/scope/receipt relationships', () => {
  for (const level of ['allow', 'partial', 'deny', 'unknown']) {
    assert.match(GUIDE, new RegExp(`<code>${level}</code>`), `missing level ${level}`);
  }
  assert.match(GUIDE, /JEV is the host's confidence→band policy/);
  assert.match(GUIDE, /must never replace the verdict/);
  assert.match(GUIDE, /separate write-target decision/);
  assert.match(GUIDE, /sealed into the receipt as <code>evidenceScore<\/code>/);
});

test('card exposes the guide and passes the current verdict', () => {
  assert.match(GLANCE, /<eso-verdict-guide #guide \[verdict\]="verdict\(\)" \/>/);
  assert.match(GLANCE, /guide\.open\(\)/);
  assert.match(GLANCE, />Full explanation<\/button>/);
});
