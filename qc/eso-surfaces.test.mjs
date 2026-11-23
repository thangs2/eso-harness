import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(`eso/ui/apps/control-plane/src/app/features/${p}`, 'utf8');
const diagnosis = read('diagnosis/pages/diagnosis.page.ts');
const declaration = read('declaration/pages/declaration.page.ts');
const risk = read('risk/pages/risk.page.ts');
const audit = read('audit/pages/audit.page.ts');

test('AC-34-1 · 3 surface S2/S4/S5 là placeholder có banner', () => {
    for (const [name, src] of [['diagnosis', diagnosis], ['risk', risk], ['audit', audit]]) {
        assert.match(src, /Not implemented yet/, name);
        assert.match(src, /read-only placeholder/, name);
    }
});

test('AC-34-1 · declaration là stub: preview hash client + save no-op', () => {
    assert.match(declaration, /cfg-\$\{Date\.now\(\)\}/);
    assert.match(declaration, /saveConfiguration[\s\S]{0,300}isSaving\.set\(false\)/);
    assert.equal(/fetch\(/.test(declaration), false);
});

test('AC-34-1 · risk/audit signal không được nạp (luôn empty)', () => {
    assert.match(risk, /items = signal<RiskItem\[\]>\(\[\]\)/);
    assert.match(audit, /items = signal<AuditItem\[\]>\(\[\]\)/);
    assert.equal(/items\.set\(/.test(risk + audit), false);
});

test('AC-34-2 · empty message có nội dung', () => {
    assert.match(diagnosis, /No evidence for this run/);
    assert.match(risk, /No technical debt recorded/);
    assert.match(audit, /No artefacts archived yet/);
});
