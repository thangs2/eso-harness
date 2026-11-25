#!/usr/bin/env node
/**
 * PreInvocation mode guard — hard injector, not a long-running executor.
 *
 * If the prompt begins with mode=A|B, this hook parses it and injects the exact router command as
 * a user message. The model no longer decides *whether* to route; it only runs the injected step.
 * Invalid directives are injected as a system error and no router command is offered.
 *
 * AGY PreInvocation uses `injectSteps` (`userMessage` / `systemMessage`). Other hosts are left
 * untouched until their hook dialect is verified.
 */

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        setTimeout(() => resolve(data), 1200);
    });
}

function promptOf(data) {
    for (const value of [data?.prompt, data?.user_message, data?.message, data?.userQuery, data?.user_query]) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
}

const mod = await import(new URL('./eso-mode-router.mjs', import.meta.url))
    .catch(() => import(new URL('../slp-mode-router.mjs', import.meta.url)));
const parseModePrompt = mod.parseModePrompt;

const hostArg = process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] : 'agy';
const raw = await readStdin();
let data;
try { data = raw.trim() ? JSON.parse(raw) : {}; } catch { process.exit(0); }
const isDsh = hostArg === 'dsh' || data?.hook_event_name === 'UserPromptSubmit';
const isAgy = hostArg === 'agy' || data?.conversationId || data?.invocationNum !== undefined;
if (!isDsh && !isAgy) process.exit(0);

const prompt = promptOf(data);
const isSlpPrompt = /^\s*impl\s+\S+\s+slp\s+g\b/i.test(prompt);
const hasSwarm = /\bswarm(?:\s*=\s*[a-z-]+)?\b/i.test(prompt);
// SLP prompts are routed to the skill path except for the swarm variants this hook guards.
const hasMode = /^\s*mode\s*=\s*[AB]\b/i.test(prompt);
if (!hasMode && !(isSlpPrompt && hasSwarm)) process.exit(0);

const parsed = parseModePrompt(prompt);
function errorOutput(message) {
    if (isDsh) process.stdout.write(`${JSON.stringify({ decision: 'block', reason: message })}\n`);
    else process.stdout.write(`${JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: message } }] })}\n`);
}
function contextOutput(message) {
    if (isDsh) {
        process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message } })}\n`);
    } else {
        process.stdout.write(`${JSON.stringify({ injectSteps: [{ userMessage: message }] })}\n`);
    }
}
if (parsed.error) {
    errorOutput(`MODE ROUTER ERROR: ${parsed.error}. No worker was started.`);
    process.exit(0);
}
if (parsed.swarm) {
    const supported = isDsh ? process.env.ESO_SWARM_SUPPORTED === '1' : true;
    if (!supported) {
        errorOutput('MODE ROUTER ERROR: swarm is not supported on this host; run SLP with subagents instead.');
        process.exit(0);
    }
    if (parsed.mode === 'B') {
        errorOutput('MODE ROUTER ERROR: swarm + mode=B is not supported; swarm workers stay on the local host.');
        process.exit(0);
    }
}
if (parsed.slp && parsed.mode) {
    errorOutput('MODE ROUTER ERROR: SLP + mode is not wired yet. Use mode=A|B standalone or run SLP separately.');
    process.exit(0);
}
if (parsed.slp && !parsed.mode) {
    const scope = parsed.swarm ? ` swarm=${parsed.swarm}` : '';
    const command = `run harness-engineering-team with${parsed.key ? ` ticket ${parsed.key}` : ''}${scope}${parsed.task ? `; task: ${parsed.task}` : ''}`;
    contextOutput(`MODE ROUTER (slp): ${command}\nFollow the SLP skill order; do not switch execution shape mid-run.`);
    process.exit(0);
}
const command = `node .harness/hooks/eso-mode-router.mjs --host ${isDsh ? 'dsh' : 'agy'} --prompt ${JSON.stringify(prompt)}`;
contextOutput(`MODE ROUTER (hard): ${command}\nRun this command, report its JSON result, and do not perform the task yourself.`);
