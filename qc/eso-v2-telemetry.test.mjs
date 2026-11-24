/**
 * Vision test V2 — "bằng chứng thay cho log thô" · source invariants.
 *
 * No Angular build/browser is available in this repo, so this reads the source the browser would
 * run and pins the contract:
 *   - the observable call sites exist (2 surface opens + raw evidence expand);
 *   - the beacon is fire-and-forget (`.catch`, never awaited for render);
 *   - the request body carries ONLY surface/consumerId/session — no prompt, no evidence payload;
 *   - `raw.json.copy` is not emitted because the UI exposes no copy button.
 *
 * Raw JSON opened in a terminal/transcript is not observable by ESO and must not be counted.
 *
 * Chạy: node --test qc/eso-v2-telemetry.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const OBSERVATORY = src('eso/ui/apps/control-plane/src/app/features/observatory/pages/observatory.page.ts');
const REQUEST = src('eso/ui/apps/control-plane/src/app/features/observatory/pages/request-detail.page.ts');
const CLIENT = src('eso/ui/libs/api-client/client.ts');
const SERVER = src('eso/control-plane/src/common/http/server.ts');
const SERVICE = src('eso/control-plane/src/modules/telemetry/telemetry.service.ts');
const DDL = src('eso/control-plane/src/platform/registry/ddl.ts');
const TYPES = src('eso/control-plane/src/platform/registry/types.ts');
const STORE = src('eso/control-plane/src/platform/registry/store.ts');

const UI_SOURCES = [OBSERVATORY, REQUEST, CLIENT];

test('SCN-V2-1 — platform.ui_event is an append-only platform table', () => {
    assert.match(DDL, /CREATE TABLE IF NOT EXISTS platform\.ui_event/);
    assert.match(DDL, /consumer_id\s+text not null/);
    assert.match(DDL, /surface\s+text not null/);
    assert.match(DDL, /session\s+text/);
    assert.match(DDL, /at\s+timestamptz not null default now\(\)/);
    assert.match(STORE, /async recordUiEvent\(event: UiEvent\)/);
    assert.match(STORE, /async listUiEvents\(query: UiEventQuery = \{\}\)/);
    // Append-only: the store contract never exposes an update/delete for ui events.
    assert.doesNotMatch(STORE, /deleteUiEvent|updateUiEvent/);
});

test('SCN-V2-2 — the two surface opens and the evidence expand are wired', () => {
    assert.match(OBSERVATORY, /'surface\.observatory\.open'/);
    assert.match(REQUEST, /'surface\.request\.open'/);
    assert.match(REQUEST, /'raw\.evidence\.expand'/);

    // Request-detail evidence is a real <details> toggle, and only an opening counts.
    assert.match(REQUEST, /<details \(toggle\)="trackEvidence\(\$event\)">/);
    assert.match(REQUEST, /trackEvidence\(event: Event\): void \{/);
    assert.match(REQUEST, /open\) return/);

    // Every page calls the client method (3 call sites incl. the toggle handler).
    for (const page of [OBSERVATORY, REQUEST]) {
        assert.match(page, /this\.api\.postUiEvent\(\{ surface, consumerId, session: this\.uiSession \}\)/);
        assert.match(page, /private readonly uiSession = crypto\.randomUUID\(\)/);
    }
});

test('SCN-V2-3 — beacons are fire-and-forget and never block or fail the render', () => {
    assert.match(CLIENT, /async postUiEvent\(event: \{ surface: string; consumerId\?: string \| null; session\?: string \| null \}\): Promise<void>/);
    for (const page of [OBSERVATORY, REQUEST]) {
        // `void …catch(...)` means the beacon is not awaited by ngOnInit/init.
        assert.match(page, /void this\.api\.postUiEvent\([^)]*\)\.catch\(\(\) => undefined\)/);
        assert.doesNotMatch(page, /await this\.api\.postUiEvent/);
    }
});

test('SCN-V2-4 — the beacon body carries only surface/consumerId/session (no prompt/PII)', () => {
    const start = CLIENT.indexOf('async postUiEvent');
    assert.ok(start > 0, 'postUiEvent not found');
    const method = CLIENT.slice(start, CLIENT.indexOf('\n    }\n}', start) + 7);
    assert.match(method, /surface: event\.surface/);
    assert.match(method, /consumerId: event\.consumerId \?\? undefined/);
    assert.match(method, /session: event\.session \?\? undefined/);
    for (const forbidden of ['prompt', 'userQuery', 'requestBody', 'evidence', 'payload']) {
        assert.doesNotMatch(method, new RegExp(`\\b${forbidden}\\b`, 'i'), `beacon must not send ${forbidden}`);
    }

    // The server passes the same three fields into the service, nothing else.
    const routeStart = SERVER.indexOf("app.post('/api/v1/telemetry/ui'");
    assert.ok(routeStart > 0, 'POST /api/v1/telemetry/ui not wired');
    const route = SERVER.slice(routeStart, SERVER.indexOf("app.get('/api/v1/telemetry/summary'", routeStart));
    assert.match(route, /surface: body\?\.surface/);
    assert.match(route, /consumerId: body\?\.consumerId/);
    assert.match(route, /session: body\?\.session/);
    assert.match(route, /reply\.code\(202\)/);
    assert.doesNotMatch(route, /body\?\.(prompt|userQuery|evidence|payload)/);
});

test('SCN-V2-5 — summary is authenticated and computes the documented ratio', () => {
    assert.match(SERVER, /app\.get\('\/api\/v1\/telemetry\/summary', \{ preHandler: requireAuth \}/);
    assert.match(SERVICE, /ratio: denominator === 0 \? 0 : surface_views \/ denominator/);
    assert.match(SERVICE, /UI_SURFACE_SET\.has\(surface\)/);
    assert.match(SERVICE, /unknown ui surface/);
});

test('SCN-V2-6 — raw.json.copy is skipped because no copy button exists', () => {
    // The enum keeps the name for a future copy action, but nothing emits it today.
    assert.match(TYPES, /'raw\.json\.copy'/);
    for (const source of UI_SOURCES) {
        assert.doesNotMatch(source, /raw\.json\.copy/);
        assert.doesNotMatch(source, /navigator\.clipboard/);
    }
});
