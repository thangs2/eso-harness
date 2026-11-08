import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
    DEFAULT_SERVER,
    LOCAL_SERVER,
    buildServerEnv,
    createJiraPlugin,
    inject,
    name,
} from '../src/plugin.mjs';
import {
    FIXTURE,
    createFakeAgent,
    createFakeContext,
    makeWorkspace,
    readEvents,
    removeWorkspace,
    sleep,
    waitFor,
} from './helpers.mjs';

const SITE = 'https://tst.atlassian.net';
const TENANT_CONFIG = {
    '.dsh/jira.json': {
        site: SITE,
        email: 'test@example.com',
        token: 'test-token',
        projectKey: 'TST',
    },
};

function tempLog() {
    const dir = mkdtempSync(join(tmpdir(), 'jira-plugin-log-'));
    return {
        dir,
        path: join(dir, 'events.jsonl'),
        cleanup() {
            try {
                rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
            } catch {
                /* best-effort temp cleanup */
            }
        },
    };
}

function configFor(log, overrides = {}) {
    return {
        serverCommand: process.execPath,
        serverArgs: [FIXTURE, '--log', log],
        probeImpl: async () => ({ ok: true, status: 200 }),
        timeoutMs: 5_000,
        probeTimeoutMs: 500,
        ...overrides,
    };
}

/** One configured fake agent wired to an active plugin. */
function harness({ files = TENANT_CONFIG, config = {}, existingAgents = [], credentials = {} } = {}) {
    const workspace = makeWorkspace(files);
    const log = tempLog();
    const ctx = createFakeContext({
        dirs: { 'session-1': workspace },
        existingAgents,
        credentials,
        services: inject,
    });
    const plugin = createJiraPlugin();
    plugin.apply(ctx, configFor(log.path, config));
    const { agent, tools } = createFakeAgent('session-1');
    return {
        workspace,
        ctx,
        plugin,
        agent,
        tools,
        log,
        async cleanup() {
            ctx.cleanup();
            await sleep(20);
            removeWorkspace(workspace);
            log.cleanup();
        },
    };
}

test('the plugin declares the contract the Harness needs', () => {
    assert.equal(name, 'jira-mcp-plugin');
    assert.deepEqual(inject, ['tools', 'workingDirectory']);
    assert.equal(DEFAULT_SERVER.command, process.execPath);
    assert.equal(DEFAULT_SERVER.args[0], LOCAL_SERVER);
    assert.ok(existsSync(LOCAL_SERVER), 'the bundle must ship its own MCP server');
});

test('buildServerEnv pins the tenant and cannot be overridden by repo env', () => {
    const tenant = {
        site: SITE,
        email: 'test@example.com',
        projectKey: 'TST',
        extraEnv: { JIRA_TYPE: 'cloud', JIRA_BASE_URL: 'https://evil.example', JIRA_API_TOKEN: 'evil' },
    };
    const env = buildServerEnv(tenant, 'real-token', { caFile: '/etc/ssl/cert.pem', insecureTls: true, electronHost: true });
    assert.equal(env.JIRA_BASE_URL, SITE);
    assert.equal(env.JIRA_API_TOKEN, 'real-token');
    assert.equal(env.JIRA_USER_EMAIL, 'test@example.com');
    assert.equal(env.JIRA_PROJECT_KEY, 'TST');
    assert.equal(env.JIRA_TYPE, 'cloud');
    assert.equal(env.JIRA_CA_FILE, '/etc/ssl/cert.pem');
    assert.equal(env.JIRA_TLS_INSECURE, '1');
    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
});

test('a workspace with no Jira config gets no tools and no process', async () => {
    const h = harness({ files: {} });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        assert.equal(readEvents(h.log.path).length, 0, 'nothing may be spawned for an unconfigured repo');
    } finally {
        await h.cleanup();
    }
});

test('a configured workspace registers the server tools and passes the tenant env', async () => {
    const h = harness();
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.deepEqual([...h.tools.keys()].sort(), [
            'create_issue',
            'get_issue',
            'get_myself',
            'search_issues',
            'transition_issue',
        ]);
        const start = readEvents(h.log.path).find((event) => event.event === 'start');
        assert.equal(start.site, SITE);
        assert.equal(start.email, 'test@example.com');
        assert.equal(start.token, 'test-token');
        assert.equal(start.projectKey, 'TST');
        assert.equal(start.cwd, realpathSync(h.workspace));
    } finally {
        await h.cleanup();
    }
});

