/**
 * Fixture Jira Cloud API for the offline tests.
 *
 * The real site is never touched by the test suite: every tool assertion runs
 * against this HTTP server on 127.0.0.1. It implements the endpoints the local
 * MCP server uses (and records each request body so a test can assert what the
 * server actually sent — the difference between "the tool returned text" and
 * "the tool sent the right fields").
 *
 * Response shapes mirror the measured live API (2026-11-08, project ESO):
 *   - `/rest/api/3/search/jql` returns `issues`, `nextPageToken`, `isLast` and
 *     no `total`;
 *   - `/rest/api/2/search` is gone (a real site answers 410);
 *   - story points are `customfield_10016`, sprint `customfield_10020`;
 *   - descriptions/comments are wiki markup strings, not ADF.
 */
import { createServer } from 'node:http';

export const FIXTURE_TOKEN = 'test-token';
export const FIXTURE_EMAIL = 'test@example.com';

const DEFAULT_FIELDS = {
    issuetype: { id: '10001', name: 'Task', subtask: false },
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
    priority: { name: 'Medium' },
    project: { key: 'TST', name: 'Test Project', id: '1' },
    reporter: { accountId: 'acc-1', displayName: 'Test User', emailAddress: FIXTURE_EMAIL },
    created: '2026-11-01T10:00:00.000+0000',
    updated: '2026-11-02T11:00:00.000+0000',
    description: 'h3. Goal\n\nFixture description with {{wiki markup}}.',
    labels: ['qc'],
};

function defaultIssues() {
    return [
        {
            id: '1',
            key: 'TST-1',
            self: 'http://127.0.0.1/rest/api/2/issue/1',
            fields: {
                ...DEFAULT_FIELDS,
                summary: 'Fix the thing',
                assignee: { accountId: 'acc-1', displayName: 'Test User', emailAddress: FIXTURE_EMAIL },
                parent: { key: 'TST-0', fields: { summary: 'Parent' } },
                comment: {
                    total: 1,
                    comments: [
                        {
                            id: 'c1',
                            author: { accountId: 'acc-1', displayName: 'Test User' },
                            created: '2026-11-02T12:00:00.000+0000',
                            body: 'First comment in *wiki markup*.',
                        },
                    ],
                },
                subtasks: [],
                issuelinks: [],
            },
        },
        {
            id: '2',
            key: 'TST-2',
            self: 'http://127.0.0.1/rest/api/2/issue/2',
            fields: {
                ...DEFAULT_FIELDS,
                summary: 'Second task',
                status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
                assignee: null,
                labels: [],
                comment: { total: 0, comments: [] },
            },
        },
        {
            id: '3',
            key: 'TST-3',
            self: 'http://127.0.0.1/rest/api/2/issue/3',
            fields: {
                ...DEFAULT_FIELDS,
                summary: 'Third task',
                status: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
                assignee: null,
                labels: ['done'],
            },
        },
    ];
}

function defaultTransitions() {
    return [
        { id: '11', name: 'To Do', to: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } } },
        { id: '21', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } } },
        { id: '31', name: 'Finish', to: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } } },
        { id: '41', name: 'Review', to: { name: 'Human In Review', statusCategory: { key: 'indeterminate', name: 'In Review' } } },
    ];
}

function json(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw.trim()) return resolve(null);
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve({ __raw: raw });
            }
        });
    });
}

/**
 * Start the fixture on an ephemeral loopback port.
 *
 * @param {{ token?: string, email?: string, authRequired?: boolean }} [options]
 * @returns {Promise<{ url: string, port: number, requests: object[], state: object,
 *   close: () => Promise<void>, findRequests: (method: string, pathIncludes: string) => object[] }>}
 */
