/**
 * P9 — request detail visual parity with the legacy Observatory page.
 *
 * The page was re-skinned (not rewritten) to mirror the legacy information hierarchy and visual
 * language while keeping every proof block and every honest empty state:
 *
 *   header (prompt h1 + badges + one meta line + collapsible Identity)
 *   → at-a-glance (Verdict | Effectiveness | Write gate | Cost)
 *   → 8-stage stepper → E2E flow → tabs → full-width waterfall.
 *
 * Contract under test:
 *   · the legacy structure markers exist and render in that order;
 *   · the card chrome is legacy-style: icon chips, accent left rail, status dots, token tiles;
 *   · the stepper keeps the 8 pipeline v2 stage ids, one row at ≥1200, and one selected step;
 *   · the E2E step cards are dense: 3 sub-columns, empty steps collapse to one line;
 *   · the waterfall is full width with summary chips and no right rail;
 *   · all mandatory honest strings survive the revamp;
 *   · styles are component-scoped layout tokens only — no hardcoded `Npx` outside borders;
 *   · type scale: body 13px, secondary 12px, card title 14px, h1 26–28px, badge 11px.
 *
 * Chạy: node --test qc/eso-request-visual-parity.test.mjs
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

/** Mandatory strings the existing qc suites (and the operator) assert verbatim. */
const MANDATORY_STRINGS = [
    'No scope decision was recorded for this turn',
    'No host signal was reported for this turn',
    'Not issued yet',
    'Verified · hash ok',
    'Verification failed',
    'No JEV decision was recorded',
    'Band mismatch',
    'No effectiveness data for this request',
    'No gaps recorded',
    'No rule reference was recorded',
    'No action event was captured (host did not report it)',
    'No host evidence for this step',
];

/** Pipeline v2 — the eight stages the stepper must keep (ids, not a local order). */
const STAGE_IDS = ['intake-law', 'decision-jev', 'evidence-recon', 'sufficiency', 'slp', 'execution', 'seal', 'report'];

test('layout markers render in the professional order: header → at-a-glance → stepper → flow → tabs', () => {
    const header = PAGE.indexOf('<header class="request-hero"');
    const glance = PAGE.indexOf('class="glance-grid top-grid"');
    const stepper = PAGE.indexOf('<nav class="pipeline-stepper"');
    const endflow = PAGE.indexOf('class="endflow"');
    const tabs = PAGE.indexOf('class="tabs drill-tabs"');
    assert.ok(header > 0, 'header hero marker');
    assert.ok(glance > 0, 'at-a-glance row marker');
    assert.ok(stepper > 0, 'pipeline stepper marker');
    assert.ok(endflow > 0, 'end-to-end flow marker');
    assert.ok(tabs > 0, 'drill tabs marker');
    assert.ok(header < glance, 'header renders before the at-a-glance row');
    assert.ok(glance < stepper, 'at-a-glance row renders before the stepper');
    assert.ok(stepper < endflow, 'stepper renders before the E2E flow');
    assert.ok(endflow < tabs, 'drill tabs follow the E2E flow');
    assert.equal(PAGE.indexOf('<main class="detail-page">'), -1, 'shell owns main; page root stays a div');
    // The old standalone metadata card is gone: identity folds into the header.
    assert.equal(PAGE.includes('Request metadata'), false, 'no separate Request metadata card');
});

