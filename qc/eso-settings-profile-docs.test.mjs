/**
 * Doc conformance cho `settings · profile` (DRAFT — chờ WIP tách consumer-settings).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const INDEX = doc('08.ui-design/20.pages/00.index.md');
const FRD = doc('05.requirements/01.specification/03.frd/03.consumer-registry.md');
const AC = doc('06.analysis/02.ac/AC-06.md');
const SCN = doc('06.analysis/03.scn/SCN-06.md');
const RTM = doc('06.analysis/04.rtm/RTM-SETTINGS-PROFILE-01.md');
const UI = doc('08.ui-design/20.pages/06.settings-profile.md');
const SERVICE = src('eso/ui/apps/control-plane/src/app/core/consumers/consumer-profile.service.ts');
const CORE = src('eso/ui/apps/control-plane/src/app/features/consumers/pages/settings-core.base.ts');
const TAIL = src('eso/ui/apps/control-plane/src/app/features/consumers/pages/settings-tail.base.ts');
const HTML = src('eso/ui/apps/control-plane/src/app/features/consumers/pages/consumer-settings.page.html');
const PROFILE = src('eso/ui/apps/control-plane/src/app/features/consumers/components/profile-panel.component.html');
const SRS_IF = doc('05.requirements/01.specification/04.srs/04.external-interfaces.md');

test('map · 7 tab có F/REQ và trạng thái', () => {
    const rows = [...INDEX.matchAll(/^\| `(profile|stack|hosts|workers|knowledge|boundaries|observation)` \|/gm)];
    assert.equal(rows.length, 7, `thấy ${rows.length} tab`);
    assert.match(INDEX, /Bản đồ `settings` → năng lực/);
});

test('FRD §8 · profile surface tồn tại + luật optimistic lock', () => {
    assert.match(FRD, /## 8\. Bề mặt `\/consumers\/:id\/settings\?tab=profile`/);
    assert.match(FRD, /expected_version/);
    assert.match(FRD, /STALE_VERSION/);
});

test('AC-06-4/5 + SCN + RTM', () => {
    assert.match(AC, /`AC-06-4`/);
    assert.match(AC, /`AC-06-5`/);
    assert.match(SCN, /`SCN-06-4`/);
    assert.match(SCN, /`SCN-06-5`/);
    for (const n of [1, 2, 3, 4, 5]) assert.match(RTM, new RegExp(`\\|\\s*\`AC-06-${n}\``));
});

test('UI doc · không còn chờ WIP + không chép endpoint', () => {
    assert.doesNotMatch(UI, /chờ WIP/);
    assert.doesNotMatch(UI, /GET \/api\//);
});

test('code hook · service có updateSettings', () => {
    assert.match(SERVICE, /updateSettings\(/);
});

test('AC-06-6 · 5 mã PROFILE_* trong code + SRS + hiển thị mã', () => {
    for (const code of ['PROFILE_STALE_VERSION', 'PROFILE_DENIED', 'PROFILE_UPSTREAM_FAILED', 'PROFILE_JEV_NEEDS_CONSENT', 'PROFILE_JEV_THRESHOLD']) {
        assert.match(SRS_IF, new RegExp(code), `SRS thiếu ${code}`);
    }
    assert.match(CORE, /PROFILE_DENIED/);
    assert.match(TAIL, /PROFILE_STALE_VERSION/);
    assert.match(TAIL, /PROFILE_JEV_THRESHOLD/);
    assert.match(HTML, /errorCode\(\)/);
});

test('field list · 5 trường profile', () => {
    for (const label of ['Consumer name', 'Owner / team', 'Locale', 'Tags', 'Description']) {
        assert.ok(PROFILE.includes(label), `thiếu field ${label}`);
    }
});

test('OPEN của profile đã đóng (không còn TECH/CODES)', () => {
    const all = INDEX + FRD + UI + RTM + AC;
    assert.doesNotMatch(all, /OPEN-SETTINGS-TECH/);
    assert.doesNotMatch(all, /OPEN-SETTINGS-CODES/);
});
