/**
 * Jira MCP for DSH — one plugin, one tenant per workspace, one local server.
 *
 * One DSH profile serves many repos, and each repo may point at a different
 * Atlassian site with its own token. A static `cordis.patch.yml` row cannot
 * express that (the Loader composes rows once at boot, before any session or
 * working directory exists), so the tenant is decided here, per
 * `agent/created`, and a stdio MCP server is started for that workspace only.
 *
 * The server is this bundle's own `src/server.mjs`, run by the host's Node: no
 * npm package, no `npx`/`bunx` resolution at session start, and the tool surface
 * is versioned together with the plugin.
 *
 * Constraints this file obeys, each learned from the installed Harness:
 *  - No `@deepseek-ai/*` import: a host plugin that imports the Harness runtime
 *    can hoist a second copy of a singleton into the profile (the sibling plugins
 *    record this as ATF-OPS-001; `@mu/eso-harness-dsh` ships a zero-dependency
 *    bundle for the same reason).
 *  - Every Cordis service this plugin reads is declared in `inject`.
 *    `ctx.workingDirectory` / `ctx.agents` are proxies that throw
 *    `cannot get property "…" without inject`, and a `try/catch` around that read
 *    turns the plugin into a silent no-op (measured 2026-11-07 on DSH 0.2.2-rc.1:
 *    `inject: ['tools']` alone registered 0 tools with no log line). Optional
 *    services (`agents`, `credentials`) are read through `ctx.get(name)`.
 *  - Tools are registered on `agent.ctx`, not the plugin ctx, so they disappear
 *    when that agent is disposed. An `agent/created` listener must return only
 *    after its tool installation completes, so the handshake is awaited there.
 *  - A workspace with no Jira config registers nothing, silently. The plugin
 *    never blocks or slows a repo it was not configured for.
 *  - A configured workspace with no usable token or a dead site also registers
 *    nothing, and says why — mounting tools that 401 on every call is worse than
 *    no tools and one readable line.
 *  - The event payload is NOT the agent: `dsh-agent` sends
 *    `ctx.serial(carrier, 'agent/created', { agent, … })`, and Cordis strips the
 *    carrier/name before calling listeners. Reading `agent.session` off the
 *    payload registered 0 tools with 0 log lines — the silent no-op the sibling
 *    Jira plugin shipped and fixed (measured 2026-10-29).
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { StdioMcpClient, resultText } from './mcp-stdio-client.mjs';
import { probeJira } from './probe.mjs';
import { isSecureSite, resolveTenant, resolveToken } from './tenant.mjs';

export const name = 'jira-mcp-plugin';

/** Services this plugin reads. `workingDirectory` is required to resolve the repo. */
export const inject = ['tools', 'workingDirectory'];

