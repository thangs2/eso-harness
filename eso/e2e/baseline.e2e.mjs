#!/usr/bin/env node
/**
 * L6.2 — baseline E2E: unified 404 + the whole Sprint 1 surface on a running control plane.
 *
 * Run (with eso/.env sourced): node eso/e2e/baseline.e2e.mjs
 * The harness starts `bun src/common/http/server.ts` on an ephemeral port, drives HTTP, and
 * removes its own consumer/schema afterwards.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL_PLANE = resolve(HERE, '..', 'control-plane');
const ID = `e2e-${Date.now().toString(36)}`;
const ROOT = mkdtempSync(join(tmpdir(), 'eso-e2e-'));
const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

function basicAuth() {
    const user = process.env.ESO_AUTH_USER;
    const password = process.env.ESO_AUTH_PASSWORD;
    if (!user || !password) throw new Error('ESO_AUTH_USER/ESO_AUTH_PASSWORD must be set (source eso/.env)');
    return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function startServer() {
    const env = {
        ...process.env,
        ESO_PORT: '0',
        ESO_DB_URL: process.env.ESO_TEST_DB_URL,
    };
    if (!env.ESO_TEST_DB_URL) throw new Error('ESO_TEST_DB_URL must be set (source eso/.env)');
    const child = spawn('bun', ['src/common/http/server.ts'], {
        cwd: CONTROL_PLANE,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const port = await new Promise((resolvePort, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr || stdout}`)), 15000);
        const check = () => {
            const match = /LISTEN:(\d+)/.exec(stdout);
            if (match) {
                clearTimeout(timer);
                resolvePort(Number(match[1]));
            }
        };
        child.stdout.on('data', check);
        child.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`server exited ${code}: ${stderr || stdout}`));
        });
    });
    return { child, base: `http://127.0.0.1:${port}` };
}

async function request(base, path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = basicAuth();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
}

function rawGet(base, path) {
    const url = new URL(base);
    return new Promise((resolveRaw, reject) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path,
            method: 'GET',
            headers: { Accept: 'application/json', Authorization: basicAuth() },
        }, (res) => {
            let text = '';
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => {
                let body = null;
                try { body = JSON.parse(text); } catch { body = text; }
                resolveRaw({ status: res.statusCode, body });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function cleanupDb() {
    const code = `
const sql = new Bun.SQL(process.env.ESO_TEST_DB_URL);
const id = process.env.CLEAN_ID;
await sql.unsafe('DELETE FROM platform.consumer_event WHERE consumer_id = $1', [id]);
await sql.unsafe('DELETE FROM platform.consumer WHERE id = $1', [id]);
await sql.unsafe('DROP SCHEMA IF EXISTS "c_' + id + '" CASCADE');
await sql.close();
`;
    try {
        execFileSync('bun', ['-e', code], {
            env: { ...process.env, CLEAN_ID: ID },
            stdio: 'ignore',
        });
    } catch {
        // Best effort: the E2E result is already known; a leftover row is visible in the DB.
    }
}

test('SCN-13-1 · AC-13-1 — 404 thống nhất + E2E + smoke · tdd-unit', async ({ base }) => {
    assert.equal((await request(base, '/health', { auth: false })).status, 200);
    const noAuth = await request(base, '/api/v1/consumers', { auth: false });
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.body.code, 'AUTH_REQUIRED');

    const missing = await request(base, `/api/v1/c/${ID}/ping`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'CONSUMER_NOT_FOUND');
    assert.equal(missing.body.message, 'Consumer not found');

    const cB = await request(base, '/api/v1/c/c_b/ping');
    assert.equal(cB.status, 400, 'c_b must be INVALID_CONSUMER_ID');
    assert.equal(cB.body.code, 'INVALID_CONSUMER_ID');

    const encoded = await rawGet(base, '/api/v1/c/%2e%2e/ping');
    assert.equal(encoded.status, 400, '%2e%2e must be INVALID_CONSUMER_ID');
    assert.equal(encoded.body.code, 'INVALID_CONSUMER_ID');

    const unknown = await request(base, '/api/v1/no-such-route');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'CONSUMER_NOT_FOUND');
});

test('SCN-13-1 · AC-13-1 — 404 thống nhất + E2E + smoke · tdd-impl', async ({ base }) => {
    const me = await request(base, '/api/v1/auth/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { kind: 'operator', configured: true });

    const created = await request(base, '/api/v1/consumers', {
        method: 'POST',
        body: {
            id: ID,
            name: 'E2E Consumer',
            root: ROOT,
            sdlcRoot: join(ROOT, 'sdlc'),
            profile: { recipe: 'pro', hostProfile: 'cursor' },
            zones: [{ name: 'human', path: 'src' }, { name: 'agent', path: 'src' }],
        },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.id, ID);
    assert.equal(created.body.status, 'ready');
    assert.equal(created.body.version, 1);

    const list = await request(base, '/api/v1/consumers');
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.ok(list.body.some((row) => row.id === ID));

    const detail = await request(base, `/api/v1/consumers/${ID}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.id, ID);
    assert.ok(detail.body.profile);
});

test('SCN-13-1 · AC-13-1 — 404 thống nhất + E2E + smoke · tdd-coverage', async ({ base }) => {
    const updated = await request(base, `/api/v1/consumers/${ID}`, {
        method: 'PUT',
        body: { expected_version: 1, profile: { recipe: 'lite', hostProfile: 'agents' } },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);

    const stale = await request(base, `/api/v1/consumers/${ID}`, {
        method: 'PUT',
        body: { expected_version: 1, profile: { recipe: 'pro' } },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'STALE_VERSION');

    const check = await request(base, `/api/v1/consumers/${ID}/profile/check`, { method: 'POST' });
    assert.equal(check.status, 200);
    assert.equal(check.body.status, 'ok');

    const retired = await request(base, `/api/v1/consumers/${ID}/retire`, { method: 'POST' });
    assert.equal(retired.status, 200);
    assert.equal(retired.body.status, 'retired');
    const hidden = await request(base, `/api/v1/c/${ID}/ping`);
    assert.equal(hidden.status, 404);
    assert.equal(hidden.body.code, 'CONSUMER_NOT_FOUND');

    const reactivated = await request(base, `/api/v1/consumers/${ID}/reactivate`, { method: 'POST' });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.status, 'ready');
    assert.equal((await request(base, `/api/v1/c/${ID}/ping`)).status, 200);

    const deleted = await request(base, `/api/v1/consumers/${ID}/delete`, { method: 'POST' });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.status, 'deleted');
    assert.equal((await request(base, `/api/v1/c/${ID}/ping`)).status, 404);

    const restored = await request(base, `/api/v1/consumers/${ID}/restore`, { method: 'POST' });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.status, 'ready');
});

test('SCN-13-1 · AC-13-1 — 404 thống nhất + E2E + smoke · tdd-qc', async ({ base }) => {
    await request(base, `/api/v1/consumers/${ID}/retire`, { method: 'POST' });
    const mismatch = await request(base, `/api/v1/consumers/${ID}/purge`, {
        method: 'POST',
        body: { confirm_id: 'wrong-id' },
    });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.code, 'PURGE_CONFIRM_MISMATCH');

    const beforePurge = await request(base, `/api/v1/consumers/${ID}/events`);
    assert.equal(beforePurge.status, 200);
    const types = beforePurge.body.map((event) => event.eventType);
    for (const expected of ['created', 'updated', 'retired', 'reactivated', 'deleted', 'restored']) {
        assert.ok(types.includes(expected), `missing event ${expected}`);
    }

    const purged = await request(base, `/api/v1/consumers/${ID}/purge`, {
        method: 'POST',
        body: { confirm_id: ID },
    });
    assert.equal(purged.status, 200);
    assert.equal(purged.body.status, 'purged');

    const gone = await request(base, `/api/v1/c/${ID}/ping`);
    assert.equal(gone.status, 404);
    assert.equal(gone.body.code, 'CONSUMER_NOT_FOUND');
    assert.equal((await request(base, `/api/v1/consumers/${ID}`)).status, 404);
    assert.equal((await request(base, `/api/v1/consumers/${ID}/events`)).status, 404);

    const removed = await request(base, `/api/v1/consumers/${ID}/events`, { method: 'DELETE' });
    assert.equal(removed.status, 404);
    assert.equal(removed.body.code, 'CONSUMER_NOT_FOUND');
});

let server = null;
let exitCode = 0;
try {
    server = await startServer();
    for (const { name, fn } of tests) {
        try {
            await fn(server);
            console.log(`(pass) ${name}`);
        } catch (error) {
            exitCode = 1;
            console.log(`(fail) ${name}`);
            console.error(error?.stack || error);
            break;
        }
    }
} catch (error) {
    exitCode = 1;
    console.error(error?.stack || error);
} finally {
    cleanupDb();
    if (server?.child) {
        server.child.kill('SIGTERM');
        await new Promise((resolveExit) => {
            const timer = setTimeout(() => { server.child.kill('SIGKILL'); resolveExit(); }, 3000);
            server.child.on('exit', () => { clearTimeout(timer); resolveExit(); });
        });
    }
    rmSync(ROOT, { recursive: true, force: true });
}

if (exitCode === 0) console.log('baseline e2e: PASS');
process.exit(exitCode);
