import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
    credentialNameFor,
    derivedCredentialName,
    isSecureSite,
    normalizeSite,
    resolveTenant,
    resolveToken,
} from '../src/tenant.mjs';
import { makeWorkspace, removeWorkspace } from './helpers.mjs';

const SITE = 'https://thangs2net.atlassian.net';

function writeJson(root, relative, value) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

test('normalizeSite accepts the dialects repos actually use', () => {
    assert.equal(normalizeSite(SITE), SITE);
    assert.equal(normalizeSite('thangs2net.atlassian.net'), SITE);
    assert.equal(normalizeSite(`${SITE}/`), SITE);
    assert.equal(normalizeSite('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.equal(normalizeSite('https://x.atlassian.net/jira/software'), SITE.replace('thangs2net', 'x'));
});

test('normalizeSite rejects what a client cannot use', () => {
    assert.equal(normalizeSite('ftp://x.atlassian.net'), null);
    assert.equal(normalizeSite('https://user:pass@x.atlassian.net'), null);
    assert.equal(normalizeSite('https://x.atlassian.net/?a=1'), null);
    assert.equal(normalizeSite(''), null);
    assert.equal(normalizeSite(null), null);
    assert.equal(normalizeSite(42), null);
});

test('credentialNameFor derives JIRA_TOKEN_<SITE> and honours an explicit ref', () => {
    assert.equal(credentialNameFor(SITE), 'JIRA_TOKEN_THANGS2NET');
    assert.equal(credentialNameFor('https://acme.atlassian.net/'), 'JIRA_TOKEN_ACME');
    assert.equal(credentialNameFor(SITE, 'JIRA_TOKEN_CUSTOM'), 'JIRA_TOKEN_CUSTOM');
    assert.equal(credentialNameFor('not a site'), null);
});

test('no config anywhere resolves to null', () => {
    const root = makeWorkspace();
    try {
        assert.equal(resolveTenant(root), null);
    } finally {
        removeWorkspace(root);
    }
});

test('relative and non-POSIX workspace roots resolve to null', () => {
    assert.equal(resolveTenant('relative/path'), null);
    assert.equal(resolveTenant(''), null);
    assert.equal(resolveTenant(null), null);
});

test('.dsh/jira.json is the explicit dialect and normalizes its values', () => {
    const root = makeWorkspace({
        '.dsh/jira.json': {
            site: 'thangs2net.atlassian.net/',
            email: 'thangs2.net@gmail.com',
            credential: 'JIRA_TOKEN_THANGS2NET',
            projectKey: 'eso',
        },
    });
    try {
        const tenant = resolveTenant(root);
        assert.equal(tenant.site, SITE);
        assert.equal(tenant.label, 'thangs2net.atlassian.net');
        assert.equal(tenant.email, 'thangs2.net@gmail.com');
        assert.equal(tenant.tokenRef, 'JIRA_TOKEN_THANGS2NET');
        assert.equal(tenant.projectKey, 'ESO');
        assert.equal(tenant.source, join(root, '.dsh', 'jira.json'));
        assert.equal(tenant.inlineToken, null);
    } finally {
        removeWorkspace(root);
    }
});

test('.dsh/jira.json accepts alias keys (baseUrl/url, token/apiToken, project)', () => {
    const root = makeWorkspace({
        '.dsh/jira.json': { baseUrl: 'acme.atlassian.net', user: 'dev@acme.test', apiToken: 'inline-token', project: 'abc' },
    });
    try {
        const tenant = resolveTenant(root);
        assert.equal(tenant.site, 'https://acme.atlassian.net');
        assert.equal(tenant.email, 'dev@acme.test');
        assert.equal(tenant.inlineToken, 'inline-token');
        assert.equal(tenant.tokenRef, 'JIRA_TOKEN_ACME');
        assert.equal(tenant.projectKey, 'ABC');
    } finally {
        removeWorkspace(root);
    }
});

test('.cursor/mcp.json "jira" entry is read, command/args are deliberately ignored', () => {
    const root = makeWorkspace({
        '.cursor/mcp.json': {
            mcpServers: {
                other: { command: 'echo', args: ['hi'] },
                jira: {
                    command: '/opt/homebrew/bin/bunx',
                    args: ['-y', '@rokealvo/jira-mcp'],
                    env: {
                        JIRA_BASE_URL: SITE,
                        JIRA_USER_EMAIL: 'cursor@example.test',
                        JIRA_API_TOKEN: 'inline-from-cursor',
                        JIRA_PROJECT_KEY: 'tst',
                        JIRA_TYPE: 'cloud',
                        JIRA_AUTH_TYPE: 'basic',
                    },
                },
            },
        },
    });
    try {
        const tenant = resolveTenant(root);
        assert.equal(tenant.site, SITE);
        assert.equal(tenant.email, 'cursor@example.test');
        assert.equal(tenant.inlineToken, 'inline-from-cursor');
        assert.equal(tenant.tokenRef, 'JIRA_TOKEN_THANGS2NET');
        assert.equal(tenant.projectKey, 'TST');
        assert.equal(tenant.extraEnv.JIRA_TYPE, 'cloud');
        assert.equal(tenant.extraEnv.JIRA_AUTH_TYPE, 'basic');
        // The repo cannot choose the process to spawn.
        assert.equal(tenant.command, undefined);
        assert.equal(tenant.args, undefined);
    } finally {
        removeWorkspace(root);
    }
});

test('.cursor/mcp.json falls back to an entry whose env has JIRA_URL', () => {
    const root = makeWorkspace({
        '.cursor/mcp.json': {
            mcpServers: { 'atlassian-remote': { type: 'http', url: 'https://acme.atlassian.net/mcp', env: { JIRA_URL: 'https://acme.atlassian.net' } } },
        },
    });
    try {
        const tenant = resolveTenant(root);
        assert.equal(tenant.site, 'https://acme.atlassian.net');
    } finally {
        removeWorkspace(root);
    }
});

test('.agents/mcp_config.json is a first-class fallback for Antigravity repos', () => {
    const root = makeWorkspace({
        '.agents/mcp_config.json': {
            mcpServers: { jira: { env: { JIRA_BASE_URL: SITE, JIRA_USER_EMAIL: 'agy@example.test', JIRA_API_TOKEN: 'agy-token' } } },
        },
    });
    try {
        const tenant = resolveTenant(root);
        assert.equal(tenant.email, 'agy@example.test');
        assert.equal(tenant.inlineToken, 'agy-token');
        assert.equal(tenant.source, join(root, '.agents', 'mcp_config.json'));
    } finally {
        removeWorkspace(root);
    }
});

test('.dsh/jira.json wins over .cursor/mcp.json in the same directory', () => {
    const root = makeWorkspace({
        '.dsh/jira.json': { site: 'https://explicit.atlassian.net', email: 'impl@example.test' },
        '.cursor/mcp.json': { mcpServers: { jira: { env: { JIRA_BASE_URL: SITE } } } },
    });
    try {
        assert.equal(resolveTenant(root).site, 'https://explicit.atlassian.net');
    } finally {
        removeWorkspace(root);
    }
});

test('a nested package inherits the monorepo root tenant', () => {
    const root = makeWorkspace({ '.dsh/jira.json': { site: SITE, email: 'root@example.test' } });
    const nested = join(root, 'packages', 'app', 'src');
    mkdirSync(nested, { recursive: true });
    try {
        const tenant = resolveTenant(nested);
        assert.equal(tenant.site, SITE);
        assert.equal(tenant.email, 'root@example.test');
    } finally {
        removeWorkspace(root);
    }
});

test('a broken config stops resolution instead of inheriting a parent tenant', () => {
    const root = makeWorkspace({ '.cursor/mcp.json': { mcpServers: { jira: { env: { JIRA_BASE_URL: SITE } } } } });
    const child = join(root, 'child');
    mkdirSync(child, { recursive: true });
    try {
        mkdirSync(join(child, '.dsh'), { recursive: true });
        writeFileSync(join(child, '.dsh', 'jira.json'), '{ nope');
        const result = resolveTenant(child);
        assert.ok(result.broken, 'expected a broken marker');
        assert.equal(result.broken.path, join(child, '.dsh', 'jira.json'));
        assert.match(result.broken.message, /JSON|Unexpected|token/i);
    } finally {
        removeWorkspace(root);
    }
});

test('an empty config file is skipped in favour of the next dialect', () => {
    const root = makeWorkspace({
        '.dsh/jira.json': { note: 'no site here' },
        '.cursor/mcp.json': { mcpServers: { jira: { env: { JIRA_BASE_URL: SITE } } } },
    });
    try {
        assert.equal(resolveTenant(root).site, SITE);
    } finally {
        removeWorkspace(root);
    }
});

test('the profile-wide default is used only when no repo config exists', () => {
    const root = makeWorkspace();
    try {
        const tenant = resolveTenant(root, {
            globalDefault: { site: 'https://profile.atlassian.net', email: 'profile@example.test', projectKey: 'prf' },
        });
        assert.equal(tenant.site, 'https://profile.atlassian.net');
        assert.equal(tenant.projectKey, 'PRF');
        assert.equal(tenant.source, 'profile');
    } finally {
        removeWorkspace(root);
    }
});

test('resolveToken prefers the DSH credential store', async () => {
    const tenant = {
        tokenRef: 'JIRA_TOKEN_THANGS2NET',
        inlineToken: 'inline-token',
        source: 'test',
    };
    const ctx = {
        credentials: {
            async resolve(ref) {
                assert.equal(ref, 'JIRA_TOKEN_THANGS2NET');
                return { value: 'store-token', source: 'test-file' };
            },
        },
    };
    const result = await resolveToken(ctx, tenant);
    assert.equal(result.token, 'store-token');
    assert.match(result.from, /credentials:JIRA_TOKEN_THANGS2NET\(test-file\)/);
});

test('resolveToken falls back to the inline repo token when the store misses', async () => {
    const tenant = { tokenRef: 'JIRA_TOKEN_X', inlineToken: 'inline-token', source: '.cursor/mcp.json' };
    const ctx = { credentials: { async resolve() { return undefined; } } };
    const result = await resolveToken(ctx, tenant);
    assert.equal(result.token, 'inline-token');
    assert.equal(result.from, '.cursor/mcp.json');
    assert.match(result.reason, /not found/);
});

test('resolveToken falls back to the environment and reports a missing token', async () => {
    const tenant = { tokenRef: 'JIRA_TOKEN_ENVTEST', inlineToken: null, source: 'test' };
    const previous = process.env.JIRA_TOKEN_ENVTEST;
    process.env.JIRA_TOKEN_ENVTEST = 'env-token';
    try {
        const result = await resolveToken({}, tenant);
        assert.equal(result.token, 'env-token');
        assert.equal(result.from, 'environment:JIRA_TOKEN_ENVTEST');
    } finally {
        if (previous === undefined) delete process.env.JIRA_TOKEN_ENVTEST;
        else process.env.JIRA_TOKEN_ENVTEST = previous;
    }

    const missing = await resolveToken({ credentials: { async resolve() { return undefined; } } }, {
        tokenRef: 'JIRA_TOKEN_ABSENT',
        inlineToken: null,
        source: 'test',
    });
    assert.equal(missing.token, null);
    assert.match(missing.reason, /not found/);
});

test('a credential provider that throws does not break resolution', async () => {
    const tenant = { tokenRef: 'JIRA_TOKEN_BOOM', inlineToken: 'inline', source: 'test' };
    const result = await resolveToken(
        {
            credentials: {
                async resolve() {
                    throw new Error('provider exploded');
                },
            },
        },
        tenant,
    );
    assert.equal(result.token, 'inline');
    assert.match(result.reason, /provider exploded/);
});

test('credential lookup works through ctx.get when the service is not injected', async () => {
    const tenant = { tokenRef: 'JIRA_TOKEN_GET', inlineToken: null, source: 'test' };
    const result = await resolveToken(
        {
            get(name) {
                if (name !== 'credentials') return undefined;
                return { async resolve() { return { value: 'via-get', source: 'shim' }; } };
            },
        },
        tenant,
    );
    assert.equal(result.token, 'via-get');
});



test('credential binding refuses single-label hosts and distinguishes non-default ports', () => {
    assert.equal(derivedCredentialName('https://thangs2net'), null, 'a single-label host cannot bind a profile credential');
    assert.equal(derivedCredentialName('https://thangs2net.atlassian.net'), 'JIRA_TOKEN_THANGS2NET');
    assert.equal(derivedCredentialName('https://thangs2net.atlassian.net:8443'), 'JIRA_TOKEN_THANGS2NET_8443');
    assert.equal(derivedCredentialName('http://127.0.0.1:9'), 'JIRA_TOKEN_127_0_0_1_9');

    const root = makeWorkspace({
        '.dsh/jira.json': { site: 'https://thangs2net', email: 'dev@example.test', token: 'inline-token' },
    });
    try {
        const tenant = resolveTenant(root);
        assert.equal(tenant.tokenRef, null, 'no store credential may be bound to a single-label host');
        assert.equal(tenant.inlineToken, 'inline-token', 'its own token still works');
    } finally {
        removeWorkspace(root);
    }
});

test('a repo-requested credential outside JIRA_TOKEN_* is rejected, not read from the environment', async () => {
    const root = makeWorkspace({
        '.dsh/jira.json': { site: SITE, email: 'dev@example.test', credential: 'DEEPSEEK_API_KEY' },
    });
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'must-not-be-used';
    try {
        const tenant = resolveTenant(root);
        assert.equal(tenant.tokenRef, 'JIRA_TOKEN_THANGS2NET', 'only the site-bound ref survives');
        assert.equal(tenant.credentialRefRejected, 'DEEPSEEK_API_KEY');

        const result = await resolveToken({ credentials: { async resolve() { return undefined; } } }, tenant);
        assert.equal(result.token, null);
        assert.match(result.reason, /outside the JIRA_TOKEN_\* namespace/);
    } finally {
        if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
        else process.env.DEEPSEEK_API_KEY = previous;
        removeWorkspace(root);
    }
});

test('a repo cannot point a profile credential at a different site unless the row trusts it', async () => {
    const root = makeWorkspace({
        '.dsh/jira.json': {
            site: 'https://attacker.example',
            email: 'dev@example.test',
            credential: 'JIRA_TOKEN_THANGS2NET',
        },
    });
    try {
        const tenant = resolveTenant(root);
        assert.equal(tenant.tokenRef, 'JIRA_TOKEN_ATTACKER_EXAMPLE', 'bound to the repo-chosen host');
        assert.equal(tenant.requestedTokenRef, 'JIRA_TOKEN_THANGS2NET');

        const store = {
            async resolve(ref) {
                return ref === 'JIRA_TOKEN_THANGS2NET' ? { value: 'real-profile-token', source: 'store' } : undefined;
            },
        };
        const refused = await resolveToken({ credentials: store }, tenant);
        assert.equal(refused.token, null, 'the profile token must not travel to the repo-chosen site');
        assert.match(refused.reason, /only "JIRA_TOKEN_ATTACKER_EXAMPLE" is bound/);

        const overridden = await resolveToken({ credentials: store }, tenant, { allowCredentialRefOverride: true });
        assert.equal(overridden.token, 'real-profile-token');
    } finally {
        removeWorkspace(root);
    }
});

test('the ambient JIRA_API_TOKEN is not sent to a repo-chosen site by default', async () => {
    const previous = process.env.JIRA_API_TOKEN;
    process.env.JIRA_API_TOKEN = 'ambient-profile-token';
    try {
        const tenant = {
            site: 'https://attacker.example',
            tokenRef: 'JIRA_TOKEN_ATTACKER_EXAMPLE',
            requestedTokenRef: null,
            credentialRefRejected: null,
            inlineToken: null,
            source: 'test',
        };
        const refused = await resolveToken({ credentials: { async resolve() { return undefined; } } }, tenant);
        assert.equal(refused.token, null);
        assert.match(refused.reason, /ambient JIRA_API_TOKEN ignored/);

        const allowed = await resolveToken({ credentials: { async resolve() { return undefined; } } }, tenant, {
            allowAmbientToken: true,
        });
        assert.equal(allowed.token, 'ambient-profile-token');
    } finally {
        if (previous === undefined) delete process.env.JIRA_API_TOKEN;
        else process.env.JIRA_API_TOKEN = previous;
    }
});

test('isSecureSite allows https and loopback http only', () => {
    assert.equal(isSecureSite('https://thangs2net.atlassian.net'), true);
    assert.equal(isSecureSite('http://127.0.0.1:8080'), true);
    assert.equal(isSecureSite('http://localhost:8080'), true);
    assert.equal(isSecureSite('http://attacker.example'), false);
    assert.equal(isSecureSite('not a site'), false);
});

test('repo env may tune harmless JIRA_* knobs but never credentials/TLS/site', () => {
    const root = makeWorkspace({
        '.dsh/jira.json': {
            site: SITE,
            email: 'dev@example.test',
            env: {
                JIRA_MAX_RESULTS: '10',
                JIRA_TIMEOUT_MS: '9000',
                JIRA_TYPE: 'cloud',
                JIRA_BASE_URL: 'https://attacker.example',
                JIRA_API_TOKEN: 'repo-injected',
                JIRA_CA_FILE: '/tmp/evil.pem',
                JIRA_TLS_INSECURE: '1',
            },
        },
    });
    try {
        const tenant = resolveTenant(root);
        assert.deepEqual(tenant.extraEnv, {
            JIRA_MAX_RESULTS: '10',
            JIRA_TIMEOUT_MS: '9000',
            JIRA_TYPE: 'cloud',
        });
    } finally {
        removeWorkspace(root);
    }
});

test('a workspace written by another tool is cleaned up even when creation failed midway', () => {
    const root = mkdtempSync(join(tmpdir(), 'jira-plugin-cleanup-'));
    try {
        writeJson(root, '.dsh/jira.json', { site: SITE });
        assert.equal(resolveTenant(root).site, SITE);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
