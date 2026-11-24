/**
 * Pipeline v2 — the request detail shows the backend's orchestration tally (`detail.effectiveness`)
 * and the recorded JEV decision (`detail.jev`) instead of a re-derived story.
 *
 * Contract under test:
 *   · a compact "Orchestration effectiveness" panel below the verdict hero and above the host
 *     signals strip, with exactly 7 KPI tiles;
 *   · `effectiveness === null` ⇒ "No effectiveness data for this request";
 *   · every KPI reads its payload field — no hardcoded step total, no `?? 0` / `|| 0` fallback;
 *   · booleans render `yes` / `no` (plain text, not green badges);
 *   · the decisions tab carries `JEV <mode> · band <band> · confidence <x>`, the honest empty
 *     "No JEV decision was recorded", and the band-mismatch branch;
 *   · the `decision-jev` stage details are not duplicated by the JEV block.
 *
 * Chạy: node --test qc/eso-request-effectiveness-ui.test.mjs
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

const PAGE = readPageFolder();

/** One method body, cut at the next declaration (searched forward from the method itself). */
const method = (name, next) => {
    const start = PAGE.indexOf(`    ${name}(`);
    return PAGE.slice(start, PAGE.indexOf(`    ${next}(`, start));
};

const effectivenessPanel = PAGE.slice(
    PAGE.indexOf('class="effectiveness"'),
    PAGE.indexOf('<nav class="pipeline-stepper"'),
);
const decisionsTab = PAGE.slice(
    PAGE.indexOf("selector: 'eso-verdict-panel'"),
    PAGE.indexOf("selector: 'eso-rules-panel'"),
);
const jevBlock = decisionsTab.slice(
    decisionsTab.indexOf('class="verdict-block jev-block"'),
    decisionsTab.indexOf('</section>', decisionsTab.indexOf('class="verdict-block jev-block"')),
);

test('the Orchestration effectiveness panel sits below the verdict hero and above host signals', () => {
    const hero = PAGE.indexOf('class="verdict-hero"');
    const panel = PAGE.indexOf('class="effectiveness"');
    const signals = PAGE.indexOf('class="host-signals"');
    assert.ok(hero > 0 && panel > 0 && signals > 0, 'hero, effectiveness panel and signals strip must exist');
    assert.ok(hero < panel, 'panel renders after the verdict hero');
    assert.ok(panel < signals, 'panel renders before the host signals strip');
    assert.match(PAGE, /aria-label="Orchestration effectiveness \(pipeline v2\)"/);
    assert.match(effectivenessPanel, /<h2>Orchestration effectiveness<\/h2>/);
});

test('all 7 KPIs are rendered from detail.effectiveness', () => {
    assert.equal((effectivenessPanel.match(/<div class="kpi-tile">/g) ?? []).length, 7);
    assert.match(effectivenessPanel, /<span>Pipeline steps evidenced<\/span><strong>\{\{ countOrDash\(e\.stepsWithEvidence\) \}\}\/\{\{ countOrDash\(e\.stepsTotal\) \}\}<\/strong>/);
    assert.match(effectivenessPanel, /<span>Roles &amp; workers<\/span><strong>\{\{ countOrDash\(e\.rolesObserved\) \}\}\/\{\{ countOrDash\(e\.rolesAssigned\) \}\} roles<\/strong><small>\{\{ countOrDash\(e\.workersObserved\) \}\}\/\{\{ countOrDash\(e\.workersTotal\) \}\} workers<\/small>/);
    assert.match(effectivenessPanel, /<span>Failures<\/span><strong>\{\{ countOrDash\(e\.failures\) \}\}<\/strong>/);
    assert.match(effectivenessPanel, /<span>Duration<\/span><strong>\{\{ humanDuration\(e\.durationMs\) \}\}<\/strong>/);
    assert.match(effectivenessPanel, /<span>Write gate checked<\/span><strong>\{\{ yesNo\(e\.writeGateChecked\) \}\}<\/strong>/);
    assert.match(effectivenessPanel, /<span>Receipt sealed<\/span><strong>\{\{ yesNo\(e\.receiptSealed\) \}\}<\/strong>/);
    assert.match(effectivenessPanel, /<span>Gaps<\/span><strong>\{\{ countOrDash\(e\.gaps\) \}\}<\/strong>/);
});

test('detail.effectiveness is typed locally and read from the API payload only', () => {
    assert.match(PAGE, /interface EffectivenessView \{[\s\S]*?stepsTotal: number;[\s\S]*?stepsWithEvidence: number;[\s\S]*?writeGateChecked: boolean;[\s\S]*?receiptSealed: boolean;[\s\S]*?gaps: number;[\s\S]*?\}/);
    assert.match(PAGE, /effectiveness\?: EffectivenessView \| null;/);
    assert.match(PAGE, /readonly effectiveness = computed<EffectivenessView \| null>\(\(\) => this\.detail\(\)\?\.effectiveness \?\? null\)/);
    assert.match(PAGE, /@if \(effectiveness\(\); as e\)/);
});