test('tool execute forwards the argument object and returns the server text', async () => {
    const h = harness();
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        const tool = h.tools.get('get_issue');
        assert.ok(tool);
        assert.equal(tool.parameters.type, 'object');
        assert.match(tool.description, /Read one Jira issue/);
        const value = await tool.execute({ issueKey: 'TST-1' }, {});
        assert.equal(value.isError, undefined);
        const parsed = JSON.parse(value.text);
        assert.equal(parsed.tool, 'get_issue');
        assert.equal(parsed.args.issueKey, 'TST-1');
        const calls = readEvents(h.log.path).filter((event) => event.event === 'call');
        assert.equal(calls.at(-1).tool, 'get_issue');
    } finally {
        await h.cleanup();
    }
});

test('a tool-level failure is returned as an isError value, not a throw', async () => {
    const h = harness({
        config: { serverArgs: [FIXTURE, '--log', '', '--tools', 'get_myself,fail_tool'] },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.ok(h.tools.has('fail_tool'));
        const value = await h.tools.get('fail_tool').execute({}, {});
        assert.equal(value.isError, true);
        assert.match(value.text, /fixture failure/);
    } finally {
        await h.cleanup();
    }
});

test('a server that fails the handshake registers nothing and logs why', async () => {
    const h = harness({ config: { serverArgs: [FIXTURE, '--fail-init'] } });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        assert.ok(h.ctx.logs.info.some((line) => /connect failed/.test(line)), h.ctx.logs.info.join('\n'));
    } finally {
        await h.cleanup();
    }
});

test('a failed probe registers nothing and names the reason', async () => {
    const h = harness({
        config: { probeImpl: async () => ({ ok: false, status: 401, reason: 'token rejected (HTTP 401) — check the email + API token pair' }) },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        const line = h.ctx.logs.info.find((entry) => entry.includes('no usable Jira'));
        assert.match(line, /token rejected \(HTTP 401\)/);
        assert.equal(readEvents(h.log.path).length, 0, 'a dead tenant must not spawn a server');
    } finally {
        await h.cleanup();
    }
});

test('a configured repo with no token registers nothing and says which credential is expected', async () => {
    const h = harness({ files: { '.dsh/jira.json': { site: SITE, email: 'test@example.com' } } });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        const line = h.ctx.logs.info.find((entry) => entry.includes('no token'));
        assert.match(line, /JIRA_TOKEN_TST/);
    } finally {
        await h.cleanup();
    }
});

test('a configured repo with no email registers nothing', async () => {
    const h = harness({ files: { '.dsh/jira.json': { site: SITE, token: 'test-token' } } });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        assert.ok(h.ctx.logs.info.some((line) => /no email configured/.test(line)), h.ctx.logs.info.join('\n'));
    } finally {
        await h.cleanup();
    }
});

test('a broken config stops resolution, names the path, and registers nothing', async () => {
    const h = harness({ files: { '.dsh/jira.json': '{ not json' } });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        const line = h.ctx.logs.info.find((entry) => entry.includes('cannot parse Jira config'));
        assert.match(line, /\.dsh\/jira\.json/);
    } finally {
        await h.cleanup();
    }
});

test('failOnStartupError raises the same failure to logger.error without killing the agent', async () => {
    const h = harness({
        files: { '.dsh/jira.json': { site: SITE, email: 'test@example.com' } },
        config: { failOnStartupError: true },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        assert.ok(h.ctx.logs.error.some((line) => /no token/.test(line)), h.ctx.logs.error.join('\n'));
    } finally {
        await h.cleanup();
    }
});

test('a payload that is not an agent is logged and ignored', async () => {
    const h = harness();
    try {
        await h.ctx.emit('agent/created', { source: 'test', agent: null });
        await h.ctx.emit('agent/created', 'not-an-object');
        assert.equal(h.tools.size, 0);
        assert.ok(h.ctx.logs.info.some((line) => /without an agent payload/.test(line)));
    } finally {
        await h.cleanup();
    }
});

test('agents that already exist at activation are bootstrapped', async () => {
    const workspace = makeWorkspace(TENANT_CONFIG);
    const log = tempLog();
    const { agent, tools } = createFakeAgent('session-live');
    const ctx = createFakeContext({
        dirs: { 'session-live': workspace },
        existingAgents: [agent],
        services: inject,
    });
    const plugin = createJiraPlugin();
    try {
        plugin.apply(ctx, configFor(log.path));
        await waitFor(() => tools.size > 0, { label: 'bootstrap tool installation' });
        assert.ok(tools.has('get_myself'));
    } finally {
        ctx.cleanup();
        await sleep(20);
        removeWorkspace(workspace);
        log.cleanup();
    }
});

test('a duplicate agent/created does not spawn a second server', async () => {
    const h = harness();
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        await h.ctx.emit('agent/created', { agent: h.agent });
        const starts = readEvents(h.log.path).filter((event) => event.event === 'start');
        assert.equal(starts.length, 1);
    } finally {
        await h.cleanup();
    }
});

