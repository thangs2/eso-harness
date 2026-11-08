#!/usr/bin/env node
/**
 * Local Jira MCP server — one process per agent, tenant chosen by the plugin.
 *
 * This is the thing `@local/jira-mcp-plugin` mounts. It speaks MCP 2025-06-18
 * over stdio (newline-delimited JSON-RPC 2.0), imports only `node:*`, and talks
 * to Jira Cloud's REST API directly. There is no npm package to install, so the
 * tool surface is versioned with the plugin and the profile cannot acquire a
 * second copy of a Harness singleton (ATF-OPS-001).
 *
 * Environment (the plugin builds it; `src/selfcheck.mjs` builds the same one):
 *   JIRA_BASE_URL        required, origin of the tenant (`https://x.atlassian.net`)
 *   JIRA_USER_EMAIL      required, basic-auth user (email for Jira Cloud)
 *   JIRA_API_TOKEN       required, API token (never logged, never echoed)
 *   JIRA_PROJECT_KEY     optional, default for project-scoped tools
 *   JIRA_CA_FILE         optional, PEM bundle to trust (defaults to the OS bundle)
 *   JIRA_TLS_INSECURE=1  optional, disable TLS verification (never set silently)
 *   JIRA_TIMEOUT_MS      optional, per-request ceiling (default 20000)
 *   JIRA_MAX_RESULTS     optional, default result cap for searches (default 25)
 *
 * Working agreements encoded in the tool descriptions, each from a defect this
 * repository already paid for:
 *   - description/comment are Jira **wiki markup**, not Markdown (standard 07 §7);
 *   - `get_transitions` before `transition_issue` — never invent a transition id;
 *   - Done/Closed is signed by a human, never an agent (AGENTS.md SLP) — the
 *     server refuses status-category `done` targets unless `allowDone: true`;
 *   - a Story/Task with children gets its points from the children; estimates go
 *     on leaves (`jira-points-rollup`);
 *   - the four relations (subtasks/relates/blocks/blockedBy) are declared and
 *     become real links, and Blocks direction is inward=blocker / outward=blocked
 *     (measured 2026-11-03 in `scripts/jira-create.mjs`).
 */
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import {
    JiraApiError,
    createJiraClient,
    customFieldIds,
    defaultCaFile,
    insecureTlsFromEnv,
} from './jira-api.mjs';

export const SERVER_NAME = 'jira';
export const SERVER_VERSION = '1.0.0';
export const PROTOCOL_VERSION = '2025-06-18';
export const SERVER_PROTOCOLS = ['2025-06-18', '2024-11-05'];
const DEFAULT_MAX_RESULTS = 25;
const MAX_RESULTS_CAP = 100;
const DEFAULT_TIMEOUT_MS = 20_000;
const DESCRIPTION_LIMIT = 20_000;
const COMMENT_LIMIT = 30;
const COMMENT_TEXT_LIMIT = 8_000;

/** A tool argument problem, reported to the model as an isError result. */
export class ToolInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolInputError';
    }
}

/* ───────────────────────────── argument helpers ───────────────────────────── */

function requireString(args, name) {
    const value = args?.[name];
    if (typeof value !== 'string' || !value.trim()) {
        throw new ToolInputError(`"${name}" is required and must be a non-empty string`);
    }
    return value.trim();
}

