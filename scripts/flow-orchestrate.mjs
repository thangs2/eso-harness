#!/usr/bin/env node
/**
 * Host-side cross-host flow orchestrator (Mode A + Mode B).
 *
 * ESO stays a sidecar: this script reads the published flow/placement from ESO and invokes host
 * runtimes one worker at a time. It is intentionally outside ESO control-plane code.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostRuntime = join(root, 'host-runtime');
const env = process.env;
const base = (env.ESO_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const consumer = env.ESO_CONSUMER;
const flowId = env.ESO_FLOW;
const prompt = env.ESO_PROMPT;
const runtimeKey = env.ESO_RUNTIME_KEY;
const remoteToken = env.ESO_REMOTE_TOKEN;
const remoteHosts = JSON.parse(env.ESO_REMOTE_HOSTS || '{}');
const fallbackHosts = String(env.ESO_FALLBACK_HOSTS || 'agy:agy,cursor:cursor-agent,main-chat').split(',').map((item) => item.trim()).filter(Boolean);
const workspaceRepo = env.ESO_WORKSPACE_REPO;
const operator = env.ESO_OPERATOR_TOKEN;
const maxSteps = Number(env.ESO_MAX_STEPS || 12);
const maxRepeats = Number(env.ESO_MAX_REPEATS || 1);
const traceId = env.ESO_TRACE_ID || randomUUID();
if (!consumer || !flowId || !prompt || !runtimeKey || !operator || !remoteToken) {
    console.error('missing env: ESO_CONSUMER/ESO_FLOW/ESO_PROMPT/ESO_RUNTIME_KEY/ESO_OPERATOR_TOKEN/ESO_REMOTE_TOKEN');
    process.exit(2);
}
const headers = { authorization: `Basic ${Buffer.from(`operator:${operator}`).toString('base64')}` };
async function get(path) {
    const res = await fetch(`${base}${path}`, { headers });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return res.json();
}
function run(command, args) {
    const result = spawnSync(command, args, { cwd: hostRuntime, env, encoding: 'utf8' });
    if (result.error) throw result.error;
    let parsed = null;
    try { parsed = JSON.parse(result.stdout); } catch {}
    if (!parsed) {
        process.stderr.write(result.stderr || result.stdout || '');
        throw new Error(`${command} did not return JSON (exit ${result.status})`);
    }
    return parsed;
}
const flow = await get(`/api/v1/consumers/${consumer}/flows/${flowId}`);
if (flow.status !== 'published') throw new Error(`flow ${flowId} is ${flow.status}, not published`);
const placement = await get(`/api/v1/consumers/${consumer}/worker-placement`);
const byWorker = new Map((placement.items || []).map((item) => [item.workerId, item.allowedHosts || []]));
const edges = flow.edges || [];
const taskType = String(env.ESO_TASK_TYPE || flow.taskType || 'build').toLowerCase();
const first = flow.nodes?.[0]?.workerId;
if (!first) throw new Error('flow has no nodes');
let workerId = first;
const trail = [];
const seen = new Map();
const dry = env.ESO_DRY !== '0';

function candidatesFor(workerId) {
    const allowed = byWorker.get(workerId) || [];
    const ordered = [];
    for (const key of allowed) {
        if (key === runtimeKey || remoteHosts[key]) ordered.push(key);
    }
    for (const key of fallbackHosts) {
        if (!ordered.includes(key) && (key === runtimeKey || key === 'main-chat' || remoteHosts[key])) ordered.push(key);
    }
    return ordered;
}

function executeOnce(workerId, target, step) {
    const local = target === runtimeKey || target === 'main-chat';
    const adapter = target === 'main-chat' ? 'main-chat' : (env.ESO_ADAPTER || (target.startsWith('agy:') ? 'agy' : 'cursor'));
    if (local) {
        const report = run('bun', ['src/cli.ts', 'run', '--consumer', consumer, '--runtime-key', runtimeKey, '--flow', flowId, '--worker', workerId, '--adapter', adapter, ...(dry ? ['--dry-run'] : []), '--max-steps', '1', '--prompt', prompt, '--trace-id', traceId, '--job-id', `${traceId}-${step}`, '--task-type', taskType, '--json']);
        if (report.error) return { local: true, target, outcome: 'BLOCKED', failureKind: 'INFRA', errorCode: report.error.code || 'LOCAL_RUN_FAILED', detail: { local: true, error: report.error.message } };
        const last = report.steps?.[report.steps.length - 1];
        return {
            local: true,
            target,
            outcome: last?.outcome ?? (report.ok ? 'PASS' : 'BLOCKED'),
            failureKind: last?.failureKind,
            errorCode: last?.errorCode,
            detail: { local: true, observationId: last?.observationId, stoppedReason: report.stoppedReason },
        };
    }
    try {
        const report = run('bun', ['src/cli.ts', 'dispatch', '--consumer', consumer, '--from-runtime-key', runtimeKey, '--to-runtime-key', target, '--flow', flowId, '--worker', workerId, '--adapter', adapter, ...(dry ? ['--dry-run'] : []), '--max-steps', '1', '--prompt', prompt, '--remote-url', remoteHosts[target], '--remote-token', remoteToken, '--workspace-repo', workspaceRepo, '--trace-id', traceId, '--job-id', `${traceId}-${step}`, '--task-type', taskType, '--json']);
        if (report.error) return { local: false, target, outcome: 'BLOCKED', failureKind: 'INFRA', errorCode: report.error.code || 'DISPATCH_FAILED', detail: { local: false, error: report.error.message } };
        return {
            local: false,
            target,
            outcome: report.outcome ?? (report.ok ? 'PASS' : 'BLOCKED'),
            failureKind: report.failureKind,
            errorCode: report.errorCode,
            detail: { local: false, remoteObservationId: report.remoteObservationId, localObservationId: report.localObservationId },
        };
    } catch (error) {
        return {
            local: false,
            target,
            outcome: 'BLOCKED',
            failureKind: 'INFRA',
            errorCode: 'DISPATCH_FAILED',
            detail: { local: false, remoteObservationId: null, localObservationId: null, error: String(error?.message ?? error).slice(0, 300) },
        };
    }
}

for (let step = 1; step <= maxSteps; step += 1) {
    const candidates = candidatesFor(workerId);
    if (!candidates.length) throw new Error(`no host available for ${workerId}`);
    let attempt = null;
    for (let index = 0; index < candidates.length; index += 1) {
        const target = candidates[index];
        process.stderr.write(`[flow ${step}] ${workerId} -> ${target}${target === runtimeKey || target === 'main-chat' ? ' (local)' : ' (remote)'}\n`);
        attempt = executeOnce(workerId, target, step);
        process.stderr.write(`[flow ${step}] ${workerId} outcome=${attempt.outcome}${attempt.failureKind ? ` failure=${attempt.failureKind}` : ''}\n`);
        if ((attempt.outcome !== 'FAIL' && attempt.outcome !== 'BLOCKED') || attempt.failureKind !== 'INFRA') break;
        const next = candidates[index + 1];
        if (next) process.stderr.write(`[flow ${step}] infra failure on ${target}; fallback -> ${next}\n`);
    }
    trail.push({ step, workerId, target: attempt.target, outcome: attempt.outcome, ...attempt.detail, ...(attempt.failureKind ? { failureKind: attempt.failureKind } : {}), ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {}) });
    if ((attempt.outcome === 'FAIL' || attempt.outcome === 'BLOCKED') && attempt.failureKind === 'INFRA') {
        const payload = { ok: false, flowId, traceId, taskType, stoppedReason: 'BLOCKED_INFRA', workerId, trail };
        process.stderr.write(`[flow] infra failure exhausted fallback at ${workerId}\n`);
        console.log(JSON.stringify(payload, null, 2));
        process.exit(2);
    }
    const state = `${workerId}:${attempt.outcome}`;
    const repeats = (seen.get(state) || 0) + 1;
    seen.set(state, repeats);
    if (repeats > maxRepeats) {
        const payload = { ok: false, flowId, traceId, stoppedReason: 'cycle-detected', state, trail };
        process.stderr.write(`[flow] cycle detected at ${state} after ${step} steps\n`);
        console.log(JSON.stringify(payload, null, 2));
        process.exit(2);
    }
    if (taskType === 'audit' && attempt.outcome === 'FAIL') {
        const payload = { ok: false, flowId, traceId, taskType, stoppedReason: 'BLOCKED_HUMAN', workerId, trail };
        process.stderr.write(`[flow] audit verdict FAIL at ${workerId} -> BLOCKED_HUMAN\n`);
        console.log(JSON.stringify(payload, null, 2));
        process.exit(2);
    }
    const edge = edges.find((item) => item.from === workerId && item.on === attempt.outcome);
    if (!edge) {
        process.stderr.write(`[flow] end at ${workerId} (${attempt.outcome})\n`);
        console.log(JSON.stringify({ ok: attempt.outcome === 'PASS', flowId, traceId, taskType, trail }, null, 2));
        process.exit(attempt.outcome === 'PASS' ? 0 : 1);
    }
    workerId = edge.to;
}
throw new Error(`flow exceeded ${maxSteps} steps`);
