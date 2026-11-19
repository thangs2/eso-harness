/**
 * Phase 3 M5/M6 — HUMAN/AI document mapping + freshness.
 *
 * One source, two projections. The human document is the source of truth; an AI projection is
 * derived (`human_sot`). Freshness compares the indexed content hash with the current file hash.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.harness', '.cursor', '.agents', '.claude', 'coverage']);

interface DocHeader {
    representation?: string;
    human_sot?: string;
    source_of_truth?: string;
}

function frontmatter(text: string): DocHeader {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return {};
    const header: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index <= 0) continue;
        header[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    return header;
}

function walk(dir: string, root: string, out: string[]): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute, root, out);
        else if (entry.isFile() && entry.name.endsWith('.md')) out.push(absolute);
    }
}

function sha(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

export class KnowledgeMappingService {
    constructor(private readonly store: PlatformStore) {}

    async mapping(consumerId: string) {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        let manifest: any = {};
        try {
            manifest = JSON.parse(readFileSync(join(consumer.root, '.harness', 'knowledge-manifest.json'), 'utf8'));
        } catch {
            manifest = {};
        }
        const indexed = new Map<string, string>();
        for (const doc of Array.isArray(manifest.documents) ? manifest.documents : []) {
            if (doc?.path && doc?.content_hash) indexed.set(String(doc.path), String(doc.content_hash));
        }

        const files: string[] = [];
        walk(consumer.root, consumer.root, files);
        const docs = files.map((absolute) => {
            const path = relative(consumer.root, absolute).split(sep).join('/');
            const text = readFileSync(absolute, 'utf8');
            const header = frontmatter(text);
            const representation = header.representation === 'agent' || header.human_sot ? 'agent' : header.representation === 'machine' ? 'machine' : 'human';
            const currentHash = sha(text);
            const indexedHash = indexed.get(path) ?? null;
            const freshness = !indexedHash ? 'unindexed' : indexedHash === currentHash ? 'fresh' : 'stale';
            return {
                path,
                representation,
                humanSot: header.human_sot || null,
                sourceOfTruth: header.source_of_truth || null,
                currentHash,
                indexedHash,
                freshness,
            };
        });

        const projections = docs.filter((doc) => doc.representation === 'agent' || doc.humanSot).map((doc) => ({
            aiPath: doc.path,
            humanPath: doc.humanSot,
            sourceOfTruth: doc.sourceOfTruth,
            freshness: doc.freshness,
            inSync: Boolean(doc.humanSot && docs.some((candidate) => candidate.path === doc.humanSot && candidate.freshness === 'fresh')),
        }));

        return {
            consumerId: consumer.id,
            summary: {
                total: docs.length,
                human: docs.filter((doc) => doc.representation === 'human').length,
                agent: docs.filter((doc) => doc.representation === 'agent').length,
                machine: docs.filter((doc) => doc.representation === 'machine').length,
                fresh: docs.filter((doc) => doc.freshness === 'fresh').length,
                stale: docs.filter((doc) => doc.freshness === 'stale').length,
                unindexed: docs.filter((doc) => doc.freshness === 'unindexed').length,
            },
            projections,
            docs,
        };
    }
}