function optionalString(args, name) {
    const value = args?.[name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalBoolean(args, name) {
    const value = args?.[name];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'boolean') throw new ToolInputError(`"${name}" must be a boolean`);
    return value;
}

function optionalNumber(args, name) {
    const value = args?.[name];
    if (value === undefined || value === null) return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ToolInputError(`"${name}" must be a number`);
    return n;
}

function optionalInteger(args, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const n = optionalNumber(args, name);
    if (n === undefined) return undefined;
    if (!Number.isInteger(n) || n < min || n > max) throw new ToolInputError(`"${name}" must be an integer ${min}..${max}`);
    return n;
}

function optionalStringArray(args, name) {
    const value = args?.[name];
    if (value === undefined || value === null) return undefined;
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
    if (!list) throw new ToolInputError(`"${name}" must be an array of strings`);
    const cleaned = list.map((item) => String(item).trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
}

/* ──────────────────────────── response formatting ─────────────────────────── */

function cap(text, limit, note = '…') {
    if (typeof text !== 'string') return '';
    return text.length <= limit ? text : `${text.slice(0, limit)}${note}`;
}

/** ISO timestamp → `YYYY-MM-DD HH:mm` (the model does not need milliseconds). */
function timestamp(value) {
    if (typeof value !== 'string' || !value) return null;
    return value.replace('T', ' ').replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, '').slice(0, 16);
}

function userLabel(user) {
    if (!user || typeof user !== 'object') return null;
    const name = user.displayName ?? user.emailAddress ?? user.accountId;
    return typeof name === 'string' && name ? name : null;
}

function statusLine(status) {
    if (!status || typeof status !== 'object') return null;
    const category = status.statusCategory?.key;
    return category ? `${status.name} (${category})` : status.name;
}

function joinParts(parts, separator = ' · ') {
    return parts.filter((part) => typeof part === 'string' && part.trim()).join(separator);
}

function fieldLine(label, value) {
    return value === undefined || value === null || value === '' ? null : `${label}: ${value}`;
}

/** Issue key/URL helpers. */
function browseUrl(site, key) {
    return `${site.replace(/\/+$/, '')}/browse/${key}`;
}

/**
 * A single issue as compact text. `includeComments`/`includeLinks` keep a broad
 * read from turning into a 100 KB tool result.
 */
export function formatIssue(issue, site, { includeComments = true, includeLinks = true } = {}) {
    if (!issue || typeof issue !== 'object') return 'Jira returned no issue.';
    const f = issue.fields ?? {};
    const key = issue.key ?? '?';
    const lines = [];
    lines.push(`${key} — ${f.summary ?? '(no summary)'}`);
    lines.push(
        joinParts([
            fieldLine('status', statusLine(f.status)),
            fieldLine('type', f.issuetype?.name),
            fieldLine('assignee', userLabel(f.assignee) ?? 'unassigned'),
            fieldLine('reporter', userLabel(f.reporter)),
        ]),
    );
    lines.push(
        joinParts([
            fieldLine('project', f.project ? `${f.project.key} (${f.project.name})` : null),
            fieldLine('parent', f.parent?.key),
            fieldLine('priority', f.priority?.name),
            f.labels?.length ? `labels: ${f.labels.join(', ')}` : null,
        ]),
    );
    lines.push(
        joinParts([
            fieldLine('created', timestamp(f.created)),
            fieldLine('updated', timestamp(f.updated)),
            fieldLine('due', f.duedate),
        ]),
    );
    if (f.subtasks?.length) {
        lines.push(
            `subtasks (${f.subtasks.length}): ${f.subtasks
                .map((child) => `${child.key} [${child.fields?.status?.name ?? '?'}]`)
                .join(', ')}`,
        );
    }
    lines.push(`url: ${browseUrl(site, key)}`);

    const description = typeof f.description === 'string' ? f.description : '';
    if (description.trim()) {
        lines.push('', 'description:', cap(description, DESCRIPTION_LIMIT));
    }

    if (includeComments) {
        const comments = f.comment?.comments;
        if (Array.isArray(comments) && comments.length) {
            lines.push('', `comments (${comments.length}):`);
            for (const comment of comments.slice(0, COMMENT_LIMIT)) {
                lines.push(`- ${userLabel(comment.author) ?? '?'} · ${timestamp(comment.created) ?? '?'}`);
                lines.push(`  ${cap(String(comment.body ?? '').replace(/\s+/g, ' '), COMMENT_TEXT_LIMIT)}`);
            }
            if (comments.length > COMMENT_LIMIT) {
                lines.push(`… ${comments.length - COMMENT_LIMIT} more comments not shown`);
            }
        } else if (f.comment?.total > 0) {
            lines.push('', `comments: ${f.comment.total} (not included in this response)`);
        }
    }

    if (includeLinks && Array.isArray(f.issuelinks) && f.issuelinks.length) {
        lines.push('', `links (${f.issuelinks.length}):`);
        for (const link of f.issuelinks) {
            const type = link.type?.name ?? 'link';
            if (link.inwardIssue) lines.push(`- ${link.inwardIssue.key} ${link.type?.inward ?? 'inward'} ${key} (${type})`);
            if (link.outwardIssue) lines.push(`- ${key} ${link.type?.outward ?? 'outward'} ${link.outwardIssue.key} (${type})`);
        }
    }
    return lines.filter((line) => line !== null).join('\n');
}

/** One search hit as a line: `KEY [Type/Status] summary — assignee`. */
export function formatIssueLine(issue) {
    const f = issue?.fields ?? {};
    const assignee = userLabel(f.assignee);
    return `${issue?.key ?? '?'} [${f.issuetype?.name ?? '?'}/${f.status?.name ?? '?'}] ${String(f.summary ?? '(no summary)')}${
        assignee ? ` — ${assignee}` : ''
    }`;
}

function formatSearchPage(page, site) {
    const issues = Array.isArray(page?.issues) ? page.issues : [];
    const lines = [`found ${issues.length} issue(s)${page?.isLast === true ? ' · last page' : ''}`];
    for (const issue of issues) lines.push(`- ${formatIssueLine(issue)}`);
    if (issues.length) {
        lines.push(`url: ${browseUrl(site, issues[0].key)}`);
    }
    if (page?.nextPageToken) {
        lines.push('', `nextPageToken: ${page.nextPageToken}`, 'pass it back as nextPageToken to read the next page.');
    }
    return lines.join('\n');
}

/* ────────────────────────────────── tools ─────────────────────────────────── */

/**
 * The tool catalogue. Each entry is data plus a handler; the MCP framing below
 * knows nothing about Jira, so adding a tool never touches the transport.
 *
 * `handler({ args, client, config })` returns the text shown to the model.
 */
const TOOLS = [
    {
        name: 'get_myself',
        title: 'Jira · current user',
        description:
            'Identify the authenticated Jira user and confirm the tenant works. Call it first in an unfamiliar repo when a Jira write is about to happen.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        async handler({ client, signal }) {
            const me = await client.myself({ signal });
            return joinParts([
                `site: ${client.site}`,
                `user: ${me.displayName ?? '?'} <${me.emailAddress ?? '?'}>`,
                `accountId: ${me.accountId ?? '?'}`,
                me.timeZone ? `timeZone: ${me.timeZone}` : null,
            ], '\n');
        },
    },
    {
        name: 'get_issue',
        title: 'Jira · read issue',
        description:
            'Read one Jira issue: summary, status, type, assignee, parent, labels, description (Jira wiki markup), comments and links. Call it before editing or transitioning.',
        inputSchema: {
            type: 'object',
            properties: {
                issueKey: { type: 'string', description: 'Issue key, e.g. ESO-488.' },
                includeComments: { type: 'boolean', description: 'Include the comment thread (default true).' },
                includeLinks: { type: 'boolean', description: 'Include issue links (default true).' },
            },
            required: ['issueKey'],
            additionalProperties: false,
        },
        async handler({ args, client, signal }) {
            const issueKey = requireString(args, 'issueKey');
            const issue = await client.getIssue(issueKey, { signal });
            return formatIssue(issue, client.site, {
                includeComments: optionalBoolean(args, 'includeComments') ?? true,
                includeLinks: optionalBoolean(args, 'includeLinks') ?? true,
            });
        },
    },
    {
        name: 'search_issues',
        title: 'Jira · JQL search',
        description:
            'Search Jira with JQL (POST /rest/api/3/search/jql). Prefer a bounded query, e.g. "project = ESO AND status != Done ORDER BY created DESC". maxResults is capped at 100; use nextPageToken for the next page.',
        inputSchema: {
            type: 'object',
            properties: {
                jql: { type: 'string', description: 'JQL query. Always bounded (project/status/labels).' },
                maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_CAP, description: 'Page size (default JIRA_MAX_RESULTS, cap 100).' },
                fields: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Fields to return. Default: summary,status,issuetype,assignee,priority,labels,parent,updated.',
                },
                nextPageToken: { type: 'string', description: 'Token from a previous search_issues result.' },
            },
            required: ['jql'],
            additionalProperties: false,
        },
        async handler({ args, client, config, signal }) {
            const jql = requireString(args, 'jql');
            const maxResults = optionalInteger(args, 'maxResults', { min: 1, max: MAX_RESULTS_CAP }) ?? config.maxResults;
            const fields = optionalStringArray(args, 'fields') ?? [
                'summary',
                'status',
                'issuetype',
                'assignee',
                'priority',
                'labels',
                'parent',
                'updated',
            ];
            const page = await client.search({
                jql,
                maxResults,
                fields,
                nextPageToken: optionalString(args, 'nextPageToken'),
                signal,
            });
            return `JQL: ${jql}\n${formatSearchPage(page, client.site)}`;
        },
    },
    {
        name: 'get_transitions',
        title: 'Jira · allowed transitions',
        description:
            'List the workflow transitions currently allowed for an issue, with the status each one leads to. Always call this before transition_issue; never invent a transition id.',
        inputSchema: {
            type: 'object',
            properties: { issueKey: { type: 'string', description: 'Issue key.' } },
            required: ['issueKey'],
            additionalProperties: false,
        },
        async handler({ args, client, signal }) {
            const issueKey = requireString(args, 'issueKey');
            const data = await client.transitions(issueKey, { signal });
            const transitions = Array.isArray(data?.transitions) ? data.transitions : [];
            if (!transitions.length) return `${issueKey}: no transitions available for this user/workflow state.`;
            const lines = [`${issueKey} — ${transitions.length} transition(s):`];
            for (const transition of transitions) {
                lines.push(
                    `- id ${transition.id} · "${transition.name}" → ${statusLine(transition.to) ?? '?'}` +
                        (transition.isAvailable === false ? ' (not available)' : ''),
                );
            }
            lines.push('', 'Pass the id to transition_issue. Done/Closed needs explicit operator approval.');
            return lines.join('\n');
        },
    },
    {
        name: 'get_projects',
        title: 'Jira · projects',
        description: 'List or search Jira projects visible to the token (key, name, id). Useful before create_issue to confirm the project key.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Filter by project key or name.' },
                maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_CAP },
            },
            additionalProperties: false,
        },
        async handler({ args, client, config, signal }) {
            const page = await client.projectSearch({
                query: optionalString(args, 'query'),
                maxResults: optionalInteger(args, 'maxResults', { min: 1, max: MAX_RESULTS_CAP }) ?? config.maxResults,
                signal,
            });
            const values = Array.isArray(page?.values) ? page.values : [];
            const lines = [`${values.length} project(s)${page?.total !== undefined ? ` of ${page.total}` : ''}:`];
            for (const project of values) {
                lines.push(`- ${project.key} — ${project.name} (id ${project.id})${project.projectTypeKey ? ` · ${project.projectTypeKey}` : ''}`);
            }
            return lines.join('\n');
        },
    },
    {
        name: 'get_project_issue_types',
        title: 'Jira · issue types',
        description: 'List the issue types creatable in a project (Subtask, Epic, Story, Bug, Task, …). Call before create_issue when the type name is uncertain.',
        inputSchema: {
            type: 'object',
            properties: {
                projectKey: { type: 'string', description: 'Project key; defaults to JIRA_PROJECT_KEY.' },
            },
            additionalProperties: false,
        },
        async handler({ args, client, config, signal }) {
            const projectKey = optionalString(args, 'projectKey') ?? config.projectKey;
            if (!projectKey) throw new ToolInputError('"projectKey" is required (no JIRA_PROJECT_KEY default in this workspace)');
            const data = await client.issueTypes(projectKey, { signal });
            const types = Array.isArray(data?.issueTypes) ? data.issueTypes : [];
            const lines = [`${projectKey} — ${types.length} issue type(s):`];
            for (const type of types) {
                lines.push(`- ${type.name} (id ${type.id})${type.subtask ? ' · subtask' : ''}`);
            }
            return lines.join('\n');
        },
    },
    {
        name: 'get_fields',
        title: 'Jira · fields',
        description:
            'List Jira fields, and show the ids this server writes for Story Points and Sprint. Use when a project needs a custom field id that is not the measured default (customfield_10016 / customfield_10020).',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Filter field names (case-insensitive substring).' },
            },
            additionalProperties: false,
        },
        async handler({ args, client, signal }) {
            const fields = await client.fields({ signal });
            const ids = customFieldIds(fields);
            const query = (optionalString(args, 'query') ?? '').toLowerCase();
            const matching = (Array.isArray(fields) ? fields : []).filter(
                (field) => !query || String(field.name ?? '').toLowerCase().includes(query),
            );
            const lines = [
                `storyPoints field: ${ids.storyPoints}`,
                `sprint field: ${ids.sprint}`,
                '',
                `${matching.length} field(s)${query ? ` matching "${query}"` : ''}:`,
            ];
            for (const field of matching.slice(0, 200)) {
                lines.push(`- ${field.id} — ${field.name}${field.custom ? ' (custom)' : ''}${field.schema?.type ? ` · ${field.schema.type}` : ''}`);
            }
            if (matching.length > 200) lines.push(`… ${matching.length - 200} more fields not shown`);
            return lines.join('\n');
        },
    },
    {
        name: 'get_boards',
        title: 'Jira · boards',
        description: 'List Jira Software boards (optionally for one project). Boards are the input to get_sprints.',
        inputSchema: {
            type: 'object',
            properties: {
                projectKey: { type: 'string', description: 'Filter boards by project key.' },
                maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_CAP },
            },
            additionalProperties: false,
        },
        async handler({ args, client, config, signal }) {
            const page = await client.boards({
                projectKey: optionalString(args, 'projectKey') ?? config.projectKey,
                maxResults: optionalInteger(args, 'maxResults', { min: 1, max: MAX_RESULTS_CAP }) ?? config.maxResults,
                signal,
            });
            const values = Array.isArray(page?.values) ? page.values : [];
            const lines = [`${values.length} board(s)${page?.total !== undefined ? ` of ${page.total}` : ''}:`];
            for (const board of values) {
                lines.push(`- ${board.id} — ${board.name}${board.type ? ` · ${board.type}` : ''}${board.location?.projectKey ? ` · project ${board.location.projectKey}` : ''}`);
            }
            return lines.join('\n');
        },
    },
    {
        name: 'get_sprints',
        title: 'Jira · sprints',
        description: 'List sprints on a board (default state active,future). Use to find the sprint id accepted by create_issue/update_issue.',
        inputSchema: {
            type: 'object',
            properties: {
                boardId: { type: 'integer', description: 'Board id from get_boards.' },
                state: { type: 'string', description: 'Comma-separated states: active,future,closed (default active,future).' },
                maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_CAP },
            },
            required: ['boardId'],
            additionalProperties: false,
        },
        async handler({ args, client, config, signal }) {
            const boardId = optionalInteger(args, 'boardId', { min: 1 });
            if (boardId === undefined) throw new ToolInputError('"boardId" is required');
            const page = await client.sprints({
                boardId,
                state: optionalString(args, 'state') ?? 'active,future',
                maxResults: optionalInteger(args, 'maxResults', { min: 1, max: MAX_RESULTS_CAP }) ?? config.maxResults,
                signal,
            });
            const values = Array.isArray(page?.values) ? page.values : [];
            const lines = [`board ${boardId} — ${values.length} sprint(s):`];
            for (const sprint of values) {
                lines.push(
                    joinParts([
                        `- ${sprint.id} — ${sprint.name}`,
                        sprint.state,
                        sprint.startDate ? `start ${timestamp(sprint.startDate)}` : null,
                        sprint.endDate ? `end ${timestamp(sprint.endDate)}` : null,
                    ]),
                );
            }
            return lines.join('\n');
        },
    },
    {
        name: 'create_issue',
        title: 'Jira · create issue',
        description:
            'Create one Jira issue. Confirm project, type and summary with the user first. description is Jira wiki markup (not Markdown): *bold*, {{code}}, h3. headings, "* " bullets. Story points belong on leaves — do not set them on a parent whose points should roll up from subtasks. Use dryRun to preview the payload without writing.',
        inputSchema: {
            type: 'object',
            properties: {
                projectKey: { type: 'string', description: 'Project key; defaults to JIRA_PROJECT_KEY.' },
                issueType: { type: 'string', description: 'Issue type name or id (Subtask, Epic, Story, Bug, Task).' },
                summary: { type: 'string', description: 'One-line summary.' },
                description: { type: 'string', description: 'Body in Jira wiki markup.' },
                labels: { type: 'array', items: { type: 'string' } },
                priority: { type: 'string', description: 'Priority name, e.g. Medium.' },
                assignee: { type: 'string', description: 'Email address or Atlassian accountId.' },
                parent: { type: 'string', description: 'Parent issue key. Required for subtasks.' },
                storyPoints: { type: 'number', description: 'Story point estimate (leaf issues only).' },
                sprintId: { type: 'integer', description: 'Sprint id from get_sprints.' },
                dryRun: { type: 'boolean', description: 'Return the payload instead of creating the issue.' },
            },
            required: ['issueType', 'summary'],
            additionalProperties: false,
        },
        async handler({ args, client, config, signal }) {
            const projectKey = optionalString(args, 'projectKey') ?? config.projectKey;
            if (!projectKey) throw new ToolInputError('"projectKey" is required (no JIRA_PROJECT_KEY default in this workspace)');
            const issueTypeInput = requireString(args, 'issueType');
            const summary = requireString(args, 'summary');
            const issueType = await resolveIssueType(client, projectKey, issueTypeInput, { signal });
            const parent = optionalString(args, 'parent');
            if (issueType.subtask && !parent) throw new ToolInputError(`"${issueType.name}" is a subtask type — "parent" is required`);
            if (!issueType.subtask && parent) {
                // Jira accepts parent only on subtask types; say it here instead of a raw 400.
                throw new ToolInputError(`"parent" is only valid for subtask issue types, not "${issueType.name}"`);
            }

            const fields = {
                project: { key: projectKey },
                issuetype: { id: issueType.id },
                summary,
            };
            const description = optionalString(args, 'description');
            if (description) fields.description = description;
            const labels = optionalStringArray(args, 'labels');
            if (labels) fields.labels = labels;
            const priority = optionalString(args, 'priority');
            if (priority) fields.priority = { name: priority };
            if (parent) fields.parent = { key: parent };
            const estimates = await estimateFields(
                client,
                {
                    storyPoints: optionalNumber(args, 'storyPoints'),
                    sprintId: optionalInteger(args, 'sprintId', { min: 1 }),
                },
                { signal },
            );
            Object.assign(fields, estimates);
            const assignee = optionalString(args, 'assignee');
            if (assignee) fields.assignee = { id: (await resolveAssignee(client, assignee, { signal })).accountId };

            const dryRun = optionalBoolean(args, 'dryRun') ?? false;
            if (dryRun) {
                return `DRY-RUN — would POST /rest/api/2/issue with:\n${JSON.stringify({ fields }, null, 2)}`;
            }
            const created = await client.createIssue(fields, { signal });
            const key = created?.key ?? '(no key returned)';
            const lines = [
                `created ${key} · ${browseUrl(client.site, key)}`,
                `project: ${projectKey} · type: ${issueType.name}${parent ? ` · parent: ${parent}` : ''}`,
            ];
            if (labels) lines.push(`labels: ${labels.join(', ')}`);
            if (estimates.customfield_10016 !== undefined) lines.push(`story points: ${estimates.customfield_10016}`);
            if (estimates.customfield_10020 !== undefined) lines.push(`sprint: ${estimates.customfield_10020}`);
            return lines.join('\n');
        },
    },
    {
        name: 'update_issue',
        title: 'Jira · update issue',
        description:
            'Update fields on one issue. description is Jira wiki markup. Only the fields you pass change; storyPoints/sprintId accept null to clear. Confirm destructive edits with the user first.',
        inputSchema: {
            type: 'object',
            properties: {
                issueKey: { type: 'string', description: 'Issue key.' },
                summary: { type: 'string' },
                description: { type: 'string', description: 'Body in Jira wiki markup.' },
                labels: { type: 'array', items: { type: 'string' } },
                priority: { type: 'string' },
                assignee: { type: ['string', 'null'], description: 'Email/accountId, or null to unassign.' },
                storyPoints: { type: ['number', 'null'], description: 'Number, or null to clear.' },
                sprintId: { type: ['integer', 'null'], description: 'Sprint id, or null to clear.' },
                dryRun: { type: 'boolean' },
            },
            required: ['issueKey'],
            additionalProperties: false,
        },
        async handler({ args, client, signal }) {
            const issueKey = requireString(args, 'issueKey');
            const fields = {};
            const summary = optionalString(args, 'summary');
            if (summary) fields.summary = summary;
            if (typeof args?.description === 'string') fields.description = args.description;
            if (args?.labels !== undefined) fields.labels = optionalStringArray(args, 'labels') ?? [];
            const priority = optionalString(args, 'priority');
            if (priority) fields.priority = { name: priority };
            if (Object.prototype.hasOwnProperty.call(args ?? {}, 'assignee')) {
                const assignee = args.assignee;
                if (assignee === null) fields.assignee = null;
                else if (typeof assignee === 'string' && assignee.trim()) {
                    fields.assignee = { id: (await resolveAssignee(client, assignee.trim(), { signal })).accountId };
                } else throw new ToolInputError('"assignee" must be a non-empty string or null');
            }
            if (Object.prototype.hasOwnProperty.call(args ?? {}, 'storyPoints')) {
                const value = args.storyPoints === null ? undefined : optionalNumber(args, 'storyPoints');
                if (args.storyPoints !== null && value === undefined) throw new ToolInputError('"storyPoints" must be a number or null');
                const { storyPoints } = customFieldIds(await client.fields({ signal }));
                fields[storyPoints] = args.storyPoints === null ? null : value;
            }
            if (Object.prototype.hasOwnProperty.call(args ?? {}, 'sprintId')) {
                const { sprint } = customFieldIds(await client.fields({ signal }));
                if (args.sprintId === null) fields[sprint] = null;
                else {
                    const sprintId = optionalInteger(args, 'sprintId', { min: 1 });
                    if (sprintId === undefined) throw new ToolInputError('"sprintId" must be a positive integer or null');
                    fields[sprint] = sprintId;
                }
            }
            if (Object.keys(fields).length === 0) throw new ToolInputError('nothing to update — pass at least one field');

            if (optionalBoolean(args, 'dryRun') ?? false) {
                return `DRY-RUN — would PUT /rest/api/2/issue/${issueKey} with:\n${JSON.stringify({ fields }, null, 2)}`;
            }
            await client.updateIssue(issueKey, fields, { signal });
            return `updated ${issueKey} · ${browseUrl(client.site, issueKey)}\nfields: ${Object.keys(fields).join(', ')}`;
        },
    },
    {
        name: 'add_comment',
        title: 'Jira · comment',
        description: 'Add a comment to one issue. Body is Jira wiki markup (not Markdown). Never paste a raw transcript — distill the conclusion.',
        inputSchema: {
            type: 'object',
            properties: {
                issueKey: { type: 'string' },
                body: { type: 'string', description: 'Comment body in Jira wiki markup.' },
            },
            required: ['issueKey', 'body'],
            additionalProperties: false,
        },
        async handler({ args, client, signal }) {
            const issueKey = requireString(args, 'issueKey');
            const body = requireString(args, 'body');
            const comment = await client.addComment(issueKey, body, { signal });
            const url = comment?.id ? `${browseUrl(client.site, issueKey)}?focusedCommentId=${comment.id}` : browseUrl(client.site, issueKey);
            return `comment added to ${issueKey}${comment?.id ? ` · id ${comment.id}` : ''}\nurl: ${url}`;
        },
    },
    {
        name: 'transition_issue',
        title: 'Jira · transition',
        description:
            'Move an issue through a workflow transition. Call get_transitions first and pass its id or exact name. Never transition to Done or Closed — a human signs Done (AGENTS.md SLP); pass allowDone:true only when the operator explicitly asked for it.',
        inputSchema: {
            type: 'object',
            properties: {
                issueKey: { type: 'string' },
                transition: { type: 'string', description: 'Transition id (preferred) or exact transition/status name.' },
                comment: { type: 'string', description: 'Optional comment in Jira wiki markup, added with the transition.' },
                allowDone: { type: 'boolean', description: 'Explicitly allow a transition whose target status category is done.' },
            },
            required: ['issueKey', 'transition'],
            additionalProperties: false,
        },
        async handler({ args, client, signal }) {
            const issueKey = requireString(args, 'issueKey');
            const wanted = requireString(args, 'transition');
            const data = await client.transitions(issueKey, { signal });
            const transitions = Array.isArray(data?.transitions) ? data.transitions : [];
            const transition = matchTransition(transitions, wanted);
            if (!transition) {
                const available = transitions.map((item) => `${item.id}:"${item.name}"→${item.to?.name}`).join(', ');
                throw new ToolInputError(`no transition "${wanted}" for ${issueKey}; available: ${available || '(none)'}`);
            }
            const targetCategory = transition.to?.statusCategory?.key;
            const allowDone = optionalBoolean(args, 'allowDone') ?? false;
            if (targetCategory === 'done' && !allowDone) {
                throw new ToolInputError(
                    `${issueKey}: transition "${transition.name}" → ${transition.to?.name} would close the issue. ` +
                        'Done/Closed is signed by a human; pass allowDone:true only if the operator explicitly asked.',
                );
            }
            const comment = optionalString(args, 'comment');
            await client.transition(issueKey, transition.id, { comment, signal });
            const after = await client.getIssue(issueKey, { fields: ['status'], signal });
            return joinParts([
                `${issueKey}: transition "${transition.name}" applied (id ${transition.id})`,
                `status: ${statusLine(after?.fields?.status) ?? transition.to?.name ?? '?'}`,
                `url: ${browseUrl(client.site, issueKey)}`,
            ], '\n');
        },
    },
    {
        name: 'link_issues',
        title: 'Jira · link issues',
        description:
            'Create an issue link. For type "Blocks", inwardIssue is the blocker and outwardIssue is the blocked issue (measured direction, scripts/jira-create.mjs 2026-11-03). Use "Relates" for a symmetric relation.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: 'Link type name: Blocks, Relates, Cloners, Duplicate, … (default Relates).' },
                inwardIssue: { type: 'string', description: 'Inward issue key.' },
                outwardIssue: { type: 'string', description: 'Outward issue key.' },
                comment: { type: 'string', description: 'Optional comment in Jira wiki markup.' },
            },
            required: ['inwardIssue', 'outwardIssue'],
            additionalProperties: false,
        },
        async handler({ args, client, signal }) {
            const type = optionalString(args, 'type') ?? 'Relates';
            const inwardIssue = requireString(args, 'inwardIssue');
            const outwardIssue = requireString(args, 'outwardIssue');
            const comment = optionalString(args, 'comment');
            await client.linkIssues(
                {
                    type: { name: type },
                    inwardIssue: { key: inwardIssue },
                    outwardIssue: { key: outwardIssue },
                    ...(comment ? { comment: { body: comment } } : {}),
                },
                { signal },
            );
            const direction = type.toLowerCase() === 'blocks'
                ? `${inwardIssue} blocks ${outwardIssue} (inwardIssue=blocker, outwardIssue=blocked)`
                : `${inwardIssue} -[${type}]-> ${outwardIssue}`;
            return `linked: ${direction}`;
        },
    },
];

