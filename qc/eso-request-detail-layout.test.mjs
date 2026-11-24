import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const PAGE_DIR = new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail/', import.meta.url);
const ORDER = [
    'request-detail.models.ts',
    'request-detail.selectors.ts',
    'components/request-hero.component.ts',
    'components/glance-cards.component.ts',
    'components/pipeline-stepper.component.ts',
    'components/pipeline-flow.component.ts',
    'components/waterfall-panel.component.ts',
    'components/graph-panel.component.ts',
    'components/verdict-panel.component.ts',
    'components/rules-panel.component.ts',
    'components/telemetry-panel.component.ts',
    'request-detail.page.ts',
];
const readPageFolder = () => {
    const root = readdirSync(PAGE_DIR).filter((file) => file.endsWith('.ts'));
    const components = readdirSync(new URL('components/', PAGE_DIR)).filter((file) => file.endsWith('.ts')).map((file) => `components/${file}`);
    return [...root, ...components, '../request-detail.page.ts']
        .sort((a, b) => (ORDER.indexOf(a) + 1 || ORDER.length + 1) - (ORDER.indexOf(b) + 1 || ORDER.length + 1) || a.localeCompare(b))
        .map((file) => readFileSync(new URL(file, PAGE_DIR), 'utf8'))
        .join('\n');
};
const stylesOf = (source) => [...source.matchAll(/styles:\s*\[`([\s\S]*?)`\]/g)].map((match) => match[1]).join('\n');

const PAGE = readPageFolder();
const STYLES = stylesOf(PAGE);

test('detail page frame follows golden standard (symmetrical page-pad, no section max-width)', () => {
    assert.match(STYLES, /\.detail-page\s*\{[\s\S]*?padding:\s*var\(--page-pad\)/);
    assert.match(STYLES, /\.detail-page\s*\{[\s\S]*?gap:\s*var\(--space-5\)/);
    assert.match(STYLES, /max-width:\s*calc\(var\(--content-max\) \+ var\(--page-pad\) \* 2\)/);
    assert.match(STYLES, /margin:\s*0 auto/);
    assert.match(STYLES, /box-sizing:\s*border-box/);
    assert.equal(/max-width:\s*1280px/.test(STYLES), false, 'no fixed 1280 frame');
});

test('no hardcoded px for spacing/font/radius (border/shadow excepted)', () => {
    const decls = STYLES.match(/[a-z-]+\s*:\s*[^;{}]+/g) ?? [];
    const bad = decls.filter((decl) => {
        const prop = decl.split(':')[0].trim();
        if (/^border/.test(prop) || prop === 'box-shadow') return false;
        if (!/\d+px/.test(decl)) return false;
        if (prop === 'border-radius') return false;
        return true;
    });
    assert.deepEqual(bad, [], `hardcoded px:\n${bad.join('\n')}`);
});

test('shell owns main element — page root is a div', () => {
    assert.match(PAGE, /<div class="detail-page">/);
    assert.equal(/<main class="detail-page">/.test(PAGE), false);
});

test('layout doc is recorded (5a) with page-pad contract', () => {
    const DOC = readFileSync(new URL('../sdlc/08.ui-design/20.pages/20.request-detail.md', import.meta.url), 'utf8');
    assert.match(DOC, /## 5a\. Layout/);
    assert.match(DOC, /var\(--page-pad\)/);
});