test('effectiveness === null renders the honest empty state', () => {
    assert.match(effectivenessPanel, /\} @else \{[\s\S]*?No effectiveness data for this request[\s\S]*?\}/);
});

test('no fabricated numbers: every KPI is the reported field, never a default', () => {
    // The denominator is the reported total, not a hardcoded stage count.
    assert.doesNotMatch(effectivenessPanel, /\/\s*8\b/);
    assert.doesNotMatch(PAGE, /stepsWithEvidence[^\n]*\?\?/);
    assert.doesNotMatch(PAGE, /stepsTotal[^\n]*(\?\?|\|\|)/);
    assert.doesNotMatch(PAGE, /rolesAssigned[^\n]*(\?\?|\|\|)/);
    assert.doesNotMatch(PAGE, /workersTotal[^\n]*(\?\?|\|\|)/);
    assert.doesNotMatch(PAGE, /writeGateChecked[^\n]*(\?\?|\|\|)/);
    assert.doesNotMatch(PAGE, /receiptSealed[^\n]*(\?\?|\|\|)/);
    assert.doesNotMatch(PAGE, /humanDuration[^\n]*return\s+0/);
    // A counter is only rendered when the API sent a finite number.
    const count = method('countOrDash', 'yesNo');
    assert.match(count, /typeof value === 'number' && Number\.isFinite\(value\) \? String\(value\) : '—'/);
    // Booleans read as words; an absent flag is "—", never a defaulted yes.
    const yesNo = method('yesNo', 'humanDuration');
    assert.match(yesNo, /value === true \? 'yes' : value === false \? 'no' : '—'/);
});

test('booleans are plain yes/no text, not green badges', () => {
    assert.match(effectivenessPanel, /yesNo\(e\.writeGateChecked\)/);
    assert.match(effectivenessPanel, /yesNo\(e\.receiptSealed\)/);
    assert.doesNotMatch(effectivenessPanel, /class="badge ok"|\[class\.ok\]|badge ok/i);
});

test('durationMs is humanised, with an honest dash when the backend sent none', () => {
    const human = PAGE.slice(PAGE.indexOf('    humanDuration('));
    assert.match(human, /typeof ms !== 'number' \|\| !Number\.isFinite\(ms\)\) return '—'/);
    assert.match(human, /total < 1000\) return `\$\{total\} ms`/);
    assert.match(human, /seconds < 60\) return `\$\{seconds\.toFixed\(1\)\} s`/);
    assert.match(human, /return `\$\{minutes\}m \$\{rest\}s`/);
});

test('the decisions tab shows the JEV line from detail.jev', () => {
    assert.match(PAGE, /interface JevView \{[\s\S]*?mode: string;[\s\S]*?confidence: number;[\s\S]*?band: string;[\s\S]*?expectedBand: string;[\s\S]*?match: boolean;[\s\S]*?\}/);
    assert.match(PAGE, /jev\?: JevView \| null;/);
    assert.match(PAGE, /readonly jev = computed<JevView \| null>\(\(\) => this\.detail\(\)\?\.jev \?\? null\)/);
    assert.match(jevBlock, /@if \(jev\(\); as j\)/);
    assert.match(jevBlock, /<span class="jev-summary">JEV \{\{ j\.mode \}\} · band \{\{ j\.band \}\} · confidence \{\{ j\.confidence \}\}<\/span>/);
    assert.match(jevBlock, /No JEV decision was recorded/);
});

test('a band mismatch is named with reported and expected band', () => {
    assert.match(jevBlock, /@if \(j\.match === false\) \{/);
    assert.match(jevBlock, /Band mismatch — reported \{\{ j\.band \}\}, expected \{\{ j\.expectedBand \}\}/);
    // The mismatch must be reachable only from `match === false`; no truthiness shortcut.
    assert.doesNotMatch(jevBlock, /@if \(!j\.match\)/);
});

test('the JEV block does not duplicate the decision-jev stage details', () => {
    // Stage details are rendered by the shared stepper; the decisions tab reads `detail.jev` only.
    assert.doesNotMatch(jevBlock, /details|systemStages|stage\.details/);
    assert.doesNotMatch(jevBlock, /j\.reason|j\.decision\b|j\.consent|j\.at\b/);
    assert.equal((decisionsTab.match(/class="jev-line"/g) ?? []).length, 1);
});
