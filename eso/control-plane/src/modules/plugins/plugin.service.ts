import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformStore } from '../../platform/registry/store.js';

export interface PluginManifest {
    id: string;
    label: string;
    type: 'host' | 'provider' | 'capability' | 'source';
    category: 'host' | 'work' | 'design' | 'content' | 'other';
    version: string;
    capabilities: string[];
    status: 'installed' | 'available';
    description: string;
    configSchema: {
        required: string[];
        properties: Record<string, { type: string; label: string; enum?: string[]; format?: string; secret?: boolean; help?: string }>;
    };
    connector?: any;
    source?: string;
}

const JIRA_SCHEMA: PluginManifest['configSchema'] = {
    required: ['baseUrl', 'email'],
    properties: {
        baseUrl: { type: 'string', label: 'Base URL', format: 'uri' },
        projectKey: { type: 'string', label: 'Project scope', help: 'Optional. Leave empty to sync all accessible projects.' },
        email: { type: 'string', label: 'Email' },
        authMode: { type: 'string', label: 'Auth mode', enum: ['api-token', 'oauth'] },
        syncMode: { type: 'string', label: 'Sync mode', enum: ['manual', 'on-demand'] },
        apiToken: { type: 'string', label: 'API token secret ref', secret: true, help: 'Use env:JIRA_API_TOKEN' },
    },
};

const NOTION_SCHEMA: PluginManifest['configSchema'] = {
    required: ['databaseId'],
    properties: {
        databaseId: { type: 'string', label: 'Database id' },
        apiToken: { type: 'string', label: 'API token secret ref', secret: true, help: 'Use env:NOTION_TOKEN' },
    },
};

const BUILTINS: PluginManifest[] = [
    { id: 'cursor', label: 'Cursor', type: 'host', category: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'hooks', 'mcp'], status: 'installed', description: 'Cursor host adapter.', configSchema: { required: [], properties: {} }, source: 'builtin' },
    { id: 'agy', label: 'Antigravity', type: 'host', category: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'mcp'], status: 'installed', description: 'Antigravity host adapter.', configSchema: { required: [], properties: {} }, source: 'builtin' },
    { id: 'claude', label: 'Claude', type: 'host', category: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'subagents', 'mcp'], status: 'installed', description: 'Claude host adapter.', configSchema: { required: [], properties: {} }, source: 'builtin' },
    { id: 'dsh', label: 'DSH', type: 'host', category: 'host', version: '1.0.0', capabilities: ['rules', 'skills', 'hooks', 'mcp', 'memory'], status: 'installed', description: 'DeepSeek Harness host adapter.', configSchema: { required: [], properties: {} }, source: 'builtin' },
    { id: 'paseo', label: 'Paseo', type: 'host', category: 'host', version: '1.0.0', capabilities: ['orchestration', 'mcp'], status: 'installed', description: 'Paseo orchestration adapter.', configSchema: { required: [], properties: {} }, source: 'builtin' },
    { id: 'jira', label: 'Jira', type: 'provider', category: 'work', version: '1.0.0', capabilities: ['ticket', 'external-ref'], status: 'installed', description: 'Jira issue and external reference provider.', configSchema: JIRA_SCHEMA, source: 'builtin' },
    { id: 'notion', label: 'Notion', type: 'provider', category: 'content', version: '1.0.0', capabilities: ['document'], status: 'available', description: 'Notion document provider.', configSchema: { ...NOTION_SCHEMA, properties: { ...NOTION_SCHEMA.properties, baseUrl: { type: 'string', label: 'API base URL', help: 'Default https://api.notion.com' } } }, source: 'builtin' },
    { id: 'confluence', label: 'Confluence', type: 'provider', category: 'content', version: '1.0.0', capabilities: ['document'], status: 'available', description: 'Confluence document provider.', configSchema: { required: ['baseUrl', 'spaceKey'], properties: { baseUrl: { type: 'string', label: 'Base URL' }, spaceKey: { type: 'string', label: 'Space key' }, apiToken: { type: 'string', label: 'API token secret ref', secret: true } } }, source: 'builtin' },
    { id: 'figma', label: 'Figma', type: 'provider', category: 'design', version: '1.0.0', capabilities: ['design'], status: 'installed', description: 'Figma design artifact provider.', configSchema: { required: ['fileKey'], properties: { baseUrl: { type: 'string', label: 'API base URL', help: 'Default https://api.figma.com' }, fileKey: { type: 'string', label: 'File key' }, apiToken: { type: 'string', label: 'API token secret ref', secret: true, help: 'Use env:FIGMA_TOKEN' } } }, source: 'builtin' },
    { id: 'penpot', label: 'Penpot', type: 'provider', category: 'design', version: '1.0.0', capabilities: ['design'], status: 'installed', description: 'Penpot design artifact provider.', configSchema: { required: ['baseUrl'], properties: { baseUrl: { type: 'string', label: 'Base URL' }, teamId: { type: 'string', label: 'Team id (for sync)' }, apiToken: { type: 'string', label: 'API token secret ref', secret: true, help: 'Use env:PENPOT_TOKEN' } } }, source: 'builtin' },
];