/** This bundle's own MCP server, run by the host's Node. */
export const LOCAL_SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
export const DEFAULT_SERVER = { command: process.execPath, args: [LOCAL_SERVER] };

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_TOOL_PREFIX = '';

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]`, at most 64 characters. */
const MAX_TOOL_NAME_LENGTH = 64;

/** Absolute POSIX path or nothing. */
const isAbsoluteDir = (value) => typeof value === 'string' && value.startsWith('/');

/** A log-safe session id: the Harness uses an object with `id`; tests may pass a string. */
const sessionIdOf = (agent) => {
    const session = agent?.session;
    if (typeof session === 'string') return session;
    return typeof session?.id === 'string' ? session.id : '?';
};

/**
 * Headless hosts route `logger.info` away from the terminal. `JIRA_PLUGIN_DEBUG=1`
 * mirrors the plugin's diagnostics to stderr, and `JIRA_PLUGIN_DEBUG_FILE`
 * appends them to a file, so a "no Jira tools appeared" session can be explained
 * without reinstalling a debug build.
 */
function debug(message) {
    if (process.env.JIRA_PLUGIN_DEBUG !== '1') return;
    const line = `[jira-mcp-plugin] ${message}\n`;
    try {
        process.stderr.write(line);
    } catch {
        /* diagnostics must never decide anything */
    }
    try {
        const path = process.env.JIRA_PLUGIN_DEBUG_FILE;
        if (path) appendFileSync(path, line);
    } catch {
        /* diagnostics must never decide anything */
    }
}

/**
 * MCP tool name → a model-facing description that carries the working agreement.
 * The server's own descriptions are accurate; these state when to call the tool,
 * because a tool list is read as a policy by the agent.
 */
const DESCRIPTION_OVERRIDES = {
    get_myself: 'Confirm the authenticated Jira user for this repo before a write. Cheap; call it when a Jira call fails with 401/403.',
    get_issue:
        'Read one Jira issue (summary, status, type, assignee, parent, labels, description in wiki markup, comments, links). Call before editing or transitioning.',
    search_issues:
        'Search Jira with JQL (/rest/api/3/search/jql). Always bound the query (project/status/labels) and keep maxResults small; page with nextPageToken instead of raising the cap.',
    get_transitions:
        'List the transitions currently allowed for an issue. Always call this before transition_issue; never invent a transition id.',
    get_projects: 'List or search Jira projects to confirm a project key before create_issue.',
    get_project_issue_types: 'List creatable issue types of a project before create_issue when the type name is uncertain.',
    get_fields:
        'Show the field ids this server writes for Story Points and Sprint, and search other custom fields. Use only when the measured defaults are wrong for a project.',
    get_boards: 'List Jira boards for a project; the board id feeds get_sprints.',
    get_sprints: 'List active/future sprints on a board; the sprint id is accepted by create_issue/update_issue.',
    create_issue:
        'Create one Jira issue. Confirm project/type/summary with the user first. description is Jira wiki markup (not Markdown). Set story points on leaves only — a Story/Task with children rolls up from its children. Use dryRun to preview.',
    update_issue:
        'Update fields on one issue (only what you pass changes). description is Jira wiki markup. storyPoints/sprintId accept null to clear. Confirm destructive edits first.',
    add_comment: 'Add a comment in Jira wiki markup. Distill the conclusion; never paste a raw transcript.',
    transition_issue:
        'Apply a workflow transition returned by get_transitions. Never move an issue to Done or Closed — a human signs Done (AGENTS.md SLP); allowDone:true only when the operator explicitly asked.',
    link_issues:
        'Link two issues. For "Blocks", inwardIssue is the blocker and outwardIssue is the blocked issue. Use "Relates" for a symmetric relation.',
};

/** Keep a configured prefix inside the function-name contract. */
function normalizePrefix(value) {
    if (typeof value !== 'string') return DEFAULT_TOOL_PREFIX;
    return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Apply the configured prefix, avoiding a doubled prefix and the 64-char ceiling. */
function toolNameFor(prefix, rawName) {
    const joined = (prefix && rawName.startsWith(prefix) ? rawName : `${prefix}${rawName}`).replace(/[^A-Za-z0-9_-]/g, '_');
    return joined.length <= MAX_TOOL_NAME_LENGTH ? joined : joined.slice(0, MAX_TOOL_NAME_LENGTH);
}

/**
 * The environment the local server is started with.
 *
 * Exported so `src/selfcheck.mjs` and the tests use the same construction the
 * runtime uses — a second copy would drift and "selfcheck passed" would stop
 * meaning anything.
 *
 * `ELECTRON_RUN_AS_NODE=1` is what lets the Electron-hosted plugin run
 * `process.execPath` as plain Node (measured 2026-11-08: the host binary answers
 * `process.version` as v24.21.0 with that flag). A plain-node host ignores it.
 */
export function buildServerEnv(tenant, token, { insecureTls = false, caFile = null, electronHost = process.versions.electron != null } = {}) {
    return {
        // Repo-provided extras first, so a repo cannot override the invariants below.
        ...tenant.extraEnv,
        JIRA_BASE_URL: tenant.site,
        ...(tenant.email ? { JIRA_USER_EMAIL: tenant.email } : {}),
        JIRA_API_TOKEN: token,
        ...(tenant.projectKey ? { JIRA_PROJECT_KEY: tenant.projectKey } : {}),
        ...(caFile ? { JIRA_CA_FILE: caFile } : {}),
        ...(insecureTls ? { JIRA_TLS_INSECURE: '1' } : {}),
        ...(electronHost ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    };
}

/**
 * Build one tool definition from an MCP tool descriptor.
 *
 * `defineTool` from `dsh-tools` cannot be imported here, so this returns the same
 * registry-ready shape: a JSON Schema for `parameters`, an `output` with a
 * `render`, and an `execute` that resolves to the output value.
 */
function buildTool(client, descriptor, tenant, { prefix, timeoutMs }) {
    const schema =
        descriptor.inputSchema && typeof descriptor.inputSchema === 'object'
            ? descriptor.inputSchema
            : { type: 'object', properties: {}, additionalProperties: false };

    return {
        name: toolNameFor(prefix, descriptor.name),
        description: DESCRIPTION_OVERRIDES[descriptor.name] ?? descriptor.description ?? `Jira: ${descriptor.name}`,
        parameters: schema,
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    text: { type: 'string', description: 'Rendered Jira response text.' },
                    isError: { type: 'boolean', description: 'True when Jira reported a tool-level error.' },
                },
                required: ['text'],
            },
            render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }],
            presentationMeta: () => ({
                title: `Jira · ${tenant.label}`,
                subtitle: descriptor.name,
            }),
        },
        timeoutMs,
        execute: async (args, exec) => {
            try {
                // The registry does not abandon a started body on cancel, so the
                // turn's signal has to reach the socket or a stopped call runs to
                // its full deadline.
                const result = await client.callTool(descriptor.name, args ?? {}, exec?.signal);
                const text = resultText(result);
                if (result?.isError) {
                    // Reported as a value, not a throw: the model needs to see the
                    // server's own message (a bad JQL, a permission denial) to correct itself.
                    return { text: text || 'Jira returned an error with no message.', isError: true };
                }
                return { text };
            } catch (error) {
                /*
                 * A dead server produces a fetch/JSON-RPC error. Returning it as an
                 * isError value keeps the model in the loop (it can tell the user
                 * the Jira server is down) instead of turning into a generic
                 * harness error that hides which tenant failed.
                 */
                return { text: `Jira MCP (${tenant.label}): ${error.message}`, isError: true };
            }
        },
    };
}

/**
 * Cordis/DSH plugin factory.
 *
 * @param {object} [defaults] - programmatic seam for tests; row `config` wins.
 */
export function createJiraPlugin(defaults = {}) {
    return {
        name,
        inject,
        apply(ctx, config = {}) {
            const log = (message) => {
                try {
                    ctx.logger?.info?.(`jira-mcp-plugin: ${message}`);
                } catch {
                    /* logging must never decide anything */
                }
            };

            /** A startup failure the operator asked to be loud about. */
            const complain = (message) => {
                log(message);
                debug(message);
                if (!failOnStartupError) return;
                try {
                    ctx.logger?.error?.(`jira-mcp-plugin: ${message}`);
                } catch {
                    /* logging must never decide anything */
                }
            };

            const serverCommand = config.serverCommand ?? defaults.serverCommand ?? DEFAULT_SERVER.command;
            const serverArgs = Array.isArray(config.serverArgs)
                ? config.serverArgs.map(String)
                : (defaults.serverArgs ?? DEFAULT_SERVER.args);
            const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
            const probeTimeoutMs = Number.isFinite(config.probeTimeoutMs) ? config.probeTimeoutMs : DEFAULT_PROBE_TIMEOUT_MS;
            const insecureTls = (config.insecureTls ?? defaults.insecureTls ?? false) === true;
            const caFile = config.caFile ?? defaults.caFile ?? null;
            const toolPrefix = normalizePrefix(config.toolPrefix ?? defaults.toolPrefix ?? DEFAULT_TOOL_PREFIX);
            /*
             * `failOnStartupError` raises a startup failure from `info` to `error`.
             * It deliberately does NOT throw: a throwing `agent/created` listener
             * rejects agent registration, so throwing here would take down every
             * session in a repo with an unreachable Jira. A plugin never gets to
             * be that important.
             */
            const failOnStartupError = config.failOnStartupError === true;
            const globalDefault = config.default ?? defaults.default ?? null;
            // Test seam only: a YAML row can neither express nor need a probe function.
            const probeImpl = config.probeImpl ?? defaults.probeImpl ?? probeJira;
            /*
             * The site in a tenant comes from a repo file, so it is untrusted:
             * by default only the credential *bound* to that site is resolved and
             * a bare `JIRA_API_TOKEN` is not sent to it. Both opt-ins live in the
             * profile row, never in the repo. `allowInsecureSite` is the same
             * idea for `http://`.
             */
            const trustRepoCredentialRef = config.trustRepoCredentialRef === true;
            const trustAmbientToken = config.trustAmbientToken === true;
            const allowInsecureSite = config.allowInsecureSite === true;
            /**
             * Flipped by the unload effect. Every `await` below re-checks it so a
             * handshake that completes after teardown cannot spawn a process into
             * a cleared map (measured leak: HMR/unload during a slow bootstrap).
             */
            let unloaded = false;

            /** agent → { client, disposers } so disposal can tear down the process. */
            const sessions = new Map();

            /**
             * The agent's effective project directory.
             *
             * `workingDirectory.get(session)` is a pure read of the committed
             * projection; `ensure(agent)` additionally validates that the directory
             * still exists. `ensure` is preferred, `get` is the fallback.
             */
            const currentDirOf = async (agent) => {
                const workingDirectory = ctx.workingDirectory;
                if (typeof workingDirectory?.ensure === 'function') {
                    try {
                        const dir = await workingDirectory.ensure(agent);
                        if (isAbsoluteDir(dir)) return dir;
                    } catch (error) {
                        debug(`workingDirectory.ensure failed: ${error.message}`);
                    }
                }
                try {
                    if (typeof workingDirectory?.get !== 'function') return null;
                    const dir = workingDirectory.get(agent.session);
                    return isAbsoluteDir(dir) ? dir : null;
                } catch (error) {
                    debug(`workingDirectory.get failed: ${error.message}`);
                    return null;
                }
            };

            const startFor = async (agent) => {
                const workspaceRoot = await currentDirOf(agent);
                debug(`start session=${sessionIdOf(agent)} cwd=${workspaceRoot}`);
                if (unloaded) return null;
                if (!workspaceRoot) {
                    // A configured repo whose directory cannot be resolved must not
                    // be a silent no-op: that is the failure class this plugin
                    // exists to make visible.
                    complain(
                        `cannot resolve the working directory for session ${sessionIdOf(agent)}; ` +
                            `no Jira tenant can be chosen, so no tools for this agent.`,
                    );
                    return null;
                }

                const tenant = resolveTenant(workspaceRoot, { globalDefault });
                if (tenant?.broken) {
                    // Do not walk past an unreadable config: the next hit could be a
                    // parent repo's tenant, and writing there is cross-repo mixing.
                    complain(
                        `cannot parse Jira config ${tenant.broken.path} (${tenant.broken.message}). ` +
                            `Resolution stopped there; no tools for workspace ${workspaceRoot}.`,
                    );
                    return null;
                }
                debug(`tenant=${tenant ? tenant.site : 'none'} (${workspaceRoot})`);
                if (!tenant) return null; // this repo has no Jira: register nothing

                if (tenant.credentialRefRejected) {
                    log(
                        `repo config asked for credential "${tenant.credentialRefRejected}", which is outside ` +
                            `the JIRA_TOKEN_* namespace; ignoring it.`,
                    );
                } else if (tenant.requestedTokenRef) {
                    log(
                        `repo config asked for credential "${tenant.requestedTokenRef}" but only ` +
                            `"${tenant.tokenRef}" is bound to ${tenant.site}` +
                            `${trustRepoCredentialRef ? '; honouring the repo request' : '; ignoring it'}.`,
                    );
                }

                /*
                 * The site is repo-controlled. Never send a credential over plain
                 * HTTP off-loopback, and do not probe such a site either — the probe
                 * itself carries the token.
                 */
                if (!allowInsecureSite && !isSecureSite(tenant.site)) {
                    complain(
                        `refusing ${tenant.site} for workspace ${workspaceRoot}: credentials would travel over ` +
                            `plain HTTP to a non-loopback host. Use https, or set allowInsecureSite:true in the row ` +
                            `only if you accept that.`,
                    );
                    return null;
                }

                if (!tenant.email) {
                    complain(
                        `no email configured for ${tenant.site} (workspace ${workspaceRoot}, config ${tenant.source}). ` +
                            `Jira Cloud basic auth needs the user email; tools not registered for this session.`,
                    );
                    return null;
                }

                const { token, from, reason } = await resolveToken(ctx, tenant, {
                    allowCredentialRefOverride: trustRepoCredentialRef,
                    allowAmbientToken: trustAmbientToken,
                });
                if (unloaded) return null;
                if (!token) {
                    complain(
                        `no token for ${tenant.site} (workspace ${workspaceRoot}, expected ${tenant.tokenRef}` +
                            `${reason ? `; ${reason}` : ''}). ` +
                            `Store "${tenant.tokenRef}" in the DSH credential store, or set that variable; ` +
                            `tools not registered for this session.`,
                    );
                    return null;
                }

                /*
                 * Probe before spawning, always. A revoked token or a wrong site
                 * would otherwise mount a full tool surface that 401s on every call;
                 * the probe turns that into one log line and zero tools.
                 */
                const probe = await probeImpl(tenant, {
                    token,
                    caFile,
                    insecureTls,
                    timeoutMs: probeTimeoutMs,
                });
                if (unloaded) return null;
                debug(`probe=${probe?.ok ? 'ok' : `fail(${probe?.reason ?? probe?.status ?? '?'})`}`);
                if (!probe?.ok) {
                    complain(
                        `no usable Jira at ${tenant.site} for workspace ${workspaceRoot} ` +
                            `(${probe?.reason ?? probe?.status ?? 'no response'}). ` +
                            `Tools not registered for this session.`,
                    );
                    return null;
                }

                const client = new StdioMcpClient({
                    command: serverCommand,
                    args: serverArgs,
                    env: buildServerEnv(tenant, token, { insecureTls, caFile }),
                    cwd: workspaceRoot,
                    name: `jira:${tenant.label}`,
                    timeoutMs,
                    debug: (message) => log(`${tenant.label} ${message}`),
                });

                try {
                    await client.connect();
                } catch (error) {
                    const tail = client.stderrTail;
                    client.close();
                    complain(
                        `connect failed for ${tenant.label}${tail ? ` (${tail.split('\n').slice(-2).join(' | ')})` : ''}: ${error.message}`,
                    );
                    return null;
                }
                if (unloaded) {
                    // The plugin was unloaded while the handshake was in flight: the
                    // effect cleanup already cleared `sessions`, so this child would
                    // otherwise outlive the plugin.
                    client.close();
                    return null;
                }

                const disposers = [];
                for (const descriptor of client.tools) {
                    try {
                        const definition = buildTool(client, descriptor, tenant, {
                            // Tool deadlines sit above the transport deadline on
                            // purpose: the transport's own timeout becomes an
                            // actionable tool result, not a generic runtime error.
                            prefix: toolPrefix,
                            timeoutMs: timeoutMs + 5_000,
                        });
                        const dispose = agent.ctx.tools.register(definition);
                        if (typeof dispose === 'function') disposers.push(dispose);
                    } catch (error) {
                        log(`cannot register ${descriptor?.name}: ${error.message}`);
                    }
                }

                log(
                    `registered ${disposers.length} tools for ${tenant.label} ` +
                        `(${tenant.site}, token from ${from}, cwd ${workspaceRoot})`,
                );
                return { client, disposers, tenant };
            };

            /*
             * The event payload is NOT the agent. `dsh-agent` announces with
             * `ctx.serial(carrier, 'agent/created', { agent, source, …signal })` and
             * emits `{ agent }` on disposal, and Cordis' `dispatch()` shifts the
             * `this` carrier and the event name off the argument list before calling
             * a listener — so listeners receive the payload object, which every
             * shipped consumer destructures (`ctx.on('agent/created', ({ agent }) => …)`).
             */
            const agentOf = (payload, event) => {
                const agent = payload?.agent;
                // A truthy non-object would pass a plain falsy check, then throw
                // inside `WeakSet.add` — outside the install try/catch — and
                // reject the awaited `agent/created` listener, killing agent
                // registration. The contract is an object or nothing.
                if (typeof agent !== 'object' || agent === null) {
                    log(`${event} arrived without an agent payload; ignoring`);
                    return null;
                }
                return agent;
            };

            /** Agents disposed while their session was still being installed. */
            const disposedEarly = new WeakSet();
            /** Agents whose installation is in flight, so a bootstrap and an event cannot race. */
            const installing = new WeakSet();

            const teardown = (entry) => {
                for (const dispose of entry.disposers) {
                    try {
                        dispose();
                    } catch {
                        /* already gone */
                    }
                }
                void entry.client.close();
            };

            const installFor = async (agent, origin) => {
                if (!agent || sessions.has(agent) || installing.has(agent)) return;
                installing.add(agent);
                debug(`install ${origin} session=${sessionIdOf(agent)}`);
                let entry = null;
                try {
                    entry = await startFor(agent);
                } catch (error) {
                    log(`${origin} failed: ${error.message}`);
                    return;
                } finally {
                    installing.delete(agent);
                }
                if (!entry) return;
                // The agent may have been disposed while the handshake was in flight,
                // or the plugin unloaded: storing the entry then would leak a process
                // nothing can reach.
                if (disposedEarly.has(agent) || unloaded) {
                    teardown(entry);
                    return;
                }
                sessions.set(agent, entry);
            };

            // One listener, wrapped so a failure here cannot break agent creation.
            const offCreated = ctx.on('agent/created', async (payload) => {
                await installFor(agentOf(payload, 'agent/created'), 'agent/created');
            });

            const offDisposed = ctx.on('agent/disposed', (payload) => {
                const agent = agentOf(payload, 'agent/disposed');
                if (!agent) return;
                disposedEarly.add(agent);
                const entry = sessions.get(agent);
                if (!entry) return;
                sessions.delete(agent);
                teardown(entry);
            });

            /*
             * Agents that already exist when this plugin activates never emit
             * `agent/created`: a plugin-manager enable or an HMR reload would leave
             * every live session Jira-less for the rest of its life. Seed them,
             * without blocking activation on a handshake.
             *
             * `agents` is read through `ctx.get` rather than declared in `inject`:
             * bootstrap is best-effort, and a host without the service must still
             * get the `agent/created` path.
             */
            void (async () => {
                let existing = [];
                try {
                    const agents = ctx.get?.('agents');
                    existing = typeof agents?.list === 'function' ? agents.list() : [];
                } catch (error) {
                    log(`cannot list live agents: ${error.message}`);
                    return;
                }
                for (const agent of existing) {
                    if (unloaded) return;
                    await installFor(agent, 'agent bootstrap');
                }
            })();

            // Plugin unload must not leave MCP processes behind, even if the host
            // never emits a matching `agent/disposed` for a live agent.
            ctx.effect(() => () => {
                // Mark first: an install in flight checks this after every await and
                // closes its own child instead of storing it into a cleared map.
                unloaded = true;
                for (const [, entry] of sessions) teardown(entry);
                sessions.clear();
                offCreated?.();
                offDisposed?.();
            });
        },
    };
}

export default createJiraPlugin();
