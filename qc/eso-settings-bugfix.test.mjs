/**
 * Consumer-settings bug batch (BUG-03/04/14/15/16/17/18/19/20/34/36/42).
 * Source invariants only: these run without a browser or database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const CONSUMERS = 'eso/ui/apps/control-plane/src/app/features/consumers';
const HOSTS_BASE = read(`${CONSUMERS}/pages/settings-hosts.base.ts`);
const STACK_BASE = read(`${CONSUMERS}/pages/settings-stack.base.ts`);
const KNOWLEDGE_BASE = read(`${CONSUMERS}/pages/settings-knowledge.base.ts`);
const TAIL_BASE = read(`${CONSUMERS}/pages/settings-tail.base.ts`);
const BOUNDARY_TS = read(`${CONSUMERS}/components/boundaries-panel.component.ts`);
const BOUNDARY_HTML = read(`${CONSUMERS}/components/boundaries-panel.component.html`);
const OBSERVATION_TS = read(`${CONSUMERS}/components/observation-panel.component.ts`);
const KB_TAB = read(`${CONSUMERS}/components/knowledge-tab.component.html`);
const KB_OVERVIEW = read(`${CONSUMERS}/components/knowledge-overview.component.html`);
const HOST_PAGE = read('eso/ui/apps/control-plane/src/app/features/hosts/pages/hosts.page.ts');
const BOUNDARY_SERVICE = read('eso/control-plane/src/modules/boundaries/boundary-policy.service.ts');

test('BUG-03 — role count uses worker roles, not worker length', () => {
    const correct = HOSTS_BASE.match(/\$\{this\.workers\(\)\.length\} workers · \$\{this\.workerRoleCount\(\)\} roles/g) || [];
    assert.equal(correct.length, 2, 'both multi-agent cells must use workerRoleCount()');
    assert.doesNotMatch(HOSTS_BASE, /\$\{this\.workers\(\)\.length\} roles/);
    assert.match(STACK_BASE, /workerRoleCount\(\): number \{\s*return new Set\(this\.workers\(\)\.map\(\(worker\) => worker\.role\)\)\.size;/);
});

test('BUG-04 — Sources/Resolution read policy from the binding stack version', () => {
    assert.match(STACK_BASE, /isResolutionLayerEnabled\(layerId: LayerId, version = this\.newStackVersion\(\)\): boolean/);
    assert.match(STACK_BASE, /sourceOptionsFor\(layerId: LayerId, version = this\.newStackVersion\(\)\): string\[\]/);
    assert.match(HOSTS_BASE, /hostSourcesSummary\(profile: HostProfile\): string \{\s*const memory = this\.isResolutionLayerEnabled\('memory', profile\.stackVersion\)/);
    assert.match(HOSTS_BASE, /resolutionSummary\(profile: HostProfile\): string \{\s*if \(!this\.isResolutionLayerEnabled\('memory', profile\.stackVersion\) && !this\.isResolutionLayerEnabled\('codeGraph', profile\.stackVersion\)\)/);
});

test('BUG-17 — write + always is blocked in the UI with a reason, no silent coercion', () => {
    assert.doesNotMatch(BOUNDARY_TS, /value\.kind === 'write' \? 'once' : value\.mode/);
    assert.match(BOUNDARY_TS, /kind === 'write' && this\.grantForm\.controls\.mode\.value === 'always'/);
    assert.match(BOUNDARY_TS, /Write grants are single-use; pick the read kind for an always grant\./);
    assert.match(BOUNDARY_HTML, /\[disabled\]="grantForm\.controls\.kind\.value === 'write'"/);
    assert.match(BOUNDARY_HTML, /Write grants are single-use; choose the read kind for an always grant\./);
    // Server invariant stays authoritative.
    assert.match(BOUNDARY_SERVICE, /INVALID_STATE', 'write grants cannot be always'/);
});

test('BUG-18 — grant expiry input maps to the server ttlMs field', () => {
    assert.match(BOUNDARY_HTML, /formControlName="ttlMinutes"/);
    assert.match(BOUNDARY_TS, /grantTtlMaxMinutes\(\): number \{\s*return this\.grantForm\.controls\.kind\.value === 'write' \? 8 \* 60 : 90 \* 24 \* 60;/);
    assert.match(BOUNDARY_TS, /ttlMs: Math\.round\(ttlMinutes \* 60_000\)/);
    assert.match(BOUNDARY_SERVICE, /input\?\.ttlMs/);
});

test('BUG-19 — host type validation is reachable via an empty option', () => {
    assert.match(HOST_PAGE, /<mat-option value="">Choose a host type…<\/mat-option>/);
    assert.match(HOST_PAGE, /if \(!this\.formHostType\(\)\.trim\(\)\) return 'Host type is required\.'/);
});

test('BUG-20 — save error renders inside the host dialog', () => {
    assert.match(HOST_PAGE, /readonly dialogError = signal\(''\)/);
    assert.match(HOST_PAGE, /@if \(dialogError\(\); as message\) \{ <p class="form-error form-error-full" role="alert">\{\{ message \}\}<\/p> \}/);
    assert.match(HOST_PAGE, /\.catch\(\(err\) => this\.dialogError\.set\(err\?\.detail \|\| err\?\.message \|\| 'Could not save host'\)\)/);
    assert.doesNotMatch(HOST_PAGE, /\.catch\(\(err\) => this\.error\.set\(err\?\.detail \|\| err\?\.message \|\| 'Could not save host'\)\)/);
});

test('BUG-34 — Create grant is guarded against double submit', () => {
    assert.match(BOUNDARY_TS, /readonly grantSaving = signal\(false\)/);
    assert.match(BOUNDARY_TS, /createGrant\(\): void \{\s*if \(this\.grantSaving\(\)\) return;/);
    assert.match(BOUNDARY_TS, /\.finally\(\(\) => this\.grantSaving\.set\(false\)\)/);
    assert.match(BOUNDARY_HTML, /\[disabled\]="grantSaving\(\) \|\| !grantForm\.controls\.target\.value\.trim\(\)"/);
});

test('BUG-42 — draft is written (debounced) and cleared after a successful save', () => {
    assert.match(TAIL_BASE, /private readonly draftWriter = effect\(\(\) => \{/);
    assert.match(TAIL_BASE, /if \(!this\.hydrated\(\) \|\| !this\.baselineReady\(\) \|\| this\.saving\(\)\) return;/);
    assert.match(TAIL_BASE, /this\.lastDraftBaseline\(\) === null \|\| serialized === this\.lastDraftBaseline\(\)/);
    assert.match(TAIL_BASE, /this\.draftTimer = setTimeout\(\(\) => \{[\s\S]{0,160}localStorage\.setItem\(this\.draftKey\(\), serialized\)/);
    assert.match(TAIL_BASE, /const raw = localStorage\.getItem\(this\.draftKey\(\)\)/);
    assert.match(TAIL_BASE, /this\.lastSaved\.set\(this\.currentDraft\(\)\);\s*this\.lastDraftBaseline\.set\(JSON\.stringify\(this\.draftSnapshot\(\)\)\);\s*this\.baselineReady\.set\(true\);\s*this\.clearDraft\(\);/);
});

test('BUG-36 — observation evidence is redacted like /events', () => {
    assert.match(OBSERVATION_TS, /\['userQuery', 'prompt', 'requestBody'\]\.includes\(key\) \? '\[redacted\]'/);
    assert.match(OBSERVATION_TS, /return JSON\.stringify\(this\.redactEvidence\(evidence \?\? null\), null, 2\)/);
    assert.doesNotMatch(OBSERVATION_TS, /return JSON\.stringify\(evidence \?\? null, null, 2\)/);
});

test('BUG-15 — knowledge copy states the 50-row cap', () => {
    assert.doesNotMatch(KB_TAB, /All rows shown/);
    assert.match(KB_TAB, /Showing up to \{\{ vm\(\)\.knowledgeDocsLimit \}\} rows/);
    assert.match(KNOWLEDGE_BASE, /readonly knowledgeDocsLimit = 50;/);
});

test('BUG-16 — findings counters are hidden when zero', () => {
    assert.match(KB_TAB, /@if \(vm\(\)\.knowledgeFindingsCount\(\) > 0\) \{ · \{\{ vm\(\)\.knowledgeFindingsCount\(\) \}\} findings \}/);
    assert.match(KB_OVERVIEW, /@if \(\(summary\(\)\?\.findings \|\| 0\) > 0\) \{/);
    assert.doesNotMatch(KB_OVERVIEW, /<strong>\{\{ summary\(\)\?\.findings \|\| 0 \}\}<\/strong><span>Open findings<\/span>/);
    assert.match(KNOWLEDGE_BASE, /readonly knowledgeFindingsCount = computed\(\(\) => this\.knowledgeSummary\(\)\?\.findings \|\| 0\)/);
});

test('BUG-14 — dead judgment/sufficiency code is removed from the observation panel', () => {
    for (const symbol of ['runJudgment', 'judgmentInput', 'judgmentResult', 'judgmentLoading', 'judgmentError', 'evaluateSufficiency', 'JudgmentResponseDto']) {
        assert.ok(!OBSERVATION_TS.includes(symbol), `${symbol} must be gone`);
    }
    assert.match(OBSERVATION_TS, /evaluateJev\(\): void/);
});

test('BUG-28 — applyBulkUpgrade chỉ đổi row chưa ở target (khớp affectedBindings)', () => {
  const src = readFileSync(new URL('../eso/ui/apps/control-plane/src/app/features/consumers/pages/settings-stack.base.ts', import.meta.url), 'utf8');
  assert.match(src, /profile\.stackVersion === target \? profile : \{ \.\.\.profile, stackVersion: target \}/);
});