/* ─────────────────────────────── tool helpers ─────────────────────────────── */

/** Resolve an issue type by id or name (case-insensitive) in one project. */
async function resolveIssueType(client, projectKey, wanted, { signal = null } = {}) {
    const data = await client.issueTypes(projectKey, { signal });
    const types = Array.isArray(data?.issueTypes) ? data.issueTypes : [];
    const lower = wanted.toLowerCase();
    const match =
        types.find((type) => String(type.id) === wanted) ??
        types.find((type) => String(type.name).toLowerCase() === lower) ??
        types.find((type) => String(type.untranslatedName ?? '').toLowerCase() === lower);
    if (!match) {
        throw new ToolInputError(
            `unknown issue type "${wanted}" in ${projectKey}; available: ${types.map((type) => type.name).join(', ') || '(none)'}`,
        );
    }
    return match;
}

/** Email → accountId; an accountId is passed through. */
async function resolveAssignee(client, ident, { signal = null } = {}) {
    if (!ident.includes('@')) return { accountId: ident, displayName: ident };
    const users = await client.userSearch(ident, { maxResults: 5, signal });
    const list = Array.isArray(users) ? users : [];
    const exact = list.find((user) => String(user.emailAddress ?? '').toLowerCase() === ident.toLowerCase());
    const chosen = exact ?? list[0];
    if (!chosen?.accountId) throw new ToolInputError(`no Jira user found for "${ident}" (user search returned no accountId)`);
    return { accountId: chosen.accountId, displayName: chosen.displayName ?? ident };
}

