#!/usr/bin/env node
/**
 * DSH SessionStart hook — make AgentMemory visible at the first step, not the third.
 *
 * Why this exists: `AGENTS.md` step 1 says "call memory_smart_search first", and nothing enforced it. The
 * MCP server can also be absent (wrong DSH profile) or dead (container down), and `@agentmemory/mcp` then
 * falls back to `~/.agentmemory/standalone.json` — one file shared by every repo. This hook reports both
 * facts to the model *in the session's first request*, and clears the per-session "memory consulted" marker
 * so `memory-guard.mjs` can hold the first tool call to account.
 *
 * Never blocks: a hook that aborts a session because a container is down creates a worse failure than the
 * one it prevents. `memory-guard.mjs` is where blocking belongs (it can say what to do).
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const LIVEZ_PATH = '/agentmemory/livez';
const STATE_DIR = process.env.DSH_MEMORY_STATE_DIR || join(tmpdir(), 'dsh-memory-first');

/** The workspace mapping lives in the repo the session opened, not in this hook. */
function memoryUrl(cwd) {
    if (process.env.AGENTMEMORY_URL) return process.env.AGENTMEMORY_URL;
    const mcpPath = resolve(cwd || process.cwd(), '.cursor/mcp.json');
    try {
        const cfg = JSON.parse(readFileSync(mcpPath, 'utf8'));
        return cfg?.mcpServers?.['agentmemory-mcp']?.env?.AGENTMEMORY_URL || null;
    } catch {
        return null;
    }
}

async function livez(url) {
    if (!url) return { ok: false, reason: 'no AGENTMEMORY_URL in .cursor/mcp.json' };
    try {
        const res = await fetch(`${String(url).replace(/\/+$/, '')}${LIVEZ_PATH}`, {
            signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) return { ok: false, reason: `livez HTTP ${res.status}` };
        return { ok: true, url };
    } catch (err) {
        return { ok: false, reason: String(err?.message || err).slice(0, 120) };
    }
}

function readStdin() {
    try {
        return JSON.parse(readFileSync(0, 'utf8') || '{}');
    } catch {
        return {};
    }
}

const payload = readStdin();
const cwd = payload.cwd || process.cwd();
const session = String(payload.session_id || payload.sessionId || 'default').replace(/[^\w.-]/g, '_');

// A resumed session may inherit yesterday's marker; the point is "memory consulted in THIS session".
try {
    mkdirSync(STATE_DIR, { recursive: true });
    rmSync(join(STATE_DIR, `${session}.done`), { force: true });
} catch {
    /* state is advisory; never fail the session start */
}

const url = memoryUrl(cwd);
const health = await livez(url);
const lines = [];
if (health.ok) {
    lines.push(`AgentMemory server OK at ${url}.`);
    lines.push('AGENTS.md step 1: call memory_smart_search before any other tool. The PreToolUse guard blocks the first non-memory tool until you do.');
} else {
    lines.push(`AgentMemory server NOT reachable (${health.reason}).`);
    lines.push('Do not write memories: without a server the shim falls back to ~/.agentmemory/standalone.json, a store shared by every repo.');
    lines.push('Start it (e.g. the agentmemory container mapped to this repo) or run `node scripts/check-dsh-memory.mjs` for the exact target.');
}

const additionalContext = lines.join(' ');
process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }) + '\n',
);
