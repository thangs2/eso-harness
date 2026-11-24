/**
 * P6b / B0-10 — the topology tab compares the configured pipeline (`detail.pipeline`)
 * with the observed worker path (`detail.events`) and names the divergence.
 * Source contract test (no browser).
 *
 * Chạy: node --test qc/eso-request-runtime-graph.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(
    new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail.page.ts', import.meta.url),
    'utf8',
);

const TOPOLOGY = PAGE.slice(
    PAGE.indexOf("activeTab() === 'topology'"),
    PAGE.indexOf("activeTab() === 'decisions'"),
);
const STYLES_START = PAGE.indexOf('styles: [');
const STYLES = PAGE.slice(STYLES_START, PAGE.indexOf('`]', STYLES_START));

/** One computed block, cut at the next `readonly` declaration or comment boundary. */
const block = (start, end) => PAGE.slice(PAGE.indexOf(start), PAGE.indexOf(end));

const CONFIGURED = block('readonly configuredGraph', 'readonly observedGraph');
const OBSERVED = block('readonly observedGraph', 'readonly divergence');
const DIVERGENCE = block('readonly divergence', 'ngOnInit()');

test('topology tab renders configured and observed columns side by side', () => {
    assert.match(TOPOLOGY, /aria-label="Configured pipeline"/);
    assert.match(TOPOLOGY, /aria-label="Observed worker path"/);
    assert.match(TOPOLOGY, /<h3>Configured<\/h3>/);
    assert.match(TOPOLOGY, /<h3>Observed<\/h3>/);
    assert.match(TOPOLOGY, /@for \(step of configuredGraph\(\); track step\.workerId/);
    assert.match(TOPOLOGY, /@for \(worker of observedGraph\(\); track worker\.workerId/);
    // configured: label + status in order; observed: worker + outcome
    assert.match(TOPOLOGY, /\{\{ step\.label \}\}/);
    assert.match(TOPOLOGY, /\{\{ step\.status \|\| '—' \}\}/);
    assert.match(TOPOLOGY, /\{\{ worker\.label \}\}/);
    assert.match(TOPOLOGY, /\{\{ worker\.outcome \}\}/);
    // both columns live in the topology tab, not in a new tab
    assert.match(PAGE, /\{ id: 'topology' as const, label: 'Graphs & Topology' \}/);
});

test('configured graph is detail.pipeline only, in server order — no static flow', () => {
    assert.match(
        CONFIGURED,
        /readonly configuredGraph = computed<ConfiguredGraphStep\[\]>\(\(\) => \(this\.detail\(\)\?\.pipeline \?\? \[\]\)\.map/,
    );
    assert.match(CONFIGURED, /workerId: step\.workerId/);
    assert.match(CONFIGURED, /label: step\.label/);
    assert.match(CONFIGURED, /status: step\.status/);
    // B0-10: a hardcoded worker order is exactly the fabrication this closes.
    assert.doesNotMatch(PAGE, /const PIPELINE\b/);
});

test('observed path is derived from detail.events, ordered, distinct workers', () => {
    assert.match(
        PAGE,
        /OBSERVED_WORKER_EVENTS: ReadonlySet<string> = new Set\(\['worker\.remote\.completed', 'worker\.completed', 'prompt\.submitted'\]\)/,
    );
    assert.match(OBSERVED, /for \(const event of this\.detail\(\)\?\.events \?\? \[\]\)/);
    assert.match(OBSERVED, /if \(!OBSERVED_WORKER_EVENTS\.has\(event\.event\)\) continue;/);
    assert.match(OBSERVED, /const seen = new Set<string>\(\);/);
    assert.match(OBSERVED, /if \(!workerId \|\| seen\.has\(workerId\)\) continue;/);
    assert.match(OBSERVED, /seen\.add\(workerId\);/);
    assert.match(OBSERVED, /path\.push\(/);
    assert.match(OBSERVED, /outcome: event\.outcome \|\| '—'/);
    // no worker id is invented when the event carried none
    assert.match(OBSERVED, /const workerId = \(event\.workerId \?\? ''\)\.trim\(\)/);
});

test('no fabricated nodes: each column reads only its own source', () => {
    const compare = PAGE.slice(
        PAGE.indexOf('<div class="runtime-compare">'),
        PAGE.indexOf('<div class="runtime-divergence"'),
    );
    const configuredColumn = compare.slice(0, compare.indexOf('aria-label="Observed worker path"'));
    const observedColumn = compare.slice(compare.indexOf('aria-label="Observed worker path"'));
    assert.doesNotMatch(configuredColumn, /events/);
    assert.doesNotMatch(observedColumn, /pipeline|configuredGraph/);
    assert.doesNotMatch(compare, /stages\(\)/);
    assert.match(DIVERGENCE, /this\.configuredGraph\(\)\.map/);
    assert.match(DIVERGENCE, /this\.observedGraph\(\)\.map/);
});

test('observed empty state is explicit — host did not report worker events', () => {
    assert.match(TOPOLOGY, /No observed worker path \(host did not report worker events\)/);
});

test('divergence rules: missing / extra / matches computed from the two graphs', () => {
    assert.match(DIVERGENCE, /const configuredSet = new Set\(configured\);/);
    assert.match(DIVERGENCE, /const observedSet = new Set\(observed\);/);
    assert.match(DIVERGENCE, /const missing = configured\.filter\(\(workerId\) => !observedSet\.has\(workerId\)\);/);
    assert.match(DIVERGENCE, /const extra = observed\.filter\(\(workerId\) => !configuredSet\.has\(workerId\)\);/);
    // matches requires identical order, not just identical membership
    assert.match(DIVERGENCE, /configured\.every\(\(workerId, index\) => workerId === observed\[index\]\)/);
    assert.match(DIVERGENCE, /missing\.length \? 'missing' : extra\.length \? 'extra' : orderMatches \? 'matches' : 'reordered'/);
    assert.match(DIVERGENCE, /kind: 'empty'/);
    // divergence lines render each rule explicitly
    assert.match(TOPOLOGY, /\[attr\.data-kind\]="divergence\(\)\.kind"/);
    assert.match(TOPOLOGY, /@case \('matches'\)/);
    assert.match(TOPOLOGY, /@case \('missing'\)/);
    assert.match(TOPOLOGY, /@case \('extra'\)/);
    assert.match(TOPOLOGY, /configured but never observed: \{\{ divergence\(\)\.missing\.join\(', '\) \}\}/);
    assert.match(TOPOLOGY, /observed but not configured: \{\{ divergence\(\)\.extra\.join\(', '\) \}\}/);
    assert.match(TOPOLOGY, /matches — configured order equals observed order/);
    assert.match(TOPOLOGY, /No configured or observed worker path to compare\./);
});

test('comparison styles keep golden layout tokens (no hardcoded spacing px)', () => {
    const START = STYLES.indexOf('.runtime-compare');
    const END = STYLES.indexOf('.divergence-line.extra');
    const CSS = STYLES.slice(START, END);
    assert.match(CSS, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(CSS, /gap: var\(--space-3\)/);
    assert.match(CSS, /padding: var\(--space-3\)/);
    assert.match(CSS, /border-radius: var\(--radius-sm\)/);
    assert.match(CSS, /\.runtime-divergence\[data-kind='matches'\]/);
    assert.match(CSS, /\.runtime-divergence\[data-kind='missing'\]/);
    assert.match(CSS, /\.runtime-divergence\[data-kind='extra'\]/);
    assert.match(STYLES, /@media \(max-width: 62\.5rem\) \{ \.top-grid \{ grid-template-columns: 1fr; \} \.runtime-compare \{ grid-template-columns: 1fr; \}/);
    const decls = CSS.match(/[a-z-]+\s*:\s*[^;{}]+/g) ?? [];
    const bad = decls.filter((decl) => {
        const prop = decl.split(':')[0].trim();
        if (/^border/.test(prop) || prop === 'box-shadow' || prop === 'border-radius') return false;
        return /\d+px/.test(decl);
    });
    assert.deepEqual(bad, [], `runtime graph CSS hardcodes px:\n${bad.join('\n')}`);
});
