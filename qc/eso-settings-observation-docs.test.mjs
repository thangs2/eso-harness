/** Observation config (F-03 §9) — doc + code conformance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/03.consumer-registry.md');
const AC = doc('06.analysis/02.ac/AC-49.md');
const SCN = doc('06.analysis/03.scn/SCN-49.md');
const RTM = doc('06.analysis/04.rtm/RTM-OBSERVATION-CONFIG-01.md');
const UI = doc('08.ui-design/20.pages/12.settings-observation.md');
const PANEL = src('eso/ui/apps/control-plane/src/app/features/consumers/components/observation-panel.component.html');
const TAIL = src('eso/ui/apps/control-plane/src/app/features/consumers/pages/settings-tail.base.ts');
const STACK = src('eso/ui/apps/control-plane/src/app/features/consumers/components/stack-tab.component.html');

test('F-03 §9 · consent + event scope, evidence & JEV ở nơi khác', () => {
    assert.match(FRD, /## 9\. Bề mặt `settings\?tab=observation`/);
    assert.match(FRD, /PROFILE_JEV_NEEDS_CONSENT/);
    assert.match(FRD, /Open Observatory/);
    assert.match(FRD, /tab \*\*Stack\*\*/);
});

test('AC-49 4 tiêu chí + SCN + RTM', () => {
    for (let i = 1; i <= 4; i += 1) {
        assert.match(AC, new RegExp(`\`AC-49-${i}\``));
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-49-${i}\``));
    }
    assert.match(SCN, /`SCN-49-1`/);
});

test('code · tab observation chỉ còn consent/events; timeline và JEV không còn render', () => {
    assert.match(PANEL, /Enable observation/);
    assert.match(PANEL, /Recorded events/);
    // Data surface phải ở /observatory, không phải settings.
    assert.doesNotMatch(PANEL, /Observation timeline/);
    assert.doesNotMatch(PANEL, /observation-list/);
    // JEV là policy → tab Stack.
    assert.doesNotMatch(PANEL, /JEV mode/);
    assert.doesNotMatch(PANEL, /Verdict input JSON/);
    assert.match(TAIL, /PROFILE_JEV_NEEDS_CONSENT|PROFILE_JEV_THRESHOLD/);
    // JEV ở tab Stack (policy surface).
    assert.match(STACK, /Judgment · JEV/);
    assert.match(STACK, /JEV mode/);
});

test('UI doc · không chép endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
});
