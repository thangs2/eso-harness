/** Worker source sync slice (F-40) — doc + code conformance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/35.worker-source-sync.md');
const SRS = doc('05.requirements/01.specification/04.srs/03.functional-requirements.md');
const AC = doc('06.analysis/02.ac/AC-45.md');
const SCN = doc('06.analysis/03.scn/SCN-45.md');
const RTM = doc('06.analysis/04.rtm/RTM-WORKER-SYNC-01.md');
const UI = doc('08.ui-design/20.pages/09.settings-workers.md');
const CLIENT = src('eso/ui/libs/api-client/client.ts');
const COMP = src('eso/ui/apps/control-plane/src/app/features/consumers/components/workers-settings.component.ts');
const FRD45 = doc('05.requirements/01.specification/03.frd/40.worker-config.md');
const AC46 = doc('06.analysis/02.ac/AC-46.md');
const SCN46 = doc('06.analysis/03.scn/SCN-46.md');
const RTM46 = doc('06.analysis/04.rtm/RTM-WORKER-CONFIG-01.md');
const IDENTITY = src('eso/ui/apps/control-plane/src/app/features/consumers/components/worker-identity.component.html');

test('F-40 · PRD + REQ-50 + BR-45', () => {
    assert.match(doc('05.requirements/01.specification/01.prd/03.capabilities.md'), /`F-40`/);
    assert.match(SRS, /`REQ-50`/);
    assert.match(FRD, /BR-45|một chiều/);
});

test('FRD §7 + bốn trạng thái sync', () => {
    assert.match(FRD, /## 7\. Bề mặt `settings\?tab=workers`/);
    for (const st of ['in sync', 'drift', 'missing projection', 'orphan projection']) assert.ok(FRD.includes(st), st);
});

test('AC-45 4 tiêu chí + SCN + RTM', () => {
    for (let i = 1; i <= 4; i += 1) {
        assert.match(AC, new RegExp(`\`AC-45-${i}\``));
        assert.match(RTM, new RegExp(`\\|\\s*\`AC-45-${i}\``));
    }
    assert.match(SCN, /`SCN-45-1`/);
});

test('code · 3 endpoint sync + UI gọi promote', () => {
    assert.match(CLIENT, /workers\/sync\/status/);
    assert.match(CLIENT, /workers\/sync`/);
    assert.match(CLIENT, /sync\/promote/);
    assert.match(COMP, /promoteWorkerProjection/);
});

test('F-45 · PRD + REQ-51 + BR-49 + FRD 40', () => {
    assert.match(doc('05.requirements/01.specification/01.prd/03.capabilities.md'), /`F-45`/);
    assert.match(SRS, /`REQ-51`/);
    assert.match(doc('05.requirements/01.specification/02.brd/04.business-rules.md'), /`BR-49`/);
    assert.match(FRD45, /`WORKER_INVALID`/);
    assert.match(FRD45, /preview/);
});

test('AC-46 6 tiêu chí + SCN + RTM', () => {
    for (let i = 1; i <= 6; i += 1) {
        assert.match(AC46, new RegExp(`\`AC-46-${i}\``));
        assert.match(RTM46, new RegExp(`\\|\\s*\`AC-46-${i}\``));
    }
    assert.match(SCN46, /`SCN-46-1`/);
});

test('code · workers PUT/placements/import/audit/check + 5 field identity', () => {
    assert.match(CLIENT, /async saveConsumerWorkers/);
    assert.match(CLIENT, /worker-placement/);
    assert.match(CLIENT, /workers\/import\/preview/);
    assert.match(CLIENT, /workers\/import\/audit/);
    for (const label of ['Name', 'Role', 'Layer', 'Status', 'Prompt body']) assert.ok(IDENTITY.includes(label), label);
});

test('UI doc · không chép endpoint + không còn OPEN config', () => {
    assert.doesNotMatch(UI, /GET \/api\//);
    assert.doesNotMatch(UI, /OPEN-WORKERS-CONFIG/);
});
