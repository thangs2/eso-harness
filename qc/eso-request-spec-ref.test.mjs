/**
 * B0-9 (option C) — the request detail points at its normative page spec; it never copies the doc.
 *
 * Contract under test:
 *   a) one backend constant whose `version` equals the doc's `sot_doc_version` (and whose anchor is
 *      the real heading anchor) — the services must not read `sdlc/` at runtime;
 *   b) `detail.spec` carries `{doc, version, section, anchor}`;
 *   c) a new receipt seals `specRef: {doc, version, section}` in its canonical payload;
 *   d) the UI renders one "Normative:" line and no spec prose / no fabricated spec↔trace toggle.
 *
 * Chạy: node --test qc/eso-request-spec-ref.test.mjs
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

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const DOC_PATH = 'sdlc/08.ui-design/20.pages/20.request-detail.md';
const DOC = read(DOC_PATH);
const TYPES = read('eso/control-plane/src/platform/registry/types.ts');
const REQUEST = read('eso/control-plane/src/modules/requests/request.service.ts');
const RECEIPT = read('eso/control-plane/src/modules/receipt/receipt.service.ts');
const PAGE = readPageFolder();

/** `sot_doc_version: "1.6.0"` from the doc frontmatter. */
const docVersion = /^sot_doc_version:\s*"([^"]+)"/m.exec(DOC)?.[1] ?? '';

/** The one constant; its body is parsed instead of imported so this stays a source contract test. */
const constantBody = /export const REQUEST_SPEC_REF = \{([\s\S]*?)\} as const;/.exec(TYPES)?.[1] ?? '';
const constantField = (name) => new RegExp(`\\b${name}:\\s*'([^']*)'`).exec(constantBody)?.[1];

/** GitHub-style heading anchor: lowercase, drop punctuation, spaces ⇒ dashes. */
function anchorOf(heading) {
    return heading
        .replace(/^#+\s*/, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-');
}

test('the doc declares a version and the §6 heading the reference names', () => {
    assert.match(docVersion, /^\d+\.\d+\.\d+$/, 'sot_doc_version must be semver in the doc frontmatter');
    assert.match(DOC, /^## 6\. Behavior spec \(STD-PAGE-BEHAVIOR §1\)$/m);
});

test('(a) the backend constant equals the doc: version, path, section and real anchor', () => {
    assert.ok(constantBody.length > 0, 'REQUEST_SPEC_REF must be defined as one constant');
    assert.equal(constantField('version'), docVersion, 'constant version must equal sot_doc_version (bump both)');
    assert.equal(constantField('doc'), DOC_PATH);
    assert.equal(constantField('section'), '§6 Behavior spec');
    const heading = /^## 6\. Behavior spec.*$/m.exec(DOC)?.[0] ?? '';
    assert.equal(constantField('anchor'), `#${anchorOf(heading)}`, 'anchor must be derivable from the doc heading');
});

test('(a) the constant lives in exactly one module and nothing reads the doc at runtime', () => {
    const definitions = [TYPES, REQUEST, RECEIPT].filter((source) => /export const REQUEST_SPEC_REF\b/.test(source));
    assert.equal(definitions.length, 1, 'exactly one definition of REQUEST_SPEC_REF');
    // A second copy of the version literal is the drift this test exists to prevent.
    assert.doesNotMatch(REQUEST, /'1\.\d+\.\d+'/, 'request.service must import the constant, not restate it');
    assert.doesNotMatch(RECEIPT, /'1\.\d+\.\d+'/, 'receipt.service must import the constant, not restate it');
    // `sdlc/` is not shipped in images: no runtime file read of the doc.
    assert.doesNotMatch(REQUEST, /readFile\([^)]*sdlc\//);
    assert.doesNotMatch(RECEIPT, /readFile\(/);
});

test('(b) detail.spec carries doc · version · section · anchor', () => {
    assert.match(REQUEST, /export interface RequestSpecRef \{[\s\S]*?doc: string;[\s\S]*?version: string;[\s\S]*?section: string;[\s\S]*?anchor: string;[\s\S]*?\}/);
    assert.match(REQUEST, /spec: RequestSpecRef;/);
    assert.match(REQUEST, /detail: RequestDetail = \{[\s\S]*?spec: REQUEST_SPEC_REF,/);
    assert.match(REQUEST, /type RequestDetailBase = Omit<RequestDetail,[^;]*'spec'/);
});

test('(c) a new receipt seals specRef in its canonical payload', () => {
    assert.match(TYPES, /export interface ReceiptSpecRef \{[\s\S]*?doc: string;[\s\S]*?version: string;[\s\S]*?section: string;[\s\S]*?\}/);
    // Optional: payloads sealed before B0-9 have no key; verify recomputes from the stored bytes.
    assert.match(TYPES, /specRef\?: ReceiptSpecRef;/);
    assert.match(RECEIPT, /specRef: specRefOf\(REQUEST_SPEC_REF\)/);
    assert.match(RECEIPT, /function specRefOf\([\s\S]*?return \{ doc: ref\.doc, version: ref\.version, section: ref\.section \};/);
    // The anchor is UI-only: the sealed literal names exactly doc · version · section.
    assert.match(RECEIPT, /return \{ doc: ref\.doc, version: ref\.version, section: ref\.section \};/);
    // Old receipts still verify because the hash is recomputed from the stored payload.
    assert.match(RECEIPT, /const hashMatches = hashPayload\(receipt\.payload\) === receipt\.hash;/);
});

test('(d) Q2 renders one normative line from detail.spec, with a copy-path affordance', () => {
    assert.match(PAGE, /readonly spec = computed<SpecRefView \| null>\(\(\) => this\.detail\(\)\?\.spec \?\? null\)/);
    assert.match(PAGE, /<span class="spec-label">Normative:<\/span>/);
    assert.match(PAGE, /\{\{ ref\.doc \}\}/);
    assert.match(PAGE, /v\{\{ ref\.version \}\}/);
    assert.match(PAGE, /\{\{ ref\.section \}\}/);
    assert.match(PAGE, /\(click\)="copySpecPath\(ref\.doc\)"/);
    assert.match(PAGE, /copySpecPath\(ref\.doc\)[\s\S]{0,40}\{\{ specPathCopied\(\) \? 'copied' : 'copy path' \}\}/);
    // The line belongs to Q2 "Why this verdict", before Q3.
    const q2 = PAGE.indexOf('Why this verdict');
    const normative = PAGE.indexOf('Normative:');
    const q3 = PAGE.indexOf('Sufficiency');
    assert.ok(q2 > 0 && normative > q2, 'Normative line must sit inside Q2');
    assert.ok(q3 > normative, 'Normative line must render before Q3');
});

test('(d) no spec prose is inlined and no spec↔trace toggle is fabricated', () => {
    // The path/version come from the API only: hardcoding them in the UI would be a second source.
    assert.doesNotMatch(PAGE, /sdlc\//);
    assert.doesNotMatch(PAGE, /'1\.\d+\.\d+'/);
    // No line of the doc's §6 prose may appear in the page source.
    const section = DOC.slice(DOC.indexOf('## 6. Behavior spec'));
    const prose = section
        .split('\n')
        .map((line) => line.replace(/`/g, '').trim())
        .filter((line) => line.length > 40 && line.split(/\s+/).length >= 4);
    const copied = prose.filter((line) => PAGE.includes(line));
    assert.deepEqual(copied, [], 'the page must not copy spec prose');
    // A source toggle was explicitly not built (spec doc: "Chưa có spec ↔ trace toggle").
    assert.doesNotMatch(PAGE, /specToggle|toggleSpec|Spec ↔ trace|specProse/);
});
