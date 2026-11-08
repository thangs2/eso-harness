#!/usr/bin/env node
/**
 * Is AgentMemory actually mounted and reachable for THIS workspace? Run it when a session feels memory-blind.
 *
 * Four questions, because "DSH has agentmemory" is meaningless without a profile name (AGENTS.md measured this
 * twice: a merged capability cell hid the memory tools on one profile, and the Paseo profile mounted none of them):
 *   1. does the active DSH profile depend on @local/agentmemory-mcp-plugin?
 *   2. does this workspace's .cursor/mcp.json point at a server (per-repo port, not a default)?
 *   3. does that server answer GET /agentmemory/livez?
 *   4. is the repo hook config present, so the first tool call is actually held to the rule?
 *
 * Exit 0 = all four yes. Exit 1 = a real gap, printed with the command that fixes it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(process.argv[2] || process.cwd());
const profile = process.env.DSH_PROFILE || process.env.DSH_PROFILE_NAME || 'desktop';
const lines = [];
const problems = [];

function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

// 1) profile dependency
const profileDir = join(homedir(), '.dsh', 'profiles', profile);
const pkg = readJson(join(profileDir, 'package.json'));
const deps = Object.keys(pkg?.dependencies || {});
if (deps.includes('@local/agentmemory-mcp-plugin')) {
    lines.push(`profile ${profile}: @local/agentmemory-mcp-plugin mounted`);
} else {
    problems.push(
        `profile ${profile} does not depend on @local/agentmemory-mcp-plugin — run ` +
            `node scripts/setup-paseo-profile.mjs (paseo) or add the dependency to ${profileDir}/package.json`,
    );
}

// 2) workspace → server mapping
const mcp = readJson(join(repo, '.cursor/mcp.json'));
const url = mcp?.mcpServers?.['agentmemory-mcp']?.env?.AGENTMEMORY_URL || null;
if (url) lines.push(`workspace mapping: ${url}`);
else problems.push(`${repo}/.cursor/mcp.json has no agentmemory-mcp AGENTMEMORY_URL — memories would go to a shared fallback store`);

// 3) server liveness
if (url) {
    try {
        const res = await fetch(`${url.replace(/\/+$/, '')}/agentmemory/livez`, { signal: AbortSignal.timeout(2000) });
        const body = res.ok ? await res.text() : '';
        if (res.ok && /"status"\s*:\s*"ok"/.test(body)) lines.push(`server livez: ok (${url})`);
        else problems.push(`server at ${url} answered ${res.status} — start the agentmemory container for this repo`);
    } catch (err) {
        problems.push(`server at ${url} is unreachable (${String(err?.message || err).slice(0, 80)}) — start the agentmemory container`);
    }
}

// 4) hook wiring
const hookCfg = readJson(join(repo, '.claude/hooks.json'));
const hooks = hookCfg?.hooks || {};
const has = (event) => Array.isArray(hooks[event]) && hooks[event].length > 0;
if (has('SessionStart') && has('PreToolUse') && has('PostToolUse')) {
    lines.push('repo hooks: SessionStart + PreToolUse + PostToolUse wired (.claude/hooks.json)');
} else {
    problems.push(`${repo}/.claude/hooks.json is missing one of SessionStart/PreToolUse/PostToolUse`);
}

// 5) silently-shared fallback store
const fallback = join(homedir(), '.agentmemory', 'standalone.json');
if (existsSync(fallback)) {
    lines.push(`note: ${fallback} exists — that is the shared fallback store; its presence means some session wrote without a server`);
}

for (const line of lines) console.log(`  ok   ${line}`);
for (const problem of problems) console.error(`  FAIL ${problem}`);
process.exit(problems.length ? 1 : 0);
