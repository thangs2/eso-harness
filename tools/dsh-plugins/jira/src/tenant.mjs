/**
 * Workspace → Jira tenant resolution.
 *
 * The problem this solves: one DSH profile serves many repos, and each repo may
 * point at a different Atlassian site with its own token. A static
 * `cordis.patch.yml` row cannot express that — the Loader composes rows once at
 * boot, before any session or working directory exists, and `!!js` evaluates
 * against the loader context, which has no session cwd. So the tenant is decided
 * per agent creation, in code.
 *
 * Resolution order for a workspace root (first hit wins, walking up at most six
 * parents so a monorepo root serves its packages):
 *   1. `<root>/.dsh/jira.json`            — explicit, per repo, commit-safe when it
 *                                            holds only `site` + `email` + a
 *                                            credential *name*, never the token
 *   2. `<root>/.cursor/mcp.json`          — what Cursor already uses in this repo
 *   3. `<root>/.agents/mcp_config.json`   — what Antigravity uses in this repo
 *   4. null                               — no Jira here: register nothing
 *
 * The token itself is never read from these files when a credential name is
 * present: it is resolved through `ctx.credentials` so the secret lives in
 * `$DSH_HOME/.credentials.yaml` (owner-only), not in a repo file. A repo MCP
 * config that already carries `JIRA_API_TOKEN` inline is used as a fallback for
 * machines that have not transferred to the credential store yet — the plugin never
 * copies it anywhere.
 *
 * A config file that exists but does not parse stops resolution instead of being
 * skipped: climbing past it would silently inherit a *parent* repo's tenant.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

/** Env keys the plugin itself decides; a repo config may set every other `JIRA_*` key. */
const CONTROLLED_ENV = new Set([
    'JIRA_BASE_URL',
    'JIRA_USER_EMAIL',
    'JIRA_API_TOKEN',
    'JIRA_PROJECT_KEY',
    'JIRA_CA_FILE',
    'JIRA_TLS_INSECURE',
]);

/**
 * A repo may only name a credential inside this namespace. Without the rule a
 * repo config could ask the plugin to resolve *any* key in the DSH store (or
 * read any environment variable) and send it to a site the same repo chose —
 * i.e. exfiltrate a profile secret by committing one JSON file.
 */
const CREDENTIAL_REF_PATTERN = /^JIRA_TOKEN_[A-Z0-9_]+$/;

/** Loopback hosts are the only place a token may travel over plain HTTP. */
export function isLoopbackHost(hostname) {
    const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * May the resolved credential be sent to this site?
 *
 * `https` is required off-loopback; an `http://` site is accepted only for
 * loopback (the offline fixtures, a local proxy). The plugin additionally
 * refuses to mount tools for an insecure site unless the *row* opts in, because
 * the site comes from a repo file, not from the operator.
 */
export function isSecureSite(site) {
    try {
        const url = new URL(site);
        if (url.protocol === 'https:') return true;
        return url.protocol === 'http:' && isLoopbackHost(url.hostname);
    } catch {
        return false;
    }
}

const MAX_PARENT_DEPTH = 6;

function readJson(path) {
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        return { __broken: error.message ?? String(error) };
    }
}

/**
 * Normalize a Jira site to an origin.
 *
 * Accepts `https://x.atlassian.net`, `x.atlassian.net`, trailing slashes, and a
 * `/wiki`-style path on a copy (Jira Cloud is HTTPS-only; a bare host gets
 * `https://`). Rejects credentials, query and fragment, and any scheme other
 * than http(s). A single-label host (`localhost`) is accepted as a site — the
 * offline fixtures use loopback — but `derivedCredentialName` refuses to bind a
 * profile credential to it.
 */
export function normalizeSite(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
        const url = new URL(withScheme);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        if (!url.hostname) return null;
        if (url.username || url.password) return null;
        if (url.search || url.hash) return null;
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
}

/** A stable, log-safe label for a tenant: `thangs2net.atlassian.net`. */
export function labelFor(site) {
    try {
        return new URL(site).host;
    } catch {
        return String(site);
    }
}

/**
 * The credential key a site is *bound* to: `JIRA_TOKEN_THANGS2NET`.
 *
 * The label uses the full host plus a non-default port, so two different
 * origins cannot share one credential. A **single-label** host cannot bind a
 * profile credential at all: `https://thangs2net` and
 * `https://thangs2net.atlassian.net` would otherwise both derive
 * `JIRA_TOKEN_THANGS2NET`, and the first is not the site the operator meant.
 * Such a host can still authenticate with an inline token from its own config.
 */
export function derivedCredentialName(site) {
    const origin = normalizeSite(site);
    if (!origin) return null;
    const url = new URL(origin);
    if (!url.hostname.includes('.')) return null;
    const defaultPort = url.protocol === 'https:' ? '443' : '80';
    const portSuffix = url.port && url.port !== defaultPort ? `_${url.port}` : '';
    const label = url.hostname
        .replace(/\.atlassian\.net$/i, '')
        .replace(/[^a-z0-9]+/gi, '_')
        .toUpperCase();
    return `JIRA_TOKEN_${label}${portSuffix}`;
}

