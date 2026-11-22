#!/usr/bin/env node
/**
 * One-shot, idempotent host setup for ESO consumers.
 *
 * - ensures host bindings (hostProfiles) for agy / cursor / dsh
 * - issues a scoped host token per consumer+runtime (stored machine-local under .harness/)
 * - installs a prompt-observation hook into the host tree
 *
 * ESO stays observability-only: this script writes observations; it never runs a model or a flow.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.ESO_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const AUTH = process.env.ESO_OPERATOR_TOKEN || process.env.ESO_AUTH_TOKEN || 'eso-dev-only-token';
const AUTH_HEADER = process.env.ESO_OPERATOR_AUTH || `Basic ${Buffer.from(`operator:${AUTH}`).toString('base64')}`;
const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
    const idx = process.argv.indexOf('--only');
    return idx >= 0 ? (process.argv[idx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : null;
})();

const HOSTS = {
    agy: { runtimeId: 'agy', runtimeKey: 'agy:agy', mcpConfigSource: '.agents/mcp_config.json', hookFile: '.agents/hooks.json', tree: '.agents' },
    cursor: { runtimeId: 'cursor-agent', runtimeKey: 'cursor:cursor-agent', mcpConfigSource: '.cursor/mcp.json', hookFile: '.cursor/hooks.json', tree: '.cursor' },
    dsh: { runtimeId: 'main-chat', runtimeKey: 'dsh:main-chat', mcpConfigSource: '.claude/settings.json', hookFile: '.claude/hooks.json', tree: '.claude' },
};

// baplatform is intentionally AGY-only. Everything else gets all three hosts.
const CONSUMERS = {
    fineso: ['agy', 'cursor', 'dsh'],
    x79: ['agy', 'cursor', 'dsh'],
    baplatform: ['agy'],
    atrievefin: ['agy', 'cursor', 'dsh'],
    testeso: ['agy', 'cursor', 'dsh'],
};

const OBSERVE_HOOK = String.raw`#!/usr/bin/env node
/**
 * Host-side prompt observer. Installed by ESO setup; runs inside the consumer repo.
 * Reads the host hook payload from stdin and appends one prompt.submitted observation.
 * It never blocks the host: on any error it buffers locally and exits 0.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

if (process.env.ESO_OBSERVE_DISABLED === '1') process.exit(0);
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = (() => {
    const i = process.argv.indexOf('--host');
    return i >= 0 ? process.argv[i + 1] : '';
})();

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        setTimeout(() => resolve(data), 1500);
    });
}

function findRoot() {
    let dir = process.cwd();
    for (let i = 0; i < 8; i += 1) {
        if (existsSync(join(dir, '.harness', 'eso-host.json'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return process.cwd();
}

const root = findRoot();
const configPath = join(root, '.harness', 'eso-host.json');
if (!existsSync(configPath)) process.exit(0);
let config;
try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { process.exit(0); }
const hostConfig = config.hosts?.[host];
if (!hostConfig?.token) process.exit(0);

function strip(value) {
    return String(value || '')
        .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, ' ')
        .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const input = await readStdin();
let payload = {};
try { payload = input ? JSON.parse(input) : {}; } catch { payload = {}; }

let prompt = payload.prompt ?? payload.user_message ?? payload.message ?? payload.userQuery ?? payload.user_query ?? '';
if (!prompt && typeof payload.transcriptPath === 'string' && existsSync(payload.transcriptPath)) {
    try {
        const lines = readFileSync(payload.transcriptPath, 'utf8').trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i -= 1) {
            const line = lines[i].trim();
            if (!line) continue;
            const step = JSON.parse(line);
            if (step.type === 'USER_INPUT' && step.content) { prompt = step.content; break; }
        }
    } catch { /* ignore */ }
}
const text = strip(prompt).slice(0, 4000);
if (!text) process.exit(0);

