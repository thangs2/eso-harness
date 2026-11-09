/**
 * Jira Cloud REST client — dependency-free, `node:*` only.
 *
 * Why this exists instead of a wrapped npm server: the plugin must run inside a
 * DSH profile where every extra dependency can hoist a second copy of a Harness
 * singleton into the profile (the failure the sibling plugins record as
 * ATF-OPS-001). A file that imports only `node:*` gives the package manager
 * nothing to install, so the pathology cannot recur. It also means the MCP
 * server is versioned with the plugin that mounts it.
 *
 * TLS, measured 2026-11-08 on this host (Node 26.7.0, Node 24.21.0 inside the
 * Electron host):
 *   - `fetch('https://<site>.atlassian.net/rest/api/2/myself')` fails with
 *     `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`; Node's bundled roots are 118 and
 *     `tls.getCACertificates('system')` is empty on this build.
 *   - The OS bundle at `/etc/ssl/cert.pem` validates the same chain (200 from
 *     the Jira REST API), so the client adds that file through the `ca` option
 *     instead of disabling verification. `JIRA_CA_FILE` overrides it; only an
 *     explicit `insecureTls` turns verification off.
 *
 * API facts measured on the same host (2026-11-08):
 *   - `GET /rest/api/2/search` is **removed** (410, "transfer to
 *     /rest/api/3/search/jql"). Search uses POST `/rest/api/3/search/jql`, whose
 *     response has `issues`, `nextPageToken`, `isLast` and **no `total`**.
 *   - `/rest/api/2` still accepts Jira wiki markup for description/comment
 *     bodies, which is what this repository's tickets use (standard 07 §7), so
 *     the write tools speak wiki markup rather than ADF.
 *   - Story points are `customfield_10016` (number), sprint is
 *     `customfield_10020` (array), parent is `fields.parent.key` (verified on
 *     project `ESO`).
 */
import { readFileSync, existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** OS trust bundles, most specific first. The first existing file wins. */
const SYSTEM_CA_CANDIDATES = [
    '/etc/ssl/cert.pem',
    '/etc/ssl/certs/ca-certificates.crt',
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
    '/opt/homebrew/etc/ca-certificates/cert.pem',
];

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const USER_AGENT = 'dsh-jira-mcp-plugin/1.0.0';

/** A Jira error, already shaped for a model-facing message. */
export class JiraApiError extends Error {
    /**
     * @param {string} message
     * @param {{ status?: number, messages?: string[], body?: unknown, code?: string }} [options]
     */
    constructor(message, { status = 0, messages = [], body = null, code = 'JIRA_ERROR' } = {}) {
        super(message);
        this.name = 'JiraApiError';
        this.status = status;
        this.messages = messages;
        this.body = body;
        this.code = code;
    }
}

/** The CA file the client should trust: explicit env override, else the OS bundle. */
export function defaultCaFile(env = process.env) {
    const explicit = env.JIRA_CA_FILE;
    if (typeof explicit === 'string' && explicit.trim()) {
        const path = explicit.trim();
        return existsSync(path) ? path : null;
    }
    for (const candidate of SYSTEM_CA_CANDIDATES) {
        try {
            if (existsSync(candidate)) return candidate;
        } catch {
            /* an unreadable path is not a candidate */
        }
    }
    return null;
}

/** Read a CA bundle, or null when it is absent/unreadable. */
export function readCaPem(path) {
    if (!path) return null;
    try {
        return readFileSync(path);
    } catch {
        return null;
    }
}

/** `JIRA_TLS_INSECURE=1` (or the row's `insecureTls`) — never enabled silently. */
export function insecureTlsFromEnv(env = process.env) {
    return env.JIRA_TLS_INSECURE === '1' || env.JIRA_TLS_INSECURE === 'true';
}

function asNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Query-string builder: skips null/undefined/empty values, keeps 0/false. */
function queryString(query) {
    if (!query || typeof query !== 'object') return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `?${text}` : '';
}

/** Jira's error body → one readable line. `errors` is field → message. */
function formatJiraError(status, payload, raw) {
    const messages = [];
    if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.errorMessages)) messages.push(...payload.errorMessages.map(String));
        if (payload.errors && typeof payload.errors === 'object') {
            for (const [field, message] of Object.entries(payload.errors)) messages.push(`${field}: ${message}`);
        }
        if (typeof payload.message === 'string' && payload.message) messages.push(payload.message);
    }
    if (messages.length === 0 && raw) messages.push(String(raw).replace(/\s+/g, ' ').slice(0, 300));
    if (messages.length === 0) messages.push(`HTTP ${status}`);
    return messages;
}

