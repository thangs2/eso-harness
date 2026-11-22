/**
 * Doc + code conformance cho `/setup` (wizard tạo consumer).
 * Nguồn: sdlc/06.analysis/04.rtm/RTM-SETUP-01.md
 * Chạy: node --test qc/eso-setup-docs.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/02.consumer-register.md');
const SRS_IF = doc('05.requirements/01.specification/04.srs/04.external-interfaces.md');
const AC = doc('06.analysis/02.ac/AC-02.md');
const SCN = doc('06.analysis/03.scn/SCN-02.md');
const RTM = doc('06.analysis/04.rtm/RTM-SETUP-01.md');
const UI = doc('08.ui-design/20.pages/03.setup.md');
const PAGE = src('eso/ui/apps/control-plane/src/app/features/setup/pages/setup.page.ts');

test('AC-02-1…3 · API create có test thật và dòng RTM', () => {
    assert.ok(existsSync(new URL('../eso/control-plane/test/consumer.test.ts', import.meta.url)), 'consumer.test.ts phải tồn tại');
    for (const n of [1, 2, 3]) {
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-02-${n}\`\\s*\\|\\s*\`SCN-02-${n}\``), `RTM thiếu AC-02-${n}`);
    }
});

test('AC-02-4 · 4 bước + preview trước khi ghi', () => {
    assert.match(PAGE, /readonly steps = \[/);
    assert.match(PAGE, /Preview & apply/);
    assert.match(PAGE, /setup-summary/);
    assert.match(FRD, /trước khi ghi/);
});

test('AC-02-5 · validate có mã cho root/id/name/sdlcRoot', () => {
    for (const code of ['SETUP_ROOT_REQUIRED', 'SETUP_ID_INVALID', 'SETUP_NAME_REQUIRED', 'SETUP_SDLC_ROOT_REQUIRED']) {
        assert.match(PAGE, new RegExp(code), `page thiếu ${code}`);
        assert.match(SRS_IF, new RegExp(code), `SRS thiếu ${code}`);
    }
});

test('AC-02-6 · JEV cần consent', () => {
    assert.match(PAGE, /SETUP_JEV_NEEDS_CONSENT/);
    assert.match(UI, /SETUP_JEV_NEEDS_CONSENT/);
});

test('AC-02-7 · resolve folder có 2 mã lỗi', () => {
    assert.match(PAGE, /SETUP_ROOT_UNRESOLVED/);
    assert.match(PAGE, /SETUP_ROOT_AMBIGUOUS/);
});

test('AC-02-8 · lỗi API có mã + redirect created=1', () => {
    assert.match(PAGE, /SETUP_DENIED/);
    assert.match(PAGE, /SETUP_UPSTREAM_FAILED/);
    assert.match(PAGE, /created: '1'/);
});

test('chain · 8 AC có SCN và dòng RTM', () => {
    const acs = [...AC.matchAll(/`(AC-02-\d)`/g)].map((m) => m[1]);
    const unique = [...new Set(acs)];
    assert.equal(unique.length, 8, `phải có 8 AC, thấy ${unique.length}`);
    for (const ac of unique) {
        assert.match(SCN, new RegExp(`\\|\\s*\`SCN-02-\\d+\`\\s*\\|\\s*\`${ac}\``), `SCN thiếu ${ac}`);
        assert.match(RTM, new RegExp(`\\|\\s*\`${ac}\``), `RTM thiếu ${ac}`);
    }
});

test('no-duplication · UI doc không chứa endpoint; FRD §7 không bảng endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
    assert.doesNotMatch(FRD, /\|\s*`?GET \/api/);
});
