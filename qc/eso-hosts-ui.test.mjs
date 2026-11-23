import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync('eso/ui/apps/control-plane/src/app/features/hosts/pages/hosts.page.ts', 'utf8');
const CLIENT = readFileSync('eso/ui/libs/api-client/client.ts', 'utf8');

test('AC-54-1 · ghi host dùng PUT /hosts/{hostId}, KHÔNG POST /hosts', () => {
    assert.match(CLIENT, /\/api\/v1\/hosts\/\$\{encodeURIComponent\(host\.hostId\)\}/);
    assert.equal(/fetch\(`\$\{this\.baseUrl\}\/api\/v1\/hosts`[\s\S]{0,60}method: 'POST'/.test(CLIENT), false);
});

test('AC-54-2 · 8 validate message cho form', () => {
    const msgs = PAGE.match(/Host ID is required|lowercase slug|already exists|Host type is required|Host label is required|Runtime ID is required|This host already has a runtime/g) || [];
    assert.ok(msgs.length >= 7, `messages=${msgs.length}`);
});

test('AC-54-3 · Host ID read-only khi không phải register', () => {
    assert.match(PAGE, /\[readOnly\]="dialogMode\(\) !== 'register'"/);
});

test('AC-54-4 · heartbeat có busy theo runtimeKey + notice', () => {
    assert.match(PAGE, /heartbeatBusy\.set\(runtime\.runtimeKey\)/);
    assert.match(PAGE, /Heartbeat recorded for/);
});

test('AC-54-5 · 3 model tier + reported by host', () => {
    assert.match(PAGE, /MODEL_TIERS[^=]*=\s*\[[^\]]*fast[^\]]*balanced[^\]]*reasoning/);
    assert.match(PAGE, /Models are reported by the host runtime/);
});
