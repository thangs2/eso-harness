import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('eso/ui/apps/control-plane/src/app/features/observatory/pages/event-stream.page.ts', 'utf8');

test('AC-53-2 · trace filter dùng substring, không exact-first', () => {
    const filtered = SRC.slice(SRC.indexOf('readonly filtered'), SRC.indexOf('readonly traceCount'));
    assert.match(filtered, /item\.traceId\.toLowerCase\(\)\.includes\(trace\)/);
    assert.doesNotMatch(filtered, /traceId\s*===\s*trace/);
});

test('AC-53-2 · timeline lọc exact traceId (khác list)', () => {
    assert.match(SRC, /traceObservations[\s\S]*?item\.traceId === trace/);
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
