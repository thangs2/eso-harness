/**
 * Q2 — the request detail shows the recorded write-permission decision as its own line.
 *
 * The gate is read from `detail.writeGate` (the scope guard's append-only record). It must never
 * be inferred from `detail.verdict`: a verdict is ESO's adjudication, a write gate is a guard
 * decision, and they can disagree.
 *
 * Chạy: node --test qc/eso-request-write-gate-ui.test.mjs
 */
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

/** The rendered write-gate line only — not the whole verdict panel. */
const GATE_START = PAGE.indexOf('class="write-gate"');
const GATE_BLOCK = GATE_START >= 0 ? PAGE.slice(GATE_START, PAGE.indexOf('</p>', GATE_START)) : '';

test('writeGate is read from detail, not derived from the verdict', () => {
    assert.match(PAGE, /interface WriteGateView \{[\s\S]*?decisionId: string;[\s\S]*?allowed: boolean;[\s\S]*?code: string \| null;[\s\S]*?target: string;[\s\S]*?at: string;[\s\S]*?actor: Record<string, unknown> \| null;/);
    assert.match(PAGE, /writeGate\?: WriteGateView \| null/);
    assert.match(PAGE, /readonly writeGate = computed<WriteGateView \| null>\(\(\) => this\.detail\(\)\?\.writeGate \?\? null\)/);
    assert.doesNotMatch(GATE_BLOCK, /verdict\(\)|v\.level|v\.allowed|verdictLevel/);
});

test('write gate line renders allowed/blocked, code, target and time', () => {
    assert.ok(GATE_BLOCK, 'the Q1/Q2 area must render a .write-gate line');
    assert.match(GATE_BLOCK, /Write gate/);
    assert.match(GATE_BLOCK, /\{\{ gate\.allowed \? 'allowed' : 'blocked' \}\}/);
    assert.match(GATE_BLOCK, /\{\{ gate\.code \}\}/);
    assert.match(GATE_BLOCK, /\{\{ gate\.target \}\}/);
    assert.match(GATE_BLOCK, /\{\{ relative\(gate\.at\) \}\}/);
    assert.match(GATE_BLOCK, /writeGateActor\(gate\.actor\)/);
});

test('an unrecorded gate has the exact honest empty state', () => {
    assert.match(GATE_BLOCK, /No scope decision was recorded for this turn/);
});

test('write gate sits in the Q1/Q2 verdict panel above Q3 Sufficiency', () => {
    const q2 = PAGE.indexOf('Q2</span> Why this verdict');
    const gate = PAGE.indexOf('class="write-gate"');
    const q3 = PAGE.indexOf('Q3</span> Sufficiency');
    assert.ok(q2 > 0 && gate > 0 && q3 > 0, 'Q2, the write gate and Q3 must all exist');
    assert.ok(q2 < gate, 'the write gate belongs in the Q2 area');
    assert.ok(gate < q3, 'the write gate must render before the sufficiency block');
});

test('write gate styles use layout/type tokens', () => {
    const gateStyles = STYLES.slice(STYLES.indexOf('.write-gate'), STYLES.indexOf('.copy-path'));
    assert.match(gateStyles, /padding: var\(--space-2\) var\(--space-3\)/);
    assert.match(gateStyles, /border-radius: var\(--radius-sm\)/);
    assert.match(gateStyles, /font-size: var\(--text-xs\)/);
    const decls = gateStyles.match(/[a-z-]+\s*:\s*[^;{}]+/g) ?? [];
    const bad = decls.filter((decl) => {
        const prop = decl.split(':')[0].trim();
        if (/^border/.test(prop) || prop === 'box-shadow') return false;
        return /\d+px/.test(decl);
    });
    assert.deepEqual(bad, [], `write gate CSS hardcodes px:\n${bad.join('\n')}`);
});
