/** Boundaries (F-06) — doc + code conformance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/06.consumer-isolation.md');
const SRS = doc('05.requirements/01.specification/04.srs/03.functional-requirements.md');
const AC = doc('06.analysis/02.ac/AC-48.md');
const SCN = doc('06.analysis/03.scn/SCN-48.md');
const RTM = doc('06.analysis/04.rtm/RTM-BOUNDARY-01.md');
const UI = doc('08.ui-design/20.pages/11.settings-boundaries.md');
const CLIENT = src('eso/ui/libs/api-client/client.ts');
const SERVICE = src('eso/ui/apps/control-plane/src/app/core/consumers/consumer-profile.service.ts');
const PANEL = src('eso/ui/apps/control-plane/src/app/features/consumers/components/boundaries-panel.component.html');

test('F-06 §7 + REQ-10', () => {
    assert.match(FRD, /## 7\. Bề mặt `settings\?tab=boundaries`/);
    assert.match(SRS, /`REQ-10`/);
    assert.match(FRD, /specificity/);
});

test('AC-48 4 tiêu chí + SCN + RTM', () => {
    for (let i = 1; i <= 4; i += 1) {
        assert.match(AC, new RegExp(`\`AC-48-${i}\``));
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-48-${i}\``));
    }
    assert.match(SCN, /`SCN-48-1`/);
});

test('code · boundaries + grants + mode/enforcement', () => {
    assert.match(CLIENT, /boundaries`/);
    assert.match(CLIENT, /boundaries\/grants/);
    assert.match(SERVICE, /saveBoundaries/);
    assert.match(PANEL, /Deny wins over allow/);
    assert.match(PANEL, /single-use/);
});

test('UI doc · không chép endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
});
