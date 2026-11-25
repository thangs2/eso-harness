#!/usr/bin/env node
/**
 * Host-side transcript observer for AGY swarm/subagent child conversations.
 *
 * The parent prompt hook records only the parent prompt. AGY swarm and isolated
 * subagents run in separate brain/<conversationId> directories. This hook runs
 * after the parent turn, finds child transcripts assigned by the parent, and posts
 * one prompt.submitted observation per child under the parent trace.
 */
import { createHash } from 'node:crypto';
import { existsSync, appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

if (process.env.ESO_OBSERVE_DISABLED === '1') process.exit(0);


const host = (() => { const i = process.argv.indexOf('--host'); return i >= 0 ? process.argv[i + 1] : 'agy'; })();
const argValue = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : ''; };
const sinceArg = argValue('--since');
let turnStartedAt = sinceArg ? new Date(sinceArg).getTime() : 0;
const root = (() => {
    let dir = process.cwd();
    for (let i = 0; i < 8; i += 1) {
        if (existsSync(join(dir, '.harness', 'eso-host.json'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return process.cwd();
})();
const configPath = join(root, '.harness', 'eso-host.json');
if (!existsSync(configPath)) process.exit(0);
let config;
try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { process.exit(0); }
const hostConfig = config.hosts?.[host];
if (!hostConfig?.token) process.exit(0);

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        setTimeout(() => resolve(data), 1200);
    });
}

const rawInput = await readStdin();
let payload = {};
try { payload = rawInput ? JSON.parse(rawInput) : {}; } catch { payload = {}; }
if (payload.parentConversationId && payload.parentConversationId !== payload.conversationId) process.exit(0);

const LAW_FILE_PATTERN = /(?:^|[\\/])(?:AGENTS|CLAUDE)\.md$/i;
let parentTools = [];
let parentTranscriptPath = typeof payload.transcriptPath === 'string' && existsSync(payload.transcriptPath) ? payload.transcriptPath : '';
let parentInputTokens = 0;
let parentOutputTokens = 0;
let parentModel = '';
const lawReads = new Map();
if (parentTranscriptPath) {
    try {
        const lines = readFileSync(parentTranscriptPath, 'utf8').trim().split('\n');
        let start = -1;
        for (let i = lines.length - 1; i >= 0; i -= 1) {
            let step;
            try { step = JSON.parse(lines[i]); } catch { continue; }
            if (step.type === 'USER_INPUT') { start = i; break; }
        }
        if (start >= 0) {
            const first = JSON.parse(lines[start]);
            if (!turnStartedAt && first.created_at) turnStartedAt = new Date(first.created_at).getTime();
            for (let i = start; i < lines.length; i += 1) {
                let step;
                try { step = JSON.parse(lines[i]); } catch { continue; }
                for (const tool of step.tool_calls || []) {
                    if (!tool?.name) continue;
                    parentTools.push(tool.name);
                    if (!/read|view|cat|open|show/i.test(String(tool.name))) continue;
                    for (const value of Object.values(tool.args || {})) {
                        const candidate = String(value ?? '').replace(/^["']|["']$/g, '').trim();
                        if (LAW_FILE_PATTERN.test(candidate)) lawReads.set(candidate, String(tool.name));
                    }
                    const command = String(tool.args?.CommandLine || tool.args?.command || '');
                    const shellRead = command.match(/(?:^|[;&|]\s*)(?:cat|head|tail|sed|less)\s+[^;&|]*((?:^|[\\/])(?:AGENTS|CLAUDE)\.md)\b/i);
                    if (shellRead) lawReads.set(shellRead[1], String(tool.name));
                }
                if (Number.isFinite(Number(step.input_tokens))) parentInputTokens += Number(step.input_tokens);
                if (Number.isFinite(Number(step.output_tokens))) parentOutputTokens += Number(step.output_tokens);
                if (!parentModel && typeof step.model === 'string' && step.model.trim()) parentModel = step.model.trim();
            }
        }
    } catch { /* optional */ }
}
const modeArg = argValue('--mode');
const isSwarm = modeArg === 'swarm' || (!modeArg && parentTools.some((name) => ['post_message', 'swarm_wait', 'read_board'].includes(name)));
const isSubagent = modeArg === 'subagent' || (!modeArg && parentTools.includes('invoke_subagent'));
// Swarm workers are persistent: their child conversations may predate the turn.
// Isolated subagent children are created during the turn, so keep the tight bound.
if (isSwarm && !sinceArg && turnStartedAt) turnStartedAt -= 15 * 60 * 1000;

let turns = {};
try { turns = JSON.parse(readFileSync(join(root, '.harness', 'hooks', 'eso-turns.json'), 'utf8')); } catch { turns = {}; }
const parentConversationId = argValue('--parent-conversation') || String(payload.conversationId || payload.conversation_id || '');
const parentTraceId = argValue('--trace-id') || String(payload.parentTraceId || payload.traceId || '') || turns[parentConversationId] || '';
if (!parentConversationId || !parentTraceId) process.exit(0);

const home = process.env.HOME || '';
const brainRoots = [
    join(home, '.gemini', 'antigravity', 'brain'),
    join(home, '.gemini', 'antigravity-cli', 'brain'),
    join(home, '.gemini', 'antigravity-ide', 'brain'),
];
const oldest = Date.now() - 24 * 60 * 60 * 1000;
const outbox = join(root, '.harness', 'hooks', 'eso-transcript-outbox.jsonl');
const seen = new Set();
const workersSeen = new Set();

function assignmentFrom(content) {
    const marker = 'content=';
    const index = String(content).lastIndexOf(marker);
    return index >= 0 ? String(content).slice(index + marker.length).trim() : '';
}

function workerIdFrom(text) {
    const direct = text.match(/worker-([a-z0-9-]+)/i);
    if (direct) return `worker-${direct[1].toLowerCase()}`;
    const mention = text.match(/@([a-z][a-z0-9-]{1,24})\b/i);
    return mention ? `worker-${mention[1].toLowerCase()}` : '';
}

for (const brainRoot of brainRoots) {
    if (!existsSync(brainRoot)) continue;
    let entries = [];
    try { entries = readdirSync(brainRoot, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === parentConversationId) continue;
        const transcript = join(brainRoot, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
        if (!existsSync(transcript)) continue;
        try { if (statSync(transcript).mtimeMs < oldest) continue; } catch { continue; }
        let lines = [];
        try { lines = readFileSync(transcript, 'utf8').split('\n'); } catch { continue; }
        for (const line of lines) {
            if (!line.trim()) continue;
            let step;
            try { step = JSON.parse(line); } catch { continue; }
            if (step.type !== 'SYSTEM_MESSAGE') continue;
            const content = String(step.content || '');
            if (!content.includes(`sender=${parentConversationId}`)) continue;
            if (turnStartedAt) {
                const at = Date.parse(String(step.created_at || ''));
                if (Number.isFinite(at) && at < turnStartedAt - 60_000) continue;
            }
            const assignment = assignmentFrom(content);
            const workerId = workerIdFrom(assignment);
            if (!assignment || !workerId) continue;
            if (workersSeen.has(workerId)) continue;
            workersSeen.add(workerId);
            const key = `${parentTraceId}|${entry.name}|${workerId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
            const observation = {
                observationId: `obs-transcript-${hash}`,
                idempotencyKey: `host-transcript:${hash}`,
                traceId: parentTraceId,
                hostId: hostConfig.hostId,
                runtimeKey: hostConfig.runtimeKey,
                workerId,
                event: 'prompt.submitted',
                outcome: 'SUBMITTED',
                at: new Date().toISOString(),
                evidence: {
                    source: 'host-transcript',
                    host: hostConfig.hostId,
                    runtimeKey: hostConfig.runtimeKey,
                    userQuery: assignment.slice(0, 4000),
                    promptText: assignment.slice(0, 4000),
                    conversationId: entry.name,
                    parentConversationId,
                    subagentKind: isSwarm ? 'swarm' : isSubagent ? 'subagent' : 'unknown',
                    executionShape: isSwarm ? 'swarm' : isSubagent ? 'subagent' : 'unknown',
                    swarmScope: isSwarm ? (modeArg === 'swarm' && argValue('--swarm-scope') ? argValue('--swarm-scope') : 'all') : null,
                    boundaryIndex: 0,
                },
            };
            try {
                const response = await fetch(config.baseUrl.replace(/\/+$/, '') + '/api/v1/consumers/' + encodeURIComponent(config.consumer) + '/observations', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + hostConfig.token },
                    body: JSON.stringify(observation),
                    signal: AbortSignal.timeout(3000),
                });
                if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + (await response.text()).slice(0, 250));
            } catch (error) {
                try {
                    mkdirSync(dirname(outbox), { recursive: true });
                    appendFileSync(outbox, JSON.stringify({ observation, error: String(error?.message || error) }) + '\n');
                } catch { /* never block */ }
            }
        }
    }
}
// B — law evidence: the Stop hook is where a completed transcript can prove a real read.
// This is deliberately weaker than decision.recorded.refs: it says "the host read the file",
// not "a decision relied on it". Stage 1 labels the source.
for (const [lawPath, toolName] of lawReads) {
    const relativePath = lawPath.startsWith(root) ? lawPath.slice(root.length + 1) : lawPath.split(/[\\/]/).pop();
    let hash = null;
    try { hash = createHash('sha256').update(readFileSync(lawPath)).digest('hex').slice(0, 16); } catch { /* file may be gone */ }
    const lawId = createHash('sha256').update(`${parentTraceId}|${relativePath}`).digest('hex').slice(0, 16);
    const observation = {
        observationId: `obs-law-${lawId}`,
        idempotencyKey: `host-law-loaded:${parentTraceId}:${lawId}`,
        traceId: parentTraceId,
        hostId: hostConfig.hostId,
        runtimeKey: hostConfig.runtimeKey,
        workerId: 'worker-lead',
        event: 'law.loaded',
        outcome: 'PASS',
        at: new Date().toISOString(),
        evidence: {
            source: 'transcript-read',
            host: hostConfig.hostId,
            runtimeKey: hostConfig.runtimeKey,
            conversationId: parentConversationId,
            path: relativePath,
            hash,
            at: new Date().toISOString(),
            tool: toolName,
        },
    };
    try {
        const response = await fetch(config.baseUrl.replace(/\/+$/, '') + '/api/v1/consumers/' + encodeURIComponent(config.consumer) + '/observations', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + hostConfig.token },
            body: JSON.stringify(observation),
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + (await response.text()).slice(0, 250));
    } catch (error) {
        try {
            mkdirSync(dirname(outbox), { recursive: true });
            appendFileSync(outbox, JSON.stringify({ observation, error: String(error?.message || error) }) + '\n');
        } catch { /* never block */ }
    }
}

// Parent turn completion: the Stop hook is the only place with provider usage + tool calls, so
// post ONE worker.completed for the parent trace. Without it the grid has model but no In/Out/Calls/Tools.
if (parentTranscriptPath && parentConversationId && parentTraceId && (parentInputTokens > 0 || parentOutputTokens > 0 || parentTools.length > 0 || parentModel)) {
    const toolList = [...new Set(parentTools)];
    const completion = {
        observationId: `obs-turn-${parentTraceId.replace(/[^a-zA-Z0-9:_-]/g, '').slice(-48)}`,
        idempotencyKey: `host-turn-complete:${parentTraceId}`,
        traceId: parentTraceId,
        hostId: hostConfig.hostId,
        runtimeKey: hostConfig.runtimeKey,
        workerId: 'worker-lead',
        event: 'worker.completed',
        outcome: 'PASS',
        at: new Date().toISOString(),
        evidence: {
            source: 'host-transcript',
            host: hostConfig.hostId,
            runtimeKey: hostConfig.runtimeKey,
            conversationId: parentConversationId,
            workerId: 'worker-lead',
            adapter: host,
            model: parentModel || null,
            tokenSummary: {
                input: parentInputTokens,
                output: parentOutputTokens,
                estimated: false,
            },
            tools: toolList.map((name) => ({ name })),
            durationMs: turnStartedAt ? Math.max(0, Date.now() - turnStartedAt) : 0,
            hostStep: Number(payload.boundary_index ?? payload.boundaryIndex ?? 0) || 0,
        },
    };
    try {
        const response = await fetch(config.baseUrl.replace(/\/+$/, '') + '/api/v1/consumers/' + encodeURIComponent(config.consumer) + '/observations', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + hostConfig.token },
            body: JSON.stringify(completion),
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + (await response.text()).slice(0, 250));
    } catch (error) {
        try {
            mkdirSync(dirname(outbox), { recursive: true });
            appendFileSync(outbox, JSON.stringify({ observation: completion, error: String(error?.message || error) }) + '\n');
        } catch { /* never block */ }
    }
}
process.exit(0);