test('disposing the agent removes its tools and stops the process', async () => {
    const h = harness();
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.ok(h.tools.size > 0);
        h.ctx.emit('agent/disposed', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        await waitFor(() => readEvents(h.log.path).some((event) => event.event === 'exit'), {
            label: 'fixture exit after dispose',
        });
    } finally {
        await h.cleanup();
    }
});

test('an agent disposed while its handshake is in flight leaks neither tools nor process', async () => {
    let releaseProbe;
    const probeGate = new Promise((resolve) => {
        releaseProbe = resolve;
    });
    const h = harness({
        config: {
            probeImpl: async () => {
                await probeGate;
                return { ok: true, status: 200 };
            },
        },
    });
    try {
        const created = h.ctx.emit('agent/created', { agent: h.agent });
        // Dispose before the probe resolves, then let installation continue.
        h.ctx.emit('agent/disposed', { agent: h.agent });
        releaseProbe();
        await created;
        await waitFor(() => readEvents(h.log.path).some((event) => event.event === 'exit'), {
            label: 'fixture exit after dispose-during-install',
        });
        assert.equal(h.tools.size, 0);
    } finally {
        await h.cleanup();
    }
});

test('plugin unload stops every session and unsubscribes its listeners', async () => {
    const h = harness();
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.ok(h.tools.size > 0);
        h.ctx.cleanup();
        await waitFor(() => readEvents(h.log.path).some((event) => event.event === 'exit'), {
            label: 'fixture exit after plugin unload',
        });

        // A listener left subscribed would re-spawn for this disposed agent.
        const { agent: lateAgent, tools: lateTools } = createFakeAgent('session-1');
        await h.ctx.emit('agent/created', { agent: lateAgent });
        assert.equal(lateTools.size, 0);
    } finally {
        removeWorkspace(h.workspace);
        h.log.cleanup();
    }
});

test('toolPrefix namespaces the tool list without doubling an existing prefix', async () => {
    const h = harness({
        config: { toolPrefix: 'jira_', serverArgs: [FIXTURE, '--tools', 'get_myself,search_issues'] },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.deepEqual([...h.tools.keys()].sort(), ['jira_get_myself', 'jira_search_issues']);
        assert.match(h.tools.get('jira_search_issues').description, /Search Jira with JQL/);
    } finally {
        await h.cleanup();
    }
});

test('caFile and insecureTls are forwarded to the server environment, never silently', async () => {
    const h = harness({ config: { caFile: '/tmp/jira-test-ca.pem', insecureTls: true } });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        const start = readEvents(h.log.path).find((event) => event.event === 'start');
        assert.equal(start.caFile, '/tmp/jira-test-ca.pem');
        assert.equal(start.tlsInsecure, '1');
    } finally {
        await h.cleanup();
    }
});


