/**
 * Doc + code conformance cho `/consumers` — test tài liệu, không phải render.
 * Nguồn: sdlc/06.analysis/04.rtm/RTM-CON-01.md
 * Chạy: node --test qc/eso-consumers-docs.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/01.control-plane-ui.md');
const SRS_IF = doc('05.requirements/01.specification/04.srs/04.external-interfaces.md');
const AC = doc('06.analysis/02.ac/AC-04.md');
const SCN = doc('06.analysis/03.scn/SCN-04.md');
const RTM = doc('06.analysis/04.rtm/RTM-CON-01.md');
const UI = doc('08.ui-design/20.pages/02.consumers.md');
const PAGE = src('eso/ui/apps/control-plane/src/app/features/consumers/pages/consumers.page.ts');

test('AC-04-1…3 · API list có test thật và dòng RTM', () => {
    assert.ok(existsSync(new URL('../eso/control-plane/test/registry.test.ts', import.meta.url)), 'registry.test.ts phải tồn tại');
    for (const n of [1, 2, 3]) {
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-04-${n}\`\\s*\\|\\s*\`SCN-04-${n}\``), `RTM thiếu AC-04-${n}`);
    }
});

test('AC-04-4 · 3 số tính từ danh sách đã tải', () => {
    assert.match(PAGE, /readyCount\s*=\s*computed/);
    assert.match(PAGE, /latest\s*=\s*computed/);
    assert.match(FRD, /3 số/);
});

test('AC-04-5 · filter client-side + empty khi không khớp', () => {
    assert.match(PAGE, /statusFilter\s*=\s*signal/);
    assert.match(PAGE, /visible\s*=\s*computed/);
    assert.match(PAGE, /No consumers match this filter/);
    assert.match(UI, /Status.*All|\bAll\b.*Ready/);
});

test('AC-04-6 · Details / Events / Create điều hướng đúng', () => {
    assert.match(PAGE, /routerLink="\/setup"/);
    assert.match(PAGE, /\['\/consumers', item\.id\]/);
    assert.match(PAGE, /\['\/events'\]/);
    assert.match(PAGE, /\{ consumer: item\.id \}/);
});

test('AC-04-7 · lỗi có mã, SRS định nghĩa cả hai', () => {
    assert.match(PAGE, /CONS_DENIED/);
    assert.match(PAGE, /CONS_UPSTREAM_FAILED/);
    for (const code of ['CONS_DENIED', 'CONS_UPSTREAM_FAILED']) {
        assert.match(SRS_IF, new RegExp(code), `SRS thiếu ${code}`);
    }
});

test('chain · 7 AC có SCN và dòng RTM', () => {
    const acs = [...AC.matchAll(/`(AC-04-\d)`/g)].map((m) => m[1]);
    const unique = [...new Set(acs)];
    assert.equal(unique.length, 7, `phải có 7 AC, thấy ${unique.length}`);
    for (const ac of unique) {
        assert.match(SCN, new RegExp(`\\|\\s*\`SCN-04-\\d+\`\\s*\\|\\s*\`${ac}\``), `SCN thiếu ${ac}`);
        assert.match(RTM, new RegExp(`\\|\\s*\`${ac}\``), `RTM thiếu ${ac}`);
    }
});

test('no-duplication · UI doc không chứa endpoint; FRD không bảng endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
    assert.doesNotMatch(FRD, /\|\s*`?GET \/api/);
});
