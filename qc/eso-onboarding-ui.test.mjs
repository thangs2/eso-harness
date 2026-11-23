import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync('eso/ui/apps/control-plane/src/app/features/onboarding/pages/onboarding.page.ts', 'utf8');
const SVC = readFileSync('eso/ui/apps/control-plane/src/app/features/onboarding/data/onboarding.service.ts', 'utf8');

test('AC-39-1 · chỉ consumer ready + schema c_<id> + 5 field preview', () => {
    assert.match(SVC, /status === 'ready'/);
    assert.match(SVC, /c_\$\{/);
    for (const label of ['Consumer', 'Display name', 'Schema', 'Material', 'Root']) {
        assert.ok(PAGE.includes(label), label);
    }
});

test('AC-39-2 · rỗng ⇒ CTA /setup', () => {
    assert.match(PAGE, /routerLink="\/setup"/);
});

test('AC-39-3 · lỗi hiện code + HTTP status + message', () => {
    assert.match(PAGE, /\{\{ err\.code \}\}/);
    assert.match(PAGE, /HTTP \{\{ err\.status \}\}/);
    assert.match(PAGE, /\{\{ err\.message \}\}/);
});

test('AC-39-3 · nhãn "Confirm & provision"', () => {
    assert.match(PAGE, /Confirm & provision/);
});
