import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import { WorkerFileService } from '../workers/worker-file.service.js';

export interface FlowNode {
    workerId: string;
    x: number;
    y: number;
}

export interface FlowEdge {
    id: string;
    from: string;
    to: string;
    on: string;
    condition?: { kind: string; equals?: string; [key: string]: unknown };
    priority?: number;
}

export interface FlowDefinition {
    id: string;
    taskType?: string;
    name: string;
    version: number;
    status: 'draft' | 'published';
    nodes: FlowNode[];
    edges: FlowEdge[];
    viewport: { x: number; y: number; zoom: number };
    createdAt?: string;
    updatedAt?: string;
    publishedAt?: string;
}

const FLOW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function slug(value: string): string {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'flow';
}

function safe(value: any): FlowDefinition {
    return {
        id: String(value.id || ''),
        name: String(value.name || value.id || 'Flow'),
        version: Number(value.version) || 1,
        status: value.status === 'published' ? 'published' : 'draft',
        taskType: typeof value.taskType === 'string' ? value.taskType : undefined,
        nodes: Array.isArray(value.nodes) ? value.nodes.map((node: any) => ({ workerId: String(node.workerId || ''), x: Number(node.x) || 0, y: Number(node.y) || 0 })) : [],
        edges: Array.isArray(value.edges) ? value.edges.map((edge: any) => ({
            id: String(edge.id || ''), from: String(edge.from || ''), to: String(edge.to || ''),
            on: String(edge.on || ''), condition: edge.condition && typeof edge.condition === 'object' ? edge.condition : undefined,
            priority: Number(edge.priority) || 0,
        })) : [],
        viewport: { x: Number(value.viewport?.x) || 0, y: Number(value.viewport?.y) || 0, zoom: Number(value.viewport?.zoom) || 1 },
        createdAt: value.createdAt, updatedAt: value.updatedAt, publishedAt: value.publishedAt,
    };
}

export class FlowFileService {
    constructor(private readonly store: PlatformStore, private readonly workerFiles: WorkerFileService) {}

    private async root(consumerId: string): Promise<string> {
        const consumer = await this.store.getConsumer(assertConsumerId(consumerId));
        if (!consumer?.root) throw new Error('CONSUMER_ROOT_MISSING');
        return consumer.root;
    }

    private dir(root: string): string {
        return join(root, '.harness', 'flows');
    }

    private indexPath(root: string): string {
        return join(this.dir(root), 'index.json');
    }

    private readIndex(root: string): { defaultFlowId?: string; defaultFlowVersion?: number } {
        return this.readJsonFile(this.indexPath(root)) || {};
    }

    private findLatestPublished(root: string, id: string): number {
        return Math.max(0, ...this.versionEntries(root, id).map((item) => item.version));
    }

    async defaultFlow(consumerId: string): Promise<any> {
        const root = await this.root(consumerId);
        const index = this.readIndex(root);
        if (index.defaultFlowId && index.defaultFlowVersion) {
            return this.readIfExists(this.versionPath(root, index.defaultFlowId, index.defaultFlowVersion));
        }
        const flows = await this.list(consumerId);
        const candidate = flows.find((flow) => flow.publishedVersions.length > 0);
        if (!candidate) return null;
        const version = Math.max(...candidate.publishedVersions);
        this.writeIndex(root, candidate.id, version);
        return this.readIfExists(this.versionPath(root, candidate.id, version));
    }

    async setDefault(consumerId: string, id: string, version: number): Promise<any> {
        const root = await this.root(consumerId);
        if (!FLOW_ID.test(id) || !Number.isInteger(version) || version < 1) return { ok: false, reason: 'INVALID_DEFAULT' };
        const flow = this.readIfExists(this.versionPath(root, id, version));
        if (!flow) return { ok: false, reason: 'VERSION_NOT_FOUND' };
        this.writeIndex(root, id, version);
        await this.workerFiles.refreshIndex(consumerId);
        await this.indexFlows(consumerId);
        return { ok: true, flow };
    }

    private writeIndex(root: string, id: string, version: number): void {
        this.writeJsonFile(this.indexPath(root), { defaultFlowId: id, defaultFlowVersion: version, updatedAt: new Date().toISOString() });
    }

