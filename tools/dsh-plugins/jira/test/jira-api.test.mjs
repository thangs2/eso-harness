import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
    JiraApiError,
    createJiraClient,
    customFieldIds,
    defaultCaFile,
    insecureTlsFromEnv,
    readCaPem,
} from '../src/jira-api.mjs';
import { FIXTURE_EMAIL, FIXTURE_TOKEN, startJiraFixture } from './fixtures/jira-server.mjs';

function clientFor(fixture, extra = {}) {
    return createJiraClient({
        site: fixture.url,
        email: FIXTURE_EMAIL,
        token: FIXTURE_TOKEN,
        timeoutMs: 5_000,
        ...extra,
    });
}

test('createJiraClient refuses incomplete credentials instead of failing later', () => {
    assert.throws(() => createJiraClient({ site: 'not-a-url', email: 'a@b.c', token: 't' }), (error) => {
        assert.ok(error instanceof JiraApiError);
        assert.equal(error.code, 'BAD_SITE');
        return true;
    });
    assert.throws(() => createJiraClient({ site: 'https://x.atlassian.net', email: '', token: 't' }), /email is required/);
    assert.throws(() => createJiraClient({ site: 'https://x.atlassian.net', email: 'a@b.c', token: '' }), /token is required/);
});

test('requests carry basic auth and are serialized as JSON', async () => {
    const fixture = await startJiraFixture();
    try {
        const client = clientFor(fixture);
        const me = await client.myself();
        assert.equal(me.emailAddress, FIXTURE_EMAIL);
        const request = fixture.findRequests('GET', '/rest/api/2/myself').at(-1);
        assert.equal(request.method, 'GET');

        const page = await client.projectSearch({ query: 'TST', maxResults: 3 });
        assert.equal(page.values[0].key, 'TST');
        const projectRequest = fixture.findRequests('GET', '/rest/api/2/project/search').at(-1);
        assert.deepEqual(projectRequest.query, { query: 'TST', maxResults: '3' });
    } finally {
        await fixture.close();
    }
});

test('a 401 becomes an actionable JiraApiError that names the status', async () => {
    const fixture = await startJiraFixture();
    try {
        const client = clientFor(fixture, { token: 'wrong-token' });
        await assert.rejects(
            () => client.myself(),
            (error) => {
                assert.ok(error instanceof JiraApiError);
                assert.equal(error.status, 401);
                assert.match(error.message, /HTTP 401/);
                assert.match(error.message, /authentication failed/);
                assert.deepEqual(error.messages, ['Unauthorized']);
                return true;
            },
        );
    } finally {
        await fixture.close();
    }
});

test('the removed /rest/api/2/search is reported with its 410 hint', async () => {
    const fixture = await startJiraFixture();
    try {
        const client = clientFor(fixture);
        await assert.rejects(
            () => client.requestJson('GET', '/rest/api/2/search', { query: { jql: 'project = TST' } }),
            (error) => {
                assert.equal(error.status, 410);
                assert.match(error.message, /removed/);
                assert.match(error.message, /search\/jql/);
                return true;
            },
        );
    } finally {
        await fixture.close();
    }
});

test('a 2xx that is not JSON is an error, not a silent empty result', async () => {
    const fixture = await startJiraFixture();
    try {
        const client = clientFor(fixture);
        await assert.rejects(
            () => client.requestJson('GET', '/rest/api/2/__html'),
            (error) => {
                assert.equal(error.code, 'NON_JSON');
                assert.match(error.message, /non-JSON/);
                return true;
            },
        );
    } finally {
        await fixture.close();
    }
});

test('an unreachable site is reported as a network error, not a stack trace', async () => {
    const closed = createServer();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = closed.address().port;
    await new Promise((resolve) => closed.close(resolve));

    const client = createJiraClient({
        site: `http://127.0.0.1:${port}`,
        email: FIXTURE_EMAIL,
        token: FIXTURE_TOKEN,
        timeoutMs: 1_000,
    });
    await assert.rejects(
        () => client.myself(),
        (error) => {
            assert.ok(error instanceof JiraApiError);
            assert.match(error.message, /cannot reach/);
            assert.match(error.code, /ECONNREFUSED/);
            return true;
        },
    );
});

