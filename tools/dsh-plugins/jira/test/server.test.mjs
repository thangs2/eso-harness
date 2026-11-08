import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

import { StdioMcpClient } from '../src/mcp-stdio-client.mjs';
import { JiraApiError } from '../src/jira-api.mjs';
import { createJiraMcpServer } from '../src/server.mjs';
import { FIXTURE_EMAIL, FIXTURE_TOKEN, startJiraFixture } from './fixtures/jira-server.mjs';

const SERVER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');

function envFor(fixture, extra = {}) {
    return {
        JIRA_BASE_URL: fixture.url,
        JIRA_USER_EMAIL: FIXTURE_EMAIL,
        JIRA_API_TOKEN: FIXTURE_TOKEN,
        JIRA_PROJECT_KEY: 'TST',
        ...extra,
    };
}

async function withFixture(fn, { fixtureOptions = {}, env = null } = {}) {
    const fixture = await startJiraFixture(fixtureOptions);
    try {
        const server = createJiraMcpServer({ env: env ? env(fixture) : envFor(fixture) });
        return await fn({ fixture, server });
    } finally {
        await fixture.close();
    }
}

/** Call and flatten, asserting it did not error unless `{ expectError: true }`. */
async function call(server, name, args = {}, { expectError = false } = {}) {
    const result = await server.callTool(name, args);
    const text = result.content?.map((item) => item.text).join('\n') ?? '';
    if (expectError) assert.equal(result.isError, true, `expected ${name} to fail, got: ${text}`);
    else assert.equal(result.isError, undefined, `${name} failed: ${text}`);
    return text;
}

test('missing environment is refused before any request', () => {
    assert.throws(
        () => createJiraMcpServer({ env: { JIRA_BASE_URL: 'https://x.atlassian.net' } }),
        (error) => {
            assert.ok(error instanceof JiraApiError);
            assert.match(error.message, /JIRA_USER_EMAIL/);
            assert.match(error.message, /JIRA_API_TOKEN/);
            return true;
        },
    );
});

test('tools/list exposes the whole local tool surface with JSON schemas', async () => {
    await withFixture(async ({ server }) => {
        const names = server.tools.map((tool) => tool.name);
        assert.deepEqual(names, [
            'get_myself',
            'get_issue',
            'search_issues',
            'get_transitions',
            'get_projects',
            'get_project_issue_types',
            'get_fields',
            'get_boards',
            'get_sprints',
            'create_issue',
            'update_issue',
            'add_comment',
            'transition_issue',
            'link_issues',
        ]);
        for (const tool of server.tools) {
            assert.equal(tool.inputSchema.type, 'object', `${tool.name} must have an object schema`);
            assert.ok(tool.description.length > 20, `${tool.name} needs a model-facing description`);
        }
    });
});

