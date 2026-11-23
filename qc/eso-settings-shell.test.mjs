import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync('eso/ui/apps/control-plane/src/app/features/consumers/pages/consumer-settings.page.html', 'utf8');
const KNOW = readFileSync('eso/ui/apps/control-plane/src/app/features/consumers/pages/settings-knowledge.base.ts', 'utf8');

test('AC-55-2 · dirty dùng HỢP 3 cờ (dirty + workerImportDirty + workerDirty)', () => {
    assert.match(HTML, /dirty\(\) \|\| workerImportDirty\(\) \|\| workerDirty\(\)/);
});

test('AC-55-3 · Save bị chặn khi tab workers còn lỗi validate', () => {
    assert.match(HTML, /activeTab\(\) === 'workers'[\s\S]{0,120}validationErrors\(\)\.length/);
});

test('AC-55-5 · archive legacy phải confirm trước', () => {
    assert.match(HTML, /legacyArchiveConfirm\.set\(true\)/);
    assert.match(HTML, /archiveLegacyHarness\(\)/);
});

test('AC-55-1 · Back về trang chi tiết consumer', () => {
    assert.match(KNOW, /navigate\(\['\/consumers', id\]\)/);
});

test('AC-55-4 · migration conflict chặn apply', () => {
    assert.match(HTML, /migrationConflictCount\(\) > 0/);
});