const conversationId = String(payload.conversation_id ?? payload.conversationId ?? payload.session_id ?? payload.sessionId ?? '');
const generationId = String(payload.generation_id ?? payload.generationId ?? '');
const boundaryIndex = Number(payload.boundary_index ?? payload.boundaryIndex ?? 0) || 0;
const hash = createHash('sha256').update(conversationId + '|' + generationId + '|' + text).digest('hex').slice(0, 24);
// A conversation is not a request. One turn/prompt must have its own trace, otherwise
// every prompt in the same AGY conversation collapses into the first request row.
const traceId = String(payload.traceId ?? payload.trace_id ?? '') || (conversationId ? conversationId + ':' + hash.slice(0, 8) : generationId || ('host-' + host + '-' + new Date().toISOString().slice(0, 10)));
if (conversationId) {
    try {
        const mapPath = join(root, '.harness', 'hooks', 'eso-turns.json');
        const map = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, 'utf8')) : {};
        map[conversationId] = traceId;
        writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n', 'utf8');
    } catch { /* hook must never block */ }
}
const observation = {
    observationId: 'obs-' + host + '-' + hash,
    idempotencyKey: 'host-hook:' + host + ':' + hash,
    traceId,
    hostId: hostConfig.hostId,
    runtimeKey: hostConfig.runtimeKey,
    workerId: 'worker-lead',
    event: 'prompt.submitted',
    outcome: 'SUBMITTED',
    at: new Date().toISOString(),
    evidence: {
        source: 'host-hook',
        host: hostConfig.hostId,
        runtimeKey: hostConfig.runtimeKey,
        userQuery: text,
        promptText: text,
        conversationId,
        generationId,
        boundaryIndex,
    },
};

const outbox = join(root, '.harness', 'hooks', 'eso-observe-outbox.jsonl');
try {
    const response = await fetch(config.baseUrl.replace(/\/+$/, '') + '/api/v1/consumers/' + encodeURIComponent(config.consumer) + '/observations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + hostConfig.token },
        body: JSON.stringify(observation),
        signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) { const body = await response.text(); throw new Error('HTTP ' + response.status + ' ' + body.slice(0, 300)); }
} catch (error) {
    try {
        mkdirSync(dirname(outbox), { recursive: true });
        appendFileSync(outbox, JSON.stringify({ observation, error: String(error?.message || error) }) + '\n');
    } catch { /* ignore */ }
}
process.exit(0);
`;

const INGEST_HOOK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'hooks', 'eso-transcript-ingest.mjs'), 'utf8');

function headers() {
    return { authorization: AUTH_HEADER, 'content-type': 'application/json' };
}

async function api(method, path, body) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${String(text).slice(0, 300)}`);
    return data;
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

function mergeList(existing, incoming, key) {
    const list = Array.isArray(existing) ? [...existing] : [];
    for (const item of incoming) {
        const idx = list.findIndex((candidate) => key(candidate) === key(item));
        if (idx >= 0) list[idx] = { ...list[idx], ...item }; else list.push(item);
    }
    return list;
}

function normalizeAgyHookCommands(hooks) {
    // AGY runs hook commands with cwd = the directory containing hooks.json,
    // i.e. <repo>/.agents. Legacy harness commands are written root-relative
    // (`.agents/hooks/...`) and therefore resolve to `.agents/.agents/...`.
    // Normalize them to run from the repo root exactly once.
    const wrap = (command) => {
        if (typeof command !== 'string') return command;
        if (command.includes('${PWD%/.agents}')) return command;
        const match = command.match(/^(node|python3|bun)\s+(\.agents\/[^]+)$/);
        if (!match) return command;
        return `bash -lc 'cd "\${PWD%/.agents}"; exec ${match[1]} ${match[2]}'`;
    };
    const visit = (value) => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
        } else if (value && typeof value === 'object') {
            if (typeof value.command === 'string') value.command = wrap(value.command);
            for (const item of Object.values(value)) visit(item);
        }
    };
    visit(hooks);
    return hooks;
}

