#!/usr/bin/env node
/**
 * Prompt-mode router (host side, no SLP dependency).
 *
 *   mode=A <task>   run one worker on the host that received the prompt
 *   mode=B <task>   dispatch one worker to the first configured remote host
 *
 * The directive is parsed here, not by the model. Placement/config decides the target; there is no
 * `to=` in the prompt. ESO is only read for config/observation; execution stays on the host.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Execution shape of an SLP run: isolated subagents (default) or a persistent swarm. */
export const SWARM_SCOPE = new Set(['all', 'build', 'qc']);

function parseSwarm(rest) {
    const match = rest.match(/^\s*swarm(?:\s*=\s*([a-z-]+))?\b\s*([\s\S]*)$/i);
    if (!match) return { swarm: null, rest };
    const scope = String(match[1] || 'all').toLowerCase();
    if (!SWARM_SCOPE.has(scope)) return { swarm: null, rest, swarmError: `swarm scope must be one of ${[...SWARM_SCOPE].join('|')}` };
    return { swarm: scope, rest: String(match[2] || '') };
}

function parseSlpOnly(key, rest) {
    const parsed = parseSwarm(rest);
    if (parsed.swarmError) return { slp: true, task: '', key, swarm: null, error: parsed.swarmError };
    return { slp: true, task: parsed.rest.trim(), key, swarm: parsed.swarm, error: null };
}

export function parseModePrompt(input) {
    const text = String(input ?? '').trim();
    const match = text.match(/^mode\s*=\s*([AB])\b\s*(?:impl\s+(\S+)\s+slp\s+g\s+)?([\s\S]*)$/i);
    if (!match) {
        // `impl <KEY> slp g [swarm]` carries no mode: SLP runs on the host that received the prompt.
        const slpOnly = text.match(/^impl\s+(\S+)\s+slp\s+g\s+([\s\S]*)$/i);
        if (slpOnly) return { ...parseSlpOnly(slpOnly[1], String(slpOnly[2] || '')), mode: null };
        const filtered = text.match(/^(?:impl\s+(\S+)\s+slp\s+g\s+)?(swarm(?:\s*=\s*[a-z-]+)?)\b\s*([\s\S]*)$/i);
        if (filtered) {
            const parsed = parseSwarm(filtered[2]);
            const task = parsed.rest.trim();
            return {
                mode: null,
                slp: Boolean(filtered[1]),
                key: filtered[1] || null,
                swarm: parsed.swarm,
                task,
                error: parsed.swarmError || (task ? null : 'directive needs a task'),
            };
        }
        return { mode: 'A', slp: false, task: text, key: null, swarm: null, error: 'missing mode=A|B directive' };
    }
    const [, rawMode, implKey = null, rawRest] = match;
    const parsed = parseSwarm(String(rawRest || ''));
    const task = parsed.rest.trim();
    const mode = rawMode.toUpperCase();
    const base = { mode, slp: Boolean(implKey), key: implKey || null, swarm: parsed.swarm };
    if (parsed.swarmError) return { ...base, task, error: parsed.swarmError };
    if (parsed.swarm && mode === 'B') return { ...base, task, error: 'swarm + mode=B is not supported; swarm workers must stay on the local host' };
    if (!task) return { ...base, task: '', error: 'mode directive needs a task' };
    if (/\bto\s*=/i.test(task)) return { ...base, task, error: '`to=` is not allowed; target comes from worker placement' };
    return { ...base, task, error: null };
}

export function chooseTarget({ mode, localRuntime, placement }) {
    const modes = placement.modes?.length ? placement.modes : ['A', 'B'];
    const allowed = placement.allowedHosts?.length ? placement.allowedHosts : [];
    if (!modes.includes(mode)) throw new Error(`worker ${placement.workerId} does not enable mode ${mode}`);
    const localKeys = new Set([localRuntime, 'main-chat']);
    const rank = (key) => localKeys.has(key) ? 0 : 1;
    const ordered = [...allowed].sort((a, b) => rank(a) - rank(b));
    for (const key of ordered) {
        const local = localKeys.has(key);
        if (mode === 'A' && local) return { runtimeKey: key, local: true };
        if (mode === 'B' && !local) return { runtimeKey: key, local: false };
    }
    throw new Error(mode === 'A'
        ? `no allowed local runtime for worker ${placement.workerId} (allowed: ${allowed.join(', ') || 'none'})`
        : `no allowed remote runtime for worker ${placement.workerId} (allowed: ${allowed.join(', ') || 'none'})`);
}

function requireEnv(name) {
    const value = process.env[name] || '';
    if (!value) throw new Error(`missing ${name}`);
    return value;
}

