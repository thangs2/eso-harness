#!/usr/bin/env node
/**
 * Runtime evidence for the three runtime slices: ESO-525 (UI), ESO-528 (isolation),
 * ESO-531 (unified 404). The control plane and the static UI must already be running.
 *
 *   node eso/e2e/runtime-load.e2e.mjs
 *
 * Thresholds are local sanity bounds, not the NFR: the NFR is decided by ESO-606 (tdd-perf).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'http://127.0.0.1:8787';
const UI = 'http://127.0.0.1:4200';
const ID = `rt-${Date.now().toString(36)}`;
const ROOT = mkdtempSync(join(tmpdir(), 'eso-runtime-'));
const AUTH = `Basic ${Buffer.from(`${process.env.ESO_AUTH_USER}:${process.env.ESO_AUTH_PASSWORD}`).toString('base64')}`;

function authHeaders() {
    return { Authorization: AUTH, Accept: 'application/json' };
}

async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            ...authHeaders(),
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
}

async function ready() {
    for (let i = 0; i < 50; i += 1) {
        try {
            const res = await fetch(`${API}/health`);
            if (res.ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('control plane is not listening on 8787');
}

async function scenarios() {
    const created = await api('/api/v1/consumers', {
        method: 'POST',
        body: JSON.stringify({
            id: ID,
            name: 'Runtime Load',
            root: ROOT,
            sdlcRoot: join(ROOT, 'sdlc'),
            profile: { recipe: 'lite', hostProfile: 'cursor' },
            zones: [{ name: 'human', path: 'src' }],
        }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return [
        { name: 'ui-index', url: `${UI}/`, headers: {}, total: 200, concurrency: 20, p95: 1000 },
        { name: 'auth-me', url: `${API}/api/v1/auth/me`, headers: authHeaders(), total: 200, concurrency: 20, p95: 1000 },
        { name: 'registry-list', url: `${API}/api/v1/consumers`, headers: authHeaders(), total: 200, concurrency: 20, p95: 1000 },
        { name: 'isolation-data', url: `${API}/api/v1/c/${ID}/ping`, headers: authHeaders(), total: 200, concurrency: 20, p95: 1000 },
        { name: 'unified-404', url: `${API}/api/v1/c/missing-consumer/ping`, headers: authHeaders(), total: 200, concurrency: 20, p95: 1000, expectedStatus: 404 },
    ];
}

async function measure({ name, url, headers, total, concurrency, p95, expectedStatus = 200, phase = 'load' }) {
    let next = 0;
    let errors = 0;
    const latencies = [];
    const started = performance.now();
    async function worker() {
        while (true) {
            const index = next++;
            if (index >= total) return;
            const begin = performance.now();
            try {
                const res = await fetch(url, { headers });
                await res.arrayBuffer();
                if (res.status !== expectedStatus) errors += 1;
            } catch {
                errors += 1;
            }
            latencies.push(performance.now() - begin);
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    const elapsed = performance.now() - started;
    latencies.sort((a, b) => a - b);
    const at = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] || 0;
    const result = {
        phase,
        scenario: name,
        total,
        concurrency,
        errors,
        errorRate: Number((errors / total).toFixed(4)),
        ms: { p50: Number(at(0.5).toFixed(1)), p95: Number(at(0.95).toFixed(1)), p99: Number(at(0.99).toFixed(1)), max: Number(latencies[latencies.length - 1].toFixed(1)) },
        rps: Number((total / (elapsed / 1000)).toFixed(1)),
        p95Budget: p95,
        p95Pass: at(0.95) <= p95,
    };
    console.log(JSON.stringify(result));
    return result;
}

function cleanup() {
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

let failed = false;
try {
    if (!process.env.ESO_AUTH_USER || !process.env.ESO_AUTH_PASSWORD) {
        throw new Error('ESO_AUTH_USER/ESO_AUTH_PASSWORD must be set (source eso/.env)');
    }
    await ready();
    const list = await scenarios();
    for (const scenario of list) {
        const load = await measure({ ...scenario, phase: 'load' });
        if (load.errors > 0 || !load.p95Pass) failed = true;
        const stress = await measure({
            ...scenario,
            phase: 'stress',
            total: scenario.total * 3,
            concurrency: scenario.concurrency * 3,
            p95: scenario.p95 * 2.5,
        });
        if (stress.errors > 0 || !stress.p95Pass) failed = true;
    }

    await api(`/api/v1/consumers/${ID}/delete`, { method: 'POST' });
    await api(`/api/v1/consumers/${ID}/purge`, { method: 'POST', body: JSON.stringify({ confirm_id: ID }) });
} catch (error) {
    failed = true;
    console.error(error?.stack || error);
} finally {
    cleanup();
    rmSync(ROOT, { recursive: true, force: true });
}

if (failed) {
    console.error('runtime load/stress: FAIL');
    process.exit(1);
}
console.log('runtime load/stress: PASS');
