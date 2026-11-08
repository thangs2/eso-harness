#!/usr/bin/env node
/**
 * Minimal fake Jira MCP server for offline plugin tests.
 *
 * Speaks just enough MCP 2025-06-18 over stdio: initialize,
 * notifications/initialized, tools/list, tools/call. It also writes lifecycle
 * events to a log file so a test can assert what the plugin actually spawned —
 * cwd, resolved site, token, project key, CA/TLS — instead of trusting the
 * plugin's own log.
 *
 * Usage (the plugin's `serverCommand`/`serverArgs` carry these flags; the
 * fixture's env is exactly what the plugin built, which is the point):
 *   node mcp-server.mjs --log <path> [--delay <ms>] [--tools a,b] [--fail-init]
 *                       [--no-banner]
 */
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

function flag(name, fallback = null) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const logPath = flag('--log', '');
const delayMs = Number(flag('--delay', '0')) || 0;
const toolNames = (
    flag('--tools', 'get_myself,get_issue,search_issues,create_issue,transition_issue') ??
    'get_myself,get_issue,search_issues,create_issue,transition_issue'
)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

function record(event) {
    if (!logPath) return;
    try {
        appendFileSync(logPath, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
    } catch {
        /* a test log must never break the fixture */
    }
}

record({
    event: 'start',
    pid: process.pid,
    cwd: process.cwd(),
    site: process.env.JIRA_BASE_URL ?? null,
    email: process.env.JIRA_USER_EMAIL ?? null,
    token: process.env.JIRA_API_TOKEN ?? null,
    projectKey: process.env.JIRA_PROJECT_KEY ?? null,
    caFile: process.env.JIRA_CA_FILE ?? null,
    tlsInsecure: process.env.JIRA_TLS_INSECURE ?? null,
    electron: process.env.ELECTRON_RUN_AS_NODE ?? null,
});

// A server that prints a banner to stdout is common; the client must skip it.
if (!process.argv.includes('--no-banner')) process.stdout.write('fixture jira mcp starting\n');

const tools = toolNames.map((toolName) => ({
    name: toolName,
    description: `Fixture tool ${toolName}`,
    inputSchema: {
        type: 'object',
        properties: { issueKey: { type: 'string' }, jql: { type: 'string' } },
        additionalProperties: true,
    },
}));

function send(payload) {
    try {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
    } catch {
        /* parent closed the pipe */
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });

readline.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
        message = JSON.parse(trimmed);
    } catch {
        return;
    }

    const respond = (payload) => send({ jsonrpc: '2.0', id: message.id, ...payload });

    if (message.method === 'initialize') {
        if (delayMs > 0) await sleep(delayMs);
        if (process.argv.includes('--fail-init')) {
            respond({ error: { code: -32603, message: 'fixture init failure' } });
            return;
        }
        respond({
            result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'jira', version: 'fixture-1.0.0' },
            },
        });
        return;
    }

    if (message.method === 'notifications/initialized') return;

    if (message.method === 'tools/list') {
        respond({ result: { tools } });
        return;
    }

    if (message.method === 'tools/call') {
        const toolName = message.params?.name;
        const args = message.params?.arguments ?? {};
        if (toolName === 'fail_tool') {
            respond({ error: { code: -32000, message: 'fixture failure' } });
            return;
        }
        record({ event: 'call', tool: toolName, args });
        respond({
            result: {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ tool: toolName, args, cwd: process.cwd(), site: process.env.JIRA_BASE_URL ?? null }),
                    },
                ],
            },
        });
        return;
    }

    if (typeof message.id !== 'undefined') {
        respond({ error: { code: -32601, message: `method not found: ${message.method}` } });
    }
});

function shutdown() {
    record({ event: 'exit', pid: process.pid });
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
readline.on('close', shutdown);
