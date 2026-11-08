/**
 * Tenant liveness/auth probe — `GET /rest/api/2/myself` before spawning the server.
 *
 * Why probe when the MCP server would fail on its first call anyway: a revoked
 * token or a wrong site would otherwise mount a full tool surface that 401s on
 * every call, and the model would discover it mid-task. One small request per
 * new agent turns that into a single readable log line ("token rejected",
 * "wrong site", "TLS", "timeout") and registers no tools for that session.
 *
 * The check is deliberately read-only and side-effect free. It also exercises the
 * same TLS path (OS CA bundle) the tools will use, so a certificate problem is
 * reported here instead of on the first write.
 */
import { JiraApiError, createJiraClient } from './jira-api.mjs';

const DEFAULT_TIMEOUT_MS = 5_000;

/** Human-readable cause from a failed probe; never contains the token. */
function reasonFrom(error) {
    if (error instanceof JiraApiError) {
        if (error.status === 401) return 'token rejected (HTTP 401) — check the email + API token pair';
        if (error.status === 403) return 'token valid but forbidden (HTTP 403) — no browse permission on this site';
        if (error.status === 404) return 'site not found (HTTP 404) — check the Atlassian site URL';
        if (error.code === 'TIMEOUT') return error.message;
        return error.message;
    }
    return error?.message ?? String(error);
}

/**
 * @param {object} tenant - resolved tenant (`site`, `email`).
 * @param {{ token?: string|null, caFile?: string|null, insecureTls?: boolean, timeoutMs?: number,
 *           createClient?: typeof createJiraClient }} [options]
 * @returns {Promise<{ ok: boolean, status?: number, reason?: string, account?: object|null }>}
 */
export async function probeJira(tenant, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    if (!tenant) return { ok: false, reason: 'no tenant resolved' };
    if (!tenant.email) return { ok: false, reason: 'no email configured for this site (Jira Cloud basic auth needs user email)' };
    if (!options.token) return { ok: false, reason: 'no API token resolved' };

    const createClient = options.createClient ?? createJiraClient;
    let client;
    try {
        client = createClient({
            site: tenant.site,
            email: tenant.email,
            token: options.token,
            caFile: options.caFile ?? null,
            insecureTls: options.insecureTls === true,
            timeoutMs,
        });
    } catch (error) {
        return { ok: false, reason: reasonFrom(error) };
    }

    try {
        const me = await client.myself();
        return {
            ok: true,
            status: 200,
            account: me && typeof me === 'object' ? me : null,
        };
    } catch (error) {
        return {
            ok: false,
            status: error instanceof JiraApiError ? error.status || undefined : undefined,
            reason: reasonFrom(error),
        };
    }
}