test('search returns the opaque page token and sends the fields list', async () => {
    const fixture = await startJiraFixture();
    try {
        const client = clientFor(fixture);
        const page = await client.search({ jql: 'project = TST', maxResults: 1, fields: ['summary', 'status'] });
        assert.equal(page.issues.length, 1);
        assert.equal(page.isLast, false);
        assert.equal(page.nextPageToken, '1');
        const sent = fixture.state.searches.at(-1);
        assert.deepEqual(sent.fields, ['summary', 'status']);
        assert.equal(sent.jql, 'project = TST');
        assert.equal(sent.nextPageToken, undefined);
    } finally {
        await fixture.close();
    }
});


test('an aborted request rejects with CANCELLED and stops waiting on the socket', async () => {
    const fixture = await startJiraFixture();
    try {
        const client = clientFor(fixture);
        const controller = new AbortController();
        const started = Date.now();
        const pending = client.requestJson('GET', '/rest/api/2/issue/SLOW-1', { signal: controller.signal });
        setTimeout(() => controller.abort(), 80);
        await assert.rejects(pending, (error) => {
            assert.ok(error instanceof JiraApiError);
            assert.equal(error.code, 'CANCELLED');
            return true;
        });
        assert.ok(Date.now() - started < 1_000, 'abort must beat the 3 s fixture delay');
    } finally {
        await fixture.close();
    }
});

test('an already-aborted signal never opens a socket', async () => {
    const fixture = await startJiraFixture();
    try {
        const client = clientFor(fixture);
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            () => client.myself({ signal: controller.signal }),
            (error) => {
                assert.equal(error.code, 'CANCELLED');
                return true;
            },
        );
        assert.equal(fixture.findRequests('GET', '/rest/api/2/myself').length, 0);
    } finally {
        await fixture.close();
    }
});

test('the per-request deadline is absolute, not an idle timeout', async () => {
    const fixture = await startJiraFixture();
    try {
        const client = clientFor(fixture, { timeoutMs: 150 });
        const started = Date.now();
        await assert.rejects(
            () => client.requestJson('GET', '/rest/api/2/issue/SLOW-1'),
            (error) => {
                assert.ok(error instanceof JiraApiError);
                assert.equal(error.code, 'TIMEOUT');
                assert.match(error.message, /exceeded 150ms/);
                return true;
            },
        );
        assert.ok(Date.now() - started < 1_000);
    } finally {
        await fixture.close();
    }
});

test('customFieldIds keeps the measured defaults but trusts the site names', () => {
    assert.deepEqual(customFieldIds(null), { storyPoints: 'customfield_10016', sprint: 'customfield_10020' });
    assert.deepEqual(
        customFieldIds([
            { id: 'customfield_20001', name: 'Story Points' },
            { id: 'customfield_20002', name: 'Sprint' },
        ]),
        { storyPoints: 'customfield_20001', sprint: 'customfield_20002' },
    );
    // An unrelated field name must not rewrite the defaults.
    assert.deepEqual(customFieldIds([{ id: 'customfield_9', name: 'Epic Link' }]), {
        storyPoints: 'customfield_10016',
        sprint: 'customfield_10020',
    });
});

test('defaultCaFile honours JIRA_CA_FILE and falls back to an OS bundle', () => {
    const previous = process.env.JIRA_CA_FILE;
    try {
        process.env.JIRA_CA_FILE = '/nonexistent/jira-ca.pem';
        assert.equal(defaultCaFile(), null);
        process.env.JIRA_CA_FILE = '/etc/ssl/cert.pem';
        assert.equal(defaultCaFile(), '/etc/ssl/cert.pem');
        delete process.env.JIRA_CA_FILE;
        // On this host the OS bundle exists; on a host without one the function returns null.
        const detected = defaultCaFile();
        assert.ok(detected === null || detected.startsWith('/'));
    } finally {
        if (previous === undefined) delete process.env.JIRA_CA_FILE;
        else process.env.JIRA_CA_FILE = previous;
    }
});

test('readCaPem and insecureTlsFromEnv are conservative', () => {
    assert.equal(readCaPem(null), null);
    assert.equal(readCaPem('/nonexistent/jira-ca.pem'), null);
    const pem = readCaPem('/etc/ssl/cert.pem');
    assert.ok(pem === null || Buffer.isBuffer(pem));

    assert.equal(insecureTlsFromEnv({}), false);
    assert.equal(insecureTlsFromEnv({ JIRA_TLS_INSECURE: '1' }), true);
    assert.equal(insecureTlsFromEnv({ JIRA_TLS_INSECURE: 'true' }), true);
    assert.equal(insecureTlsFromEnv({ JIRA_TLS_INSECURE: '0' }), false);
});
