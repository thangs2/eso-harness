/**
 * Pipeline v2 must speak ONE evidence language.
 *
 * The Stepper header counted `status === 'ok' || 'warn'`, the Sufficiency axis counted
 * `evidenced`, and the flow card re-derived emptiness by scanning sub-card strings — three
 * definitions, so the same screen could show 5/8 next to 6/8. This file pins the single source:
 * `evidenced` decides, `status` only expresses attention.
 *
 * Run: cd eso/ui && bun test test/pipeline-evidence-consistency.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { toFlowSteps } from '../apps/control-plane/src/app/features/observatory/pages/request-detail/request-detail.selectors.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.resolve(HERE, '../apps/control-plane/src/app/features/observatory/pages/request-detail/components');
const STEPPER = fs.readFileSync(path.join(COMPONENTS, 'pipeline-stepper.component.ts'), 'utf8');
const FLOW = fs.readFileSync(path.join(COMPONENTS, 'pipeline-flow.component.ts'), 'utf8');
const TYPES = fs.readFileSync(path.resolve(HERE, '../libs/api-client/types.ts'), 'utf8');

function stage(over = {}) {
    return {
        id: 'intake-law', stepNumber: 1, title: 'Intake & Law Gate', sub: '133 chars · law not exercised',
        status: 'info', tab: 'rules',
        details: [{ label: 'Law', value: 'not captured', detail: 'no tool recorded' }],
        ...over,
    };
}

test('payloads without the field keep the old inspection path (compatibility, not a second rule)', () => {
    const legacy = toFlowSteps([stage()]);
    assert.equal(legacy[0].evidenced, null, 'absent flag stays null, never guessed');
    // "not captured" is on the missing-value list ⇒ the legacy path still collapses it.
    assert.equal(legacy[0].empty, true);
});

test('evidenced wins over the sub-card text: a stage can hold values and still carry no proof', () => {
    const declared = toFlowSteps([
        stage({ evidenced: false, status: 'warn', details: [{ label: 'Law', value: 'not exercised', detail: 'x' }, { label: 'Actor', value: 'worker-scout', detail: 'x' }] }),
    ]);
    assert.equal(declared[0].evidenced, false);
    assert.equal(declared[0].empty, true, 'evidenced=false decides, even though a value is present');

    const proven = toFlowSteps([
        stage({ evidenced: true, status: 'info', details: [{ label: 'Actor', value: 'worker-scout', detail: 'x' }] }),
    ]);
    assert.equal(proven[0].empty, false, 'evidenced=true counts even under an info status');
});

test('stepper count never falls back to status', () => {
    assert.match(STEPPER, /stages\(\)\.filter\(\(stage\) => stage\.evidenced === true\)\.length/, 'local count uses evidenced');
    assert.doesNotMatch(STEPPER, /filter\(\(stage\) => stage\.status === 'ok' \|\| stage\.status === 'warn'\)/, 'no status-based count anywhere in the stepper');
});

test('stepper ring follows evidence, not status alone', () => {
    assert.match(STEPPER, /\[class\.ok\]="stage\.evidenced === true/, 'ok ring requires evidence');
    assert.match(STEPPER, /\[class\.muted\]="stage\.evidenced !== true/, 'an un-evidenced stage is never drawn as found');
});

test('stepper legend and hint no longer teach the status rule', () => {
    assert.doesNotMatch(STEPPER, /Stages with OK or WARN evidence/, 'the wrong rule must not survive in the hint');
    assert.match(STEPPER, /Ring = this step's finding/, 'legend states what the ring means');
});

test('flow tone cannot look greener than the evidence', () => {
    assert.match(FLOW, /if \(step\.empty\) return warns \? 'warn' : 'muted'/, 'empty stage is muted or warn, never ok/decision');
    assert.match(FLOW, /if \(step\.evidenced === true\) return 'ok'/, 'proven stage is ok');
});

test('the DTO declares evidenced so typecheck protects the wire contract', () => {
    assert.match(TYPES, /systemStages: Array<\{[^}]*evidenced\?: boolean \| null/, 'api-client contract carries evidenced');
});
