import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

export interface RuleFile {
    id: string;
    description: string;
    globs: string;
    alwaysApply: boolean;
    body: string;
    sourceFile?: string;
    sourceHash?: string;
}

interface ImportFile {
    name: string;
    content: string;
}

const RULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function slug(value: string): string {
    return value.toLowerCase().replace(/\.(mdc|md)$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'rule';
}

function parseRule(content: string, fallbackId: string, sourceFile?: string, sourceHash?: string): RuleFile {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const fields = new Map<string, string>();
    const body = match ? content.slice(match[0].length).trim() : content.trim();
    if (match) {
        for (const line of match[1].split(/\r?\n/)) {
            const split = line.indexOf(':');
            if (split <= 0) continue;
            fields.set(line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^['"]|['"]$/g, ''));
        }
    }
    return {
        id: slug(fallbackId),
        description: fields.get('description') || '',
        globs: fields.get('globs') || '',
        alwaysApply: fields.get('alwaysApply') === 'true',
        body,
        sourceFile,
        sourceHash,
    };
}

function render(rule: RuleFile): string {
    const lines = ['---'];
    lines.push(`description: ${JSON.stringify(rule.description || '')}`);
    if (rule.globs) lines.push(`globs: ${JSON.stringify(rule.globs)}`);
    lines.push(`alwaysApply: ${rule.alwaysApply ? 'true' : 'false'}`);
    lines.push('---', '', rule.body.trim(), '');
    return lines.join('\n');
}

export class RuleFileService {
    constructor(private readonly store: PlatformStore) {}

    private async root(consumerId: string): Promise<string> {
        const consumer = await this.store.getConsumer(assertConsumerId(consumerId));
        if (!consumer?.root) throw new Error('CONSUMER_ROOT_MISSING');
        return consumer.root;
    }

    private dir(root: string): string {
        return join(root, 'agents', 'rules');
    }

    async materialCounts(consumerId: string): Promise<any> {
        const root = await this.root(consumerId);
        const count = (dir: string, exts: string[]): number => {
            const target = join(root, 'agents', dir);
            if (!existsSync(target)) return 0;
            return readdirSync(target)
                .filter((name) => !name.toLowerCase().startsWith('readme.') && exts.some((ext) => name.endsWith(ext)))
                .length;
        };
        return {
            skills: count('skills', ['.md']),
            hooks: count('hooks', ['.md', '.mjs', '.js', '.json']),
            subagents: count('subagents', ['.md']),
            rules: (await this.list(consumerId)).length,
        };
    }

    async remove(consumerId: string, id: string): Promise<any> {
        const dir = this.dir(await this.root(consumerId));
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return { removed: false, reason: 'INVALID_RULE_ID' };
        for (const extension of ['.mdc', '.md']) {
            const target = join(dir, `${id}${extension}`);
            if (existsSync(target)) {
                const { rmSync } = await import('node:fs');
                rmSync(target, { force: true });
                return { removed: true, id, file: `agents/rules/${id}${extension}` };
            }
        }
        return { removed: false, reason: 'RULE_NOT_FOUND' };
    }

    async list(consumerId: string): Promise<RuleFile[]> {
        const dir = this.dir(await this.root(consumerId));
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
            .filter((name) => /\.(mdc|md)$/i.test(name) && name.toLowerCase() !== 'readme.md')
            .sort()
            .map((name) => {
                const content = readFileSync(join(dir, name), 'utf8');
                return parseRule(content, name, `agents/rules/${name}`, createHash('sha256').update(content).digest('hex'));
            });
    }

    async preview(consumerId: string, files: ImportFile[]): Promise<any> {
        const existing = await this.list(consumerId);
        const ids = new Set(existing.map((rule) => rule.id));
        const candidates: any[] = [];
        const skipped: any[] = [];
        for (const file of files) {
            const sourceFile = String(file.name || 'rule.mdc');
            const content = String(file.content || '');
            const lower = sourceFile.toLowerCase();
            if (!lower.endsWith('.mdc') && !lower.endsWith('.md')) {
                skipped.push({ sourceFile, reason: 'NOT_A_RULE_FILE' });
                continue;
            }
            if (lower.endsWith('readme.md')) {
                skipped.push({ sourceFile, reason: 'README_NOT_A_RULE' });
                continue;
            }
            if (content.length > 100_000) {
                skipped.push({ sourceFile, reason: 'FILE_TOO_LARGE' });
                continue;
            }
            const isMarkdown = lower.endsWith('.md');
            const base = slug(sourceFile);
            let id = base;
            let suffix = 2;
            while (ids.has(id)) id = `${base}-${suffix++}`;
            const rule = parseRule(content, id, sourceFile, createHash('sha256').update(content).digest('hex'));
            rule.id = id;
            if (isMarkdown && !rule.description) {
                const firstLine = rule.body.split(/\r?\n/).find((line) => line.trim()) || '';
                rule.description = firstLine.replace(/^#+\s*/, '').slice(0, 160);
            }
            const conflictWith = existing.find((item) => item.id === base)?.id || null;
            const warnings: string[] = [];
            candidates.push({
                sourceFile,
                sourceType: isMarkdown ? 'markdown-rule' : 'cursor-rule',
                sourceHash: rule.sourceHash,
                rule: { ...rule, id: base },
                warnings,
                conflict: Boolean(conflictWith),
                conflictWith,
            });
            ids.add(base);
        }
        return { candidates, skipped };
    }

    async apply(consumerId: string, candidates: any[]): Promise<any> {
        const dir = this.dir(await this.root(consumerId));
        mkdirSync(dir, { recursive: true });
        const written: any[] = [];
        for (const candidate of candidates) {
            const source = candidate.rule || {};
            const action = String(candidate.action || 'skip');
            if (action === 'skip') continue;
            let id = slug(String(source.id || candidate.sourceFile || 'rule'));
            if (action === 'copy') {
                let suffix = 2;
                const base = id;
                while (existsSync(join(dir, `${id}.md`)) || existsSync(join(dir, `${id}.mdc`))) id = `${base}-copy${suffix++}`;
            }
            if (!RULE_ID.test(id)) continue;
            const rule: RuleFile = {
                id,
                description: String(source.description || ''),
                globs: String(source.globs || ''),
                alwaysApply: Boolean(source.alwaysApply),
                body: String(source.body || ''),
                sourceFile: candidate.sourceFile,
                sourceHash: candidate.sourceHash,
            };
            const extension = String(candidate.sourceFile || '').toLowerCase().endsWith('.md') ? '.md' : '.mdc';
            const target = join(dir, `${id}${extension}`);
            const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
            writeFileSync(temp, render(rule), 'utf8');
            renameSync(temp, target);
            written.push({ id, action, sourceFile: candidate.sourceFile });
        }
        return { written };
    }
}