/**
 * The credential key a site maps to. Kept as a helper for callers that only
 * need a name; tenant resolution deliberately does **not** trust this name for
 * lookup — see `buildTenant`.
 */
export function credentialNameFor(site, explicit) {
    if (typeof explicit === 'string' && explicit.trim() && CREDENTIAL_REF_PATTERN.test(explicit.trim())) {
        return explicit.trim();
    }
    return derivedCredentialName(site);
}

/** Copy only `JIRA_*` extra env keys the plugin does not control itself. */
function collectExtraEnv(env) {
    const extra = {};
    if (!env || typeof env !== 'object') return extra;
    for (const [key, value] of Object.entries(env)) {
        if (!/^JIRA_/.test(key)) continue;
        if (CONTROLLED_ENV.has(key)) continue;
        if (typeof value === 'string' && value.trim()) extra[key] = value.trim();
        else if (typeof value === 'number' || typeof value === 'boolean') extra[key] = String(value);
    }
    return extra;
}

/** Shape one candidate from either config dialect into the internal form. */
function buildTenant({ site, email, credentialRef, inlineToken, projectKey, extraEnv = {}, source }) {
    const origin = normalizeSite(site);
    if (!origin) return null;
    const derived = derivedCredentialName(origin);
    const requestedRaw = typeof credentialRef === 'string' ? credentialRef.trim() : '';
    const requestedValid = requestedRaw && CREDENTIAL_REF_PATTERN.test(requestedRaw) ? requestedRaw : null;
    return {
        site: origin,
        label: labelFor(origin),
        email: typeof email === 'string' && email.trim() ? email.trim() : null,
        /**
         * The only ref the plugin will resolve without an operator opt-in: the
         * one bound to this site. A repo cannot point a profile credential at a
         * different site by editing a JSON file.
         */
        tokenRef: derived,
        /** A ref the repo asked for, honoured only when the row trusts repo config. */
        requestedTokenRef: requestedValid && requestedValid !== derived ? requestedValid : null,
        /** The repo asked for something outside the JIRA_TOKEN_* namespace. */
        credentialRefRejected: requestedRaw && !requestedValid ? requestedRaw : null,
        /** An inline token is tolerated only for local, gitignored configs. */
        inlineToken: typeof inlineToken === 'string' && inlineToken.trim() ? inlineToken.trim() : null,
        projectKey: typeof projectKey === 'string' && projectKey.trim() ? projectKey.trim().toUpperCase() : null,
        extraEnv,
        source,
    };
}

/** `<root>/.dsh/jira.json` — the explicit per-repo dialect. */
function fromDshConfig(raw, source) {
    if (!raw || typeof raw !== 'object') return null;
    return buildTenant({
        site: raw.site ?? raw.baseUrl ?? raw.url ?? raw.siteUrl,
        email: raw.email ?? raw.user ?? raw.username,
        credentialRef: raw.credential ?? raw.credentialRef ?? raw.tokenRef,
        inlineToken: raw.token ?? raw.apiToken,
        projectKey: raw.projectKey ?? raw.project,
        extraEnv: collectExtraEnv(raw.env),
        source,
    });
}

/**
 * `.cursor/mcp.json` / `.agents/mcp_config.json` — the MCP client dialect.
 *
 * Picks the entry literally named `jira` (both repos on this machine use that),
 * else the first entry whose env carries `JIRA_BASE_URL`/`JIRA_URL`, else the
 * first entry whose url mentions Jira. `command`/`args` from the repo are
 * deliberately ignored: the same local server is started from this plugin's own
 * config, so a repo cannot turn an agent session into an arbitrary process
 * launch.
 */
function fromMcpConfig(raw, source) {
    const servers = raw?.mcpServers ?? raw?.mcp_servers;
    if (!servers || typeof servers !== 'object') return null;
    const entries = Object.entries(servers).filter(([, value]) => value && typeof value === 'object');
    const chosen =
        entries.find(([key]) => /^jira(-mcp)?$/i.test(key)) ??
        entries.find(([, value]) => Boolean(value.env?.JIRA_BASE_URL || value.env?.JIRA_URL)) ??
        entries.find(([, value]) => /jira/i.test(String(value.url ?? '')));
    if (!chosen) return null;
    const value = chosen[1];
    const env = value.env ?? {};
    const site = env.JIRA_BASE_URL ?? env.JIRA_URL ?? value.url ?? null;
    return buildTenant({
        site,
        email: env.JIRA_USER_EMAIL ?? env.JIRA_EMAIL,
        credentialRef: env.JIRA_CREDENTIAL,
        inlineToken: env.JIRA_API_TOKEN,
        projectKey: env.JIRA_PROJECT_KEY,
        extraEnv: collectExtraEnv(env),
        source,
    });
}

/** Candidate config files in one directory, in priority order. */
function candidatesIn(root) {
    return [
        { path: join(root, '.dsh', 'jira.json'), read: fromDshConfig },
        { path: join(root, '.cursor', 'mcp.json'), read: fromMcpConfig },
        { path: join(root, '.agents', 'mcp_config.json'), read: fromMcpConfig },
    ];
}