function installHook(rootPath, host, token, runtimeKey, consumerId) {
    const spec = HOSTS[host];
    const hookDir = join(rootPath, '.harness', 'hooks');
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(hookDir, 'eso-observe.mjs'), OBSERVE_HOOK, 'utf8');
    writeFileSync(join(hookDir, 'eso-transcript-ingest.mjs'), INGEST_HOOK, 'utf8');

    const configFile = join(rootPath, '.harness', 'eso-host.json');
    const current = existsSync(configFile) ? readJson(configFile) : { baseUrl: BASE, consumer: '', hosts: {} };
    current.baseUrl = BASE;
    current.consumer = consumerId;
    current.hosts = current.hosts || {};
    current.hosts[host] = { hostId: host, runtimeKey, token };
    writeJson(configFile, current);

    const hookFile = join(rootPath, spec.hookFile);
    const hooks = existsSync(hookFile) ? readJson(hookFile) : {};
    if (host === 'agy') normalizeAgyHookCommands(hooks);
    // Antigravity may spawn hooks with cwd = <repo>/.agents instead of <repo>.
    // Strip the suffix before resolving the relative script path.
    const command = host === 'agy'
        ? `bash -lc 'cd "\${PWD%/.agents}"; exec node .harness/hooks/eso-observe.mjs --host agy'`
        : `node .harness/hooks/eso-observe.mjs --host ${host}`;

    if (host === 'agy') {
        // AGY's hooks schema is a flat map of hook name -> events. The legacy `version`
        // key is not part of that schema and can make the whole file fail to load.
        delete hooks.version;
        hooks['eso-observation'] = {
            PreInvocation: [{ type: 'command', command }],
        };
        const ingestCommand = `bash -lc 'cd "\${PWD%/.agents}"; exec node .harness/hooks/eso-transcript-ingest.mjs --host agy'`;
        hooks['eso-transcript-ingest'] = {
            Stop: [{ type: 'command', command: ingestCommand }],
        };
    } else if (host === 'cursor') {
        hooks.version = hooks.version ?? 1;
        hooks.hooks = hooks.hooks || {};
        hooks.hooks.beforeSubmitPrompt = mergeList(hooks.hooks.beforeSubmitPrompt, [{ command }], (item) => item?.command || '');
    } else if (host === 'dsh') {
        hooks.hooks = hooks.hooks || {};
        const entry = { hooks: [{ type: 'command', command }] };
        hooks.hooks.UserPromptSubmit = mergeList(hooks.hooks.UserPromptSubmit, [entry], (item) => JSON.stringify(item?.hooks?.[0]?.command || item));
    }
    writeJson(hookFile, hooks);
    const written = readJson(hookFile);
    const collectCommands = (value, out = []) => {
        if (Array.isArray(value)) {
            for (const item of value) collectCommands(item, out);
        } else if (value && typeof value === 'object') {
            if (typeof value.command === 'string') out.push(value.command);
            for (const item of Object.values(value)) collectCommands(item, out);
        }
        return out;
    };
    if (!collectCommands(written).includes(command)) {
        throw new Error(`hook registration missing in ${hookFile} for ${host}`);
    }
    return { hookFile, command, observeScript: join(hookDir, 'eso-observe.mjs') };
}

async function ensureHostProfile(profile, consumerId, host, stackVersion) {
    const spec = HOSTS[host];
    const hostProfiles = Array.isArray(profile?.settings?.harness?.hostProfiles) ? profile.settings.harness.hostProfiles : [];
    const existing = hostProfiles.find((item) => item.hostId === host || item.hostPluginId === host);
    const binding = {
        id: `hp-${consumerId}-${host}`,
        userId: 'operator',
        hostId: host,
        stackVersion: existing?.stackVersion || stackVersion,
        memorySource: existing?.memorySource || 'eso-native',
        codeGraphSource: existing?.codeGraphSource || 'eso-native',
        mcpConfigSource: spec.mcpConfigSource,
        installState: 'installed',
        detected: false,
    };
    const next = existing ? hostProfiles.map((item) => (item === existing ? { ...item, ...binding } : item)) : [...hostProfiles, binding];
    return { next, bindingId: binding.id };
}

async function provisionWorkers(consumerId, bindingIds, hosts) {
    if (!APPLY || bindingIds.length === 0) return { workers: 0, placements: 0 };
    const runtimeKeys = hosts.map((host) => HOSTS[host].runtimeKey);
    const config = await api('GET', `/api/v1/consumers/${consumerId}/workers`);
    const workers = Array.isArray(config?.workers) ? config.workers : [];
    const bindingSet = new Set(bindingIds);
    const needsBinding = workers.filter((worker) => {
        const ids = Array.isArray(worker.hostBindingIds) ? worker.hostBindingIds : [];
        return ids.length === 0 || ids.some((id) => !bindingSet.has(id));
    });
    if (needsBinding.length > 0) {
        await api('PUT', `/api/v1/consumers/${consumerId}/workers`, {
            workers: workers.map((worker) => {
                const ids = Array.isArray(worker.hostBindingIds) ? worker.hostBindingIds : [];
                return {
                    ...worker,
                    hostBindingIds: ids.length > 0 && ids.every((id) => bindingSet.has(id)) ? ids : [...bindingIds],
                };
            }),
        });
    }
    const existing = await api('GET', `/api/v1/consumers/${consumerId}/worker-placement`).catch(() => ({ items: [] }));
    const placed = new Set((existing.items || []).filter((item) => Array.isArray(item.allowedHosts) && item.allowedHosts.length > 0).map((item) => item.workerId));
    let placements = 0;
    for (const worker of workers) {
        if (placed.has(worker.id)) continue;
        await api('PUT', `/api/v1/consumers/${consumerId}/workers/${worker.id}/placement`, {
            allowedHosts: runtimeKeys,
            modelTier: 'balanced',
            nativeAgent: {},
            fallback: 'block',
        });
        placements += 1;
    }
    return { workers: needsBinding.length, placements };
}

