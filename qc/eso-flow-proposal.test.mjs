import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SVC = readFileSync('eso/control-plane/src/modules/flows/flow-proposal.service.ts', 'utf8');

test('AC-56-1 · chỉ đọc block slp-flow, parse JSON trong block', () => {
    assert.match(SVC, /```slp-flow/);
    assert.match(SVC, /JSON\.parse|parse\(/);
});

test('AC-56-2 · không parse prose ngoài block', () => {
    assert.match(SVC, /match\(|exec\(/);
    assert.equal(/JSON\.parse\(content\)/.test(SVC), false);
});

test('AC-56-3 · proposal tạo draft, không publish/default', () => {
    assert.match(SVC, /status:\s*'draft'/);
    assert.equal(/status:\s*'published'/.test(SVC), false);
    assert.equal(/isDefault:\s*true/.test(SVC), false);
});
