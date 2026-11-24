/**
 * P3 — request detail is the proof surface: Q1–Q6 answered from real verdict/event data,
 * zero fabricated fields. Source contract test (no browser).
 *
 * Chạy: node --test qc/eso-request-verdict-ui.test.mjs
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

test('Q1 — verdict header renders level, score, actor and relative computedAt', () => {
    assert.match(PAGE, /readonly verdict = computed<TurnVerdictView \| null>\(\(\) => this\.detail\(\)\?\.verdict \?\? null\)/);
    // level badge is colour-coded by level (green/amber/red/grey classes)
    assert.match(PAGE, /class="verdict-level-badge" \[class\]="'level-' \+ v\.level"/);
    assert.match(STYLES, /\.level-allow \{/);
    assert.match(STYLES, /\.level-partial \{/);
    assert.match(STYLES, /\.level-deny \{/);
    assert.match(STYLES, /\.level-unknown \{/);
    // score, actor.id + actor.role (or unknown actor), basis, relative computedAt
    assert.match(PAGE, /\{\{ v\.score \}\}/);
    assert.match(PAGE, /\{\{ actorId\(v\.actor\) \}\}/);
    assert.match(PAGE, /actorRole\(v\.actor\)/);
    assert.match(PAGE, /actorId\(actor: VerdictActor \| null\): string[\s\S]*?actor\['id'\][\s\S]*?return id \|\| 'unknown actor'/);
    assert.match(PAGE, /actorRole\(actor: VerdictActor \| null\): string[\s\S]*?actor\['role'\]/);
    assert.match(PAGE, /\{\{ v\.basis \}\}/);
    assert.match(PAGE, /\{\{ relative\(v\.computedAt\) \}\}/);
});

test('Q1 header sits above the End-to-End flow section', () => {
    const verdict = PAGE.indexOf('class="verdict-hero"');
    const endflow = PAGE.indexOf('class="endflow"');
    assert.ok(verdict > 0 && endflow > 0, 'verdict hero and endflow must both exist');
    assert.ok(verdict < endflow, 'verdict hero must render above the E2E flow');
});

test('Q2 — why panel lists ruleRefs and basis, with an honest empty state', () => {
    assert.match(PAGE, /Why this verdict/);
    assert.match(PAGE, /@for \(ref of v\.ruleRefs; track \$index\)/);
    assert.match(PAGE, /ruleRefLabel\(ref\)/);
    assert.match(PAGE, /ruleRefLabel\(ref: VerdictRuleRef\): string[\s\S]*?ref\.kind[\s\S]*?ref\.path[\s\S]*?ref\.line/);
    assert.match(PAGE, /No rule reference was recorded/);
    // basis is repeated next to the refs
    const q2 = PAGE.indexOf('Q2</span> Why this verdict');
    assert.ok(q2 > 0);
    assert.match(PAGE.slice(q2, q2 + 900), /\{\{ v\.basis \}\}/);
});

test('Q3 — sufficiency lists every gap code · what · consequence and the score', () => {
    assert.match(PAGE, /Sufficiency/);
    assert.match(PAGE, /@for \(gap of v\.gaps; track gap\.code\)/);
    assert.match(PAGE, /\{\{ gap\.code \}\}[\s\S]{0,80}\{\{ gap\.what \}\}/);
    assert.match(PAGE, /\{\{ gap\.consequence \}\}/);
    assert.match(PAGE, /Score <strong>\{\{ v\.score \}\}<\/strong> \/ 100/);
    assert.match(PAGE, /No gaps recorded/);
});

test('Q4 — what changed derives only from action.recorded events', () => {
    assert.match(PAGE, /What changed/);
    assert.match(PAGE, /filter\(\(event\) => event\.event === 'action\.recorded'\)/);
    assert.match(PAGE, /\{\{ action\.tool \}\}/);
    assert.match(PAGE, /\{\{ action\.outcome \}\}/);
    assert.match(PAGE, /\{\{ action\.filesCount \}\} file\(s\)/);
    assert.match(PAGE, /\{\{ action\.readBeforeEdit \}\}/);
    assert.match(PAGE, /\{\{ action\.diffRef \}\}/);
    assert.match(PAGE, /readBeforeEdit === true \? 'yes' : readBeforeEdit === false \? 'no' : 'not captured'/);
    assert.match(PAGE, /No action event was captured \(host did not report it\)/);
});

test('Q5 — receipt is shown or "Not issued yet"; no hash is invented', () => {
    assert.match(PAGE, /receiptLabel\(v\.receiptId\)/);
    assert.match(PAGE, /receiptLabel\(receiptId: string \| null\): string[\s\S]*?'Not issued yet'/);
    assert.match(PAGE, /No receipt was issued/);
    assert.doesNotMatch(PAGE, /receipt[_-]?hash/i);
    assert.doesNotMatch(PAGE, /createHash|crypto\.subtle/);
});

test('Q6 — rule-based mapping only, for all four levels', () => {
    assert.match(PAGE, /deny: 'Close the gaps, then re-run'/);
    assert.match(PAGE, /unknown: 'Host must emit decision\.recorded for this turn'/);
    assert.match(PAGE, /partial: 'Capture the missing data and re-issue the verdict'/);
    assert.match(PAGE, /allow: 'No action required'/);
    assert.match(PAGE, /nextStep\(level: VerdictLevel\): string \{\s*return NEXT_STEP\[level\];/);
    assert.match(PAGE, /\{\{ nextStep\(v\.level\) \}\}/);
    // the gap codes that drive the next step are shown
    assert.match(PAGE, /No gap codes recorded for this verdict\./);
});

test('tab still id=decisions but is labelled "Verdict & gaps"; checks stay as heuristics', () => {
    assert.match(PAGE, /\{ id: 'decisions' as const, label: 'Verdict & gaps' \}/);
    assert.doesNotMatch(PAGE, /Governance & Decisions/);
    assert.match(PAGE, /Heuristic checks — not the verdict/);
    assert.match(PAGE, /Checks &amp; worker outcomes/);
});

test('no TODO/MOCK placeholders and no spec ↔ trace toggle (deferred)', () => {
    assert.doesNotMatch(PAGE, /\bTODO\b|\bFIXME\b|\bMOCK\b/);
    assert.doesNotMatch(PAGE, /Spec\s*[↔<->]+\s*[Tt]race/);
});

test('verdict blocks use layout tokens (no new global css, no hardcoded spacing/radius px)', () => {
    const verdictStyles = STYLES.slice(STYLES.indexOf('.verdict-hero'));
    assert.match(verdictStyles, /padding: var\(--space-4\)/);
    assert.match(verdictStyles, /border-radius: var\(--radius-md\)/);
    assert.match(verdictStyles, /font-size: var\(--text-sm\)/);
    const decls = verdictStyles.match(/[a-z-]+\s*:\s*[^;{}]+/g) ?? [];
    const bad = decls.filter((decl) => {
        const prop = decl.split(':')[0].trim();
        if (/^border/.test(prop) || prop === 'box-shadow') return false;
        return /\d+px/.test(decl);
    });
    assert.deepEqual(bad, [], `verdict CSS hardcodes px:\n${bad.join('\n')}`);
});
