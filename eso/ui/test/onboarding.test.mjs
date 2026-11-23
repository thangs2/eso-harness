import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// BUG-24: this file used to import `.js` specifiers that only exist after a TypeScript build, so
// `node --test` failed before running a single assertion. It now checks the source as written:
// the AC-39 contract lives in the service (readiness filter, preview, read-back) and the page
// template (states, copy, reset of `submitting`), and those are exactly the invariants we own.
const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(__dirname, relative), 'utf8');

const MODEL = read('../apps/control-plane/src/app/features/onboarding/models/onboarding.model.ts');
const SERVICE = read('../apps/control-plane/src/app/features/onboarding/data/onboarding.service.ts');
const PAGE = read('../apps/control-plane/src/app/features/onboarding/pages/onboarding.page.ts');

describe('L5.3 / US-39 / AC-39 — Onboarding UI: Select Consumer & Provisioning Preview', () => {

    test('AC-39-1: only ready consumers are loadable and the preview has no host/tier/recipe fields', () => {
        assert.match(SERVICE, /\.filter\(\(c: ConsumerSummary\) => c\.status === 'ready'\)/);

        assert.match(MODEL, /interface ProvisioningPreview/);
        for (const field of ['consumerId:', 'name:', 'root:', 'schemaName:', 'materialBundle:']) {
            assert.ok(MODEL.includes(field), `preview must declare ${field}`);
        }
        assert.doesNotMatch(MODEL, /\b(host|source|tier|recipe)\b/i);
        assert.match(SERVICE, /schemaName: `c_\$\{consumer\.id\}`/);
    });

    test('AC-39-2: empty ready list renders the blocked / CTA state', () => {
        assert.match(PAGE, /No consumers in ready state/);
        assert.match(PAGE, /routerLink="\/setup"/);
        assert.match(PAGE, /!error\(\) && consumers\(\)\.length === 0/);
    });

    test('AC-39-3: a failure shows code, HTTP status and message, and never declares success', () => {
        assert.match(PAGE, /\{\{ err\.code \}\}/);
        assert.match(PAGE, /HTTP \{\{ err\.status \}\}/);
        assert.match(PAGE, /\{\{ err\.message \}\}/);
        // success is only assigned inside the try block, after `provision` resolves
        const submit = PAGE.slice(PAGE.indexOf('async submitProvision'), PAGE.indexOf('async submitProvision') + 2000);
        assert.match(submit, /const result = await this\.service\.provision\(consumerId\);\s*this\.success\.set\(result\);/);
        assert.match(submit, /this\.error\.set\(\{ code, message, status \}\)/);
        assert.match(submit, /finally \{\s*this\.submitting\.set\(false\);/);
    });

    test('provision reads back real setup state instead of trusting the provision response', () => {
        assert.match(SERVICE, /getConsumerSetup\(consumerId\)/);
        assert.match(SERVICE, /ready: setupRes\.setup\.ready/);
    });

    test('BUG-12: "ready" is only claimed when setup.ready is true', () => {
        assert.match(PAGE, /@if \(res\.ready\)/);
        assert.match(PAGE, /does <strong>not<\/strong> report ready/);
        assert.doesNotMatch(PAGE, /and is ready/);
    });

    test('Structural and hygiene compliance: no packages/harness-* imports, no tier/recipe/host fields', () => {
        const featureFiles = [
            '../apps/control-plane/src/app/features/onboarding/models/onboarding.model.ts',
            '../apps/control-plane/src/app/features/onboarding/data/onboarding.service.ts',
            '../apps/control-plane/src/app/features/onboarding/pages/onboarding.page.ts',
            '../apps/control-plane/src/app/features/onboarding/onboarding.routes.ts',
        ];

        for (const file of featureFiles) {
            const fullPath = resolve(__dirname, file);
            assert.ok(existsSync(fullPath), `File must exist: ${file}`);
            const content = readFileSync(fullPath, 'utf8');

            assert.equal(content.includes('packages/harness-'), false, `Forbidden import packages/harness-* found in ${file}`);
            assert.equal(/\b(tier|recipe)\b/i.test(content), false, `Forbidden legacy term tier/recipe found in ${file}`);
        }
    });
});