    private draftPath(root: string, id: string): string {
        return join(this.dir(root), `${id}.draft.json`);
    }

    private versionPath(root: string, id: string, version: number): string {
        return join(this.dir(root), `${id}.v${version}.json`);
    }

    private async indexFlows(consumerId: string): Promise<void> {
        const root = await this.root(consumerId);
        const index = this.readIndex(root);
        const summaries = await this.list(consumerId);
        const rows: any[] = [];
        for (const summary of summaries) {
            const draft = this.readIfExists(this.draftPath(root, summary.id));
            if (draft) {
                rows.push({
                    flowId: summary.id, version: draft.version, name: draft.name, status: 'draft',
                    isDefault: false, definition: draft, sourceHash: createHash('sha256').update(JSON.stringify(draft)).digest('hex'),
                    updatedAt: draft.updatedAt, publishedAt: null,
                });
            }
            for (const version of summary.publishedVersions) {
                const flow = this.readIfExists(this.versionPath(root, summary.id, version));
                if (!flow) continue;
                rows.push({
                    flowId: summary.id, version, name: flow.name, status: 'published',
                    isDefault: index.defaultFlowId === summary.id && index.defaultFlowVersion === version,
                    definition: flow, sourceHash: createHash('sha256').update(JSON.stringify(flow)).digest('hex'),
                    updatedAt: flow.updatedAt, publishedAt: flow.publishedAt,
                });
            }
        }
        await this.store.replaceFlowIndex(consumerId, rows);
    }

    async list(consumerId: string): Promise<any[]> {
        const root = await this.root(consumerId);
        const dir = this.dir(root);
        if (!existsSync(dir)) return [];
        const ids = new Set<string>();
        for (const name of readdirSync(dir)) {
            const match = /^([a-z0-9-]+)\.(draft|v\d+)\.json$/.exec(name);
            if (match) ids.add(match[1]);
        }
        const index = this.readIndex(root);
        return [...ids].sort().map((id) => {
            const draft = this.readIfExists(this.draftPath(root, id));
            const versions = this.versionEntries(root, id);
            const latest = versions.at(-1);
            return {
                id,
                name: (draft || latest?.flow)?.name || id,
                version: draft ? draft.version : (latest?.version || 1),
                status: draft ? 'draft' : 'published',
                publishedVersions: versions.map((item) => item.version),
                updatedAt: draft?.updatedAt || latest?.flow?.publishedAt || null,
                isDefault: index.defaultFlowId === id,
            };
        });
    }

    async get(consumerId: string, id: string, version?: number): Promise<any> {
        const root = await this.root(consumerId);
        if (!FLOW_ID.test(id)) throw new Error('FLOW_INVALID');
        if (version) return this.readIfExists(this.versionPath(root, id, version));
        return this.readIfExists(this.draftPath(root, id)) || this.readIfExists(this.versionPath(root, id, Math.max(0, ...this.versionEntries(root, id).map((item) => item.version))));
    }

    async listVersions(consumerId: string, id: string): Promise<any[]> {
        return this.versionEntries(await this.root(consumerId), id);
    }

