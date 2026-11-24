import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/observatory.page.ts', import.meta.url), 'utf8');

test('/observatory writes ?consumer= when the dropdown falls back to the first consumer', () => {
    assert.match(PAGE, /const selected = requested \|\| fallback;/);
    assert.match(PAGE, /this\.consumerId\.set\(selected\)/);
    // the URL write must happen inside init, not only in selectConsumer
    const init = PAGE.slice(PAGE.indexOf('private async init()'), PAGE.indexOf('selectConsumer(id: string)'));
    assert.match(init, /queryParams:\s*\{\s*consumer:\s*selected/);
    assert.match(init, /replaceUrl:\s*true/);
    // alias `project` is normalised away, not left beside consumer
    assert.match(init, /project:\s*null/);
});

test('no consumer at all keeps the dropdown empty (no invented id)', () => {
    assert.match(PAGE, /const fallback = this\.consumers\(\)\[0\]\?\.id \|\| ''/);
    const init = PAGE.slice(PAGE.indexOf('private async init()'), PAGE.indexOf('selectConsumer(id: string)'));
    assert.match(init, /if \(selected && \(!requested \|\| query\.has\('project'\)\)\)/);
});
