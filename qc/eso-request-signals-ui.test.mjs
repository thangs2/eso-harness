/**
 * P6c — the request detail shows the host signals the API reported (`detail.signals`), and says
 * "not captured" per missing field instead of inventing a value.
 *
 * Contract under test:
 *   · a compact "Host signals" strip below the verdict hero and above the E2E flow;
 *   · `signals === null` ⇒ "No host signal was reported for this turn";
 *   · a null sub-field ⇒ "not captured" (preflight state + fingerprint, recon calls per adapter,
 *     brain tier, distill memorySaved/lessons);
 *   · no default tier/state (HOT/WARM/COLD, zero/flash/pro) exists as a fallback anywhere.
 *
 * Chạy: node --test qc/eso-request-signals-ui.test.mjs
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

/** One method body, cut at the next declaration. */
const method = (name, next) => PAGE.slice(PAGE.indexOf(`    ${name}(`), PAGE.indexOf(`    ${next}(`));

test('the Host signals strip sits below the verdict hero and above the E2E flow', () => {
    const hero = PAGE.indexOf('class="verdict-hero"');
    const strip = PAGE.indexOf('class="host-signals"');
    const endflow = PAGE.indexOf('class="endflow"');
    assert.ok(hero > 0 && strip > 0 && endflow > 0, 'hero, strip and E2E flow must all exist');
    assert.ok(hero < strip, 'strip renders after the verdict hero');
    assert.ok(strip < endflow, 'strip renders before the E2E flow');
    assert.match(PAGE, /aria-label="Host signals \(P6c\)"/);
    assert.match(PAGE, /<h2>Host signals<\/h2>/);
    assert.match(PAGE, /<span class="badge muted">not inferred by ESO<\/span>/);
});

test('detail.signals is typed locally and read from the API payload only', () => {
    assert.match(PAGE, /interface HostSignalsView \{[\s\S]*?preflight: HostPreflightSignal \| null;[\s\S]*?recon: HostReconCall\[\] \| null;[\s\S]*?brainTier: string \| null;[\s\S]*?distill: HostDistillSignal \| null;[\s\S]*?\}/);
    assert.match(PAGE, /signals\?: HostSignalsView \| null;/);
    assert.match(PAGE, /readonly signals = computed<HostSignalsView \| null>\(\(\) => this\.detail\(\)\?\.signals \?\? null\)/);
    assert.match(PAGE, /@if \(signals\(\); as s\)/);
});

test('signals === null renders the honest empty state', () => {
    assert.match(PAGE, /No host signal was reported for this turn/);
    const branch = PAGE.slice(PAGE.indexOf('@if (signals(); as s)'), PAGE.indexOf('</section>', PAGE.indexOf('class="host-signals"')));
    assert.match(branch, /\} @else \{[\s\S]*?No host signal was reported for this turn/);
});

test('each signal tile renders the reported value through its label method', () => {
    const strip = PAGE.slice(PAGE.indexOf('class="host-signals"'), PAGE.indexOf('class="endflow"'));
    assert.match(strip, /<span>Preflight<\/span><strong>\{\{ preflightLabel\(s\.preflight\) \}\}<\/strong><small>\{\{ preflightFingerprint\(s\.preflight\) \}\}<\/small>/);
    assert.match(strip, /<span>Recon calls<\/span><strong>\{\{ reconLabel\(s\.recon\) \}\}<\/strong>/);
    assert.match(strip, /<span>Brain tier<\/span><strong>\{\{ brainTierLabel\(s\.brainTier\) \}\}<\/strong>/);
    assert.match(strip, /<span>Distill<\/span><strong>\{\{ distillLabel\(s\.distill\) \}\}<\/strong>/);
});

test('a missing sub-field is "not captured", never a substitute value', () => {
    const preflight = method('preflightLabel', 'preflightFingerprint');
    assert.match(preflight, /return state \|\| 'not captured';/);
    const fingerprint = method('preflightFingerprint', 'reconLabel');
    assert.match(fingerprint, /return fingerprint \|\| 'fingerprint not captured';/);
    const recon = method('reconLabel', 'brainTierLabel');
    assert.match(recon, /if \(!recon \|\| !recon\.length\) return 'not captured';/);
    // calls are summed per adapter from reported rows only
    assert.match(recon, /return recon\.map\(\(call\) => `\$\{call\.adapter\} \$\{call\.calls\}`\)\.join\(' · '\);/);
    const brain = method('brainTierLabel', 'distillLabel');
    assert.match(brain, /return value \|\| 'not captured';/);
    const distill = method('distillLabel', 'copySpecPath');
    assert.match(distill, /if \(!distill\) return 'not captured';/);
    assert.match(distill, /distill\.memorySaved \? 'memory saved' : 'memory not saved'/);
    assert.match(distill, /typeof distill\.lessons === 'number'/);
});

test('no host value is invented: no default state or tier fallback in the page', () => {
    // A fallback like `?? 'HOT'` or `|| 'flash'` is exactly the fabrication P6c closes.
    assert.doesNotMatch(PAGE, /['"]HOT['"]|['"]WARM['"]|['"]COLD['"]/);
    assert.doesNotMatch(PAGE, /['"]flash['"]|['"]zero['"]|['"]pro['"]/);
    assert.doesNotMatch(PAGE, /brainTier[^\n]*\?\?/);
    assert.doesNotMatch(PAGE, /preflight[^\n]*\?\?\s*['"]/);
    // Every tile has an honest fallback; the count proves no field was forgotten.
    assert.equal((PAGE.match(/'not captured'/g) ?? []).length >= 4, true);
});
