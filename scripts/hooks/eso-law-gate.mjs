#!/usr/bin/env node
/**
 * Law gate — fail-closed PreToolUse guard.
 *
 * AGY's own `.agents/rules/core.law-gate.md` says the agent MUST read `AGENTS.md` before
 * planning/writing, but nothing enforced it: a turn could run tools without ever opening the law
 * file (trace 33c93d3c). This guard turns the rule into a check:
 *
 *   - a read tool targeting AGENTS.md / CLAUDE.md is allowed;
 *   - a shell command that only reads one of those files is allowed;
 *   - once the transcript proves such a read happened, tools are allowed;
 *   - everything else is denied with a reason, so the agent must read the law first.
 *
 * Fail-closed: missing transcript, unreadable payload or a missing law file denies non-law tools.
 * The guard never runs a model and never writes observations.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const host = (() => { const i = process.argv.indexOf('--host'); return i >= 0 ? process.argv[i + 1] : 'agy'; })();
const lawNames = ['AGENTS.md', 'CLAUDE.md'];

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        setTimeout(() => resolve(data), 1200);
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

function decode(value) {
    return String(value ?? '').replace(/^["']|["']$/g, '').trim();
}

function isLawPath(candidate) {
    const value = decode(candidate).replace(/\\/g, '/');
    return lawNames.some((name) => value === name || value.endsWith(`/${name}`));
}

function toolName(data) {
    const call = data?.toolCall && typeof data.toolCall === 'object' ? data.toolCall : null;
    return decode(data?.tool_name ?? data?.toolName ?? call?.name ?? call?.tool ?? '');
}

function toolArgs(data) {
    const call = data?.toolCall && typeof data.toolCall === 'object' ? data.toolCall : null;
    for (const value of [call?.args, data?.tool_input, data?.input, data?.arguments]) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
    return {};
}

function commandOf(args) {
    return decode(args?.CommandLine ?? args?.command ?? args?.cmd ?? '');
}

function transcriptCandidates(data, conversationId) {
    const out = [];
    for (const value of [data?.transcriptPath, data?.transcript_path, data?.session?.transcriptPath]) {
        const path = decode(value);
        if (path) out.push(path);
    }
    if (conversationId) {
        const home = process.env.HOME || '';
        for (const base of ['antigravity', 'antigravity-cli', 'antigravity-ide']) {
            out.push(join(home, '.gemini', base, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl'));
        }
    }
    return out.filter((path) => existsSync(path));
}

function transcriptProvesRead(path) {
    let lines;
    try { lines = readFileSync(path, 'utf8').split('\n'); } catch { return false; }
    for (const line of lines) {
        if (!line.trim()) continue;
        let step;
        try { step = JSON.parse(line); } catch { continue; }
        for (const tool of step.tool_calls || []) {
            const name = decode(tool?.name);
            if (!/read|view|cat|open|show/i.test(name)) continue;
            const args = tool?.args && typeof tool.args === 'object' ? tool.args : {};
            for (const value of Object.values(args)) {
                if (typeof value === 'string' && isLawPath(value)) return true;
            }
            const command = commandOf(args);
            if (/(?:^|[;&|]\s*)(?:cat|head|tail|sed|less|bat)\s+[^;&|]*\b(?:AGENTS|CLAUDE)\.md\b/i.test(command)) return true;
        }
    }
    return false;
}

function output(allow, reason) {
    if (host === 'cursor' || host === 'claude' || host === 'dsh') {
        if (allow) process.stdout.write('{"permission":"allow"}\n');
        else process.stdout.write(`${JSON.stringify({ permission: 'deny', user_message: reason, agent_message: reason })}\n`);
        return;
    }
    if (allow) process.stdout.write('{"decision":"allow"}\n');
    else process.stdout.write(`${JSON.stringify({ decision: 'deny', reason })}\n`);
}

function deny(reason) {
    output(false, reason);
    process.exit(0);
}

const raw = await readStdin();
let data;
try { data = raw.trim() ? JSON.parse(raw) : {}; } catch { deny('Law gate: invalid hook payload (fail-closed). Read AGENTS.md, then retry.'); }

const root = findRoot();
const presentLaws = lawNames.filter((name) => existsSync(join(root, name)));
if (presentLaws.length === 0) {
    deny('Law gate: AGENTS.md and CLAUDE.md are both missing at the repository root. Restore the law file before using tools.');
}

const conversationId = decode(data?.conversationId ?? data?.conversation_id ?? data?.session_id ?? '');
const name = toolName(data);
const args = toolArgs(data);
const command = commandOf(args);

const isReadTool = /read|view|cat|open|show/i.test(name);
const targetLaw = Object.values(args).some((value) => typeof value === 'string' && isLawPath(value));
const shellReadsLaw = /(?:^|[;&|]\s*)(?:cat|head|tail|sed|less|bat)\s+[^;&|]*\b(?:AGENTS|CLAUDE)\.md\b/i.test(command);

if (isReadTool && targetLaw) output(true);
else if (shellReadsLaw) output(true);
else {
    const proved = transcriptCandidates(data, conversationId).some(transcriptProvesRead);
    if (proved) output(true);
    else deny(`Law gate: read ${presentLaws.join(' or ')} before using "${name || 'any tool'}". Allowed now: read_file with path ${presentLaws[0]} (or: cat ${presentLaws[0]}).`);
}
process.exit(0);
