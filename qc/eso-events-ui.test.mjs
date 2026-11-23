import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('eso/ui/apps/control-plane/src/app/features/observatory/pages/event-stream.page.ts', 'utf8');
const OFFICE = readFileSync('eso/ui/apps/control-plane/src/app/features/observatory/pages/office.page.ts', 'utf8');
const OBSERVATORY = readFileSync('eso/ui/apps/control-plane/src/app/features/observatory/pages/observatory.page.ts', 'utf8');

test('BUG-23 · trace filter exact, cùng một predicate cho list và timeline', () => {
    const filtered = SRC.slice(SRC.indexOf('readonly filtered'), SRC.indexOf('readonly traceCount'));
    assert.match(filtered, /this\.matchesTrace\(item, trace\)/);
    assert.doesNotMatch(filtered, /traceId\.toLowerCase\(\)\.includes/);
    assert.match(SRC, /private matchesTrace\(event: ObservationDto, trace: string\): boolean \{\s*return event\.traceId === trace;/);
    assert.match(SRC, /observations\(\)\.filter\(\(item\) => this\.matchesTrace\(item, trace\)\)/);
});

test('BUG-22 · có lỗi thì toolbar không in số "0 events · 0 traces"', () => {
    assert.match(SRC, /@if \(!error\(\)\) \{\s*<span class="stream-count">\{\{ filtered\(\)\.length \}\} events/);
    assert.match(SRC, /counts unavailable/);
});

test('BUG-07 · không còn nhánh chết requestMode (route là events, không phải requests)', () => {
    assert.equal(/requestMode/.test(SRC), false);
    assert.match(SRC, /Observatory · event stream/);
    assert.match(SRC, /<h1>Event stream viewer<\/h1>/);
    assert.equal(/routeConfig\?\.path === 'requests'/.test(SRC), false);
});

test('BUG-08 · event row dùng được bằng keyboard (role, tabindex, Enter/Space)', () => {
    assert.match(SRC, /<article[\s\S]{0,250}role="button"[\s\S]{0,250}tabindex="0"/);
    assert.match(SRC, /\(keydown\.enter\)="selectObservation\(event\)"/);
    assert.match(SRC, /\(keydown\.space\)="selectObservation\(event\); \$event\.preventDefault\(\)"/);
});

test('BUG-09 · pulse row dùng được bằng keyboard', () => {
    assert.match(OBSERVATORY, /<li\s+role="button"\s+tabindex="0"[\s\S]{0,300}\(keydown\.enter\)="openEvent\(event\)"/);
    assert.match(OBSERVATORY, /\(keydown\.space\)="openEvent\(event\); \$event\.preventDefault\(\)"/);
});

test('BUG-29 · office poll 5 s dừng được và clear dữ liệu cũ khi đổi consumer/lỗi', () => {
    assert.match(OFFICE, /readonly autoRefresh = signal\(true\)/);
    assert.match(OFFICE, /toggleAutoRefresh\(\): void/);
    assert.match(OFFICE, /\(click\)="toggleAutoRefresh\(\)"/);
    assert.match(OFFICE, /private stopPolling\(\)/);
    assert.match(OFFICE, /this\.stopPolling\(\);/);
    // consumer switch and load failure both drop the previous rows
    const select = OFFICE.slice(OFFICE.indexOf('selectConsumer(id: string)'), OFFICE.indexOf('async load()'));
    assert.match(select, /this\.observations\.set\(\[\]\)/);
    assert.match(select, /this\.activeTraceId\.set\(''\)/);
    const load = OFFICE.slice(OFFICE.indexOf('async load()'), OFFICE.indexOf('selectWorker(id: string)'));
    assert.match(load, /catch \(error\) \{[\s\S]{0,200}this\.observations\.set\(\[\]\)/);
});

test('AC-53-4 · lỗi hiện message thô, KHÔNG map mã OBS_*', () => {
    assert.equal(/OBS_/.test(SRC), false);
    assert.match(SRC, /detail \|\| .*message/);
});

test('AC-53-6 · pager 40 dòng/trang', () => {
    assert.match(SRC, /pageSize = 40/);
});

test('AC-53-5 · live dùng SSE, fallback poll 5 s', () => {
    assert.match(SRC, /observationStream\(/);
    assert.match(SRC, /\}, 5000\)/);
});

test('AC-53-3 · detail có request card 5 field + link /requests', () => {
    for (const label of ['Request hash', 'Request length', 'Task type', 'Model', 'Adapter']) assert.ok(SRC.includes(label), label);
    assert.match(SRC, /\['\/requests', event\.traceId\]/);
});
