/** Stack composition (F-43) — doc + code conformance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/38.stack-composition.md');
const SRS = doc('05.requirements/01.specification/04.srs/03.functional-requirements.md');
const AC = doc('06.analysis/02.ac/AC-43.md');
const SCN = doc('06.analysis/03.scn/SCN-43.md');
const RTM = doc('06.analysis/04.rtm/RTM-STACK-01.md');
const UI = doc('08.ui-design/20.pages/07.settings-stack.md');
const CLIENT = src('eso/ui/libs/api-client/client.ts');
const SERVICE = src('eso/ui/apps/control-plane/src/app/core/consumers/consumer-profile.service.ts');

test('F-43 · PRD + REQ-48 + BR-47', () => {
    assert.match(doc('05.requirements/01.specification/01.prd/03.capabilities.md'), /`F-43`/);
    assert.match(SRS, /`REQ-48`/);
    assert.match(doc('05.requirements/01.specification/02.brd/04.business-rules.md'), /`BR-47`/);
});

test('FRD §1–§7 + bất biến sau publish', () => {
    for (const h of ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.']) assert.ok(FRD.includes(h), h);
    assert.match(FRD, /bất biến/);
    assert.match(FRD, /STACK_VERSION_IMMUTABLE/);
});

test('AC-43 5 tiêu chí + SCN + RTM', () => {
    for (let i = 1; i <= 5; i += 1) {
        assert.match(AC, new RegExp(`\`AC-43-${i}\``));
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-43-${i}\``));
    }
    assert.match(SCN, /`SCN-43-1`/);
});

test('code · endpoint stack-versions + service', () => {
    assert.match(CLIENT, /stack-versions/);
    assert.match(SERVICE, /saveStackVersions/);
    assert.match(SERVICE, /getStackVersions/);
});

test('UI doc · không chép endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
});
