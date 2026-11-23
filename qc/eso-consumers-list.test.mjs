/**
 * `/consumers` — AC-15 (F-01, REQ-15) source-invariant test.
 *
 * No Angular build is available in this repo, so this checks the page/service source that the
 * browser would run: login stores the credential, the list is fetched from the API (not a static
 * array), and a server failure renders the code + message without reinterpretation.
 *
 * Chạy: node --test qc/eso-consumers-list.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/01.control-plane-ui.md');
const SRS_IF = doc('05.requirements/01.specification/04.srs/04.external-interfaces.md');
const AUTH = src('eso/ui/apps/control-plane/src/app/core/auth/auth.service.ts');
const LOGIN = src('eso/ui/apps/control-plane/src/app/features/login/pages/login.page.ts');
const ROUTES = src('eso/ui/apps/control-plane/src/app/routes.ts');
const CONSUMER_ROUTES = src('eso/ui/apps/control-plane/src/app/features/consumers/consumers.routes.ts');
const PAGE = src('eso/ui/apps/control-plane/src/app/features/consumers/pages/consumers.page.ts');
const SERVICE = src('eso/ui/apps/control-plane/src/app/core/consumers/consumer-profile.service.ts');
const CLIENT = src('eso/ui/libs/api-client/client.ts');
const SETUP = src('eso/ui/apps/control-plane/src/app/features/setup/pages/setup.page.ts');
const REGISTRATION = src('eso/control-plane/src/modules/consumers/registration/registration.service.ts');

test('SCN-15-1 · AC-15-1 — đăng nhập ⇒ credential ở sessionStorage, /consumers render danh sách', () => {
    // Then: credential nằm trong sessionStorage (không phải localStorage/server session).
    assert.match(AUTH, /sessionStorage\.setItem\('eso\.auth'/);
    assert.match(AUTH, /sessionStorage\.getItem\('eso\.auth'/);
    assert.match(LOGIN, /this\.auth\.setAuthorization\(authorization\)/);

    // Đăng nhập xong mở /consumers.
    assert.match(LOGIN, /navigateByUrl\([\s\S]*?\/consumers/);
    assert.match(ROUTES, /path: 'consumers'/);
    assert.match(CONSUMER_ROUTES, /\{\s*path: '',\s*component: ConsumersPage/);

    // Page gọi service (API), không dựng list từ mảng tĩnh.
    assert.match(PAGE, /this\.service\s*\.list\(\)/);
    assert.match(PAGE, /this\.items\.set\(res\.items \|\| \[\]\)/);
    assert.match(PAGE, /@for \(item of visible\(\); track item\.id\)/);
    assert.match(PAGE, /aria-label="Consumer list"/);
    assert.match(PAGE, /\{\{ item\.name \|\| item\.id \}\}/);
});

test('SCN-15-2 · AC-15-2 — wizard đăng ký ⇒ POST consumer, list đọc lại từ API, profile .harness/config.json được sinh', () => {
    // Wizard: id · name · root · sdlcRoot, nút đăng ký gọi service.
    assert.match(SETUP, /Consumer id/);
    assert.match(SETUP, /SDLC root/);
    assert.match(SETUP, /\.createSetup\(\{/);
    assert.match(SETUP, /this\.router\.navigate\(\['\/consumers', result\.id\]/);

    // Service + client: một nguồn dữ liệu là `POST /api/v1/consumers`; list cũng đọc từ API.
    assert.match(SERVICE, /createSetup\([\s\S]*?this\.client\.createConsumerSetup\(payload\)/);
    assert.match(CLIENT, /createConsumerSetup\([\s\S]*?\/api\/v1\/consumers[\s\S]*?method: 'POST'/);
    assert.match(SERVICE, /list\(\)[\s\S]*?this\.client\.listConsumers\(\)/);
    assert.match(CLIENT, /listConsumers\(\)[\s\S]*?\/api\/v1\/consumers/);

    // Postcondition: registration sinh file profile `.harness/config.json`.
    assert.match(REGISTRATION, /materializeGeneratedProfile/);
    assert.match(REGISTRATION, /join\(dir, 'config\.json'\)/);
    assert.match(REGISTRATION, /writeFileSync\(temp, body, 'utf8'\)/);
});

test('SCN-15-3 · AC-15-3 — server lỗi ⇒ UI hiện mã + message, không tự diễn giải', () => {
    // Then: mã + message cùng hiện trong alert.
    assert.match(PAGE, /role="alert"/);
    assert.match(PAGE, /class="form-error"/);
    assert.match(PAGE, /@if \(errorCode\(\)\)/);
    assert.match(PAGE, /\{\{ errorCode\(\) \}\}/);
    assert.match(PAGE, /\{\{ message \}\}/);

    // 401/403 ⇒ CONS_DENIED, còn lại ⇒ CONS_UPSTREAM_FAILED.
    assert.match(PAGE, /status === 401 \|\| status === 403 \? 'CONS_DENIED' : 'CONS_UPSTREAM_FAILED'/);

    // Không tự diễn giải: message lấy nguyên văn từ `detail`/`message` của lỗi.
    assert.match(PAGE, /\(err as \{ detail\?: string; message\?: string \}\)\?\.detail \|\| \(err as Error\)\?\.message/);

    // Mã lỗi phải có trong SRS/FRD.
    for (const code of ['CONS_DENIED', 'CONS_UPSTREAM_FAILED']) {
        assert.match(SRS_IF, new RegExp(code), `SRS thiếu ${code}`);
        assert.match(FRD, new RegExp(code), `FRD thiếu ${code}`);
    }
});
