import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { StdioMcpClient, McpError, resultText } from '../src/mcp-stdio-client.mjs';
import { FIXTURE, readEvents, waitFor } from './helpers.mjs';

function tempLog() {
    const dir = mkdtempSync(join(tmpdir(), 'jira-client-'));
    return {
        dir,
        path: join(dir, 'events.jsonl'),
        cleanup() {
            // The child may still be appending its exit event for a few ms after
            // SIGTERM; a failed temp cleanup must not fail the test it follows.
            try {
                rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
            } catch {
                /* best-effort temp cleanup */
            }
        },
    };
}

function makeClient({ log, extraArgs = [], timeoutMs = 8_000, command = process.execPath } = {}) {
    return new StdioMcpClient({
        command,
        args: [FIXTURE, '--log', log, ...extraArgs],
        cwd: process.cwd(),
        name: 'jira-fixture',
        timeoutMs,
    });
}

test('connect completes the handshake, skips a stdout banner and lists tools', async () => {
    const { path, cleanup } = tempLog();
    const client = makeClient({ log: path, extraArgs: ['--tools', 'get_myself,get_issue'] });
    try {
        await client.connect();
        assert.equal(client.serverInfo?.name, 'jira');
        assert.equal(client.protocolVersion, '2025-06-18');
        assert.deepEqual(
            client.tools.map((tool) => tool.name),
            ['get_myself', 'get_issue'],
        );
        assert.equal(client.connected, true);
    } finally {
        await client.close();
        cleanup();
    }
});

test('callTool returns the raw MCP result and resultText flattens it', async () => {
    const { path, cleanup } = tempLog();
    const client = makeClient({ log: path, extraArgs: ['--tools', 'get_issue'] });
    try {
        await client.connect();
        const result = await client.callTool('get_issue', { issueKey: 'TST-1' });
        assert.equal(result.isError, undefined);
        const text = resultText(result);
        const parsed = JSON.parse(text);
        assert.equal(parsed.tool, 'get_issue');
        assert.equal(parsed.args.issueKey, 'TST-1');
        const calls = readEvents(path).filter((event) => event.event === 'call');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].tool, 'get_issue');
    } finally {
        await client.close();
        cleanup();
    }
});

test('a JSON-RPC error rejects with the server code and message', async () => {
    const { path, cleanup } = tempLog();
    const client = makeClient({ log: path, extraArgs: ['--tools', 'fail_tool'] });
    try {
        await client.connect();
        await assert.rejects(
            () => client.callTool('fail_tool', {}),
            (error) => {
                assert.ok(error instanceof McpError);
                assert.equal(error.code, -32000);
                assert.match(error.message, /fixture failure/);
                return true;
            },
        );
    } finally {
        await client.close();
        cleanup();
    }
});

test('a slow server hits the transport deadline instead of hanging', async () => {
    const { path, cleanup } = tempLog();
    const client = makeClient({ log: path, extraArgs: ['--delay', '500'], timeoutMs: 120 });
    try {
        await assert.rejects(
            () => client.connect(),
            (error) => {
                assert.ok(error instanceof McpError);
                assert.equal(error.code, 'TIMEOUT');
                return true;
            },
        );
    } finally {
        await client.close();
        cleanup();
    }
});

test('a missing server binary rejects with SPAWN_FAILED', async () => {
    const { path, cleanup } = tempLog();
    const client = new StdioMcpClient({
        command: '/nonexistent/node-binary-for-jira-tests',
        args: [],
        name: 'jira-missing',
        timeoutMs: 2_000,
    });
    try {
        await assert.rejects(
            () => client.connect(),
            (error) => {
                assert.ok(error instanceof McpError);
                assert.equal(error.code, 'SPAWN_FAILED');
                return true;
            },
        );
    } finally {
        await client.close();
        cleanup();
    }
});

test('an initialize failure rejects and keeps the server stderr tail readable', async () => {
    const { path, cleanup } = tempLog();
    const client = makeClient({ log: path, extraArgs: ['--fail-init'] });
    try {
        await assert.rejects(
            () => client.connect(),
            (error) => {
                assert.ok(error instanceof McpError);
                assert.match(error.message, /fixture init failure/);
                return true;
            },
        );
    } finally {
        await client.close();
        cleanup();
    }
});

test('close is idempotent and makes later calls reject instead of hanging', async () => {
    const { path, cleanup } = tempLog();
    const client = makeClient({ log: path, extraArgs: ['--tools', 'get_myself'] });
    try {
        await client.connect();
        await client.close();
        await client.close();
        assert.equal(client.connected, false);
        await assert.rejects(
            () => client.callTool('get_myself', {}),
            (error) => {
                assert.equal(error.code, 'NOT_CONNECTED');
                return true;
            },
        );
        await waitFor(() => readEvents(path).some((event) => event.event === 'exit'), { label: 'fixture exit after close' });
    } finally {
        await client.close();
        cleanup();
    }
});

test('an already-aborted signal rejects the call before dispatch', async () => {
    const { path, cleanup } = tempLog();
    const client = makeClient({ log: path, extraArgs: ['--tools', 'get_myself'] });
    try {
        await client.connect();
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            () => client.callTool('get_myself', {}, controller.signal),
            (error) => {
                assert.equal(error.code, 'CANCELLED');
                return true;
            },
        );
    } finally {
        await client.close();
        cleanup();
    }
});

test('resultText handles text, resource, image and structured content', () => {
    assert.equal(resultText(null), '');
    assert.equal(resultText({ content: [{ type: 'text', text: 'hello' }] }), 'hello');
    assert.equal(
        resultText({ content: [{ type: 'text', text: 'a' }, { type: 'resource', resource: { text: 'b' } }, { type: 'image', mimeType: 'image/png' }] }),
        'a\nb\n[image image/png]',
    );
    assert.match(resultText({ content: [], structuredContent: { ok: true } }), /"ok": true/);
});
