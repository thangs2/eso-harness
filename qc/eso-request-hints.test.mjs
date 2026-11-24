import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HINT = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/shared/section-hint.component.ts', import.meta.url), 'utf8');
const HERO = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/request-hero.component.ts', import.meta.url), 'utf8');
const STEPPER = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/pipeline-stepper.component.ts', import.meta.url), 'utf8');
const FLOW = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/pipeline-flow.component.ts', import.meta.url), 'utf8');
const GLANCE = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/glance-cards.component.ts', import.meta.url), 'utf8');
const WATERFALL = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/components/waterfall-panel.component.ts', import.meta.url), 'utf8');

test('hint is a native, keyboard-accessible details/summary with an aria-label', () => {
  assert.match(HINT, /<details class="section-hint" #hint>/);
  assert.match(HINT, /<summary \[attr\.aria-label\]="'Explain this section: ' \+ summary\(\)"/);
  assert.match(HINT, /role="note"/);
  assert.match(HINT, /@for \(item of items\(\); track item\.label\)/);
});

test('every major request-detail section carries a hint', () => {
  for (const [name, source] of Object.entries({ HERO, STEPPER, FLOW, GLANCE, WATERFALL })) {
    assert.match(source, /<eso-section-hint/, `${name} must render a hint`);
  }
  const glanceHints = (GLANCE.match(/<eso-section-hint/g) ?? []).length;
  assert.equal(glanceHints, 4, 'verdict, gate, effectiveness and cost each have one');
});

test('verdict hint defines all four levels and the score impact', () => {
  for (const level of ['allow', 'partial', 'deny', 'unknown']) {
    assert.match(GLANCE, new RegExp(`label: '${level}'`), `verdict hint defines ${level}`);
  }
  assert.match(GLANCE, /It measures evidence completeness, not model quality/);
  assert.match(GLANCE, /does not block writes by itself/);
  assert.match(GLANCE, /NOT deny: nothing rejected the turn/);
});

test('hints state what values mean instead of repeating labels', () => {
  assert.match(WATERFALL, /Failures keeps FAIL\/BLOCKED outcomes/);
  assert.match(STEPPER, /4\/8 means the other four stages have no proof/);
  assert.match(GLANCE, /"Not captured" means the host sent no usage data/);
});
