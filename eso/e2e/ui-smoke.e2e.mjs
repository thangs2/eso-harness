#!/usr/bin/env node
/**
 * L5.1/L5.2 — UI smoke against a running control plane + built Angular app.
 *
 * Run (with eso/.env sourced): node eso/e2e/ui-smoke.e2e.mjs
 * Requires the UI build at eso/ui/dist/control-plane/browser and Google Chrome.
 * Ports 4200 (UI) and 8787 (control plane) are fixed by plane C; the harness fails loudly if
 * either is occupied instead of silently testing another origin.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const UI_ROOT = resolve(ROOT, 'eso', 'ui', 'dist', 'control-plane', 'browser');
const CONTROL_PLANE = resolve(ROOT, 'eso', 'control-plane');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ID = `ui-${Date.now().toString(36)}`;
const ROOT_DIR = mkdtempSync(join(tmpdir(), 'eso-ui-'));
const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

function basicAuth(user = process.env.ESO_AUTH_USER, password = process.env.ESO_AUTH_PASSWORD) {
    if (!user || !password) throw new Error('ESO_AUTH_USER/ESO_AUTH_PASSWORD must be set (source eso/.env)');
    return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function api(path, options = {}) {
    const res = await fetch(`http://127.0.0.1:8787${path}`, {
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.auth === false ? {} : { Authorization: basicAuth() }),
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
}

function startStatic() {
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
    };
    return new Promise((resolveServer, reject) => {
        const server = createServer((req, res) => {
            try {
                const pathname = decodeURIComponent(new URL(req.url, 'http://ui').pathname);
                const relative = pathname === '/' || !extname(pathname) ? 'index.html' : pathname.replace(/^\//, '');
                const file = resolve(UI_ROOT, relative);
                if (!file.startsWith(UI_ROOT) || !existsSync(file) || !statSync(file).isFile()) {
                    res.writeHead(404).end('not found');
                    return;
                }
                res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
                res.end(readFileSync(file));
            } catch {
                res.writeHead(500).end('static error');
            }
        });
        server.on('error', reject);
        server.listen(4200, '127.0.0.1', () => resolveServer(server));
    });
}

async function startControlPlane() {
    const env = { ...process.env, ESO_PORT: '8787', ESO_DB_URL: process.env.ESO_TEST_DB_URL };
    const child = spawn('bun', ['src/common/http/server.ts'], {
        cwd: CONTROL_PLANE,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    await new Promise((resolveStart, reject) => {
        const timer = setTimeout(() => reject(new Error(`control plane did not start: ${stderr || stdout}`)), 15000);
        const check = () => {
            if (/LISTEN:8787/.test(stdout)) {
                clearTimeout(timer);
                resolveStart();
            }
        };
        child.stdout.on('data', check);
        child.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`control plane exited ${code}: ${stderr || stdout}`));
        });
    });
    return child;
}

async function launchChrome() {
    if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
    const profile = mkdtempSync(join(tmpdir(), 'eso-chrome-'));
    const child = spawn(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const portFile = join(profile, 'DevToolsActivePort');
    let port = 0;
    for (let i = 0; i < 100; i += 1) {
        if (existsSync(portFile)) {
            const first = readFileSync(portFile, 'utf8').split('\n')[0];
            port = Number(first);
            if (port) break;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    if (!port) throw new Error('Chrome DevTools port not available');
    const page = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
    return { child, profile, wsUrl: page.webSocketDebuggerUrl };
}

async function connectCdp(url) {
    const ws = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
        ws.onopen = resolveOpen;
        ws.onerror = () => reject(new Error('CDP websocket failed'));
    });
    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            const { resolve: resolveCall, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolveCall(message.result);
        }
    };
    const send = (method, params = {}) => new Promise((resolveCall, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveCall, reject });
        ws.send(JSON.stringify({ id, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    return { ws, send };
}

async function evaluate(cdp, expression) {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
    return result.result?.value;
}

async function waitFor(cdp, expression, timeout = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        if (await evaluate(cdp, expression)) return true;
        await new Promise((r) => setTimeout(r, 120));
    }
    return false;
}

const setValue = (selector, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
})()`;

test('SCN-15-1 · AC-15-1 — Use the control plane via the UI (US-15) · tdd-unit', async () => {
    const auth = readFileSync(resolve(ROOT, 'eso/ui/apps/control-plane/src/app/core/auth/auth.service.ts'), 'utf8');
    assert.match(auth, /sessionStorage\.setItem\('eso\.auth'/);
    assert.doesNotMatch(auth, /localStorage\.(setItem|getItem)/);
    const login = readFileSync(resolve(ROOT, 'eso/ui/apps/control-plane/src/app/features/login/login.page.ts'), 'utf8');
    assert.match(login, /\/api\/v1\/auth\/me/);
    assert.match(login, /Basic/);
    const config = readFileSync(resolve(ROOT, 'eso/ui/apps/control-plane/src/app/core/config/app-config.service.ts'), 'utf8');
    assert.match(config, /127\.0\.0\.1:8787/);
    assert.equal(existsSync(join(UI_ROOT, 'index.html')), true);
});

test('SCN-15-1 · AC-15-1 — Use the control plane via the UI (US-15) · tdd-impl', async ({ cdp }) => {
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4200/login' });
    assert.equal(await waitFor(cdp, 'document.querySelector("eso-login-page") !== null'), true);
    assert.equal(await evaluate(cdp, setValue('input[name=user]', process.env.ESO_AUTH_USER)), true);
    assert.equal(await evaluate(cdp, setValue('input[name=password]', process.env.ESO_AUTH_PASSWORD)), true);
    await evaluate(cdp, 'document.querySelector("button[type=submit]").click()');
    assert.equal(await waitFor(cdp, 'location.pathname === "/consumers"'), true);
    const stored = await evaluate(cdp, 'sessionStorage.getItem("eso.auth")');
    assert.match(String(stored), /^Basic /);
    assert.equal(await waitFor(cdp, 'document.body.innerText.includes("Consumers")'), true);
});

test('SCN-15-1 · AC-15-1 — Use the control plane via the UI (US-15) · tdd-coverage', async ({ cdp, apiBase }) => {
    const created = await api('/api/v1/consumers', {
        method: 'POST',
        body: JSON.stringify({
            id: ID,
            name: 'UI Smoke Consumer',
            root: ROOT_DIR,
            sdlcRoot: join(ROOT_DIR, 'sdlc'),
            profile: { recipe: 'pro', hostProfile: 'cursor' },
            zones: [{ name: 'human', path: 'src' }, { name: 'agent', path: 'src' }],
        }),
    });
    assert.equal(created.status, 201);

    await cdp.send('Page.reload', { ignoreCache: true });
    assert.equal(await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(ID)})`), true);

    // The wizard page is reachable and renders its stepper.
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4200/onboarding' });
    assert.equal(await waitFor(cdp, 'document.querySelector(".stepper") !== null'), true);
});

test('SCN-15-1 · AC-15-1 — Use the control plane via the UI (US-15) · tdd-qc', async ({ cdp }) => {
    await evaluate(cdp, 'sessionStorage.removeItem("eso.auth")');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4200/login' });
    assert.equal(await waitFor(cdp, 'document.querySelector("eso-login-page") !== null'), true);
    await evaluate(cdp, setValue('input[name=user]', process.env.ESO_AUTH_USER));
    await evaluate(cdp, setValue('input[name=password]', 'definitely-wrong'));
    await evaluate(cdp, 'document.querySelector("button[type=submit]").click()');
    assert.equal(await waitFor(cdp, 'document.querySelector(".form-error") !== null'), true);
    const errorText = await evaluate(cdp, 'document.querySelector(".form-error").innerText');
    assert.match(String(errorText), /AUTH_INVALID/);
    assert.match(String(errorText), /Invalid credentials/);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/eso-ui-smoke.png', Buffer.from(shot.data, 'base64'));
    assert.ok(statSync('/tmp/eso-ui-smoke.png').size > 1000);
});

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
        execFileSync('bun', ['-e', code], { env: { ...process.env, CLEAN_ID: ID }, stdio: 'ignore' });
    } catch {}
}

let apiBase = null;
let cp = null;
let ui = null;
let chrome = null;
let cdp = null;
let exitCode = 0;
try {
    if (!existsSync(join(UI_ROOT, 'index.html'))) throw new Error('UI build missing: run npm run build:ng in eso/ui');
    ui = await startStatic();
    cp = await startControlPlane();
    apiBase = 'http://127.0.0.1:8787';
    const launched = await launchChrome();
    chrome = launched.child;
    cdp = await connectCdp(launched.wsUrl);
    for (const { name, fn } of tests) {
        try {
            await fn({ cdp, apiBase });
            console.log(`(pass) ${name}`);
        } catch (error) {
            exitCode = 1;
            console.log(`(fail) ${name}`);
            console.error(error?.stack || error);
            break;
        }
    }
    if (chrome) chrome.kill('SIGTERM');
} catch (error) {
    exitCode = 1;
    console.error(error?.stack || error);
} finally {
    cleanupDb();
    if (cdp?.ws) cdp.ws.close();
    if (chrome) chrome.kill('SIGKILL');
    if (ui) await new Promise((r) => ui.close(r));
    if (cp) cp.kill('SIGTERM');
    rmSync(ROOT_DIR, { recursive: true, force: true });
}
if (exitCode === 0) console.log('ui smoke: PASS');
process.exit(exitCode);