test('initialize negotiates the protocol and tools/list answers over JSON-RPC', async () => {
    await withFixture(async ({ server }) => {
        const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
        assert.equal(init.result.protocolVersion, '2024-11-05');
        assert.equal(init.result.serverInfo.name, 'jira');
        assert.deepEqual(init.result.capabilities, { tools: {} });

        const unknownVersion = await server.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
        assert.equal(unknownVersion.result.protocolVersion, '2025-06-18');

        const list = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
        assert.equal(list.result.tools.length, 14);

        const ping = await server.handle({ jsonrpc: '2.0', id: 4, method: 'ping' });
        assert.deepEqual(ping.result, {});

        assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
        assert.equal(await server.handle({ jsonrpc: '2.0', id: 5, method: 'prompts/list' }).then((r) => r.error.code), -32601);
        assert.equal(await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope', arguments: {} } }).then((r) => r.error.code), -32602);
    });
});

test('get_myself identifies the authenticated user', async () => {
    await withFixture(async ({ server }) => {
        const text = await call(server, 'get_myself');
        assert.match(text, /site: http:\/\/127\.0\.0\.1:\d+/);
        assert.match(text, /user: Test User <test@example\.com>/);
        assert.match(text, /accountId: acc-1/);
        assert.match(text, /timeZone: Asia\/Saigon/);
    });
});

test('get_issue renders summary, status, parent, labels, wiki description and comments', async () => {
    await withFixture(async ({ server, fixture }) => {
        const text = await call(server, 'get_issue', { issueKey: 'TST-1' });
        assert.match(text, /TST-1 — Fix the thing/);
        assert.match(text, /status: In Progress \(indeterminate\)/);
        assert.match(text, /type: Task/);
        assert.match(text, /assignee: Test User/);
        assert.match(text, /parent: TST-0/);
        assert.match(text, /labels: qc/);
        assert.match(text, /description:\nh3\. Goal/);
        assert.match(text, /comments \(1\):/);
        assert.match(text, /First comment in \*wiki markup\*/);
        assert.match(text, /url: .*\/browse\/TST-1/);
        assert.ok(fixture.findRequests('GET', '/rest/api/2/issue/TST-1').length >= 1);
    });
});

test('get_issue can omit comments and links on demand', async () => {
    await withFixture(async ({ server }) => {
        const text = await call(server, 'get_issue', { issueKey: 'TST-1', includeComments: false, includeLinks: false });
        assert.doesNotMatch(text, /comments \(1\)/);
        assert.doesNotMatch(text, /links \(/);
    });
});

test('an unknown issue returns an actionable isError instead of throwing', async () => {
    await withFixture(async ({ server }) => {
        const text = await call(server, 'get_issue', { issueKey: 'TST-999' }, { expectError: true });
        assert.match(text, /404/);
        assert.match(text, /not found|does not exist/i);
    });
});

test('search_issues pages with the token the search/jql API returns', async () => {
    await withFixture(async ({ server, fixture }) => {
        const first = await call(server, 'search_issues', { jql: 'project = TST', maxResults: 1 });
        assert.match(first, /^JQL: project = TST/);
        assert.match(first, /found 1 issue\(s\)/);
        assert.match(first, /- TST-1 \[Task\/In Progress\] Fix the thing — Test User/);
        const token = /nextPageToken: (.+)/.exec(first)?.[1];
        assert.ok(token, 'expected a nextPageToken');
        assert.equal(fixture.state.searches[0].jql, 'project = TST');
        assert.equal(fixture.state.searches[0].maxResults, 1);
        assert.ok(fixture.state.searches[0].fields.includes('summary'));

        const second = await call(server, 'search_issues', { jql: 'project = TST', maxResults: 1, nextPageToken: token });
        assert.match(second, /found 1 issue\(s\)/);
        assert.match(second, /TST-2/);
    });
});

test('search_issues rejects a page size above the cap and a missing JQL', async () => {
    await withFixture(async ({ server }) => {
        const tooBig = await call(server, 'search_issues', { jql: 'project = TST', maxResults: 500 }, { expectError: true });
        assert.match(tooBig, /maxResults/);
        const missing = await call(server, 'search_issues', {}, { expectError: true });
        assert.match(missing, /jql/);
    });
});

test('get_transitions lists ids, names and target status', async () => {
    await withFixture(async ({ server }) => {
        const text = await call(server, 'get_transitions', { issueKey: 'TST-1' });
        assert.match(text, /4 transition\(s\)/);
        assert.match(text, /id 21 · "Start" → In Progress \(indeterminate\)/);
        assert.match(text, /id 31 · "Finish" → Done \(done\)/);
    });
});

test('get_projects, get_project_issue_types, get_fields, get_boards and get_sprints read metadata', async () => {
    await withFixture(async ({ server }) => {
        const projects = await call(server, 'get_projects', { query: 'TST' });
        assert.match(projects, /TST — Test Project/);

        const types = await call(server, 'get_project_issue_types', { projectKey: 'TST' });
        assert.match(types, /Task \(id 10001\)/);
        assert.match(types, /Subtask \(id 10002\) · subtask/);

        const fields = await call(server, 'get_fields', { query: 'story' });
        assert.match(fields, /storyPoints field: customfield_10016/);
        assert.match(fields, /sprint field: customfield_10020/);

        const boards = await call(server, 'get_boards', { projectKey: 'TST' });
        assert.match(boards, /68 — TST board/);

        const sprints = await call(server, 'get_sprints', { boardId: 68 });
        assert.match(sprints, /123 — TST Sprint 1 · active/);
    });
});

test('create_issue refuses a subtask without a parent and an unknown type', async () => {
    await withFixture(async ({ server }) => {
        const noParent = await call(server, 'create_issue', { issueType: 'Subtask', summary: 'child' }, { expectError: true });
        assert.match(noParent, /parent.*required/i);

        const unknown = await call(server, 'create_issue', { issueType: 'Spike', summary: 'x' }, { expectError: true });
        assert.match(unknown, /unknown issue type "Spike"/);
        assert.match(unknown, /Task, Subtask, Epic/);
    });
});

test('create_issue dryRun previews the exact payload without writing', async () => {
    await withFixture(async ({ server, fixture }) => {
        const text = await call(server, 'create_issue', {
            issueType: 'Task',
            summary: 'Preview me',
            description: 'h3. Body',
            dryRun: true,
        });
        assert.match(text, /DRY-RUN/);
        const payload = JSON.parse(text.slice(text.indexOf('{')));
        assert.equal(payload.fields.summary, 'Preview me');
        assert.equal(payload.fields.issuetype.id, '10001');
        assert.equal(fixture.state.created.length, 0);
    });
});

test('create_issue sends project, type id, wiki description, labels, parent, points and resolved assignee', async () => {
    await withFixture(async ({ server, fixture }) => {
        const text = await call(server, 'create_issue', {
            projectKey: 'TST',
            issueType: 'Subtask',
            summary: 'Wire the local server',
            description: 'h3. Context\n\n* one bullet',
            labels: ['qc', 'mcp'],
            parent: 'TST-1',
            storyPoints: 3,
            assignee: 'test@example.com',
        });
        assert.match(text, /created TST-101/);
        const sent = fixture.state.created.at(-1);
        assert.deepEqual(sent.project, { key: 'TST' });
        assert.deepEqual(sent.issuetype, { id: '10002' });
        assert.equal(sent.summary, 'Wire the local server');
        assert.equal(sent.description, 'h3. Context\n\n* one bullet');
        assert.deepEqual(sent.labels, ['qc', 'mcp']);
        assert.deepEqual(sent.parent, { key: 'TST-1' });
        assert.equal(sent.customfield_10016, 3);
        assert.deepEqual(sent.assignee, { id: 'acc-1' });
        // Email was resolved through /rest/api/2/user/search, not guessed.
        assert.ok(fixture.findRequests('GET', '/rest/api/2/user/search').length >= 1);
    });
});

test('create_issue rejects a parent on a non-subtask type before writing', async () => {
    await withFixture(async ({ server, fixture }) => {
        const text = await call(server, 'create_issue', { issueType: 'Task', summary: 'x', parent: 'TST-1' }, { expectError: true });
        assert.match(text, /only valid for subtask/);
        assert.equal(fixture.state.created.length, 0);
    });
});

test('update_issue sends only the fields it was given, and null clears', async () => {
    await withFixture(async ({ server, fixture }) => {
        const text = await call(server, 'update_issue', {
            issueKey: 'TST-1',
            summary: 'Renamed',
            labels: ['renamed'],
            storyPoints: 5,
            assignee: null,
        });
        assert.match(text, /updated TST-1/);
        assert.match(text, /fields: summary, labels, assignee, customfield_10016/);
        const sent = fixture.state.updated.at(-1).fields;
        assert.equal(sent.summary, 'Renamed');
        assert.deepEqual(sent.labels, ['renamed']);
        assert.equal(sent.assignee, null);
        assert.equal(sent.customfield_10016, 5);
        assert.equal(sent.description, undefined, 'an omitted field must not be written');
    });
});

test('update_issue refuses an empty change set', async () => {
    await withFixture(async ({ server }) => {
        const text = await call(server, 'update_issue', { issueKey: 'TST-1' }, { expectError: true });
        assert.match(text, /nothing to update/);
    });
});

test('add_comment posts the wiki-markup body', async () => {
    await withFixture(async ({ server, fixture }) => {
        const text = await call(server, 'add_comment', { issueKey: 'TST-1', body: '*done* — verified locally' });
        assert.match(text, /comment added to TST-1 · id 9001/);
        assert.equal(fixture.state.comments.at(-1).body.body, '*done* — verified locally');
    });
});

test('transition_issue refuses a Done target unless the operator explicitly allows it', async () => {
    await withFixture(async ({ server, fixture }) => {
        const refused = await call(server, 'transition_issue', { issueKey: 'TST-1', transition: 'Finish' }, { expectError: true });
        assert.match(refused, /signed by a human/);
        assert.match(refused, /allowDone/);
        assert.equal(fixture.state.transitionsApplied.length, 0);

        const applied = await call(server, 'transition_issue', { issueKey: 'TST-1', transition: 'Finish', allowDone: true });
        assert.match(applied, /transition "Finish" applied \(id 31\)/);
        assert.match(applied, /status: Done \(done\)/);
        assert.equal(fixture.state.transitionsApplied.length, 1);
    });
});

test('transition_issue accepts a status name, an id, and reports the new status', async () => {
    await withFixture(async ({ server, fixture }) => {
        const byName = await call(server, 'transition_issue', { issueKey: 'TST-2', transition: 'Start' });
        assert.match(byName, /status: In Progress/);
        assert.equal(fixture.state.transitionsApplied.at(-1).transition.id, '21');

        const byId = await call(server, 'transition_issue', { issueKey: 'TST-1', transition: '11' });
        assert.match(byId, /transition "To Do" applied/);
        assert.match(byId, /status: To Do \(new\)/);
    });
});

test('transition_issue lists the allowed transitions when the id/name is unknown', async () => {
    await withFixture(async ({ server }) => {
        const text = await call(server, 'transition_issue', { issueKey: 'TST-1', transition: 'Approve' }, { expectError: true });
        assert.match(text, /no transition "Approve"/);
        assert.match(text, /21:"Start"→In Progress/);
    });
});

test('link_issues documents and sends the measured Blocks direction', async () => {
    await withFixture(async ({ server, fixture }) => {
        const text = await call(server, 'link_issues', { type: 'Blocks', inwardIssue: 'TST-1', outwardIssue: 'TST-2' });
        assert.match(text, /TST-1 blocks TST-2 \(inwardIssue=blocker, outwardIssue=blocked\)/);
        const sent = fixture.state.links.at(-1);
        assert.deepEqual(sent, {
            type: { name: 'Blocks' },
            inwardIssue: { key: 'TST-1' },
            outwardIssue: { key: 'TST-2' },
        });
    });
});

test('a bad token turns every tool into a readable 401 isError', async () => {
    await withFixture(
        async ({ server }) => {
            const text = await call(server, 'get_myself', {}, { expectError: true });
            assert.match(text, /401/);
            assert.match(text, /authentication failed/);
        },
        { env: (fixture) => envFor(fixture, { JIRA_API_TOKEN: 'wrong-token' }) },
    );
});


test('notifications/cancelled aborts an in-flight tool call instead of letting it finish', async () => {
    await withFixture(async ({ server }) => {
        const started = Date.now();
        const pending = server.handle({
            jsonrpc: '2.0',
            id: 91,
            method: 'tools/call',
            params: { name: 'get_issue', arguments: { issueKey: 'SLOW-1' } },
        });
        await sleep(80);
        await server.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 91 } });
        const response = await pending;
        assert.ok(Date.now() - started < 1_500, 'cancellation must beat the 3 s fixture delay');
        assert.equal(response.result.isError, true);
        assert.match(response.result.content[0].text, /cancelled/i);
    });
});

