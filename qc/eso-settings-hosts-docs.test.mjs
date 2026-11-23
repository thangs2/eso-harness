/** Host binding (F-44) — doc + code conformance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/39.host-binding.md');
const SRS = doc('05.requirements/01.specification/04.srs/03.functional-requirements.md');
const AC = doc('06.analysis/02.ac/AC-44.md');
const SCN = doc('06.analysis/03.scn/SCN-44.md');
const RTM = doc('06.analysis/04.rtm/RTM-BINDING-01.md');
const UI = doc('08.ui-design/20.pages/08.settings-hosts.md');
const CLIENT = src('eso/ui/libs/api-client/client.ts');
const HOSTS_TAB = src('eso/ui/apps/control-plane/src/app/features/consumers/components/hosts-tab.component.html');

test('F-44 · PRD + REQ-49 + BR-48', () => {
    assert.match(doc('05.requirements/01.specification/01.prd/03.capabilities.md'), /`F-44`/);
    assert.match(SRS, /`REQ-49`/);
    assert.match(doc('05.requirements/01.specification/02.brd/04.business-rules.md'), /`BR-48`/);
});

test('FRD §1–§7 + chỉ published', () => {
    for (const h of ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.']) assert.ok(FRD.includes(h), h);
    assert.match(FRD, /VERSION_NOT_PUBLISHED/);
    assert.match(FRD, /published/);
});

test('AC-44 5 tiêu chí + SCN + RTM', () => {
    for (let i = 1; i <= 5; i += 1) {
        assert.match(AC, new RegExp(`\`AC-44-${i}\``));
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-44-${i}\``));
    }
    assert.match(SCN, /`SCN-44-1`/);
});

test('code · hosts + host-runtimes + bulk upgrade', () => {
    assert.match(CLIENT, /\/hosts`/);
    assert.match(CLIENT, /host-runtimes/);
    assert.match(HOSTS_TAB, /Bulk upgrade/);
    assert.match(HOSTS_TAB, /No host bindings yet/);
});

test('UI doc · không chép endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
});
