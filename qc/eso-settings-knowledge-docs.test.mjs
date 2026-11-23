/** Knowledge index slice (F-14/F-15) — doc + code conformance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/14.inventory.md');
const AC = doc('06.analysis/02.ac/AC-47.md');
const SCN = doc('06.analysis/03.scn/SCN-47.md');
const RTM = doc('06.analysis/04.rtm/RTM-KNOWLEDGE-01.md');
const UI = doc('08.ui-design/20.pages/10.settings-knowledge.md');
const MAP = doc('08.ui-design/20.pages/00.index.md');
const CLIENT = src('eso/ui/libs/api-client/client.ts');
const TAB = src('eso/ui/apps/control-plane/src/app/features/consumers/components/knowledge-tab.component.html');

test('F-14 §7 + REQ-22', () => {
    assert.match(FRD, /## 7\. Bề mặt `settings\?tab=knowledge`/);
    assert.match(doc('05.requirements/01.specification/04.srs/03.functional-requirements.md'), /`REQ-22`/);
});

test('AC-47 4 tiêu chí + SCN + RTM', () => {
    for (let i = 1; i <= 4; i += 1) {
        assert.match(AC, new RegExp(`\`AC-47-${i}\``));
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-47-${i}\``));
    }
    assert.match(SCN, /`SCN-47-1`/);
});

test('code · docs/check/findings + counts', () => {
    assert.match(CLIENT, /knowledge\/docs/);
    assert.match(CLIENT, /knowledge\/check/);
    assert.match(CLIENT, /knowledge\/findings/);
    assert.match(TAB, /knowledgeSummary\(\)/);
});

test('B/C/D đã chốt trong bản đồ', () => {
    assert.match(MAP, /`settings · knowledge` — chốt B\/C\/D/);
    assert.match(MAP, /`F-36`/);
    assert.match(MAP, /`F-37`/);
    assert.match(MAP, /OUT/);
});

test('UI doc · không chép endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
});
