#!/usr/bin/env node
/**
 * Repeatable cross-host flow smoke.
 *
 * Required env:
 *   ESO_OPERATOR_TOKEN, ESO_BASE_URL, ESO_CONSUMER, ESO_FLOW, ESO_RUNTIME_KEY,
 *   ESO_REMOTE_TOKEN, ESO_REMOTE_HOSTS (JSON), ESO_WORKSPACE_REPO
 * Optional:
 *   ESO_DRY=0 for real adapters (default dry), ESO_TRACE_ID
 *
 * This is provider-neutral: run it locally, from cron, or from any CI.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const env = process.env;
const required = ['ESO_OPERATOR_TOKEN', 'ESO_CONSUMER', 'ESO_FLOW', 'ESO_RUNTIME_KEY', 'ESO_REMOTE_TOKEN', 'ESO_REMOTE_HOSTS', 'ESO_WORKSPACE_REPO'];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
    console.error(`missing env: ${missing.join(', ')}`);
    process.exit(2);
}
const base = (env.ESO_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const hosts = JSON.parse(env.ESO_REMOTE_HOSTS);
for (const [key, url] of Object.entries(hosts)) {
    try {
        const res = await fetch(`${url.replace(/\/+$/, '')}/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!body?.ok) throw new Error('health not ok');
        process.stdout.write(`[cross-host] ${key} healthy at ${url}\n`);
    } catch (error) {
        console.error(`[cross-host] ${key} unhealthy: ${error.message}`);
        process.exit(2);
    }
}
const args = ['scripts/flow-orchestrate.mjs'];
const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 2);