test('a cancelled write does not report a mutation it did not make', async () => {
    await withFixture(async ({ server, fixture }) => {
        const pending = server.handle({
            jsonrpc: '2.0',
            id: 92,
            method: 'tools/call',
            params: { name: 'create_issue', arguments: { issueType: 'Task', summary: 'slow cancelled write' } },
        });
        await sleep(100);
        await server.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 92 } });
        const response = await pending;
        assert.equal(response.result.isError, true);
        assert.match(response.result.content[0].text, /cancelled/i);
        assert.equal(fixture.state.created.length, 0, 'the fixture must never receive a cancelled write');
    });
});

test('the real stdio server completes an MCP session against the fixture site', async () => {
    const fixture = await startJiraFixture();
    const client = new StdioMcpClient({
        command: process.execPath,
        args: [SERVER_PATH],
        env: { ...process.env, ...envFor(fixture) },
        name: 'jira-local-server',
        timeoutMs: 20_000,
    });
    try {
        await client.connect();
        assert.equal(client.serverInfo.name, 'jira');
        assert.equal(client.tools.length, 14);
        const result = await client.callTool('get_myself', {});
        const text = result.content?.[0]?.text ?? '';
        assert.match(text, /Test User <test@example\.com>/);
        const issue = await client.callTool('get_issue', { issueKey: 'TST-1' });
        assert.match(issue.content?.[0]?.text ?? '', /TST-1 — Fix the thing/);
    } finally {
        await client.close();
        await fixture.close();
    }
});