function parse(value: any): any {
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return {}; }
    }
    return value && typeof value === 'object' ? value : {};
}

function missingFields(schema: PluginManifest['configSchema'], config: any): string[] {
    return (schema?.required || []).filter((key) => {
        const value = config?.[key];
        return value === undefined || value === null || String(value).trim() === '';
    });
}

function secret(ref: string | undefined): string {
    if (!ref) return '';
    if (ref.startsWith('env:')) return process.env[ref.slice(4)] || '';
    if (ref.startsWith('secret:')) {
        const path = ref.slice(7);
        return existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
    }
    return '';
}

async function requestJson(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
    try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
        const text = await response.text();
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, 500) }; }
        return { ok: response.ok, status: response.status, data };
    } catch (error: any) {
        return { ok: false, status: 0, data: { error: error?.message || String(error) } };
    }
}

export class PluginService {
    constructor(private readonly store: PlatformStore) {}

    private async catalog(): Promise<PluginManifest[]> {
        const custom = (await this.store.listPluginManifests()).map((row: any) => ({
            id: row.id, label: row.label, type: row.type, category: row.category || 'other', version: row.version,
            capabilities: parse(row.capabilities), status: row.status || 'installed', description: row.description,
            configSchema: parse(row.config_schema), source: row.source || 'custom', connector: parse(row.config_schema)?.connector,
        })) as PluginManifest[];
        return [...BUILTINS, ...custom];
    }

    async list(): Promise<any[]> {
        return (await this.catalog()).map((plugin) => ({ ...plugin, installed: plugin.status === 'installed' }));
    }

    async install(manifest: any): Promise<any> {
        if (!manifest?.id || !/^[a-z][a-z0-9-]{1,63}$/.test(String(manifest.id))) return { ok: false, reason: 'INVALID_PLUGIN_ID' };
        if (!['host', 'provider', 'capability', 'source'].includes(manifest.type)) return { ok: false, reason: 'INVALID_PLUGIN_TYPE' };
        if (!manifest.configSchema || typeof manifest.configSchema !== 'object') return { ok: false, reason: 'INVALID_CONFIG_SCHEMA' };
        const configSchema = { ...(manifest.configSchema || {}), connector: manifest.connector || undefined };
        const row = await this.store.upsertPluginManifest({ ...manifest, configSchema });
        return { ok: true, plugin: row };
    }

    async remove(id: string): Promise<any> {
        await this.store.deletePluginManifest(id);
        return { ok: true, id };
    }

    private async migrateLegacy(consumerId: string, plugins: any[]): Promise<void> {
        const jira = plugins.find((plugin) => plugin.id === 'jira');
        if (jira?.enabled || jira?.config?.projectKey) return;
        const consumer = await this.store.getConsumer(consumerId as any);
        if (!consumer?.root) return;
        const path = join(consumer.root, '.harness', 'config.json');
        if (!existsSync(path)) return;
        try {
            const config = JSON.parse(readFileSync(path, 'utf8'));
            const settings = config?.profile?.settings || config?.settings;
            const legacy = settings?.knowledge?.providers?.jira;
            if (!legacy?.enabled && !legacy?.projectKey) return;
            await this.store.upsertConsumerPlugin(consumerId, 'jira', {
                enabled: Boolean(legacy.enabled), config: { projectKey: legacy.projectKey || '', syncMode: legacy.syncMode || 'manual' },
                secretRefs: {}, health: 'unconfigured',
            });
        } catch { /* ignore malformed legacy config */ }
    }

