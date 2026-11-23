import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Regression contract for H-UI-1/2/3: the Hosts runtime PUT must not send empty
// defaultModel or null modelTiers (both 422 on the control plane), and the UI slug
// pattern must match the backend SAFE_SLUG_PATTERN.
//
// BUG-25: this file used to import `../libs/api-client/client.js` and drive a live
// `fetch` mock. There is no TypeScript build step under `node --test`, so the import
// failed before the assertions ran. The contract is still worth guarding, so it is
// asserted against the source that implements it instead of a runtime instance.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = fs.readFileSync(path.resolve(HERE, '../libs/api-client/client.ts'), 'utf8');
const PAGE = fs.readFileSync(path.resolve(HERE, '../apps/control-plane/src/app/features/hosts/pages/hosts.page.ts'), 'utf8');

test('Hosts runtime save omits empty defaultModel', () => {
    assert.match(CLIENT, /if \(runtime\.defaultModel\?\.trim\(\)\) body\.defaultModel = runtime\.defaultModel\.trim\(\);/);
    assert.doesNotMatch(CLIENT, /defaultModel: runtime\.defaultModel \|\| ''/);
});

test('Hosts runtime save always sends a modelTiers object, never null', () => {
    assert.match(CLIENT, /modelTiers,\n\s*};/);
    assert.doesNotMatch(CLIENT, /modelTiers: Object\.keys\(modelTiers\)\.length \? modelTiers : null/);
});

test('Hosts UI slug regex matches backend safe slug', () => {
    assert.match(PAGE, /\/\^\[a-z0-9\]\[a-z0-9_-\]\{0,63\}\$\//);
    assert.doesNotMatch(PAGE, /\[A-Za-z0-9\]\[A-Za-z0-9\._-\]/);
});

test('saveHostRuntime builds a backend-valid payload from the runtime input', () => {
    // The PUT body is assembled from the trimmed runtime fields, with empty tiers dropped
    // rather than sent as an empty model (422) and an explicit null only where allowed.
    const method = CLIENT.slice(CLIENT.indexOf('async saveHostRuntime'), CLIENT.indexOf('async heartbeatHostRuntime'));
    assert.match(method, /const body: Record<string, unknown> = \{/);
    assert.match(method, /runtimeKind: runtime\.runtimeKind/);
    assert.match(method, /models: \[\.\.\.runtime\.models\]/);
    assert.match(method, /remoteUrl: runtime\.remoteUrl\?\.trim\(\) \? runtime\.remoteUrl\.trim\(\) : null/);
    assert.match(method, /method: 'PUT'/);
    assert.match(method, /JSON\.stringify\(body\)/);
    assert.match(method, /if \(!model\) continue;/);
});