test('header: real h1 prompt, badge row, one meta line and collapsible Identity', () => {
    const start = PAGE.indexOf('<header class="request-hero"');
    const hero = PAGE.slice(start, PAGE.indexOf('</header>', start));
    assert.match(hero, /<h1 class="request-query">\{\{ queryText\(\) \}\}<\/h1>/);
    assert.match(hero, /class="badge status-badge"[\s\S]{0,120}<span class="status-dot"/);
    assert.match(hero, /class="badge verdict-badge"/);
    assert.match(hero, /class="hero-meta"/);
    for (const key of ['Started', 'Duration', 'Host', 'Runtime', 'Model', 'Actor']) {
        assert.match(hero, new RegExp(`<span class="meta-key">${key}</span>`), `meta line carries ${key}`);
    }
    assert.match(hero, /class="identity-details"/);
    assert.match(hero, /<summary class="identity-summary">/);
    assert.match(hero, /class="identity-grid"/);
    assert.match(hero, /Request hash/);
    assert.match(hero, /class="copy-path" \(click\)="copyRequestId\(request\.observationId\)"/);
    assert.match(PAGE, /readonly requestIdCopied = signal\(false\)/);
    assert.match(PAGE, /copyRequestId\(id: string\): void/);
    // 2-line clamp and the 26–28px scale at ≥1200.
    assert.match(STYLES, /\.request-query\s*\{[^}]*-webkit-line-clamp:\s*2/);
    assert.match(STYLES, /\.request-query\s*\{[^}]*font-size:\s*var\(--fs-h1\)/);
    assert.match(STYLES, /@media \(min-width: 75rem\) \{ \.request-query \{ font-size: var\(--fs-h1-lg\); \} \}/);
});

test('at-a-glance row: four compact cards, verdict + effectiveness + gate + cost', () => {
    const start = PAGE.indexOf('class="glance-grid top-grid"');
    const row = PAGE.slice(start, PAGE.indexOf('<nav class="pipeline-stepper"', start));
    assert.match(row, /class="verdict-hero"/);
    assert.match(row, /class="effectiveness"/);
    assert.match(row, /class="panel gate-card"/);
    assert.match(row, /class="panel tokens"/);
    assert.equal((row.match(/<div class="kpi-tile">/g) ?? []).length, 7, 'all seven effectiveness values stay');
    assert.match(row, /class="token-tiles"/);
    assert.match(row, /Host signals:<\/span> not reported/, 'null signals fold to one inline line');
    assert.match(STYLES, /\.glance-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, \.95fr\) minmax\(0, 1\.9fr\) minmax\(0, 1fr\) minmax\(0, \.95fr\)/);
});