    private async find(id: string): Promise<PluginManifest | undefined> {
        return (await this.catalog()).find((plugin) => plugin.id === id);
    }

    async consumer(consumerId: string): Promise<any[]> {
        const plugins = await this.catalog();
        await this.migrateLegacy(consumerId, plugins);
        const saved = await this.store.listConsumerPlugins(consumerId);
        const byId = new Map(saved.map((row: any) => [row.plugin_id, row]));
        return plugins.map((plugin) => {
            const row: any = byId.get(plugin.id);
            return {
                ...plugin, enabled: Boolean(row?.enabled), config: parse(row?.config), secretRefs: parse(row?.secret_refs),
                health: row?.health || 'unknown', lastCheckedAt: row?.last_checked_at || null,
                installed: plugin.status === 'installed',
            };
        });
    }

    async configure(consumerId: string, pluginId: string, input: any): Promise<any> {
        const plugin = await this.find(pluginId);
        if (!plugin) return { ok: false, reason: 'PLUGIN_NOT_FOUND' };
        const config = input.config && typeof input.config === 'object' ? input.config : {};
        const missing = missingFields(plugin.configSchema, config);
        if (input.enabled && missing.length > 0) return { ok: false, reason: 'CONFIG_INCOMPLETE', missing };
        const secretRefs = input.secretRefs && typeof input.secretRefs === 'object' ? input.secretRefs : {};
        for (const [key, value] of Object.entries(secretRefs)) {
            if (!/^(env|secret|vault):[A-Za-z0-9_./-]+$/.test(String(value))) return { ok: false, reason: `INVALID_SECRET_REF:${key}` };
        }
        const row = await this.store.upsertConsumerPlugin(consumerId, pluginId, {
            enabled: Boolean(input.enabled), config, secretRefs, health: missing.length ? 'unconfigured' : 'configured',
        });
        if (plugin.id === 'jira' && config.projectKey === '__none__') {
            await this.store.replaceProviderRecords(consumerId, pluginId, []);
        }
        return { ok: true, plugin: { ...plugin, ...row, enabled: Boolean(row.enabled), config: parse(row.config), secretRefs: parse(row.secret_refs), health: row.health } };
    }

