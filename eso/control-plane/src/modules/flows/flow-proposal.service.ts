import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PlatformStore } from '../../platform/registry/store.js';
import { FlowFileService } from './flow-file.service.js';
import { WorkerFileService } from '../workers/worker-file.service.js';

export class FlowProposalService {
    constructor(
        private readonly store: PlatformStore,
        private readonly workerFiles: WorkerFileService,
        private readonly flowFiles: FlowFileService,
    ) {}

    private async root(consumerId: string): Promise<string> {
        const consumer = await this.store.getConsumer(consumerId as any);
        if (!consumer?.root) throw new Error('CONSUMER_ROOT_MISSING');
        return consumer.root;
    }

    private slpFiles(root: string): string[] {
        const files: string[] = [];
        const add = (dir: string) => {
            if (!existsSync(dir)) return;
            for (const name of readdirSync(dir)) {
                if (!/slp/i.test(name)) continue;
                if (!name.endsWith('.md') && !name.endsWith('.mdc')) continue;
                files.push(join(dir, name));
            }
        };
        add(join(root, 'agents', 'rules'));
        for (const name of ['slp.md', 'SLP.md']) {
            const path = join(root, 'agents', name);
            if (existsSync(path)) files.push(path);
        }
        return [...new Set(files)].sort();
    }

    private extractSpec(content: string): any | null {
        const match = content.match(/```slp-flow\s*\r?\n([\s\S]*?)```/i);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[1].trim());
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }

    async preview(consumerId: string): Promise<any> {
        const root = await this.root(consumerId);
        const files = this.slpFiles(root);
        if (files.length === 0) return { available: false, reason: 'NO_SLP_FILE', files: [] };
        for (const file of files) {
            const content = readFileSync(file, 'utf8');
            const spec = this.extractSpec(content);
            if (!spec) continue;
            const workers = await this.workerFiles.read(consumerId);
            const workerIds = new Set(workers.workers.map((worker) => worker.id));
            const rank: Record<string, number> = { scout: 0, plan: 1, build: 2, verify: 3, audit: 4, qc: 5, fixbug: 6 };
            const ordered = [...workers.workers].sort((a, b) => (rank[a.role] ?? 50) - (rank[b.role] ?? 50));
            const id = String(spec.id || 'slp-flow');
            const nodes = ordered.map((worker, index) => ({
                workerId: worker.id,
                x: 60 + (index % 3) * 240,
                y: 50 + Math.floor(index / 3) * 160,
            }));
            const edges = (Array.isArray(spec.edges) ? spec.edges : []).map((edge: any, index: number) => ({
                id: String(edge.id || `slp-e-${index + 1}`),
                from: String(edge.from || ''),
                to: String(edge.to || ''),
                on: String(edge.on || 'PASS'),
                condition: edge.condition && typeof edge.condition === 'object' ? edge.condition : { kind: 'outcome', equals: String(edge.on || 'PASS') },
                priority: Number(edge.priority) || 0,
            }));
            const flow = {
                id,
                name: String(spec.name || 'SLP proposal'),
                version: 1,
                status: 'draft' as const,
                nodes,
                edges,
                viewport: { x: 0, y: 0, zoom: 1 },
            };
            const warnings: string[] = [];
            for (const edge of edges) {
                if (!workerIds.has(edge.from)) warnings.push(`UNKNOWN_WORKER:${edge.from}`);
                if (!workerIds.has(edge.to)) warnings.push(`UNKNOWN_WORKER:${edge.to}`);
            }
            return {
                available: true,
                sourceFile: file.slice(root.length + 1),
                sourceHash: createHash('sha256').update(content).digest('hex'),
                flow,
                warnings,
            };
        }
        return { available: false, reason: 'NO_STRUCTURED_SLP_FLOW', files: files.map((file) => file.slice(root.length + 1)) };
    }

    async apply(consumerId: string): Promise<any> {
        const proposal = await this.preview(consumerId);
        if (!proposal.available) return { ok: false, reason: proposal.reason };
        const flow = await this.flowFiles.saveDraft(consumerId, proposal.flow.id, proposal.flow);
        const validation = await this.flowFiles.validate(consumerId, flow);
        return { ok: validation.ok, flow, validation, warnings: proposal.warnings || [] };
    }
}