/** Story points / sprint field ids from the site, keeping measured defaults as fallback. */
async function estimateFields(client, { storyPoints, sprintId }, { signal = null } = {}) {
    const fields = {};
    if (storyPoints === undefined && sprintId === undefined) return fields;
    const ids = customFieldIds(await client.fields({ signal }));
    if (storyPoints !== undefined) fields[ids.storyPoints] = storyPoints;
    if (sprintId !== undefined) fields[ids.sprint] = sprintId;
    return fields;
}

/** Match by id, transition name, or target status name. Exact id wins. */
export function matchTransition(transitions, wanted) {
    const lower = String(wanted).toLowerCase();
    return (
        transitions.find((transition) => String(transition.id) === String(wanted)) ??
        transitions.find((transition) => String(transition.name).toLowerCase() === lower) ??
        transitions.find((transition) => String(transition.to?.name ?? '').toLowerCase() === lower) ??
        null
    );
}

/* ────────────────────────────── MCP server core ───────────────────────────── */

function configFromEnv(env = process.env) {
    const site = typeof env.JIRA_BASE_URL === 'string' ? env.JIRA_BASE_URL.trim() : '';
    const email = typeof env.JIRA_USER_EMAIL === 'string' ? env.JIRA_USER_EMAIL.trim() : '';
    const token = typeof env.JIRA_API_TOKEN === 'string' ? env.JIRA_API_TOKEN.trim() : '';
    const missing = [
        ['JIRA_BASE_URL', site],
        ['JIRA_USER_EMAIL', email],
        ['JIRA_API_TOKEN', token],
    ]
        .filter(([, value]) => !value)
        .map(([name]) => name);
    if (missing.length) {
        throw new JiraApiError(`missing required environment: ${missing.join(', ')}`, { code: 'BAD_ENV' });
    }
    return {
        site,
        email,
        token,
        projectKey: typeof env.JIRA_PROJECT_KEY === 'string' && env.JIRA_PROJECT_KEY.trim() ? env.JIRA_PROJECT_KEY.trim().toUpperCase() : null,
        caFile: typeof env.JIRA_CA_FILE === 'string' && env.JIRA_CA_FILE.trim() ? env.JIRA_CA_FILE.trim() : null,
        insecureTls: insecureTlsFromEnv(env),
        timeoutMs: Number.isFinite(Number(env.JIRA_TIMEOUT_MS)) && Number(env.JIRA_TIMEOUT_MS) > 0 ? Number(env.JIRA_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
        maxResults: clampMaxResults(env.JIRA_MAX_RESULTS),
    };
}

function clampMaxResults(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_RESULTS;
    return Math.min(Math.floor(n), MAX_RESULTS_CAP);
}

function publicTools() {
    return TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
    }));
}

