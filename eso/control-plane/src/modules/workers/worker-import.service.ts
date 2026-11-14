import { createHash } from 'node:crypto';

import type { EvidenceRequirement, WorkerFile, WorkerLayer, WorkerStatus } from './worker-file.service.js';
import { WorkerFileService } from './worker-file.service.js';

interface ImportFile {
    name: string;
    content: string;
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'worker';
}

function fieldsOf(content: string): { fields: Map<string, string>; body: string } | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return null;
    const fields = new Map<string, string>();
    for (const line of match[1].split(/\r?\n/)) {
        const split = line.indexOf(':');
        if (split <= 0) continue;
        fields.set(line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^['"]|['"]$/g, ''));
    }
    return { fields, body: content.slice(match[0].length).trim() };
}

function list(value: string | undefined): string[] {
    if (!value) return [];
    return value.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function verbsFromTools(tools: string[]): { verbs: string[]; warnings: string[] } {
    const verbs = new Set<string>();
    const warnings: string[] = [];
    for (const raw of tools) {
        const tool = raw.toLowerCase();
        if (['read', 'grep', 'glob', 'ls', 'search'].includes(tool)) verbs.add('read');
        else if (['write', 'edit', 'multiedit', 'multi_edit', 'apply_patch'].includes(tool)) warnings.push(`Tool ${raw} maps to write; write verb requires review in the inspector.`);
        else if (['task', 'agent'].includes(tool)) verbs.add('handoff');
        else if (tool === 'bash') warnings.push('Bash tool detected; no write verb granted automatically.');
    }
    if (verbs.size === 0) verbs.add('read');
    return { verbs: [...verbs], warnings };
}

function barOf(value: string | undefined): EvidenceRequirement[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && typeof item.kind === 'string') : [];
    } catch {
        return [];
    }
}

export class WorkerImportService {
    constructor(private readonly workerFiles: WorkerFileService) {}

    async preview(consumerId: string, files: ImportFile[]): Promise<any> {
        const existing = await this.workerFiles.read(consumerId);
        const ids = new Set(existing.workers.map((worker) => worker.id));
        const names = new Set(existing.workers.map((worker) => worker.name.toLowerCase()));
        const byName = new Map(existing.workers.map((worker) => [worker.name.toLowerCase(), worker]));
        const candidates: any[] = [];
        const skipped: any[] = [];

        for (const file of files) {
            const sourceFile = String(file.name || 'agent.md');
            const content = String(file.content || '');
            const sha = createHash('sha256').update(content).digest('hex');
            if (content.length > 200_000) {
                skipped.push({ sourceFile, reason: 'FILE_TOO_LARGE' });
                continue;
            }
            if (sourceFile.toLowerCase().endsWith('.mdc')) {
                skipped.push({ sourceFile, reason: 'CURSOR_RULE_NOT_A_WORKER', sourceType: 'cursor-rule' });
                continue;
            }
            const parsed = fieldsOf(content);
            if (!parsed) {
                skipped.push({ sourceFile, reason: 'NO_FRONTMATTER', sourceType: 'unknown' });
                continue;
            }
            const { fields, body } = parsed;
            const hasEsoShape = Boolean(fields.get('id') && (fields.get('role') || fields.get('layer')));
            const hasAgentShape = Boolean(fields.get('name') || fields.get('description'));
            if (!hasEsoShape && !hasAgentShape) {
                skipped.push({ sourceFile, reason: 'NOT_AN_AGENT_DEFINITION', sourceType: 'unknown' });
                continue;
            }

            const name = fields.get('name') || sourceFile.replace(/\.(md|mdc)$/i, '');
            let id = hasEsoShape ? String(fields.get('id')) : `worker-${slug(name)}`;
            if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) id = `worker-${slug(id)}`;
            const existingById = ids.has(id) ? id : null;
            const existingByName = byName.get(name.toLowerCase())?.id || null;
            const conflictWith = existingById || existingByName;
            let unique = conflictWith || id;
            if (!conflictWith) {
                let suffix = 2;
                while (ids.has(unique)) unique = `${id}-${suffix++}`;
            }

            const tools = list(fields.get('tools'));
            const mapped = verbsFromTools(tools);
            const warnings: string[] = [...mapped.warnings];
            const layer: WorkerLayer = fields.get('layer') === 'gate' ? 'gate' : 'peer';
            const status: WorkerStatus = 'declared';
            const scope = fields.get('scope') || '';
            if (!scope) warnings.push('No scope declared; deployment and write scope must be set in the inspector.');
            if (names.has(name.toLowerCase()) && !ids.has(id)) warnings.push('A worker with this name already exists.');
            if (hasEsoShape && !fields.get('bar')) warnings.push('No evidence requirement imported.');

            const worker: WorkerFile = {
                id: unique,
                name,
                role: fields.get('role') || 'imported',
                layer,
                scope,
                status,
                hostBindingIds: [],
                capabilities: list(fields.get('capabilities')),
                verbs: fields.get('verbs') ? list(fields.get('verbs')) : mapped.verbs,
                bar: barOf(fields.get('bar')),
                escalation: (fields.get('escalation') as WorkerFile['escalation']) || 'allow',
                instructions: body || fields.get('description') || '',
                sourceFile,
                sourceHash: sha,
                sourceType: hasEsoShape ? 'eso-worker' : 'claude-subagent',
            };
            candidates.push({
                sourceFile,
                sourceType: hasEsoShape ? 'eso-worker' : 'claude-subagent',
                sourceHash: sha,
                worker,
                warnings: conflictWith ? [...warnings, `Conflicts with existing worker ${conflictWith}.`] : warnings,
                conflict: Boolean(conflictWith),
                conflictWith,
            });
            ids.add(unique);
            names.add(name.toLowerCase());
        }

        return { candidates, skipped };
    }
}