/** Hints that turn the common failures into an action, not a stack trace. */
function statusHint(status) {
    if (status === 401) return 'authentication failed — check the token and email (Jira Cloud uses email + API token, not password)';
    if (status === 403) return 'the token is valid but lacks permission for this resource';
    if (status === 404) return 'not found — check the issue key / project key / site URL';
    if (status === 410) return 'this Jira API was removed (410) — the server uses /rest/api/3/search/jql';
    if (status === 429) return 'Jira rate limit hit — retry with a smaller maxResults';
    if (status >= 500) return 'Jira server error — retry later';
    return null;
}

const TLS_CERT_CODES = new Set([
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
]);

/**
 * One Jira tenant's REST client.
 *
 * `site` is an origin (`https://x.atlassian.net`); `http://` is accepted too so
 * the offline tests can point at a fixture server (and so a self-hosted Jira on
 * plain HTTP, which Atlassian Cloud never is, does not need a second client).
 */
export function createJiraClient({
    site,
    email,
    token,
    caFile = null,
    insecureTls = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchAgent = null,
} = {}) {
    if (typeof site !== 'string' || !/^https?:\/\//i.test(site)) {
        throw new JiraApiError(`invalid Jira site "${String(site)}"`, { code: 'BAD_SITE' });
    }
    if (typeof email !== 'string' || !email.trim()) {
        throw new JiraApiError('Jira email is required for basic auth', { code: 'BAD_EMAIL' });
    }
    if (typeof token !== 'string' || !token.trim()) {
        throw new JiraApiError('Jira API token is required', { code: 'BAD_TOKEN' });
    }

    const origin = site.replace(/\/+$/, '');
    const auth = `Basic ${Buffer.from(`${email.trim()}:${token.trim()}`).toString('base64')}`;
    const ca = readCaPem(caFile) ?? readCaPem(defaultCaFile());
    // The token is a credential: never place it in a message, URL or log line.
    const redact = (message) => String(message ?? '').replaceAll(token.trim(), '<redacted>');

    /**
     * One HTTP request. Rejects with `JiraApiError` for every failure class, so
     * callers never surface a raw socket error to the model.
     */
    function requestJson(method, path, { query = null, body = undefined, requestTimeoutMs = timeoutMs, signal = null } = {}) {
        const pathAndQuery = `${path}${queryString(query)}`;
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new JiraApiError(`${method} ${path} cancelled before dispatch`, { code: 'CANCELLED' }));
                return;
            }
            let url;
            try {
                url = new URL(`${origin}${pathAndQuery}`);
            } catch (error) {
                reject(new JiraApiError(`bad Jira request path: ${error.message}`, { code: 'BAD_PATH' }));
                return;
            }
            const isHttps = url.protocol === 'https:';
            const send = isHttps ? httpsRequest : httpRequest;
            const payload = body === undefined ? undefined : JSON.stringify(body);
            const headers = {
                authorization: auth,
                accept: 'application/json',
                'user-agent': USER_AGENT,
            };
            if (payload !== undefined) {
                headers['content-type'] = 'application/json';
                headers['content-length'] = Buffer.byteLength(payload);
            }

            let settled = false;
            let deadline = null;
            const onAbort = () => req.destroy(new JiraApiError(`request cancelled (${method} ${path})`, { code: 'CANCELLED' }));
            const cleanup = () => {
                if (deadline) clearTimeout(deadline);
                deadline = null;
                signal?.removeEventListener?.('abort', onAbort);
            };
            /** Settle exactly once and always release the deadline/abort listener. */
            const settle = (fn, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                fn(value);
            };

            const req = send(
                {
                    protocol: url.protocol,
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: `${url.pathname}${url.search}`,
                    method,
                    headers,
                    ...(isHttps && ca ? { ca } : {}),
                    ...(isHttps && insecureTls ? { rejectUnauthorized: false } : {}),
                },
                (res) => {
                    const chunks = [];
                    let size = 0;
                    res.on('data', (chunk) => {
                        size += chunk.length;
                        if (size > MAX_RESPONSE_BYTES) {
                            req.destroy();
                            settle(
                                reject,
                                new JiraApiError(`Jira response exceeded ${MAX_RESPONSE_BYTES} bytes; narrow the query`, {
                                    status: res.statusCode,
                                    code: 'RESPONSE_TOO_LARGE',
                                }),
                            );
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.on('end', () => {
                        const raw = Buffer.concat(chunks).toString('utf8');
                        const status = res.statusCode ?? 0;
                        let parsed = null;
                        if (raw.trim()) {
                            try {
                                parsed = JSON.parse(raw);
                            } catch {
                                parsed = null;
                            }
                        }
                        if (parsed === null && status === 204) {
                            settle(resolve, {});
                            return;
                        }
                        if (status >= 400) {
                            const messages = formatJiraError(status, parsed, raw);
                            const hint = statusHint(status);
                            settle(
                                reject,
                                new JiraApiError(`${method} ${path} → HTTP ${status}: ${messages.join('; ')}${hint ? ` (${hint})` : ''}`, {
                                    status,
                                    messages,
                                    body: parsed,
                                    code: `HTTP_${status}`,
                                }),
                            );
                            return;
                        }
                        if (parsed === null) {
                            // A 2xx that is not JSON is a proxy/HTML page, not Jira.
                            settle(
                                reject,
                                new JiraApiError(`${method} ${path} returned non-JSON (HTTP ${status})`, {
                                    status,
                                    body: raw.slice(0, 300),
                                    code: 'NON_JSON',
                                }),
                            );
                            return;
                        }
                        settle(resolve, parsed);
                    });
                },
            );

            // Absolute per-request deadline. `req.setTimeout` below is an *idle*
            // timeout; a slow-drip response would never trip it, so the deadline
            // is what the tool description actually promises.
            deadline = setTimeout(() => {
                req.destroy(new JiraApiError(`Jira request exceeded ${requestTimeoutMs}ms (${method} ${path})`, { code: 'TIMEOUT' }));
            }, requestTimeoutMs);
            deadline.unref?.();
            signal?.addEventListener?.('abort', onAbort, { once: true });

            req.setTimeout(requestTimeoutMs, () => {
                req.destroy(
                    new JiraApiError(`Jira request timed out after ${requestTimeoutMs}ms (${method} ${path})`, {
                        code: 'TIMEOUT',
                    }),
                );
            });
            req.on('error', (error) => {
                if (error instanceof JiraApiError) {
                    settle(reject, error);
                    return;
                }
                const code = error?.code ?? 'NETWORK';
                if (TLS_CERT_CODES.has(code)) {
                    settle(
                        reject,
                        new JiraApiError(
                            `TLS verification failed (${code}) for ${url.hostname}. This host needs its OS CA bundle ` +
                                `(auto-detected: ${defaultCaFile() ?? 'none found'}); set JIRA_CA_FILE to a PEM bundle, ` +
                                `or explicitly accept the risk with JIRA_TLS_INSECURE=1.`,
                            { code },
                        ),
                    );
                    return;
                }
                settle(
                    reject,
                    new JiraApiError(`cannot reach ${url.hostname}: ${redact(error.message)} (${code})`, {
                        code,
                    }),
                );
            });
            if (payload !== undefined) req.write(payload);
            req.end();
        });
    }

    const encodeKey = (issueKey) => encodeURIComponent(String(issueKey).trim());

    return {
        site: origin,
        email: email.trim(),
        timeoutMs,
        requestJson,

        /** GET /rest/api/2/myself — the probe and the `get_myself` tool. */
        myself: ({ signal = null } = {}) => requestJson('GET', '/rest/api/2/myself', { signal }),

        /** GET /rest/api/2/issue/{key} — v2 keeps `description` as wiki markup. */
        getIssue: (issueKey, { fields = null, expand = null, signal = null } = {}) =>
            requestJson('GET', `/rest/api/2/issue/${encodeKey(issueKey)}`, {
                query: {
                    fields: Array.isArray(fields) ? fields.join(',') : fields || undefined,
                    expand: expand || undefined,
                },
                signal,
            }),

        /**
         * POST /rest/api/3/search/jql — the endpoint that replaced /search.
         * `nextPageToken` is opaque; pass the previous response's token back.
         */
        search: ({ jql, maxResults = 25, fields = null, nextPageToken = null, signal = null }) =>
            requestJson('POST', '/rest/api/3/search/jql', {
                body: {
                    jql,
                    maxResults,
                    fields: Array.isArray(fields) ? fields : undefined,
                    nextPageToken: nextPageToken || undefined,
                },
                signal,
            }),

        /** GET /rest/api/2/issue/{key}/transitions — allowed workflow moves. */
        transitions: (issueKey, { signal = null } = {}) =>
            requestJson('GET', `/rest/api/2/issue/${encodeKey(issueKey)}/transitions`, { signal }),

        /** POST /rest/api/2/issue/{key}/transitions — the only write on the workflow. */
        transition: (issueKey, transitionId, { fields = null, comment = null, signal = null } = {}) =>
            requestJson('POST', `/rest/api/2/issue/${encodeKey(issueKey)}/transitions`, {
                body: {
                    transition: { id: String(transitionId) },
                    ...(fields ? { fields } : {}),
                    ...(comment ? { update: { comment: [{ add: { body: comment } }] } } : {}),
                },
                signal,
            }),

        /** POST /rest/api/2/issue — wiki markup body (see file header). */
        createIssue: (fields, { signal = null } = {}) => requestJson('POST', '/rest/api/2/issue', { body: { fields }, signal }),

        /** PUT /rest/api/2/issue/{key} — partial field update. */
        updateIssue: (issueKey, fields, { signal = null } = {}) =>
            requestJson('PUT', `/rest/api/2/issue/${encodeKey(issueKey)}`, { body: { fields }, signal }),

        /** POST /rest/api/2/issue/{key}/comment — body is wiki markup, not ADF. */
        addComment: (issueKey, body, { signal = null } = {}) =>
            requestJson('POST', `/rest/api/2/issue/${encodeKey(issueKey)}/comment`, { body: { body }, signal }),

        /** POST /rest/api/2/issueLink — direction measured in scripts/jira-create.mjs. */
        linkIssues: (payload, { signal = null } = {}) => requestJson('POST', '/rest/api/2/issueLink', { body: payload, signal }),

        /** GET /rest/api/2/project/search. */
        projectSearch: ({ query = null, maxResults = 25, signal = null } = {}) =>
            requestJson('GET', '/rest/api/2/project/search', { query: { query: query || undefined, maxResults }, signal }),

        /** GET /rest/api/2/issue/createmeta/{project}/issuetypes. */
        issueTypes: (projectKey, { signal = null } = {}) =>
            requestJson('GET', `/rest/api/2/issue/createmeta/${encodeURIComponent(String(projectKey).trim())}/issuetypes`, {
                signal,
            }),

        /** GET /rest/api/2/project/{project}/statuses — every status per issue type. */
        projectStatuses: (projectKey, { signal = null } = {}) =>
            requestJson('GET', `/rest/api/2/project/${encodeURIComponent(String(projectKey).trim())}/statuses`, { signal }),

        /** GET /rest/api/2/user/search — email → accountId for assignee writes. */
        userSearch: (query, { maxResults = 5, signal = null } = {}) =>
            requestJson('GET', '/rest/api/2/user/search', { query: { query, maxResults }, signal }),

        /** GET /rest/api/2/field — discover custom field ids from names. */
        fields: ({ signal = null } = {}) => requestJson('GET', '/rest/api/2/field', { signal }),

        /** GET /rest/agile/1.0/board — optional project filter. */
        boards: ({ projectKey = null, maxResults = 25, signal = null } = {}) =>
            requestJson('GET', '/rest/agile/1.0/board', {
                query: { projectKeyOrId: projectKey || undefined, maxResults },
                signal,
            }),

        /** GET /rest/agile/1.0/board/{boardId}/sprint. */
        sprints: ({ boardId, state = 'active,future', maxResults = 25, signal = null } = {}) =>
            requestJson('GET', `/rest/agile/1.0/board/${Number(boardId)}/sprint`, {
                query: { state: state || undefined, maxResults },
                signal,
            }),
    };
}

/**
 * Build the supported custom-field map from `/rest/api/2/field`.
 *
 * Names are localised and can change, so the ids are read once from the site
 * rather than hard-coded as the only truth: the measured defaults (ESO,
 * 2026-11-08) are `customfield_10016` Story point estimate and
 * `customfield_10020` Sprint, matching `scripts/jira-create.mjs`.
 */
export function customFieldIds(fields) {
    const found = { storyPoints: 'customfield_10016', sprint: 'customfield_10020' };
    if (!Array.isArray(fields)) return found;
    for (const field of fields) {
        if (!field || typeof field !== 'object') continue;
        const name = String(field.name ?? '').toLowerCase();
        if (name.includes('story point') || name.includes('story points')) found.storyPoints = field.id ?? found.storyPoints;
        else if (name === 'sprint') found.sprint = field.id ?? found.sprint;
    }
    return found;
}