/**
 * Build the server core without touching stdio — the seam the offline tests use.
 *
 * @param {{ env?: NodeJS.ProcessEnv, client?: object, logger?: { info: Function, error: Function } }} [options]
 */
export function createJiraMcpServer({ env = process.env, client = null, logger = null } = {}) {
    const config = configFromEnv(env);
    const jira = client ?? createJiraClient(config);
    const log = (level, message) => {
        try {
            logger?.[level]?.(message);
        } catch {
            /* logging must never decide anything */
        }
        try {
            if (level === 'error') process.stderr.write(`jira-mcp: ${message}\n`);
        } catch {
            /* stderr is best-effort */
        }
    };

    const tools = publicTools();
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

    /** Run one tool. Always resolves to an MCP result object. */
    async function callTool(name, args, { signal = null } = {}) {
        const tool = byName.get(name);
        if (!tool) {
            return { error: { code: -32602, message: `unknown tool "${name}"` } };
        }
        try {
            const text = await tool.handler({ args: args ?? {}, client: jira, config, signal });
            log('info', `${name} ok`);
            return { content: [{ type: 'text', text: String(text ?? '') }] };
        } catch (error) {
            const message =
                error instanceof ToolInputError || error instanceof JiraApiError
                    ? error.message
                    : `Jira MCP internal error: ${error?.message ?? String(error)}`;
            log('error', `${name} failed: ${message}`);
            return { content: [{ type: 'text', text: message }], isError: true };
        }
    }

    /** JSON-RPC id → AbortController, so `notifications/cancelled` can stop a write. */
    const inFlight = new Map();

    /** Route one JSON-RPC message → response | null (notifications return null). */
    async function handle(message) {
        if (!message || typeof message !== 'object') return null;
        const { method, id } = message;
        const isRequest = id !== undefined && id !== null;

        switch (method) {
            case 'initialize': {
                const requested = message.params?.protocolVersion;
                const protocolVersion = SERVER_PROTOCOLS.includes(requested) ? requested : PROTOCOL_VERSION;
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion,
                        capabilities: { tools: {} },
                        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
                    },
                };
            }
            case 'notifications/initialized':
            case 'notifications/roots/list_changed':
                return null;
            case 'notifications/cancelled': {
                const requestId = message.params?.requestId;
                const controller = inFlight.get(requestId);
                if (controller) controller.abort();
                return null;
            }
            case 'ping':
                return isRequest ? { jsonrpc: '2.0', id, result: {} } : null;
            case 'tools/list':
                return isRequest ? { jsonrpc: '2.0', id, result: { tools } } : null;
            case 'tools/call': {
                if (!isRequest) return null;
                const name = message.params?.name;
                const controller = new AbortController();
                inFlight.set(id, controller);
                try {
                    const result = await callTool(name, message.params?.arguments ?? {}, { signal: controller.signal });
                    if (result?.error) return { jsonrpc: '2.0', id, error: result.error };
                    return { jsonrpc: '2.0', id, result };
                } finally {
                    inFlight.delete(id);
                }
            }
            default: {
                // Server-initiated requests are not supported; answer only if this was a request.
                if (!isRequest) return null;
                return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
            }
        }
    }

    return { config, tools, callTool, handle, client: jira, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } };
}

/* ──────────────────────────────── stdio main ──────────────────────────────── */

function writeMessage(message) {
    try {
        process.stdout.write(`${JSON.stringify(message)}\n`);
    } catch {
        /* parent closed the pipe; nothing to do */
    }
}

async function main() {
    let server;
    try {
        server = createJiraMcpServer();
    } catch (error) {
        process.stderr.write(`jira-mcp: ${error.message}\n`);
        process.exitCode = 2;
        return;
    }
    process.stderr.write(`jira-mcp: ready for ${server.config.site} (CA ${defaultCaFile() ?? 'none'})\n`);

    const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });
    readline.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let message;
        try {
            message = JSON.parse(trimmed);
        } catch {
            writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
            return;
        }
        void (async () => {
            try {
                const response = await server.handle(message);
                if (response) writeMessage(response);
            } catch (error) {
                if (message && message.id !== undefined) {
                    writeMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } });
                }
            }
        })();
    });

    const shutdown = () => {
        readline.close();
        process.exit(0);
    };
    readline.on('close', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main();
}
