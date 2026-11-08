import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { probeJira } from '../src/probe.mjs';
import { FIXTURE_EMAIL, FIXTURE_TOKEN, startJiraFixture } from './fixtures/jira-server.mjs';

function tenantFor(fixture, extra = {}) {
    return { site: fixture.url, email: FIXTURE_EMAIL, ...extra };
}

test('a live site with a valid token probes ok and returns the account', async () => {
    const fixture = await startJiraFixture();
    try {
        const probe = await probeJira(tenantFor(fixture), { token: FIXTURE_TOKEN, timeoutMs: 2_000 });
        assert.equal(probe.ok, true);
        assert.equal(probe.status, 200);
        assert.equal(probe.account.emailAddress, FIXTURE_EMAIL);
        assert.equal(probe.account.accountId, 'acc-1');
    } finally {
        await fixture.close();
    }
});

test('a rejected token is reported as a token problem, not a generic failure', async () => {
    const fixture = await startJiraFixture();
    try {
        const probe = await probeJira(tenantFor(fixture), { token: 'wrong-token', timeoutMs: 2_000 });
        assert.equal(probe.ok, false);
        assert.match(probe.reason, /token rejected \(HTTP 401\)/);
        assert.equal(probe.status, 401);
    } finally {
        await fixture.close();
    }
});

test('a wrong site path is reported as a 404 site problem', async () => {
    const fixture = await startJiraFixture();
    try {
        const probe = await probeJira({ site: `${fixture.url}/maybe`, email: FIXTURE_EMAIL }, { token: FIXTURE_TOKEN });
        assert.equal(probe.ok, false);
        assert.match(probe.reason, /site not found \(HTTP 404\)/);
    } finally {
        await fixture.close();
    }
});

test('missing token, missing email and no tenant are refused before any request', async () => {
    assert.match((await probeJira(null, { token: 't' })).reason, /no tenant/);
    assert.match((await probeJira({ site: 'https://x.atlassian.net' }, { token: 't' })).reason, /no email/);
    assert.match((await probeJira({ site: 'https://x.atlassian.net', email: FIXTURE_EMAIL }, {})).reason, /no API token/);
});

test('a site that never answers hits the probe deadline', async () => {
    // Accept connections but never respond: the failure mode a hung proxy produces.
    const sockets = new Set();
    const server = createServer((socket) => {
        sockets.add(socket);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        const probe = await probeJira(
            { site: `http://127.0.0.1:${port}`, email: FIXTURE_EMAIL },
            { token: FIXTURE_TOKEN, timeoutMs: 150 },
        );
        assert.equal(probe.ok, false);
        assert.match(probe.reason, /(exceeded|timed out after) 150ms/);
    } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    }
});
