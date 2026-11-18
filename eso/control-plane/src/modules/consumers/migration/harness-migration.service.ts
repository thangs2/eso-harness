/**
 * Harness migration pipeline — legacy host trees (.cursor/.agents) to ESO canonical.
 *
 * The pipeline is preview-first and never overwrites canonical ESO files. It moves nothing out of
 * the host trees; cleanup is a separate verified step.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { fail } from '../../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../../platform/registry/store.js';
import type { Actor } from '../../../platform/registry/types.js';

export type MigrationCategory = 'rules' | 'skills' | 'agents' | 'hooks';

export interface MigrationEntry {
    category: MigrationCategory;
    source: string;
    target: string;
    kind: 'file' | 'directory';
    status: 'new' | 'same' | 'conflict';
    reason?: string;
    bytes: number;
}

export interface MigrationPreview {
    consumerId: string;
    root: string;
    planHash: string;
    detected: boolean;
    totals: Record<MigrationCategory, { new: number; same: number; conflict: number }>;
    entries: MigrationEntry[];
}

export interface MigrationApplyResult {
    consumerId: string;
    planHash: string;
    applied: MigrationEntry[];
    skipped: MigrationEntry[];
    manifestPath: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'session', '__pycache__', '.mypy_cache', '.pytest_cache']);

function filesUnder(dir: string): string[] {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        if (/\.(pyc|pyo|log|tmp|DS_Store)$/i.test(entry.name)) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...filesUnder(absolute));
        else if (entry.isFile()) out.push(absolute);
    }
    return out;
}

function dirBytes(dir: string): number {
    const stat = lstatSync(dir);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return readdirSync(dir).reduce((total, name) => total + dirBytes(join(dir, name)), 0);
}

function stableHash(entries: MigrationEntry[]): string {
    return createHash('sha256').update(JSON.stringify(entries.map((entry) => [entry.category, entry.source, entry.target]))).digest('hex');
}

export class HarnessMigrationService {
    constructor(private readonly store: PlatformStore) {}

    async preview(consumerId: string): Promise<MigrationPreview> {
        const consumer = await this.consumer(consumerId);
        const entries: MigrationEntry[] = [];
        const push = (entry: MigrationEntry) => entries.push(entry);

        // Rules: .cursor/*.mdc is primary; .agents/*.md is fallback per file.
        const ruleSources = new Map<string, string>();
        for (const absolute of filesUnder(join(consumer.root, '.cursor', 'rules'))) {
            if (extname(absolute) === '.mdc') ruleSources.set(basename(absolute, '.mdc'), absolute);
        }
        for (const absolute of filesUnder(join(consumer.root, '.agents', 'rules'))) {
            if (extname(absolute) !== '.md') continue;
            const id = basename(absolute, '.md');
            if (!ruleSources.has(id)) ruleSources.set(id, absolute);
        }
        for (const [id, source] of [...ruleSources.entries()].sort()) {
            const target = join(consumer.root, 'agents', 'rules', `${id}.md`);
            push(this.entry('rules', consumer.root, source, target));
        }

        // Skills: directory per skill; .cursor first, .agents fallback.
        const skills = new Map<string, string>();
        for (const [tree, ext] of [['.cursor', '.md'], ['.agents', '.md']] as const) {
            const base = join(consumer.root, tree, 'skills');
            if (!existsSync(base)) continue;
            for (const name of readdirSync(base)) {
                const source = join(base, name);
                if (!statSync(source).isDirectory()) continue;
                if (!existsSync(join(source, 'SKILL.md'))) continue;
                if (!skills.has(name)) skills.set(name, source);
            }
        }
        for (const [name, source] of [...skills.entries()].sort()) {
            const target = join(consumer.root, 'agents', 'skills', name);
            push(this.entry('skills', consumer.root, source, target));
        }

        // Agents/subagents: .cursor first, .agents fallback.
        const agents = new Map<string, string>();
        for (const tree of ['.cursor', '.agents'] as const) {
            for (const absolute of filesUnder(join(consumer.root, tree, 'agents'))) {
                if (extname(absolute) !== '.md') continue;
                const id = basename(absolute, '.md');
                if (!agents.has(id)) agents.set(id, absolute);
            }
        }
        for (const [id, source] of [...agents.entries()].sort()) {
            const target = join(consumer.root, 'agents', 'subagents', `${id}.md`);
            push(this.entry('agents', consumer.root, source, target));
        }

        // Hooks: copy script files; host hook JSON is host-local, not migrated here.
        const hooks = new Map<string, string>();
        for (const tree of ['.cursor', '.agents'] as const) {
            for (const absolute of filesUnder(join(consumer.root, tree, 'hooks'))) {
                const id = basename(absolute);
                if (!hooks.has(id)) hooks.set(id, absolute);
            }
        }
        for (const [id, source] of [...hooks.entries()].sort()) {
            const target = join(consumer.root, 'agents', 'hooks', id);
            push(this.entry('hooks', consumer.root, source, target));
        }

        const totals: MigrationPreview['totals'] = {
            rules: { new: 0, same: 0, conflict: 0 },
            skills: { new: 0, same: 0, conflict: 0 },
            agents: { new: 0, same: 0, conflict: 0 },
            hooks: { new: 0, same: 0, conflict: 0 },
        };
        for (const entry of entries) totals[entry.category][entry.status] += 1;
        return {
            consumerId: consumer.id,
            root: consumer.root,
            planHash: stableHash(entries),
            detected: entries.length > 0,
            totals,
            entries,
        };
    }

    async apply(consumerId: string, actor: Actor): Promise<MigrationApplyResult> {
        const preview = await this.preview(consumerId);
        if (!preview.detected) fail('INVALID_STATE', 'No legacy harness files to migrate');
        const applied: MigrationEntry[] = [];
        const skipped: MigrationEntry[] = [];
        for (const entry of preview.entries) {
            if (entry.status !== 'new') { skipped.push(entry); continue; }
            const source = join(preview.root, entry.source);
            const target = join(preview.root, entry.target);
            mkdirSync(join(target, '..'), { recursive: true });
            cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
            applied.push(entry);
        }
        const projected: string[] = [];
        for (const entry of applied) {
            const source = join(preview.root, entry.target);
            const projections: string[] = [];
            if (entry.category === 'rules') {
                const id = entry.target.split('/').pop()!.replace(/\.md$/, '');
                projections.push(join(preview.root, '.cursor', 'rules', `${id}.mdc`), join(preview.root, '.agents', 'rules', `${id}.md`));
            } else if (entry.category === 'skills') {
                const id = entry.target.split('/').pop()!;
                projections.push(join(preview.root, '.cursor', 'skills', id), join(preview.root, '.agents', 'skills', id));
            } else if (entry.category === 'agents') {
                const id = entry.target.split('/').pop()!;
                projections.push(join(preview.root, '.cursor', 'agents', id), join(preview.root, '.agents', 'agents', id));
            } else if (entry.category === 'hooks') {
                const id = entry.target.split('/').pop()!;
                projections.push(join(preview.root, '.cursor', 'hooks', id), join(preview.root, '.agents', 'hooks', id));
            }
            for (const target of projections) {
                mkdirSync(join(target, '..'), { recursive: true });
                if (entry.kind === 'directory') cpSync(source, target, { recursive: true, force: true });
                else copyFileSync(source, target);
                projected.push(target.slice(preview.root.length + 1).split('\\').join('/'));
            }
        }

        const manifest = {
            generated: 'generated by eso harness migration — do not edit',
            consumerId: preview.consumerId,
            planHash: preview.planHash,
            createdAt: new Date().toISOString(),
            actor: { kind: actor.kind, label: actor.label || null },
            applied: applied.map((entry) => ({ category: entry.category, source: entry.source, target: entry.target })),
            skipped: skipped.map((entry) => ({ category: entry.category, source: entry.source, target: entry.target, reason: entry.reason })),
            projected,
        };
        const manifestPath = '.harness/migration-manifest.json';
        mkdirSync(join(preview.root, '.harness'), { recursive: true });
        writeFileSync(join(preview.root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        await this.store.appendEvent({
            consumerId: preview.consumerId,
            eventType: 'updated',
            actorKind: actor.kind,
            actorLabel: actor.label || null,
            at: manifest.createdAt,
            detail: { harnessMigration: preview.planHash, applied: applied.length, skipped: skipped.length },
        });
        return { consumerId: preview.consumerId, planHash: preview.planHash, applied, skipped, manifestPath };
    }

    private entry(category: MigrationCategory, root: string, source: string, target: string): MigrationEntry {
        const relativeSource = source.slice(root.length + 1).split('\\').join('/');
        const relativeTarget = target.slice(root.length + 1).split('\\').join('/');
        const stat = lstatSync(source);
        const exists = existsSync(target);
        const same = exists ? this.sameContent(source, target, stat.isDirectory()) : false;
        return {
            category,
            source: relativeSource,
            target: relativeTarget,
            kind: stat.isDirectory() ? 'directory' : 'file',
            status: exists ? (same ? 'same' : 'conflict') : 'new',
            ...(exists && !same ? { reason: 'canonical target differs' } : {}),
            ...(same ? { reason: 'canonical target already identical' } : {}),
            bytes: dirBytes(source),
        };
    }

    private sameContent(source: string, target: string, directory: boolean): boolean {
        const digest = (path: string): string => createHash('sha256')
            .update(readFileSync(path, 'utf8').replace(/^<!-- generated by [^>]+-->\s*/i, ''))
            .digest('hex');
        if (!directory) {
            if (lstatSync(target).isDirectory()) return false;
            return digest(source) === digest(target);
        }
        if (!lstatSync(target).isDirectory()) return false;
        const sourceFiles = filesUnder(source).map((file) => file.slice(source.length + 1)).sort();
        const targetFiles = filesUnder(target).map((file) => file.slice(target.length + 1)).sort();
        if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) return false;
        return sourceFiles.every((rel) => digest(join(source, rel)) === digest(join(target, rel)));
    }

    private async consumer(consumerId: string) {
        const consumer = await this.store.getConsumer(assertConsumerId(consumerId));
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        if (consumer.status !== 'ready' && consumer.status !== 'error') {
            fail('INVALID_STATE', `Harness migration requires ready/error consumer, got ${consumer.status}`);
        }
        if (!existsSync(consumer.root) || !statSync(consumer.root).isDirectory()) fail('ROOT_NOT_FOUND');
        return consumer;
    }
}