/**
 * Resolve the Jira tenant for a workspace root.
 *
 * @param {string} workspaceRoot - absolute session working directory.
 * @param {{ globalDefault?: object }} [options]
 * @returns {object|null|{ broken: { path: string, message: string } }} tenant descriptor,
 *   null when this repo has no Jira, or a `broken` marker when a config file exists
 *   but cannot be parsed (resolution stops there on purpose).
 */
export function resolveTenant(workspaceRoot, options = {}) {
    if (typeof workspaceRoot !== 'string' || !workspaceRoot.startsWith('/')) return null;

    let dir = resolvePath(workspaceRoot);
    for (let depth = 0; depth <= MAX_PARENT_DEPTH; depth += 1) {
        for (const candidate of candidatesIn(dir)) {
            const raw = readJson(candidate.path);
            if (!raw) continue;
            if (raw.__broken) return { broken: { path: candidate.path, message: raw.__broken } };
            const tenant = candidate.read(raw, candidate.path);
            if (tenant) return tenant;
        }
        const parent = dirname(dir);
        if (parent === dir || parent === '/') break;
        dir = parent;
    }

    return options.globalDefault ? fromDshConfig({ ...options.globalDefault, __source: 'profile' }, 'profile') : null;
}

/**
 * The credentials service, read without declaring it in `inject`.
 *
 * Cordis service proxies throw when they are not injected, but the plugin should
 * still mount tools for a repo whose token comes from its own MCP config or the
 * environment. `ctx.get(name)` reads an optional service; the direct property is
 * the fallback for contexts that expose it plainly (and for the test shim).
 */
function credentialsOf(ctx) {
    try {
        const viaGet = ctx?.get?.('credentials');
        if (viaGet) return viaGet;
    } catch {
        /* not mounted here */
    }
    try {
        return ctx?.credentials ?? null;
    } catch {
        return null;
    }
}

/**
 * Resolve the API token for a tenant.
 *
 * Order: an explicit credential from the DSH store (owner-only file) → the token
 * the repo's own MCP config already carries → the ambient environment → none.
 *
 * `reason` is per-call, not module state: two agents can resolve against
 * different tenants concurrently, and a stale failure from one must never be
 * reported as the cause for another. Returning null is a real, reportable state:
 * the plugin registers no tools and says why, instead of mounting a client that
 * will 401 on the first call.
 *
 * Trust boundary: the **site** comes from a repo file, so the plugin resolves
 * only the credential *bound* to that site (`JIRA_TOKEN_<HOST>`). Two opt-ins
 * exist for an operator who accepts the risk, and both live in the profile row
 * (not in the repo): `allowCredentialRefOverride` (honour a repo-requested
 * `JIRA_TOKEN_*` ref) and `allowAmbientToken` (use a bare `JIRA_API_TOKEN` env
 * var for a repo-chosen site).
 */
export async function resolveToken(ctx, tenant, { allowCredentialRefOverride = false, allowAmbientToken = false } = {}) {
    let reason = null;
    if (tenant.credentialRefRejected) {
        reason = `repo config asked for credential "${tenant.credentialRefRejected}", which is outside the JIRA_TOKEN_* namespace; ignoring it`;
    } else if (tenant.requestedTokenRef && !allowCredentialRefOverride) {
        reason = `repo config asked for credential "${tenant.requestedTokenRef}" but only "${tenant.tokenRef}" is bound to ${tenant.site}; ignoring it (row trustRepoCredentialRef enables the override)`;
    }
    const ref = tenant.requestedTokenRef && allowCredentialRefOverride ? tenant.requestedTokenRef : tenant.tokenRef;
    const credentials = credentialsOf(ctx);
    if (ref && typeof credentials?.resolve === 'function') {
        try {
            const hit = await credentials.resolve(ref);
            if (hit && typeof hit.value === 'string' && hit.value) {
                return { token: hit.value, from: `credentials:${ref}(${hit.source ?? 'file'})`, reason };
            }
            reason = `${reason ? `${reason}; ` : ''}credential "${ref}" not found in the DSH store`;
        } catch (error) {
            reason = `${reason ? `${reason}; ` : ''}credential "${ref}" failed: ${error?.message ?? String(error)}`;
        }
    }
    if (tenant.inlineToken) return { token: tenant.inlineToken, from: tenant.source, reason };
    const direct = ref ? process.env[ref] : undefined;
    if (typeof direct === 'string' && direct.trim()) return { token: direct.trim(), from: `environment:${ref}`, reason };
    const ambient = process.env.JIRA_API_TOKEN;
    if (typeof ambient === 'string' && ambient.trim()) {
        if (allowAmbientToken) return { token: ambient.trim(), from: 'environment:JIRA_API_TOKEN', reason };
        reason = `${reason ? `${reason}; ` : ''}ambient JIRA_API_TOKEN ignored for a repo-configured tenant (row trustAmbientToken enables it)`;
    }
    return { token: null, from: null, reason };
}
