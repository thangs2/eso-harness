/**
 * C = test tài liệu: mỗi AC của `/observatory` kiểm rằng **tài liệu và code còn khớp nhau**
 * (điều kiện "tài liệu đầy đủ"), không phải test hành vi UI.
 *
 * Nguồn: sdlc/06.analysis/04.rtm/RTM-OBS-01.md · sdlc/06.analysis/03.scn/SCN-OBS-01.md
 * Chạy: node --test qc/eso-observatory-docs.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = (p) => readFileSync(new URL(`../sdlc/${p}`, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FRD = doc('05.requirements/01.specification/03.frd/37.worker-observability.md');
const SRS_IF = doc('05.requirements/01.specification/04.srs/04.external-interfaces.md');
const AC = doc('06.analysis/02.ac/AC-OBS-01.md');
const SCN = doc('06.analysis/03.scn/SCN-OBS-01.md');
const RTM = doc('06.analysis/04.rtm/RTM-OBS-01.md');
const UI = doc('08.ui-design/20.pages/01.observatory.md');
const PLANE_C = doc('07.technical/10.planes/02.plane-c-contract.md');
const PAGE = src('eso/ui/apps/control-plane/src/app/features/observatory/pages/observatory.page.ts');
const GRID = src('eso/ui/apps/control-plane/src/app/features/observatory/components/request-grid.component.ts');

const OBS_CODES = [
    'OBS_DENIED', 'OBS_CONSUMER_UNKNOWN', 'OBS_UPSTREAM_FAILED', 'OBS_FLOW_MISSING',
    'OBS_QUERY_EMPTY', 'OBS_TRACE_NOT_MATCHED', 'OBS_TRACE_EMPTY',
];

test('AC-OBS-01-01 · chọn consumer ghi ?consumer= và tài liệu mô tả đúng', () => {
    assert.match(PAGE, /queryParamMap/, 'page phải đọc query param');
    assert.match(PAGE, /queryParams:\s*\{\s*consumer:\s*id/, 'selectConsumer phải ghi ?consumer=');
    assert.match(FRD, /ghi lựa chọn vào URL/, 'FRD phải nêu luật ghi URL');
    assert.match(RTM, /`AC-OBS-01-01`/, 'RTM phải có dòng AC-01');
});

test('AC-OBS-01-02 · consumer không tồn tại ⇒ OBS_CONSUMER_UNKNOWN (tài liệu)', () => {
    assert.match(SRS_IF, /OBS_CONSUMER_UNKNOWN/, 'SRS phải định nghĩa mã');
    assert.match(FRD, /OBS_CONSUMER_UNKNOWN/, 'FRD phải nêu mã khi consumer không tồn tại');
    assert.match(SCN, /`SCN-OBS-01-02`/, 'SCN phải có kịch bản');
    // code phải mang mã + chặn fallback im lặng
    assert.match(PAGE, /OBS_CONSUMER_UNKNOWN/, 'page phải dùng mã OBS_CONSUMER_UNKNOWN');
    assert.match(PAGE, /requested && !this\.consumers\(\)\.some/, 'page phải chặn fallback im lặng');
});

test('AC-OBS-01-03 · KPI lấy từ observation ≤500 và nhãn Prompts', () => {
    assert.match(PAGE, /getConsumerObservations\(id,\s*500\)/, 'page phải gọi limit 500');
    assert.match(FRD, /Prompts/, 'FRD phải chốt nhãn Prompts');
    assert.match(PLANE_C, /observations[\s\S]{0,120}≤500/, 'hợp đồng phải ghi trần 500');
});

test('AC-OBS-01-04 · chọn flow isDefault → published → first', () => {
    assert.match(PAGE, /isDefault/);
    assert.match(PAGE, /status === 'published'/);
    assert.match(PLANE_C, /\/flows/, 'hợp đồng phải có endpoint flows');
});

test('AC-OBS-01-05 · pulse 450ms + khớp chính xác trước, rồi substring + 3 mã lỗi', () => {
    assert.match(PAGE, /450/, 'phải có nhịp 450ms');
    assert.match(PAGE, /toLowerCase\(\)/, 'phải chuẩn hoá trước khi so');
    for (const code of ['OBS_QUERY_EMPTY', 'OBS_TRACE_NOT_MATCHED', 'OBS_TRACE_EMPTY']) {
        assert.match(PAGE, new RegExp(code), `page phải dùng mã ${code}`);
        assert.match(SRS_IF, new RegExp(code), `SRS thiếu ${code}`);
    }
});

test('AC-OBS-01-06 · grid phân trang 50, request ≤200, prompt ≤500', () => {
    assert.match(GRID, /PAGE_SIZE\s*=\s*50/);
    assert.match(PLANE_C, /requests[\s\S]{0,120}≤200/);
    assert.match(PLANE_C, /prompts[\s\S]{0,120}≤500/);
});

test('AC-OBS-01-07 · mọi lỗi có mã + message; đủ 7 mã OBS', () => {
    for (const code of OBS_CODES) assert.match(SRS_IF, new RegExp(code), `SRS thiếu ${code}`);
    assert.match(UI, /mã \+ message/, 'UI phải nói hiển thị mã + message');
    for (const code of ['OBS_DENIED', 'OBS_UPSTREAM_FAILED']) {
        assert.match(PAGE, new RegExp(code), `page phải map ${code}`);
    }
});

test('AC-OBS-01-08 · read-only: page không gọi fetch/ghi trực tiếp', () => {
    assert.doesNotMatch(PAGE, /\bfetch\(/, 'page không được tự gọi HTTP');
    assert.doesNotMatch(PAGE, /method:\s*'(POST|PUT|DELETE|PATCH)'/, 'page không được ghi');
    assert.match(UI, /chỉ đọc|read-only|Read-only/, 'UI phải nêu read-only');
});

test('chain · 8 AC có SCN và có dòng RTM', () => {
    const acs = [...AC.matchAll(/`(AC-OBS-01-\d\d)`/g)].map((m) => m[1]);
    const unique = [...new Set(acs)];
    assert.equal(unique.length, 8, 'phải có 8 AC');
    for (const ac of unique) {
        assert.match(SCN, new RegExp(`\\|\\s*\`SCN-OBS-01-\\d\\d\`\\s*\\|\\s*\`${ac}\``), `SCN thiếu ${ac}`);
        assert.match(RTM, new RegExp(`\\|\\s*\`${ac}\``), `RTM thiếu ${ac}`);
    }
});

test('no-duplication · UI doc không chứa endpoint; FRD không chứa bảng endpoint', () => {
    assert.doesNotMatch(UI, /GET \/api\//, 'UI doc không được chép endpoint');
    assert.doesNotMatch(FRD, /\|\s*`?GET \/api/, 'FRD không được có bảng endpoint');
});