export async function startJiraFixture(options = {}) {
    const token = options.token ?? FIXTURE_TOKEN;
    const email = options.email ?? FIXTURE_EMAIL;
    const authRequired = options.authRequired !== false;
    const expectedAuth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

    const state = {
        issues: defaultIssues(),
        transitions: defaultTransitions(),
        nextIssueNumber: 100,
        transitionsApplied: [],
        searches: [],
        created: [],
        updated: [],
        comments: [],
        links: [],
        users: [{ accountId: 'acc-1', displayName: 'Test User', emailAddress: FIXTURE_EMAIL }],
    };
    const requests = [];
    const server = createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : null;
            requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });

            if (authRequired && req.headers.authorization !== expectedAuth) {
                json(res, 401, { errorMessages: ['Unauthorized'], errors: {} });
                return;
            }
            const path = url.pathname;

            if (path === '/rest/api/2/myself' && req.method === 'GET') {
                json(res, 200, {
                    accountId: 'acc-1',
                    displayName: 'Test User',
                    emailAddress: email,
                    timeZone: 'Asia/Saigon',
                    self: `${url.origin}/rest/api/2/user?accountId=acc-1`,
                });
                return;
            }

            if (path === '/rest/api/2/__html' && req.method === 'GET') {
                res.writeHead(200, { 'content-type': 'text/html' });
                res.end('<html><body>proxy page</body></html>');
                return;
            }

            const issueMatch = /^\/rest\/api\/2\/issue\/([A-Za-z]+-\d+|\d+)$/.exec(path);
            if (issueMatch && req.method === 'GET') {
                // A deliberately slow issue, used to prove request deadlines and
                // MCP cancellation actually stop the HTTP call.
                if (issueMatch[1] === 'SLOW-1') {
                    await new Promise((resolve) => setTimeout(resolve, 3_000));
                    if (res.destroyed) return;
                }
                const issue = state.issues.find((item) => item.key === issueMatch[1] || item.id === issueMatch[1]);
                if (!issue) {
                    json(res, 404, { errorMessages: [`Issue does not exist or you do not have permission to see it.`], errors: {} });
                    return;
                }
                json(res, 200, issue);
                return;
            }

            const transitionsMatch = /^\/rest\/api\/2\/issue\/([A-Za-z]+-\d+)\/transitions$/.exec(path);
            if (transitionsMatch) {
                const issue = state.issues.find((item) => item.key === transitionsMatch[1]);
                if (!issue) {
                    json(res, 404, { errorMessages: ['Issue not found'], errors: {} });
                    return;
                }
                if (req.method === 'GET') {
                    json(res, 200, { expand: 'transitions', transitions: state.transitions });
                    return;
                }
                if (req.method === 'POST') {
                    const wanted = state.transitions.find((item) => String(item.id) === String(body?.transition?.id));
                    if (!wanted) {
                        json(res, 400, { errorMessages: ['Transition id is not valid'], errors: {} });
                        return;
                    }
                    state.transitionsApplied.push({ issueKey: issue.key, transition: wanted, body });
                    issue.fields.status = { ...wanted.to, statusCategory: wanted.to.statusCategory };
                    res.writeHead(204);
                    res.end();
                    return;
                }
            }

            const commentMatch = /^\/rest\/api\/2\/issue\/([A-Za-z]+-\d+)\/comment$/.exec(path);
            if (commentMatch && req.method === 'POST') {
                state.comments.push({ issueKey: commentMatch[1], body });
                json(res, 201, { id: '9001', body: body?.body ?? '', author: state.users[0], created: '2026-11-08T10:00:00.000+0000' });
                return;
            }

            if (path === '/rest/api/3/search/jql' && req.method === 'POST') {
                state.searches.push(body);
                const maxResults = Number(body?.maxResults) > 0 ? Number(body.maxResults) : 25;
                const start = Number(body?.nextPageToken) > 0 ? Number(body.nextPageToken) : 0;
                const slice = state.issues.slice(start, start + maxResults);
                const end = start + slice.length;
                json(res, 200, {
                    issues: slice,
                    isLast: end >= state.issues.length,
                    ...(end < state.issues.length ? { nextPageToken: String(end) } : {}),
                });
                return;
            }

            if (path === '/rest/api/2/search' && req.method === 'GET') {
                json(res, 410, {
                    errorMessages: [
                        'The requested API has been removed. Please transfer to the /rest/api/3/search/jql API.',
                    ],
                    errors: {},
                });
                return;
            }

            if (path === '/rest/api/2/issue' && req.method === 'POST') {
                // A slow write, so a cancellation test can prove nothing was recorded.
                if (String(body?.fields?.summary ?? '').startsWith('slow')) {
                    await new Promise((resolve) => setTimeout(resolve, 1_000));
                    if (res.destroyed) return;
                }
                state.created.push(body?.fields ?? null);
                state.nextIssueNumber += 1;
                const key = `TST-${state.nextIssueNumber}`;
                state.issues.push({
                    id: String(state.nextIssueNumber),
                    key,
                    fields: { ...DEFAULT_FIELDS, summary: body?.fields?.summary ?? '(created)', ...(body?.fields ?? {}) },
                });
                json(res, 201, { id: String(state.nextIssueNumber), key, self: `${url.origin}/rest/api/2/issue/${state.nextIssueNumber}` });
                return;
            }

            const updateMatch = /^\/rest\/api\/2\/issue\/([A-Za-z]+-\d+)$/.exec(path);
            if (updateMatch && req.method === 'PUT') {
                const issue = state.issues.find((item) => item.key === updateMatch[1]);
                if (!issue) {
                    json(res, 404, { errorMessages: ['Issue not found'], errors: {} });
                    return;
                }
                state.updated.push({ issueKey: issue.key, fields: body?.fields ?? null });
                Object.assign(issue.fields, body?.fields ?? {});
                res.writeHead(204);
                res.end();
                return;
            }

            if (path === '/rest/api/2/issueLink' && req.method === 'POST') {
                state.links.push(body);
                json(res, 201, { id: '8001' });
                return;
            }

            if (path === '/rest/api/2/project/search' && req.method === 'GET') {
                json(res, 200, {
                    maxResults: 25,
                    startAt: 0,
                    total: 1,
                    isLast: true,
                    values: [{ id: '1', key: 'TST', name: 'Test Project', projectTypeKey: 'software' }],
                });
                return;
            }

            const metaMatch = /^\/rest\/api\/2\/issue\/createmeta\/([A-Za-z]+)\/issuetypes$/.exec(path);
            if (metaMatch) {
                json(res, 200, {
                    startAt: 0,
                    maxResults: 50,
                    total: 3,
                    issueTypes: [
                        { id: '10001', name: 'Task', subtask: false },
                        { id: '10002', name: 'Subtask', subtask: true },
                        { id: '10003', name: 'Epic', subtask: false },
                    ],
                });
                return;
            }

            const statusesMatch = /^\/rest\/api\/2\/project\/([A-Za-z]+)\/statuses$/.exec(path);
            if (statusesMatch) {
                json(res, 200, [
                    {
                        name: 'Task',
                        statuses: [
                            { name: 'To Do', statusCategory: { key: 'new' } },
                            { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                            { name: 'Done', statusCategory: { key: 'done' } },
                        ],
                    },
                ]);
                return;
            }

            if (path === '/rest/api/2/user/search' && req.method === 'GET') {
                const query = (url.searchParams.get('query') ?? '').toLowerCase();
                json(res, 200, state.users.filter((user) => String(user.emailAddress).toLowerCase().includes(query)));
                return;
            }

            if (path === '/rest/api/2/field' && req.method === 'GET') {
                json(res, 200, [
                    { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
                    { id: 'customfield_10016', name: 'Story point estimate', custom: true, schema: { type: 'number' } },
                    { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array' } },
                    { id: 'customfield_10099', name: 'Epic Link', custom: true, schema: { type: 'string' } },
                ]);
                return;
            }

            if (path === '/rest/agile/1.0/board' && req.method === 'GET') {
                json(res, 200, {
                    maxResults: 25,
                    total: 1,
                    isLast: true,
                    values: [{ id: 68, name: 'TST board', type: 'scrum', location: { projectKey: 'TST' } }],
                });
                return;
            }

            const sprintMatch = /^\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/.exec(path);
            if (sprintMatch) {
                json(res, 200, {
                    maxResults: 25,
                    total: 1,
                    isLast: true,
                    values: [{ id: 123, name: 'TST Sprint 1', state: 'active', startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-14T00:00:00.000Z' }],
                });
                return;
            }

            json(res, 404, { errorMessages: [`No fixture route for ${req.method} ${path}`], errors: {} });
        })();
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    return {
        url: `http://127.0.0.1:${port}`,
        port,
        requests,
        state,
        findRequests(method, pathIncludes) {
            return requests.filter((item) => item.method === method && item.path.includes(pathIncludes));
        },
        async close() {
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}