function actualProfile(profile) {
    // GET /consumers/:id wraps the profile in consumer metadata. PUT expects the
    // canonical profile object itself; passing the wrapper nests another `profile`.
    let current = profile;
    for (let i = 0; i < 20; i += 1) {
        const child = current && typeof current === 'object' ? current.profile : null;
        if (!child || typeof child !== 'object') break;
        if (child.canonical || child.settings || child.observation) current = child;
        else break;
    }
    return current && typeof current === 'object' ? current : {};
}

async function setupConsumer(consumerId, hosts) {
    const consumer = await api('GET', `/api/v1/consumers/${consumerId}`);
    const root = consumer.root;
    if (!root || !existsSync(root)) throw new Error(`missing consumer root: ${root}`);
    const profile = actualProfile(consumer.profile || {});
    const settings = profile.settings || (profile.settings = {});
    const harness = settings.harness || (settings.harness = {});
    const currentProfiles = Array.isArray(harness.hostProfiles) ? harness.hostProfiles : [];
    const stackVersions = await api('GET', `/api/v1/consumers/${consumerId}/stack-versions`).catch(() => ({ items: [] }));
    const published = (stackVersions.items || []).filter((item) => item.status === 'published').sort((a, b) => b.version - a.version);
    const stackVersion = published[0]?.version || currentProfiles[0]?.stackVersion || 1;

    const nextProfiles = currentProfiles.filter((item) => hosts.includes(item.hostId || item.hostPluginId));
    const bindingIds = [];
    for (const host of hosts) {
        const { next, bindingId } = await ensureHostProfile({ settings: { harness: { hostProfiles: nextProfiles } } }, consumerId, host, stackVersion);
        nextProfiles.splice(0, nextProfiles.length, ...next);
        bindingIds.push(bindingId);
    }
    harness.hostProfiles = nextProfiles;
    harness.developers = ['operator'];
    harness.formationHostIds = [...bindingIds];
    const plugins = Array.isArray(harness.plugins) ? harness.plugins : [];
    for (const host of hosts) {
        const label = host === 'agy' ? 'Antigravity' : host === 'cursor' ? 'Cursor' : 'DSH';
        if (!plugins.some((item) => item.id === host)) {
            plugins.push({ id: host, label, type: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'hooks', 'mcp'], status: 'installed' });
        }
    }
    harness.plugins = plugins;

    if (!APPLY) return { consumerId, root, hosts, dryRun: true };
    await api('PUT', `/api/v1/consumers/${consumerId}`, { profile, expected_version: consumer.version });
    const provisioned = await provisionWorkers(consumerId, bindingIds, hosts);

    const installed = [];
    for (const host of hosts) {
        const spec = HOSTS[host];
        const issued = await api('POST', `/api/v1/hosts/${host}/runtimes/${spec.runtimeId}/tokens`, { consumerId });
        const hook = installHook(root, host, issued.token, spec.runtimeKey, consumerId);
        installed.push({ host, runtimeKey: spec.runtimeKey, tokenId: issued.tokenId, hookFile: hook.hookFile });
    }
    return { consumerId, root, hosts, provisioned, installed };
}

let failed = false;
for (const [consumerId, hosts] of Object.entries(CONSUMERS)) {
    if (ONLY && !ONLY.includes(consumerId)) continue;
    try {
        const result = await setupConsumer(consumerId, hosts);
        console.log(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
        failed = true;
        console.error(JSON.stringify({ ok: false, consumerId, error: String(error?.message || error) }));
    }
}
process.exit(failed ? 1 : 0);
