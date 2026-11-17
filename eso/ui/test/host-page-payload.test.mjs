import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ControlPlaneApiClient } from '../libs/api-client/client.js';

// Regression contract for H-UI-1/2/3: the Hosts runtime PUT must not send empty
// defaultModel or null modelTiers (both 422 on the control plane), and the UI slug
// pattern must match the backend SAFE_SLUG_PATTERN.
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

test('saveHostRuntime sends a backend-valid new-runtime payload', async () => {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: init?.body });
        return new Response(JSON.stringify({
            hostId: 'host-ui',
            runtimeId: 'cursor-agent',
            runtimeKey: 'host-ui:cursor-agent',
            hostType: 'cursor',
            runtimeKind: 'cli',
            models: [],
            defaultModel: '',
            leadEligible: false,
            health: 'unknown',
            lastHeartbeat: null,
            remoteUrl: null,
            modelTiers: {},
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
        const client = new ControlPlaneApiClient({ baseUrl: 'http://eso.test' });
        await client.saveHostRuntime({
            hostId: 'host-ui',
            hostType: 'cursor',
            runtimeId: 'cursor-agent',
            runtimeKey: 'host-ui:cursor-agent',
            runtimeKind: 'cli',
            models: [],
            defaultModel: '',
            leadEligible: false,
            health: 'unknown',
            lastHeartbeat: null,
            remoteUrl: null,
            modelTiers: {},
        });
        assert.equal(calls.length, 1);
        const body = JSON.parse(String(calls[0].body));
        assert.equal('defaultModel' in body, false);
        assert.deepEqual(body.modelTiers, {});
        assert.notEqual(body.modelTiers, null);
    } finally {
        globalThis.fetch = original;
    }
});