test('a repo-chosen plain-HTTP non-loopback site is refused before the probe', async () => {
    const h = harness({
        files: {
            '.dsh/jira.json': { site: 'http://attacker.example', email: 'dev@example.test', token: 'repo-token' },
        },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        assert.ok(h.ctx.logs.info.some((line) => /plain HTTP to a non-loopback host/.test(line)), h.ctx.logs.info.join('\n'));
        assert.equal(readEvents(h.log.path).length, 0, 'no server may be spawned for an insecure site');
    } finally {
        await h.cleanup();
    }
});

test('loopback HTTP is allowed without an opt-in', async () => {
    const h = harness({
        files: {
            '.dsh/jira.json': { site: 'http://127.0.0.1:9', email: 'dev@example.test', token: 'repo-token' },
        },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.ok(h.tools.size > 0, 'loopback http is secure enough');
    } finally {
        await h.cleanup();
    }
});


test('allowInsecureSite:true is the only way to use a non-loopback plain-HTTP site', async () => {
    const h = harness({
        files: {
            '.dsh/jira.json': { site: 'http://attacker.example', email: 'dev@example.test', token: 'repo-token' },
        },
        config: { allowInsecureSite: true },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.ok(h.tools.size > 0, 'the row opt-in must be what allows the site');
        const start = readEvents(h.log.path).find((event) => event.event === 'start');
        assert.equal(start.site, 'http://attacker.example');
    } finally {
        await h.cleanup();
    }
});

test('a repo-requested credential bound to another site is ignored by default', async () => {
    const h = harness({
        files: {
            '.dsh/jira.json': {
                site: SITE,
                email: 'test@example.com',
                credential: 'JIRA_TOKEN_OTHER_TENANT',
            },
        },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        const line = h.ctx.logs.info.find((entry) => /repo config asked for credential "JIRA_TOKEN_OTHER_TENANT"/.test(entry));
        assert.ok(line, h.ctx.logs.info.join('\n'));
        // The store has a token for another tenant; it must not be used here.
        assert.equal(readEvents(h.log.path).length, 0);
    } finally {
        await h.cleanup();
    }
});

test('trustRepoCredentialRef opts in to a repo-requested ref, from the row only', async () => {
    const h = harness({
        files: {
            '.dsh/jira.json': {
                site: SITE,
                email: 'test@example.com',
                credential: 'JIRA_TOKEN_OTHER_TENANT',
            },
        },
        credentials: { JIRA_TOKEN_OTHER_TENANT: 'other-token' },
        config: { trustRepoCredentialRef: true },
    });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.ok(h.tools.size > 0);
        const start = readEvents(h.log.path).find((event) => event.event === 'start');
        assert.equal(start.token, 'other-token');
    } finally {
        await h.cleanup();
    }
});

test('a workspace that cannot be resolved for the agent is logged, not silently skipped', async () => {
    const h = harness();
    h.ctx.workingDirs.delete('session-1');
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        assert.equal(h.tools.size, 0);
        assert.ok(
            h.ctx.logs.info.some((line) => /cannot resolve the working directory for session session-1/.test(line)),
            h.ctx.logs.info.join('\n'),
        );
    } finally {
        await h.cleanup();
    }
});

test('unload during bootstrap leaves no MCP child behind', async () => {
    let releaseProbe;
    const probeGate = new Promise((resolve) => {
        releaseProbe = resolve;
    });
    const workspace = makeWorkspace(TENANT_CONFIG);
    const log = tempLog();
    const { agent, tools } = createFakeAgent('session-boot');
    const ctx = createFakeContext({ dirs: { 'session-boot': workspace }, existingAgents: [agent], services: inject });
    const plugin = createJiraPlugin();
    try {
        plugin.apply(
            ctx,
            configFor(log.path, {
                probeImpl: async () => {
                    await probeGate;
                    return { ok: true, status: 200 };
                },
            }),
        );
        // Let the bootstrap install reach the probe, then unload mid-flight.
        await sleep(50);
        ctx.cleanup();
        releaseProbe();
        await sleep(300);

        const events = readEvents(log.path);
        const starts = events.filter((event) => event.event === 'start').length;
        const exits = events.filter((event) => event.event === 'exit').length;
        assert.equal(tools.size, 0);
        assert.equal(starts, exits, 'every spawned child must be closed when the plugin unloads');
    } finally {
        ctx.cleanup();
        await sleep(20);
        removeWorkspace(workspace);
        log.cleanup();
    }
});

test('a tool call on a closed server still answers with a readable isError', async () => {
    const h = harness({ config: { serverArgs: [FIXTURE, '--log', ''] } });
    try {
        await h.ctx.emit('agent/created', { agent: h.agent });
        const tool = h.tools.get('get_myself');
        // Stop the child underneath the registered tool, exactly as a crashed server would.
        h.ctx.cleanup();
        await sleep(30);
        const value = await tool.execute({}, {});
        assert.equal(value.isError, true);
        assert.match(value.text, /Jira MCP \(tst\.atlassian\.net\):/);
    } finally {
        removeWorkspace(h.workspace);
        h.log.cleanup();
    }
});
