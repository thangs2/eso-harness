/**
 * P5a — Q5 integrity: the detail page reads the receipt summary and asks the server to verify it.
 * No full hash on screen, no verification assumed before the server answered.
 * Source contract test (no browser).
 *
 * Chạy: node --test qc/eso-request-receipt-ui.test.mjs
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

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const PAGE = readPageFolder();
const CLIENT = read('eso/ui/libs/api-client/client.ts');
const TYPES = read('eso/ui/libs/api-client/types.ts');

test('Q5 reads detail.receipt summary: hashPrefix + chained + HMAC', () => {
    assert.match(PAGE, /readonly receipt = computed<RequestReceiptSummaryDto \| null>\(\(\) => this\.detail\(\)\?\.receipt \?\? null\)/);
    assert.match(PAGE, /@if \(receipt\(\); as r\)/);
    assert.match(PAGE, /\{\{ r\.hashPrefix \}\}/);
    assert.match(PAGE, /r\.chained \? 'chained' : 'genesis'/);
    assert.match(PAGE, /r\.hmacPresent \? 'HMAC present' : 'HMAC absent'/);
    assert.match(
        TYPES,
        /export interface RequestReceiptSummaryDto \{[\s\S]*?hashPrefix: string;[\s\S]*?hmacPresent: boolean;[\s\S]*?chained: boolean;/
    );
});

test('Q5 calls the verify route once per loaded receipt', () => {
    assert.match(CLIENT, /async verifyReceipt\(id: string, receiptId: string\): Promise<ReceiptVerificationDto>/);
    assert.match(
        CLIENT,
        /\/api\/v1\/consumers\/\$\{encodeURIComponent\(id\)\}\/receipts\/\$\{encodeURIComponent\(receiptId\)\}\/verify/
    );
    assert.match(
        PAGE,
        /const receiptId = loaded\?\.receipt\?\.receiptId \?\? loaded\?\.verdict\?\.receiptId \?\? this\.fullReceipt\(\)\?\.receiptId \?\? '';/
    );
    assert.match(PAGE, /if \(receiptId\) await this\.verifyReceipt\(seq, receiptId\);/);
    // exactly one call site, inside the guarded load; nothing calls verify from the template
    assert.equal((PAGE.match(/this\.verifyReceipt\(/g) ?? []).length, 1);
});

test('Q5 has verified / failed / unavailable branches and uses the server result', () => {
    assert.match(PAGE, /receiptVerification\(\) === 'verified'/);
    assert.match(PAGE, /receiptVerification\(\) === 'failed'/);
    assert.match(PAGE, /data-state="unavailable"/);
    assert.match(PAGE, /Verified · hash ok/);
    assert.match(PAGE, /Verification failed/);
    assert.match(PAGE, /Verification unavailable/);
    assert.match(PAGE, /result\.ok && result\.hashMatches \? 'verified' : 'failed'/);
});

test('Q5 never renders a full hash or computes one client-side', () => {
    assert.doesNotMatch(PAGE, /r\.hash(?!Prefix)/);
    assert.doesNotMatch(PAGE, /receipt\.hash\b/);
    assert.doesNotMatch(PAGE, /[0-9a-f]{32,}/i);
    assert.doesNotMatch(PAGE, /createHash|crypto\.subtle/);
});

test('Q5 defaults to unavailable — "verified" is never assumed', () => {
    assert.match(PAGE, /readonly receiptVerification = signal<ReceiptVerificationState>\('unavailable'\)/);
    assert.doesNotMatch(PAGE, /signal<ReceiptVerificationState>\('verified'\)/);
    // a thrown verify request degrades to unavailable, not to a pass
    assert.match(
        PAGE,
        /private async verifyReceipt\(seq: number, receiptId: string\): Promise<void> \{[\s\S]*?catch \{[\s\S]*?this\.receiptVerification\.set\('unavailable'\);/
    );
    // the old "No receipt was issued" honesty is kept for detail payloads without a summary
    assert.match(PAGE, /No receipt was issued for this turn/);
});
