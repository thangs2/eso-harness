/**
 * Doc + code conformance cho `/consumers/:id`.
 * Nguồn: sdlc/06.analysis/04.rtm/RTM-DETAIL-01.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/03.consumer-registry.md');
const SRS_IF = doc('05.requirements/01.specification/04.srs/04.external-interfaces.md');
const AC = doc('06.analysis/02.ac/AC-05.md');
const SCN = doc('06.analysis/03.scn/SCN-05.md');
const RTM = doc('06.analysis/04.rtm/RTM-DETAIL-01.md');
const UI = doc('08.ui-design/20.pages/04.consumer-detail.md');
const PAGE = src('eso/ui/apps/control-plane/src/app/features/consumers/pages/consumer-detail.page.ts');

test('AC-05-1…3 · API detail có test và dòng RTM', () => {
    assert.ok(existsSync(new URL('../eso/control-plane/test/registry.test.ts', import.meta.url)));
    for (const n of [1, 2, 3]) {
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-05-${n}\`\\s*\\|\\s*\`SCN-05-${n}\``), `RTM thiếu AC-05-${n}`);
    }
});

test('AC-05-4 · 4 panel + link settings', () => {
    for (const h of ['Profile', 'Knowledge base', 'Team &amp; gates', 'Protected paths']) {
        assert.ok(PAGE.includes(h) || PAGE.includes(h.replace('&amp;', '&')), `thiếu panel ${h}`);
    }
    assert.match(PAGE, /\[\'\/consumers\', p\.id, \'settings\'\]/);
});

test('AC-05-5 · banner chỉ từ ?created=1', () => {
    assert.match(PAGE, /created\.set\(this\.route\.snapshot\.queryParamMap\.get\('created'\) === '1'\)/);
    assert.match(PAGE, /Consumer saved/);
});

test('AC-05-6 · mã lỗi 404/401/5xx', () => {
    for (const code of ['DETAIL_NOT_FOUND', 'DETAIL_DENIED', 'DETAIL_UPSTREAM_FAILED']) {
        assert.match(PAGE, new RegExp(code), `page thiếu ${code}`);
        assert.match(SRS_IF, new RegExp(code), `SRS thiếu ${code}`);
    }
    assert.match(FRD, /mã \+ message|mã \+ thông điệp/);
});

test('chain · 6 AC có SCN và dòng RTM', () => {
    const acs = [...new Set([...AC.matchAll(/`(AC-05-\d)`/g)].map((m) => m[1]))];
    assert.equal(acs.length, 6);
    for (const ac of acs) {
        assert.match(SCN, new RegExp(`\\|\\s*\`SCN-05-\\d+\`\\s*\\|\\s*\`${ac}\``), `SCN thiếu ${ac}`);
        assert.match(RTM, new RegExp(`\\|\\s*\`${ac}\``), `RTM thiếu ${ac}`);
    }
});

test('no-duplication · UI doc không chứa endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
});