    async saveDraft(consumerId: string, id: string, input: any): Promise<any> {
        const root = await this.root(consumerId);
        if (!FLOW_ID.test(id)) throw new Error('FLOW_INVALID');
        mkdirSync(this.dir(root), { recursive: true });
        const latest = this.versionEntries(root, id).at(-1);
        const previous = this.readIfExists(this.draftPath(root, id));
        const flow = safe({
            ...input,
            id,
            name: input.name || id,
            version: previous?.version || (latest?.version || 0) + 1,
            status: 'draft',
            createdAt: previous?.createdAt || input.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        this.write(this.draftPath(root, id), flow);
        await this.indexFlows(consumerId);
        return flow;
    }

    async deleteDraft(consumerId: string, id: string): Promise<any> {
        const root = await this.root(consumerId);
        if (!FLOW_ID.test(id)) return { ok: false, reason: 'FLOW_INVALID' };
        const draft = this.draftPath(root, id);
        if (!existsSync(draft)) return { ok: false, reason: 'NO_DRAFT' };
        rmSync(draft, { force: true });
        await this.indexFlows(consumerId);
        return { ok: true, flowId: id };
    }

    async publish(consumerId: string, id: string): Promise<any> {
        const root = await this.root(consumerId);
        const draft = this.readIfExists(this.draftPath(root, id));
        if (!draft) return { ok: false, reason: 'NO_DRAFT' };
        const validation = await this.validate(consumerId, draft);
        if (!validation.ok) return { ok: false, validation };
        const flow = safe({ ...draft, status: 'published', publishedAt: new Date().toISOString() });
        this.write(this.versionPath(root, id, flow.version), flow);
        rmSync(this.draftPath(root, id), { force: true });
        const index = this.readIndex(root);
        if (!index.defaultFlowId || index.defaultFlowId === id) {
            this.writeIndex(root, id, flow.version);
        }
        await this.workerFiles.refreshIndex(consumerId);
        await this.indexFlows(consumerId);
        return { ok: true, flow, validation };
    }

    async validate(consumerId: string, input: any): Promise<any> {
        const flow = safe(input);
        const errors: string[] = [];
        const warnings: string[] = [];
        if (!FLOW_ID.test(flow.id)) errors.push('FLOW_ID_INVALID');
        if (!flow.nodes.length) errors.push('FLOW_HAS_NO_NODES');
        const workers = await this.workerFiles.read(consumerId);
        const workerIds = new Set(workers.workers.map((worker) => worker.id));
        const nodes = new Set<string>();
        for (const node of flow.nodes) {
            if (!workerIds.has(node.workerId)) errors.push(`UNKNOWN_WORKER:${node.workerId}`);
            if (nodes.has(node.workerId)) errors.push(`DUPLICATE_NODE:${node.workerId}`);
            nodes.add(node.workerId);
        }
        const edgeIds = new Set<string>();
        for (const edge of flow.edges) {
            if (!edge.id) errors.push('EDGE_ID_MISSING');
            if (edgeIds.has(edge.id)) errors.push(`DUPLICATE_EDGE:${edge.id}`);
            edgeIds.add(edge.id);
            if (!nodes.has(edge.from)) errors.push(`EDGE_FROM_UNKNOWN:${edge.from}`);
            if (!nodes.has(edge.to)) errors.push(`EDGE_TO_UNKNOWN:${edge.to}`);
            if (edge.from === edge.to) errors.push(`EDGE_SELF:${edge.id}`);
        }
        const adjacency = new Map<string, string[]>();
        for (const edge of flow.edges) adjacency.set(edge.from, [...(adjacency.get(edge.from) || []), edge.to]);
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const hasCycle = (node: string): boolean => {
            if (visiting.has(node)) return true;
            if (visited.has(node)) return false;
            visiting.add(node);
            for (const next of adjacency.get(node) || []) if (hasCycle(next)) return true;
            visiting.delete(node);
            visited.add(node);
            return false;
        };
        let cyclic = false;
        for (const node of nodes) if (hasCycle(node)) { cyclic = true; break; }
        if (cyclic) warnings.push('FLOW_HAS_LOOP');
        if (flow.edges.length === 0 && flow.nodes.length > 1) warnings.push('FLOW_HAS_NO_EDGES');
        return { ok: errors.length === 0, errors, warnings };
    }

    private readJsonFile(path: string): any {
        if (!existsSync(path)) return null;
        try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
    }

    private writeJsonFile(path: string, value: any): void {
        const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        renameSync(temp, path);
    }

    private versionEntries(root: string, id: string): Array<{ version: number; flow: FlowDefinition }> {
        const dir = this.dir(root);
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
            .map((name) => /^([a-z0-9-]+)\.v(\d+)\.json$/.exec(name))
            .filter((match): match is RegExpExecArray => Boolean(match && match[1] === id))
            .map((match) => ({ version: Number(match[2]), flow: this.readIfExists(this.versionPath(root, id, Number(match[2]))) }))
            .filter((item) => item.flow)
            .sort((a, b) => a.version - b.version);
    }

    private readIfExists(path: string): FlowDefinition | null {
        if (!existsSync(path)) return null;
        try { return safe(JSON.parse(readFileSync(path, 'utf8'))); } catch { return null; }
    }

    private write(path: string, flow: FlowDefinition): void {
        const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(temp, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
        renameSync(temp, path);
    }
}
