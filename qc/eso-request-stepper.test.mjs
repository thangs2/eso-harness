/**
 * Stepper interaction contract — clicking a step opens its evidence; it never changes the tab.
 *
 * The previous bug: `active = activeTab() === stage.tab` meant every stage sharing a tab looked
 * active at once, and a click silently switched the drill pane. This test pins the replacement:
 *   · exactly one active step, driven by `selectedStepId` only;
 *   · `aria-current="step"` on that one button, never `aria-pressed`;
 *   · click selects + expands + smooth-scrolls to `#step-<id>`, and does not call `activeTab.set`;
 *   · the step card owns a separate "Open <tab>" action for the drill pane;
 *   · ArrowLeft/ArrowRight/Home/End move selection and focus.
 *
 * Chạy: node --test qc/eso-request-stepper.test.mjs
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
const STEPPER = PAGE.slice(
    PAGE.indexOf("selector: 'eso-pipeline-stepper'"),
    PAGE.indexOf("selector: 'eso-pipeline-flow'"),
);
const FLOW = PAGE.slice(
    PAGE.indexOf("selector: 'eso-pipeline-flow'"),
    PAGE.indexOf("selector: 'eso-waterfall-panel'"),
);
const SELECT_STEP = PAGE.slice(
    PAGE.indexOf('selectStep(id: string): void {'),
    PAGE.indexOf('selectStep(id: string): void {') + 500,
);

test('one active step only — selectedStepId drives it, never the active tab', () => {
    assert.match(STEPPER, /readonly selectedStepId = input<string \| null>\(null\)/);
    assert.match(STEPPER, /\[class\.active\]="selectedStepId\(\) === stage\.id"/);
    assert.match(STEPPER, /\[attr\.aria-current\]="selectedStepId\(\) === stage\.id \? 'step' : null"/);
    // A tab-shared stage can no longer light up several steps at once.
    assert.doesNotMatch(PAGE, /activeTab\(\) === stage\.tab/);
    assert.doesNotMatch(STEPPER, /activeTab/);
    assert.doesNotMatch(STEPPER, /aria-pressed/);
    // The binding is singular: one active class binding and one aria-current binding.
    assert.equal((STEPPER.match(/\[class\.active\]/g) ?? []).length, 1);
    assert.equal((STEPPER.match(/aria-current/g) ?? []).length, 1);
    assert.match(STEPPER, /readonly stepSelected = output<string>\(\)/);
});

test('clicking a step selects evidence, expands it and scrolls to its anchor', () => {
    assert.match(STEPPER, /\(click\)="select\(stage\.id\)"/);
    assert.match(SELECT_STEP, /this\.selectedStepId\.set\(id\)/);
    assert.match(SELECT_STEP, /this\.stepOpen\.update\(\(map\) => \(\{ \.\.\.map, \[id\]: true \}\)\)/);
    assert.match(SELECT_STEP, /this\.scrollToStep\(id\)/);
    // The selection path must not touch the tab.
    assert.doesNotMatch(SELECT_STEP, /activeTab/);
    assert.match(PAGE, /document\.getElementById\(`step-\$\{id\}`\)\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
    assert.match(FLOW, /\[attr\.id\]="'step-' \+ step\.id"/);
    assert.match(FLOW, /\[class\.selected\]="selectedStepId\(\) === step\.id"/);
});

test('the hint and tooltip state the two meanings in EN', () => {
    assert.match(STEPPER, /Select a step to open its evidence/);
    assert.match(STEPPER, /'Step ' \+ stage\.stepNumber \+ ': ' \+ stage\.title \+ ' — click to open its evidence'/);
});

test('ArrowLeft/ArrowRight/Home/End move selection and focus; Enter/Space select', () => {
    assert.match(STEPPER, /case 'ArrowLeft':/);
    assert.match(STEPPER, /case 'ArrowRight':/);
    assert.match(STEPPER, /case 'Home':/);
    assert.match(STEPPER, /case 'End':/);
    assert.match(STEPPER, /case 'Enter':/);
    assert.match(STEPPER, /case ' ':/);
    assert.match(STEPPER, /requestAnimationFrame\(\(\) => \{/);
    assert.match(STEPPER, /buttons\[next\]\?\.focus\(\)/);
    // Native buttons keep the keyboard path available.
    assert.match(STEPPER, /<button\s[\s\S]*?type="button"/);
});

test('the step card has a separate "Open <tab>" action for the drill pane', () => {
    assert.match(FLOW, /Open \{\{ step\.tabLabel \}\}/);
    assert.match(FLOW, /readonly openTab = output<TabKey>\(\)/);
    assert.match(FLOW, /\(click\)="openRelatedTab\(step\)"/);
    assert.match(FLOW, /this\.openTab\.emit\(step\.tab\)/);
    assert.match(PAGE, /\(openTab\)="activeTab\.set\(\$event\)"/);
    // Tabs stay independent: a tab click only switches the pane.
    assert.match(PAGE, /\(click\)="activeTab\.set\(tab\.id\)"/);
});

test('the container passes one selection to both stepper and flow', () => {
    assert.match(PAGE, /\[selectedStepId\]="selectedStepId\(\)"/);
    assert.equal((PAGE.match(/\[selectedStepId\]="selectedStepId\(\)"/g) ?? []).length, 2);
    assert.match(PAGE, /\(stepSelected\)="selectStep\(\$event\)"/);
});
