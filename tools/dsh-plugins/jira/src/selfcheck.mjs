#!/usr/bin/env node
/**
 * Live smoke check for `@local/jira-mcp-plugin`, outside the Harness.
 *
 * It exercises the same code the plugin runs at `agent/created` — resolve the
 * tenant from the workspace, resolve the token, probe
 * `GET /rest/api/2/myself`, start the local server, handshake, list tools, call
 * one read-only tool — so a failure here is the failure the plugin would hit,
 * with a readable message instead of a silent "no Jira tools appeared".
 *
 *   node src/selfcheck.mjs                  # workspace = cwd
 *   node src/selfcheck.mjs /path/to/repo
 *   node src/selfcheck.mjs /path/to/repo ESO-488   # also read one issue
 *
 * Exit code 0 means the site, token, TLS path, handshake, tool list and a
 * read-only call all work; 1 means they did not. The token is never printed.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { StdioMcpClient, resultText } from './mcp-stdio-client.mjs';
import { defaultCaFile, insecureTlsFromEnv } from './jira-api.mjs';
import { DEFAULT_SERVER, buildServerEnv } from './plugin.mjs';
import { probeJira } from './probe.mjs';
import { isSecureSite, resolveTenant, resolveToken } from './tenant.mjs';

/**
 * Minimal reader for the parts of `$DSH_HOME/.credentials.yaml` this script needs.
 *
 * Inside the Harness the store is reached through `ctx.credentials.resolve`; this
 * is a `refs:` mapping on disk, so a dev script can read it without a YAML
 * dependency. Values are never echoed, only their presence.
 */
