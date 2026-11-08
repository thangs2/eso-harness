#!/usr/bin/env node
/**
 * DSH hook — memory-first, enforced at the only place that can enforce it: the tool call.
 *
 * `--pre`  (PreToolUse, matcher *)   exit 2 blocks the tool call and shows the reason.
 * `--post` (PostToolUse, memory_*)   marks this session as "memory consulted".
 *
 * Two states are blocked:
 *   1. the memory server is not answering — because the MCP shim would then write into
 *      `~/.agentmemory/standalone.json`, shared by every repo (measured: several repos' memories in one file);
 *   2. the server is fine but this session has not called `memory_smart_search` yet.
 *
 * Fail-open on purpose for everything else: a hook that breaks unrelated tool calls is worse than a rule that is
 * sometimes skipped. Every unexpected path exits 0.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const MODE = process.argv.includes('--post') ? 'post' : 'pre';
const LIVEZ_PATH = '/agentmemory/livez';
const STATE_DIR = process.env.DSH_MEMORY_STATE_DIR || join(tmpdir(), 'dsh-memory-first');

function readStdin() {
    try {
        return JSON.parse(readFileSync(0, 'utf8') || '{}');
    } catch {
        return {};
    }
}

function memoryUrl(cwd) {
    if (process.env.AGENTMEMORY_URL) return process.env.AGENTMEMORY_URL;
    try {
        const cfg = JSON.parse(readFileSync(resolve(cwd || process.cwd(), '.cursor/mcp.json'), 'utf8'));
        return cfg?.mcpServers?.['agentmemory-mcp']?.env?.AGENTMEMORY_URL || null;
    } catch {
        return null;
    }
}

async function healthy(url) {
    if (!url) return false;
    try {
        const res = await fetch(`${String(url).replace(/\/+$/, '')}${LIVEZ_PATH}`, {
            signal: AbortSignal.timeout(1200),
        });
        return res.ok;
    } catch {
        return false;
    }
}

function stateFile(session) {
    return join(STATE_DIR, `${session}.done`);
}

function block(reason) {
    process.stderr.write(reason + '\n');
    process.exit(2);
}

const payload = readStdin();
const cwd = payload.cwd || process.cwd();
const session = String(payload.session_id || payload.sessionId || 'default').replace(/[^\w.-]/g, '_');
const tool = String(payload.tool_name || payload.toolName || '');

try {
    if (MODE === 'post') {
        if (tool.startsWith('memory_')) {
            mkdirSync(STATE_DIR, { recursive: true });
            writeFileSync(stateFile(session), new Date().toISOString() + '\n');
        }
        process.exit(0);
    }

    // A memory tool is the way out of the guard: let it through even when the marker is missing.
    if (tool.startsWith('memory_')) process.exit(0);
    if (existsSync(stateFile(session))) process.exit(0);

    const url = memoryUrl(cwd);
    if (!(await healthy(url))) {
        block(
            `AgentMemory server is not reachable${url ? ` at ${url}` : ''}. Refusing non-memory tools, because a ` +
                'dead server makes the MCP shim write into ~/.agentmemory/standalone.json — a store shared by every repo. ' +
                'Start the agentmemory container for this repo, then run `node scripts/check-dsh-memory.mjs`.',
        );
    }
    block(
        'AGENTS.md step 1: call memory_smart_search before any other tool in this session ' +
            `(server OK at ${url}). This is a block, not a reminder — the marker is per session.`,
    );
} catch {
    process.exit(0);
}