    private headers(plugin: PluginManifest, config: any, secretRefs: any): Record<string, string> {
        const token = secret(secretRefs.apiToken);
        if (!token) return {};
        if (plugin.id === 'jira') {
            const email = String(config.email || '');
            return { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`, Accept: 'application/json' };
        }
        return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    }

    async test(consumerId: string, pluginId: string): Promise<any> {
        const plugin = await this.find(pluginId);
        if (!plugin) return { ok: false, reason: 'PLUGIN_NOT_FOUND' };
        const rows = await this.store.listConsumerPlugins(consumerId);
        const row: any = rows.find((item: any) => item.plugin_id === pluginId);
        if (!row?.enabled) return { ok: false, reason: 'PLUGIN_NOT_ENABLED', health: 'disabled' };
        const config = parse(row.config);
        const secretRefs = parse(row.secret_refs);
        const missing = missingFields(plugin.configSchema, config);
        if (missing.length > 0) return { ok: false, reason: 'CONFIG_INCOMPLETE', missing, health: 'unconfigured' };
        const health = await this.health(plugin, config, secretRefs);
        await this.store.upsertConsumerPlugin(consumerId, pluginId, {
            enabled: true, config, secretRefs, health: health.ok ? 'healthy' : 'unreachable',
        });
        return { ...health, health: health.ok ? 'healthy' : 'unreachable' };
    }

    private async health(plugin: PluginManifest, config: any, secretRefs: any): Promise<any> {
        const headers = this.headers(plugin, config, secretRefs);
        let url = '';
        if (plugin.id === 'jira') url = `${String(config.baseUrl).replace(/\/$/, '')}/rest/api/3/myself`;
        else if (plugin.id === 'figma') url = `${String(config.baseUrl || 'https://api.figma.com').replace(/\/$/, '')}/v1/me`;
        else if (plugin.id === 'penpot') url = `${String(config.baseUrl).replace(/\/$/, '')}/api/rpc/command/get-profile`;
        else if (plugin.id === 'notion') url = `${String(config.baseUrl || 'https://api.notion.com').replace(/\/$/, '')}/v1/users/me`;
        else if (plugin.id === 'confluence') url = `${String(config.baseUrl).replace(/\/$/, '')}/wiki/rest/api/space/${encodeURIComponent(config.spaceKey)}`;
        else if (plugin.connector?.healthPath) url = `${String(config.baseUrl).replace(/\/$/, '')}${plugin.connector.healthPath}`;
        if (!url) return { ok: false, status: 0, detail: 'NO_HEALTH_CONNECTOR' };
        const result = await requestJson(url, { headers });
        return { ok: result.ok, status: result.status, url, detail: result.ok ? 'reachable' : (result.data?.error || result.data?.message || `HTTP ${result.status}`) };
    }

    async discoverProjects(consumerId: string, pluginId: string): Promise<any> {
        const plugin = await this.find(pluginId);
        if (!plugin) return { ok: false, reason: 'PLUGIN_NOT_FOUND' };
        if (plugin.id !== 'jira') return { ok: false, reason: 'PROJECT_DISCOVERY_UNSUPPORTED' };
        const rows = await this.store.listConsumerPlugins(consumerId);
        const row: any = rows.find((item: any) => item.plugin_id === pluginId);
        if (!row) return { ok: false, reason: 'PLUGIN_NOT_CONFIGURED' };
        const config = parse(row.config);
        const secretRefs = parse(row.secret_refs);
        const missing = ['baseUrl', 'email'].filter((key) => !config?.[key]);
        if (missing.length > 0) return { ok: false, reason: 'CONFIG_INCOMPLETE', missing };
        const headers = this.headers(plugin, config, secretRefs);
        if (!headers.Authorization) return { ok: false, reason: 'SECRET_MISSING' };
        const base = String(config.baseUrl).replace(/\/$/, '');
        const result = await requestJson(`${base}/rest/api/3/project/search?maxResults=100&orderBy=name`, { headers });
        if (!result.ok) return { ok: false, reason: 'PROVIDER_REQUEST_FAILED', status: result.status, detail: result.data?.errorMessages || result.data?.message || result.data };
        const projects = (result.data?.values || []).map((project: any) => ({ id: String(project.id), key: String(project.key), name: String(project.name), type: project.projectTypeKey || 'project' }));
        return { ok: true, projects };
    }

    async sync(consumerId: string, pluginId: string): Promise<any> {
        const plugin = await this.find(pluginId);
        if (!plugin) return { ok: false, reason: 'PLUGIN_NOT_FOUND' };
        const rows = await this.store.listConsumerPlugins(consumerId);
        const row: any = rows.find((item: any) => item.plugin_id === pluginId);
        if (!row?.enabled) return { ok: false, reason: 'PLUGIN_NOT_ENABLED' };
        const config = parse(row.config);
        const secretRefs = parse(row.secret_refs);
        const missing = missingFields(plugin.configSchema, config);
        if (missing.length > 0) return { ok: false, reason: 'CONFIG_INCOMPLETE', missing };
        if (plugin.id === 'jira' && config.projectKey === '__none__') {
            return { ok: false, reason: 'NO_PROJECT_SCOPE', detail: 'No Jira project linked. Choose a project or All accessible projects.' };
        }
        const headers = this.headers(plugin, config, secretRefs);
        let records: any[] = [];
        if (plugin.id === 'jira') {
            const base = String(config.baseUrl).replace(/\/$/, '');
            const jql = config.projectKey ? `project=${config.projectKey}` : 'updated >= -30d ORDER BY updated DESC';
            const result = await requestJson(`${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,issuetype,updated`, { headers });
            if (!result.ok) return { ok: false, reason: 'PROVIDER_REQUEST_FAILED', status: result.status, detail: result.data?.error || result.data?.errorMessages || result.data };
            records = (result.data?.issues || []).map((issue: any) => ({
                externalId: String(issue.key), kind: String(issue.fields?.issuetype?.name || 'issue'),
                title: String(issue.fields?.summary || issue.key), status: String(issue.fields?.status?.name || ''),
                url: `${base}/browse/${issue.key}`, payload: issue,
            }));
        } else if (plugin.id === 'figma') {
            const figmaBase = String(config.baseUrl || 'https://api.figma.com').replace(/\/$/, '');
            const result = await requestJson(`${figmaBase}/v1/files/${encodeURIComponent(config.fileKey)}?depth=1`, { headers });
            if (!result.ok) return { ok: false, reason: 'PROVIDER_REQUEST_FAILED', status: result.status, detail: result.data?.error || result.data };
            records = [{ externalId: String(config.fileKey), kind: 'file', title: String(result.data?.name || config.fileKey), status: 'active', url: `https://www.figma.com/file/${config.fileKey}`, payload: result.data }];
        } else if (plugin.id === 'penpot') {
            if (!config.teamId) return { ok: false, reason: 'TEAM_ID_REQUIRED' };
            const base = String(config.baseUrl).replace(/\/$/, '');
            const result = await requestJson(`${base}/api/rpc/command/get-projects?team-id=${encodeURIComponent(config.teamId)}`, { headers });
            if (!result.ok) return { ok: false, reason: 'PROVIDER_REQUEST_FAILED', status: result.status, detail: result.data?.error || result.data };
            const list = Array.isArray(result.data) ? result.data : (result.data?.projects || []);
            records = list.map((project: any) => ({
                externalId: String(project.id), kind: 'project', title: String(project.name || project.id),
                status: 'active', url: `${base}/#/dashboard/team/${config.teamId}`, payload: project,
            }));
        } else if (plugin.id === 'notion') {
            const base = String(config.baseUrl || 'https://api.notion.com').replace(/\/$/, '');
            const result = await requestJson(`${base}/v1/search`, {
                method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
                body: JSON.stringify({ page_size: 50 }),
            });
            if (!result.ok) return { ok: false, reason: 'PROVIDER_REQUEST_FAILED', status: result.status, detail: result.data?.message || result.data };
            records = (result.data?.results || []).map((item: any) => ({
                externalId: String(item.id), kind: item.object || 'page',
                title: String(item.properties?.title?.title?.[0]?.plain_text || item.title?.[0]?.plain_text || item.id),
                status: 'active', url: item.url || null, payload: item,
            }));
        } else if (plugin.id === 'confluence') {
            const base = String(config.baseUrl).replace(/\/$/, '');
            const result = await requestJson(`${base}/wiki/rest/api/content?spaceKey=${encodeURIComponent(config.spaceKey)}&limit=50`, { headers });
            if (!result.ok) return { ok: false, reason: 'PROVIDER_REQUEST_FAILED', status: result.status, detail: result.data?.message || result.data };
            records = (result.data?.results || []).map((item: any) => ({
                externalId: String(item.id), kind: 'page', title: String(item.title || item.id),
                status: String(item.status || 'current'), url: `${base}/wiki${item._links?.webui || ''}`, payload: item,
            }));
        } else if (plugin.connector?.kind === 'http-json' && plugin.connector.recordsPath) {
            const url = `${String(config.baseUrl).replace(/\/$/, '')}${plugin.connector.recordsPath}`;
            const result = await requestJson(url, { headers });
            if (!result.ok) return { ok: false, reason: 'PROVIDER_REQUEST_FAILED', status: result.status, detail: result.data?.error || result.data };
            const list = Array.isArray(result.data) ? result.data : (result.data?.items || []);
            records = list.map((item: any, index: number) => ({
                externalId: String(item?.[plugin.connector.idField || 'id'] ?? index),
                kind: String(item?.[plugin.connector.kindField || 'kind'] || 'record'),
                title: String(item?.[plugin.connector.titleField || 'title'] ?? 'Record'),
                status: String(item?.status || ''), url: item?.url || null, payload: item,
            }));
        } else {
            return { ok: false, reason: 'SYNC_NOT_IMPLEMENTED', provider: plugin.id };
        }
        await this.store.replaceProviderRecords(consumerId, pluginId, records);
        await this.store.upsertConsumerPlugin(consumerId, pluginId, {
            enabled: true, config, secretRefs, health: 'healthy',
        });
        return { ok: true, provider: plugin.id, count: records.length, records: records.map((r) => ({ externalId: r.externalId, kind: r.kind, title: r.title, status: r.status })) };
    }
}