test('card chrome mirrors the legacy language: icon chips, accent rails, status dots, token tiles', () => {
    const chips = PAGE.match(/class="icon-chip/g) ?? [];
    assert.ok(chips.length >= 4, `expected icon chips on the card heads (found ${chips.length})`);
    assert.match(STYLES, /\.icon-chip\s*\{[\s\S]*?border:\s*1px solid[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    // Legacy accent left rail on every card.
    assert.match(STYLES, /border-left:\s*3px solid var\(--card-accent/);
    // Status badges carry a dot as a second signal, not colour alone.
    assert.match(PAGE, /class="badge status-badge"[\s\S]{0,120}<span class="status-dot"/);
    assert.match(STYLES, /\.status-dot\s*\{[^}]*border-radius:\s*50%/);
    // Cost card keeps its token tiles; the telemetry tab keeps a second set.
    assert.equal((PAGE.match(/class="token-tiles"/g) ?? []).length >= 2, true, 'tokens card + telemetry tab tiles');
    // Section rhythm: page stack owns the vertical gap.
    assert.match(STYLES, /\.detail-page\s*\{[\s\S]*?gap:\s*var\(--space-5\)/);
});

test('stepper keeps the 8 v2 stage ids, one row, readable labels and a single selected step', () => {
    for (const id of STAGE_IDS) {
        assert.match(PAGE, new RegExp(`'?${id.replace('-', '\\-')}'?:\\s*'`), `stage glyph for ${id}`);
    }
    assert.match(PAGE, /@for \(stage of stages\(\); track stage\.id; let index = \$index\)/);
    assert.match(PAGE, /class="pipeline-step-title">\{\{ stage\.title \}\}/);
    assert.match(PAGE, /class="stage-icon"/);
    assert.match(PAGE, /\{\{ stageGlyph\(stage\.id\) \}\}/);
    assert.match(PAGE, /class="step-dot"/);
    // Selection — never the tab — decides which single step is active.
    assert.match(PAGE, /\[class\.active\]="selectedStepId\(\) === stage\.id"/);
    assert.match(PAGE, /\[attr\.aria-current\]="selectedStepId\(\) === stage\.id \? 'step' : null"/);
    assert.doesNotMatch(PAGE, /\[class\.active\]="activeTab\(\) === stage\.tab"/);
    assert.doesNotMatch(PAGE, /\[attr\.aria-pressed\]/);
    assert.match(STYLES, /\.pipeline-step\.active\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--brand\)/);
    assert.match(STYLES, /\.pipeline-stepper\s*\{[^}]*grid-template-columns:\s*repeat\(8, minmax\(0, 1fr\)\)/);
    // No label ellipsis: the title is allowed to wrap; only the sub line may truncate.
    assert.match(STYLES, /\.pipeline-step-title\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.doesNotMatch(STYLES, /\.pipeline-step-title\s*\{[^}]*text-overflow:\s*ellipsis/);
    // Under 1200 the single row becomes horizontally scrollable.
    assert.match(STYLES, /@media \(max-width: 74\.9375rem\) \{[\s\S]*?\.pipeline-stepper \{ grid-template-columns: repeat\(8, minmax\(9rem, 1fr\)\); overflow-x: auto; \}/);
});

test('E2E flow keeps 8 step cards, 3 sub-columns, one missing tag and empty-step collapse', () => {
    assert.match(PAGE, /@for \(step of steps\(\); track step\.id; let index = \$index\)/);
    assert.match(PAGE, /class="endflow-card-title">STEP \{\{ index \+ 1 \}\} · \{\{ step\.label \}\}/);
    assert.match(PAGE, /class="endflow-subgrid" \[class\.single\]="step\.subcards\.length === 1"/);
    assert.match(PAGE, /class="sub-label">\{\{ sub\.label \}\}/);
    assert.match(PAGE, /class="sub-value">\{\{ sub\.value \}\}/);
    assert.match(PAGE, /@if \(step\.empty\) \{ <span class="missing-tag">missing<\/span> \}/);
    assert.match(PAGE, /No host evidence for this step/);
    assert.match(PAGE, /\(click\)="toggleStep\(step\)"/);
    assert.match(PAGE, /\[attr\.aria-expanded\]="isStepOpen\(step\)"/);
    assert.match(PAGE, /stage\.details\.filter\(\(detail\) => detail\.label === 'Law'\)/);
    assert.match(STYLES, /\.endflow-subgrid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(STYLES, /\.endflow-sub \.sub-label\s*\{[^}]*font-size:\s*var\(--fs-secondary\)/);
    assert.match(STYLES, /\.endflow-sub \.sub-value\s*\{[^}]*font-size:\s*var\(--fs-body\)/);
});

test('drill tabs are full width, icon + label + count, and keep the five tabs', () => {
    assert.match(PAGE, /class="tabs drill-tabs" role="tablist"/);
    for (const tab of ['waterfall', 'topology', 'decisions', 'rules', 'telemetry']) {
        assert.match(PAGE, new RegExp(`\\{ id: '${tab}' as const`), `tab ${tab}`);
    }
    assert.match(PAGE, /class="tab-icon"/);
    assert.match(PAGE, /class="tab-count">\{\{ tabCount\(tab\.id\) \}\}/);
    assert.match(PAGE, /\[class\.active\]="activeTab\(\) === tab\.id"/);
    assert.match(STYLES, /\.tabs\s*\{[^}]*width:\s*100%/);
    assert.match(STYLES, /\.tabs button\s*\{[^}]*flex:\s*1 1 0/);
});

test('waterfall is full width, has summary chips, a table-like event grid and no right rail', () => {
    const pane = PAGE.slice(
        PAGE.indexOf("selector: 'eso-waterfall-panel'"),
        PAGE.indexOf("selector: 'eso-graph-panel'"),
    );
    assert.match(pane, /class="panel waterfall"/);
    assert.match(pane, /class="wf-summary"/);
    for (const chip of ['Files', 'Tool calls', 'LLM calls']) {
        assert.match(pane, new RegExp(`class="summary-chip">${chip}`), `waterfall summary chip: ${chip}`);
    }
    assert.match(pane, /class="event-table-head"/);
    assert.match(pane, /class="event-grid"/);
    assert.match(pane, /<time \[title\]="formatAt\(event\.at\)">\{\{ formatClock\(event\.at\) \}\}<\/time>/);
    assert.match(pane, /class="event-duration">\{\{ eventDuration\(event\) \}\}/);
    assert.match(pane, /<details class="event-evidence"/);
    assert.equal(pane.includes('class="diag"'), false, 'right rail removed');
    assert.equal(pane.includes('Files touched'), false, 'no Files touched box');
    assert.match(STYLES, /\.event-table-head, \.event-grid\s*\{[^}]*grid-template-columns:\s*5\.5rem minmax\(0, 2fr\) 7rem 6rem 4\.5rem/);
    assert.match(STYLES, /\.waterfall-empty\s*\{/);
});

test('every mandatory honest string survives the visual revamp', () => {
    for (const text of MANDATORY_STRINGS) {
        assert.ok(PAGE.includes(text), `missing mandatory string: ${text}`);
    }
});

test('all existing proof blocks are still rendered', () => {
    assert.match(PAGE, /aria-label="Turn verdict \(Q1\)"/);
    assert.match(PAGE, /Why this verdict/);
    assert.match(PAGE, /Q3<\/span> Sufficiency/);
    assert.match(PAGE, /What changed/);
    assert.match(PAGE, /Q5<\/span> Integrity/);
    assert.match(PAGE, /Q6<\/span> What next/);
    assert.match(PAGE, /aria-label="Orchestration effectiveness \(pipeline v2\)"/);
    assert.match(PAGE, /aria-label="Host signals \(P6c\)"/);
    assert.match(PAGE, /class="endflow"/);
    assert.match(PAGE, /aria-label="Write gate \(Q2\)"/);
    assert.match(PAGE, /jev-block/);
    assert.match(PAGE, /Configured/);
    assert.match(PAGE, /Observed/);
});

test('type scale: 13px body, 12px secondary, 14px card title, 26–28px h1, 11px badge, 1.35 line-height', () => {
    assert.match(STYLES, /--fs-h1:\s*1\.625rem/);
    assert.match(STYLES, /--fs-h1-lg:\s*1\.75rem/);
    assert.match(STYLES, /--fs-title:\s*0\.875rem/);
    assert.match(STYLES, /--fs-body:\s*0\.8125rem/);
    assert.match(STYLES, /--fs-badge:\s*0\.6875rem/);
    assert.match(STYLES, /--lh:\s*1\.35/);
    // Nothing below 11px is allowed in the component styles.
    const sizes = [...STYLES.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1]));
    assert.deepEqual(sizes.filter((size) => size < 0.6875), [], `font sizes below 11px: ${sizes.filter((size) => size < 0.6875)}`);
});

test('tokens-only styling: no hardcoded px outside borders and shadows', () => {
    const bad = [];
    for (const match of STYLES.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
        const prop = match[1].trim();
        const value = match[2];
        if (/^border(?:-|$)/.test(prop) || prop === 'box-shadow') continue;
        if (/\d+px/.test(value)) bad.push(`${prop}: ${value.trim()}`);
    }
    assert.deepEqual(bad, [], `hardcoded px outside borders:\n${bad.join('\n')}`);
    // Size/spacing/radius tokens are actually used.
    assert.match(STYLES, /padding:\s*var\(--page-pad\)/);
    assert.match(STYLES, /font-size:\s*var\(--text-xs\)/);
    assert.match(STYLES, /border-radius:\s*var\(--radius-md\)/);
});

test('no placeholder, TODO or fabricated data enters the page', () => {
    assert.doesNotMatch(PAGE, /\b(TODO|FIXME|MOCK|TBD)\b/);
    assert.doesNotMatch(PAGE, /lorem ipsum|dummy data|fake data|sample data/i);
    // The revamp must not invent a gate verdict or a host value outside the payload reads.
    assert.doesNotMatch(PAGE, /\?\?\s*'(allowed|blocked|HOT|WARM|COLD|flash|pro|zero)'/);
    assert.doesNotMatch(PAGE, /\|\|\s*'(allowed|blocked|HOT|WARM|COLD|flash|pro|zero)'/);
});