function credentialStoreLookup(ref) {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    const path = join(home, '.credentials.yaml');
    let text;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        return { path, value: null };
    }
    let inRefs = false;
    for (const line of text.split(/\r?\n/)) {
        if (/^refs:\s*$/.test(line)) {
            inRefs = true;
            continue;
        }
        if (!inRefs) continue;
        if (/^\S/.test(line)) break; // a new top-level key ends the block
        const match = /^\s+([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
        if (!match || match[1] !== ref) continue;
        const value = match[2].trim().replace(/^['"]|['"]$/g, '');
        return { path, value: value || null };
    }
    return { path, value: null };
}

/** The plugin context surface that token resolution actually touches. */
function contextShim() {
    return {
        credentials: {
            async resolve(ref) {
                const hit = credentialStoreLookup(ref);
                return hit.value ? { value: hit.value, source: hit.path } : undefined;
            },
        },
    };
}

function serverFromEnvironment() {
    const command = process.env.JIRA_SELFCHECK_COMMAND || DEFAULT_SERVER.command;
    const rawArgs = process.env.JIRA_SELFCHECK_ARGS;
    const args = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [DEFAULT_SERVER.args[0]];
    return { command, args };
}

async function main() {
    const workspace = resolvePath(process.argv[2] ?? process.cwd());
    const issueKey = process.argv[3] ?? null;
    console.log(`workspace:  ${workspace}`);

    const tenant = resolveTenant(workspace);
    if (tenant?.broken) {
        console.error(`FAIL: cannot parse Jira config ${tenant.broken.path} — ${tenant.broken.message}.`);
        process.exitCode = 1;
        return;
    }
    if (!tenant) {
        console.error(
            'FAIL: no Jira config found here or in a parent directory.\n' +
                '      Add .dsh/jira.json, or a "jira" entry in .cursor/mcp.json / .agents/mcp_config.json.',
        );
        process.exitCode = 1;
        return;
    }
    console.log(`site:       ${tenant.site}`);
    console.log(`email:      ${tenant.email ?? '(not configured)'}`);
    console.log(`project:    ${tenant.projectKey ?? '(not configured — pass projectKey to tools)'}`);
    console.log(`config:     ${tenant.source}`);
    console.log(`credential: ${tenant.tokenRef ?? '(none derived)'}`);
    if (tenant.credentialRefRejected) {
        console.log(`            repo asked for "${tenant.credentialRefRejected}" — ignored (outside JIRA_TOKEN_*)`);
    } else if (tenant.requestedTokenRef) {
        console.log(
            `            repo asked for "${tenant.requestedTokenRef}" — ${process.env.JIRA_TRUST_REPO_CREDENTIAL_REF === '1' ? 'honoured (JIRA_TRUST_REPO_CREDENTIAL_REF=1)' : 'ignored; only the site-bound ref is used'}`,
        );
    }

    if (!tenant.email) {
        console.error('FAIL: no email configured — Jira Cloud basic auth needs the user email.');
        process.exitCode = 1;
        return;
    }

    if (!isSecureSite(tenant.site) && process.env.JIRA_ALLOW_INSECURE_SITE !== '1') {
        console.error(
            `FAIL: ${tenant.site} is not HTTPS (non-loopback). A probe would send the token over plain HTTP.\n` +
                '      Use https, or set JIRA_ALLOW_INSECURE_SITE=1 only if you accept that.',
        );
        process.exitCode = 1;
        return;
    }

    const { token, from, reason } = await resolveToken(contextShim(), tenant, {
        allowCredentialRefOverride: process.env.JIRA_TRUST_REPO_CREDENTIAL_REF === '1',
        // selfcheck is operator-run against the workspace they named; the ambient
        // token is allowed here *because they ran it*, and the source is printed.
        allowAmbientToken: true,
    });
    console.log(`token:      ${token ? `resolved from ${from} (not printed)` : `none${reason ? ` (${reason})` : ''}`}`);
    if (token && from === 'environment:JIRA_API_TOKEN') {
        console.warn('            ⚠ ambient JIRA_API_TOKEN used for a repo-chosen site; prefer a site-bound credential');
    }
    if (!token) {
        console.error(
            `FAIL: no token for ${tenant.site}. Store "${tenant.tokenRef}" in the DSH credential store ` +
                '(~/.dsh/.credentials.yaml), or put it in the repo MCP config / environment.',
        );
        process.exitCode = 1;
        return;
    }

    const caFile = defaultCaFile();
    const insecureTls = insecureTlsFromEnv();
    console.log(`tls:        ca ${caFile ?? '(none found; using Node roots)'}${insecureTls ? ' · VERIFY DISABLED (JIRA_TLS_INSECURE=1)' : ''}`);

    const probe = await probeJira(tenant, { token, caFile, insecureTls, timeoutMs: 5_000 });
    if (!probe.ok) {
        console.error(`FAIL: Jira probe failed — ${probe.reason ?? probe.status ?? 'no response'}.`);
        console.error('      The plugin registers no tools in this workspace until the probe succeeds.');
        process.exitCode = 1;
        return;
    }
    console.log(`myself:     ok — ${probe.account?.displayName ?? '?'} <${probe.account?.emailAddress ?? '?'}> (${probe.account?.accountId ?? '?'})`);

    const { command, args } = serverFromEnvironment();
    const client = new StdioMcpClient({
        command,
        args,
        env: buildServerEnv(tenant, token, { caFile, insecureTls }),
        cwd: workspace,
        name: `jira:${tenant.label}`,
        timeoutMs: 120_000,
    });

    try {
        await client.connect();
    } catch (error) {
        const tail = client.stderrTail;
        console.error(`FAIL: handshake failed — ${error.message}${tail ? `\n      server stderr: ${tail.split('\n').slice(-3).join(' | ')}` : ''}`);
        process.exitCode = 1;
        return;
    }

    console.log(`server:     ${client.serverInfo?.name ?? '?'} ${client.serverInfo?.version ?? ''}`.trimEnd());
    console.log(`protocol:   ${client.protocolVersion}`);
    console.log(`tools:      ${client.tools.length} — ${client.tools.map((tool) => tool.name).join(', ')}`);

    const required = ['get_myself', 'get_issue', 'search_issues', 'get_transitions', 'create_issue', 'transition_issue'];
    const missing = required.filter((toolName) => !client.tools.some((tool) => tool.name === toolName));
    if (missing.length) {
        console.error(`FAIL: expected tool(s) missing from tools/list: ${missing.join(', ')}`);
        process.exitCode = 1;
        await client.close();
        return;
    }

    try {
        const myself = await client.callTool('get_myself', {});
        const myselfText = resultText(myself);
        if (myself?.isError) {
            console.error(`FAIL: get_myself returned an error — ${myselfText.slice(0, 300)}`);
            process.exitCode = 1;
            return;
        }
        console.log(`get_myself: ${myselfText.replace(/\s+/g, ' ').slice(0, 200)}`);

        if (issueKey) {
            const issue = await client.callTool('get_issue', { issueKey });
            const issueText = resultText(issue);
            if (issue?.isError) {
                console.error(`FAIL: get_issue(${issueKey}) returned an error — ${issueText.slice(0, 300)}`);
                process.exitCode = 1;
                return;
            }
            console.log(`get_issue:  ${issueText.split('\n').slice(0, 3).join(' | ').slice(0, 240)}`);
        }

        console.log(
            `PASS: site, token, TLS, handshake, ${client.tools.length} tools and a read-only Jira call all work.`,
        );
    } catch (error) {
        console.error(`FAIL: tools/call failed — ${error.message}`);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
}

await main();
