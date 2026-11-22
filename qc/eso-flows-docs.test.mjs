/**
 * Doc + code conformance cho `/consumers/:id/flows`.
 * Nguồn: sdlc/06.analysis/04.rtm/RTM-FLOW-01.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/34.consumer-flows.md');
const SRS_IF = doc('05.requirements/01.specification/04.srs/04.external-interfaces.md');
const AC = doc('06.analysis/02.ac/AC-42.md');
const SCN = doc('06.analysis/03.scn/SCN-42.md');
const RTM = doc('06.analysis/04.rtm/RTM-FLOW-01.md');
const UI = doc('08.ui-design/20.pages/05.consumer-flows.md');
const PAGE = src('eso/ui/apps/control-plane/src/app/features/consumers/pages/flows.page.ts');

test('AC-42-1 · list + empty', () => {
    assert.match(PAGE, /No flow yet\./);
    assert.match(PAGE, /summaries\(\)/);
});

test('AC-42-2 · badge status/version/default', () => {
    assert.match(PAGE, /title-badge/);
    assert.match(PAGE, /isActiveDefault/);
});

test('AC-42-3 · tạo flow cần worker set', () => {
    assert.match(PAGE, /FLOW_WORKERS_REQUIRED/);
    assert.match(PAGE, /createFlow\(\)/);
});

test('AC-42-4 · rename inline Enter/Escape', () => {
    assert.match(PAGE, /keydown\.enter/);
    assert.match(PAGE, /keydown\.escape/);
    assert.match(PAGE, /saveRename/);
});

test('AC-42-5 · canvas: cạnh cần on, xoá cạnh, guard', () => {
    assert.match(PAGE, /onCreateConnection/);
    assert.match(PAGE, /removeEdge/);
    assert.match(PAGE, /updateGuard/);
});

test('AC-42-6 · undo/redo/fit/snap/auto', () => {
    for (const m of ['undo()', 'redo()', 'fitCanvas()', 'snapGrid()', 'autoArrange()']) assert.ok(PAGE.includes(m), m);
});

test('AC-42-7 · validate + loop là warning', () => {
    assert.match(PAGE, /validateFlow/);
    assert.match(FRD, /FLOW_HAS_LOOP/);
    assert.match(FRD, /warning/);
});

test('AC-42-8/9/10 · publish · default chỉ published · delete draft', () => {
    assert.match(PAGE, /publishFlow/);
    assert.match(PAGE, /flow\.status !== 'published'/);
    assert.match(PAGE, /deleteDraftConfirm/);
});

test('AC-42-11 · mã lỗi FLOW_*', () => {
    for (const code of ['FLOW_DENIED', 'FLOW_NOT_FOUND', 'FLOW_UPSTREAM_FAILED']) {
        assert.match(PAGE, new RegExp(code));
        assert.match(SRS_IF, new RegExp(code));
    }
});

test('chain · 11 AC có SCN và dòng RTM', () => {
    const acs = [...new Set([...AC.matchAll(/`(AC-42-\d+)`/g)].map((m) => m[1]))];
    assert.equal(acs.length, 11, `thấy ${acs.length}`);
    for (const ac of acs) {
        assert.match(SCN, new RegExp(`\\|\\s*\`SCN-42-\\d+\`\\s*\\|\\s*\`${ac}\``), `SCN thiếu ${ac}`);
        assert.match(RTM, new RegExp(`\\|\\s*\`${ac}\``), `RTM thiếu ${ac}`);
    }
});

test('no-duplication · UI doc không chứa endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
});
