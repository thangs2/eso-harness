/**
 * P9 — request detail visual parity with the legacy Observatory page.
 *
 * The page was re-skinned (not rewritten) to mirror the legacy information hierarchy and visual
 * language while keeping every proof block and every honest empty state:
 *
 *   header hero → Q1 verdict band → effectiveness → pipeline stepper → host signals → E2E flow
 *   → gate + tokens row → request metadata → drill tabs.
 *
 * Contract under test:
 *   · the legacy structure markers exist and render in that order (header hero, stepper,
 *     gate+tokens row, drill tabs);
 *   · the card chrome is legacy-style: icon chip + title + subtitle, accent left rail, status
 *     dot/badges, token tiles, section rhythm;
 *   · the stepper keeps the 8 pipeline v2 stage ids and an active/tab state;
 *   · all mandatory honest strings survive the revamp;
 *   · styles are component-scoped layout tokens only — no hardcoded `Npx` outside borders;
 *   · no placeholder / TODO / fake data enters the page.
 *
 * Chạy: node --test qc/eso-request-visual-parity.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(
    new URL('../eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail.page.ts', import.meta.url),
    'utf8',
);

const STYLES_START = PAGE.indexOf('styles: [');
const STYLES = PAGE.slice(STYLES_START, PAGE.indexOf('`]', STYLES_START));

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
];

/** Pipeline v2 — the eight stages the stepper must keep (ids, not a local order). */
const STAGE_IDS = ['intake-law', 'decision-jev', 'evidence-recon', 'sufficiency', 'slp', 'execution', 'seal', 'report'];

test('legacy information hierarchy markers exist and render in order', () => {
    const hero = PAGE.indexOf('<header class="request-hero"');
    const stepper = PAGE.indexOf('<nav class="pipeline-stepper"');
    const endflow = PAGE.indexOf('class="endflow"');
    const gateTokens = PAGE.indexOf('class="top-grid gate-tokens-row"');
    const tabs = PAGE.indexOf('class="tabs drill-tabs"');
    assert.ok(hero > 0, 'header hero marker');
    assert.ok(stepper > 0, 'pipeline stepper marker');
    assert.ok(endflow > 0, 'end-to-end flow marker');
    assert.ok(gateTokens > 0, 'gate + tokens row marker');
    assert.ok(tabs > 0, 'drill tabs marker');
    assert.ok(hero < stepper, 'header hero renders before the stepper');
    assert.ok(stepper < endflow, 'stepper renders before the E2E flow');
    assert.ok(endflow < gateTokens, 'gate + tokens row follows the E2E flow');
    assert.ok(gateTokens < tabs, 'drill tabs follow the gate + tokens row');
    assert.equal(PAGE.indexOf('<main class="detail-page">'), -1, 'shell owns main; page root stays a div');
});

test('card chrome mirrors the legacy language: icon chips, accent rails, status dots, token tiles', () => {
    const chips = PAGE.match(/class="icon-chip/g) ?? [];
    assert.ok(chips.length >= 7, `expected icon chips on the card heads (found ${chips.length})`);
    assert.match(STYLES, /\.icon-chip\s*\{[\s\S]*?border:\s*1px solid[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
    // Legacy accent left rail on every card.
    assert.match(STYLES, /border-left:\s*3px solid var\(--card-accent/);
    // Status badges carry a dot as a second signal, not colour alone.
    assert.match(PAGE, /class="badge status-badge"[\s\S]{0,120}<span class="status-dot"/);
    assert.match(STYLES, /\.status-dot\s*\{[^}]*border-radius:\s*50%/);
    // Cost card keeps its four token tiles.
    assert.match(PAGE, /class="token-tiles"/);
    assert.equal((PAGE.match(/class="token-tiles"/g) ?? []).length >= 2, true, 'tokens card + telemetry tab tiles');
    // Section rhythm: page stack owns the vertical gap.
    assert.match(STYLES, /\.detail-page\s*\{[\s\S]*?gap:\s*var\(--space-5\)/);
});

test('header hero shows identity, status, verdict, host/runtime, duration, started and copy affordance', () => {
    const hero = PAGE.slice(PAGE.indexOf('<header class="request-hero"'), PAGE.indexOf('</header>', PAGE.indexOf('<header class="request-hero"')));
    assert.match(hero, /hero-chip/);
    assert.match(hero, /class="request-query"/);
    assert.match(hero, /shortId\(request\.observationId\)/);
    assert.match(hero, /copyRequestId\(request\.observationId\)/);
    assert.match(hero, /requestIdCopied\(\) \? 'copied' : 'copy'/);
    assert.match(hero, /class="badge status-badge"/);
    assert.match(hero, /class="badge verdict-badge"/);
    assert.match(hero, /heroActor\(\)/);
    assert.match(hero, /<small>Started<\/small>/);
    assert.match(hero, /<small>Duration<\/small>/);
    assert.match(hero, /<small>Host<\/small>/);
    assert.match(hero, /<small>Runtime<\/small>/);
    assert.match(PAGE, /readonly requestIdCopied = signal\(false\)/);
    assert.match(PAGE, /copyRequestId\(id: string\): void/);
});

test('stepper keeps the 8 v2 stage ids, a glyph, and an active/tab state', () => {
    for (const id of STAGE_IDS) {
        assert.match(PAGE, new RegExp(`'?${id.replace('-', '\\-')}'?:\\s*'`), `stage glyph for ${id}`);
    }
    assert.match(PAGE, /@for \(stage of systemStages\(\); track stage\.id\)/);
    assert.match(PAGE, /class="pipeline-step-no">\{\{ stage\.stepNumber \}\}/);
    assert.match(PAGE, /class="stage-icon"/);
    assert.match(PAGE, /\{\{ stageGlyph\(stage\.id\) \}\}/);
    assert.match(PAGE, /\[class\.active\]="activeTab\(\) === stage\.tab"/);
    assert.match(PAGE, /\[attr\.aria-pressed\]="activeTab\(\) === stage\.tab"/);
    assert.match(STYLES, /\.pipeline-step\.active\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--brand\)/);
});

test('drill tabs keep the five tabs, counts, glyphs and active state', () => {
    assert.match(PAGE, /class="tabs drill-tabs" role="tablist"/);
    for (const tab of ['waterfall', 'topology', 'decisions', 'rules', 'telemetry']) {
        assert.match(PAGE, new RegExp(`\\{ id: '${tab}' as const`), `tab ${tab}`);
    }
    assert.match(PAGE, /class="tab-icon"/);
    assert.match(PAGE, /class="tab-count">\{\{ tabCount\(tab\.id\) \}\}/);
    assert.match(PAGE, /\[class\.active\]="activeTab\(\) === tab\.id"/);
});

test('gate + tokens row reads the recorded gate and the reported token payload', () => {
    const row = PAGE.slice(PAGE.indexOf('class="top-grid gate-tokens-row"'), PAGE.indexOf('class="tabs drill-tabs"'));
    assert.match(row, /aria-label="Write gate"/);
    assert.match(row, /@if \(writeGate\(\); as gate\)/);
    assert.match(row, /\{\{ gateLabel\(\) \}\}/);
    assert.match(row, /\{\{ gate\.allowed \? 'allowed' : 'blocked' \}\}/);
    assert.match(row, /No scope decision was recorded for this turn/);
    assert.match(row, /class="token-tiles"/);
    assert.match(row, /\{\{ tokenSummary\(\)\.input \?\? '—' \}\}/);
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
    assert.match(STYLES, /padding:\s*var\(--space-5\)/);
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