function hostConfigPath() {
    let dir = process.cwd();
    for (let i = 0; i < 10; i += 1) {
        const candidate = join(dir, '.harness', 'eso-host.json');
        if (existsSync(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error('missing .harness/eso-host.json');
}

function readConfig() {
    const config = JSON.parse(readFileSync(hostConfigPath(), 'utf8'));
    const hosts = config.hosts || {};
    const dshSession = Boolean(process.env.PASEO_AGENT_ID || process.env.DSH_PROFILE);
    const hostArg = dshSession ? 'dsh' : (
        process.argv.find((arg) => arg.startsWith('--host='))?.slice(7)
        || (process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] : '')
        || process.env.ESO_HOST_ID || Object.keys(hosts)[0] || ''
    );
    const hostId = hostArg;
    const host = hosts[hostId] || {};
    return {
        baseUrl: String(config.baseUrl || 'http://127.0.0.1:8787').replace(/\/+$/, ''),
        consumer: String(config.consumer || ''),
        esoRoot: String(process.env.ESO_ROOT || config.esoRoot || ''),
        hostId,
        runtimeKey: String(host.runtimeKey || ''),
        token: String(host.token || ''),
    };
}

function adapterFor(runtimeKey) {
    if (process.env.ESO_ADAPTER) return process.env.ESO_ADAPTER;
    if (runtimeKey.startsWith('agy:')) return 'agy';
    if (runtimeKey.startsWith('cursor:')) return 'cursor';
    if (runtimeKey.startsWith('dsh:') || runtimeKey === 'main-chat') return 'main-chat';
    return 'dry';
}

async function api(config, path) {
    const response = await fetch(`${config.baseUrl}${path}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${config.token}` },
    });
    if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
    return await response.json();
}

function runHostRuntime(esoRoot, args) {
    const cwd = join(esoRoot, 'host-runtime');
    const result = spawnSync('bun', ['src/cli.ts', ...args], { cwd, env: process.env, encoding: 'utf8' });
    if (result.error) throw new Error(result.error.message);
    const text = String(result.stdout || '').trim();
    try { return JSON.parse(text); } catch { throw new Error(`host-runtime did not return JSON (exit ${result.status}): ${text.slice(0, 300)}`); }
}

export async function routeMode(input, options = {}) {
    const parsed = parseModePrompt(input);
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.slp && parsed.mode) throw new Error('SLP + mode is not wired yet; use mode=A|B standalone or run SLP separately');
    if (parsed.slp && !parsed.mode) throw new Error('SLP-only prompts are executed by the SLP skill, not the mode router');
    const config = readConfig();
    if (!config.consumer) throw new Error('missing consumer in .harness/eso-host.json');
    if (!config.esoRoot) throw new Error('missing esoRoot in .harness/eso-host.json (or ESO_ROOT)');

    const snapshot = await api(config, `/api/v1/consumers/${encodeURIComponent(config.consumer)}/config-snapshot?runtimeKey=${encodeURIComponent(config.runtimeKey)}`);
    const flow = snapshot?.flow;
    const flowId = process.env.ESO_FLOW || flow?.id;
    if (!flowId) throw new Error('no default flow configured; set one in Workers or ESO_FLOW');
    const workerId = process.env.ESO_WORKER || flow?.nodes?.[0]?.workerId;
    if (!workerId) throw new Error('default flow has no entry worker; set ESO_WORKER');
    const placement = snapshot?.workerPlacement || [];
    const entry = placement.find((item) => item.workerId === workerId);
    if (!entry) throw new Error(`worker ${workerId} has no placement entry`);
    const target = chooseTarget({ mode: parsed.mode, localRuntime: config.runtimeKey, placement: entry });
    const adapter = adapterFor(target.runtimeKey);
    const traceId = process.env.ESO_TRACE_ID || `mode-${Date.now().toString(36)}`;
    const plan = {
        mode: parsed.mode,
        slp: parsed.slp,
        task: parsed.task,
        consumer: config.consumer,
        flowId,
        workerId,
        target: target.runtimeKey,
        local: target.local,
        adapter,
        traceId,
    };
    if (options.dryRun) return { ok: true, dryRun: true, plan };

    if (target.local) {
        const args = ['run', '--consumer', config.consumer, '--runtime-key', config.runtimeKey,
            '--flow', String(flowId), '--worker', workerId, '--adapter', adapter,
            '--prompt', parsed.task, '--trace-id', traceId, '--max-steps', '1', '--json'];
        return { ok: true, plan, report: runHostRuntime(config.esoRoot, args) };
    }
    const remoteUrl = requireEnv('ESO_REMOTE_URL');
    const remoteToken = requireEnv('ESO_REMOTE_TOKEN');
    const args = ['dispatch', '--consumer', config.consumer,
        '--from-runtime-key', config.runtimeKey, '--to-runtime-key', target.runtimeKey,
        '--flow', String(flowId), '--worker', workerId, '--adapter', adapter,
        '--prompt', parsed.task, '--remote-url', remoteUrl, '--remote-token', remoteToken,
        '--trace-id', traceId, '--job-id', `${traceId}-1`, '--max-steps', '1', '--json'];
    return { ok: true, plan, report: runHostRuntime(config.esoRoot, args) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const args = process.argv.slice(2);
    const prompt = args.includes('--prompt') ? args[args.indexOf('--prompt') + 1] : '';
    try {
        const result = await routeMode(prompt, { dryRun: args.includes('--dry-run') });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exit(0);
    } catch (error) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`);
        process.exit(2);
    }
}
