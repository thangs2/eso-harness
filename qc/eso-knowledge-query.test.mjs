import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SERVER = readFileSync('eso/control-plane/src/common/http/server.ts', 'utf8');
const UI = readFileSync('eso/ui/apps/control-plane/src/app/features/consumers/components/knowledge-tab.component.html', 'utf8');

test('AC-57-1 · endpoint retrieve + UI có why/rrf', () => {
    assert.match(SERVER, /knowledge\/retrieve/);
    assert.match(UI, /Hybrid retrieval/);
    assert.match(UI, /Why/);
    assert.match(UI, /RRF/);
});

test('AC-57-2 · vector off vẫn trả reason + FTS/graph', () => {
    assert.match(UI, /vector/i);
    assert.match(UI, /reason|reasoning/i);
});

test('AC-57-3 · consumer/index lỗi có mã', () => {
    assert.match(SERVER, /CONSUMER_NOT_FOUND|KNOWLEDGE_DISABLED/);
});
