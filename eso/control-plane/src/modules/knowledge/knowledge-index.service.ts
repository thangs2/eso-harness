import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import { DEFAULT_POLICIES, type FolderPolicy } from '../boundaries/boundary-policy.service.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.harness', '.cursor', '.agents', '.claude', 'coverage']);
const STATUSES = new Set(['DRAFT', 'OPEN', 'READY', 'READY-SPLIT', 'BLOCKED']);

interface Header {
    id?: string;
    type?: string;
    status?: string;
    owner?: string;
    representation?: string;
    source_of_truth?: string;
    human_sot?: string;
    phase?: string;
    title?: string;
}

interface ScannedDoc {
    abs: string;
    path: string;
    body: string;
    header: Header;
    hash: string;
    docId: string;
    sections: Array<{ sectionId: string; parentSectionId: string | null; ordinal: number; level: number; heading: string; anchor: string; contentHash: string }>;
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'section';
}

function parseFrontmatter(text: string): { header: Header; body: string } {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { header: {}, body: text };
    const header: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const split = line.indexOf(':');
        if (split <= 0) continue;
        header[line.slice(0, split).trim()] = line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    return { header: header as Header, body: text.slice(match[0].length) };
}

function walk(dir: string, root: string, out: string[]): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walk(join(dir, entry.name), root, out);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push(join(dir, entry.name));
        }
    }
}



function globMatches(pattern: string, value: string): boolean {
    let out = '^';
    const normalized = pattern.replace(/\\/g, '/');
    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        if (char === '*' && normalized[index + 1] === '*') { out += '.*'; index += 1; }
        else if (char === '*') out += '[^/]*';
        else if (char === '?') out += '[^/]';
        else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`${out}$`).test(value);
}

function policyMatches(policy: FolderPolicy, value: string): boolean {
    const path = policy.path.replace(/\\/g, '/');
    if (policy.pathType === 'file') return value === path;
    if (policy.pathType === 'directory') return value === path || value.startsWith(`${path.replace(/\/$/, '')}/`);
    return globMatches(path, value);
}

function policySpecificity(policy: FolderPolicy): number {
    const exact = policy.pathType === 'file' ? 10_000 : policy.pathType === 'directory' ? 5_000 : 0;
    return exact + policy.path.replace(/[*?]/g, '').length + (policy.path.includes('**') ? 0 : 100);
}

function indexAllowed(root: string, abs: string, policies: FolderPolicy[]): boolean {
    const rel = relative(root, abs).split(sep).join('/');
    const match = policies
        .filter((policy) => policyMatches(policy, rel))
        .sort((left, right) => policySpecificity(right) - policySpecificity(left) || right.priority - left.priority)[0];
    return Boolean(match && match.read === 'allow' && match.index);
}

function loadIndexPolicies(root: string): FolderPolicy[] {
    try {
        const config = JSON.parse(readFileSync(join(root, '.harness', 'config.json'), 'utf8'));
        const explicit = config?.profile?.settings?.boundaries?.policies;
        if (Array.isArray(explicit) && explicit.length > 0) return explicit as FolderPolicy[];
    } catch {
        // fall through to defaults
    }
    return DEFAULT_POLICIES.map((policy) => ({ ...policy }));
}

function atomicWrite(path: string, body: string): void {
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, body, 'utf8');
    renameSync(temp, path);
}

function splitText(text: string, max = 900, overlap = 150): string[] {
    const chunks: string[] = [];
    let start = 0;
    const value = text.trim();
    while (start < value.length) {
        let end = Math.min(value.length, start + max);
        if (end < value.length) {
            const boundary = value.lastIndexOf('\n', end);
            if (boundary > start + Math.floor(max * 0.55)) end = boundary;
        }
        const piece = value.slice(start, end).trim();
        if (piece) chunks.push(piece);
        if (end >= value.length) break;
        start = Math.max(start + 1, end - overlap);
    }
    return chunks;
}

function chunkDocument(doc: ScannedDoc): Array<{ chunkId: string; docId: string; ordinal: number; anchor: string | null; text: string; contentHash: string }> {
    const body = doc.body;
    const headings = [...body.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)];
    const chunks: Array<{ chunkId: string; docId: string; ordinal: number; anchor: string | null; text: string; contentHash: string }> = [];
    const push = (text: string, anchor: string | null) => {
        for (const piece of splitText(text)) {
            const ordinal = chunks.length + 1;
            chunks.push({ chunkId: `${doc.docId}:c${ordinal}`, docId: doc.docId, ordinal, anchor, text: piece, contentHash: createHash('sha256').update(piece).digest('hex') });
        }
    };
    if (!headings.length) {
        push(body, doc.sections[0]?.anchor || null);
        return chunks;
    }
    const first = headings[0];
    const intro = body.slice(0, first.index || 0).trim();
    if (intro) push(intro, null);
    headings.forEach((match, index) => {
        const start = (match.index || 0) + match[0].length;
        const end = index + 1 < headings.length ? (headings[index + 1].index || body.length) : body.length;
        const heading = match[2].trim();
        const anchor = slug(heading);
        push(`${heading}\n${body.slice(start, end).trim()}`, anchor);
    });
    return chunks;
}

export class KnowledgeIndexService {
    constructor(private readonly store: PlatformStore) {}

    async index(consumerId: string): Promise<any> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const root = consumer.root;
        if (!existsSync(root) || !statSync(root).isDirectory()) fail('ROOT_NOT_FOUND');

        const files: string[] = [];
        walk(root, root, files);
        const policies = loadIndexPolicies(root);
        const indexable = files.filter((abs) => indexAllowed(root, abs, policies));
        indexable.sort();

        const docs: ScannedDoc[] = [];
        const byPath = new Map<string, ScannedDoc>();
        const sourceHash = createHash('sha256');
        for (const abs of indexable) {
            const text = readFileSync(abs, 'utf8');
            sourceHash.update(text);
            const rel = relative(root, abs).split(sep).join('/');
            const { header, body } = parseFrontmatter(text);
            const rawId = (header.id || '').trim();
            const baseId = rawId && /^[a-zA-Z0-9._:-]+$/.test(rawId) ? rawId : `doc-${createHash('sha1').update(rel).digest('hex').slice(0, 12)}`;
            let docId = baseId;
            let suffix = 1;
            while (docs.some((doc) => doc.docId === docId)) docId = `${baseId}-${suffix++}`;
            const hash = createHash('sha256').update(text).digest('hex');
            const sections: ScannedDoc['sections'] = [];
            let inFence = false;
            let ordinal = 0;
            for (const line of body.split(/\r?\n/)) {
                if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
                if (inFence) continue;
                const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
                if (!match) continue;
                const heading = match[2].trim();
                const baseAnchor = slug(heading);
                let anchor = baseAnchor;
                let suffix = 1;
                while (sections.some((section) => section.anchor === anchor)) anchor = `${baseAnchor}-${suffix++}`;
                sections.push({ sectionId: `s${++ordinal}`, parentSectionId: null, ordinal, level: match[1].length, heading, anchor, contentHash: hash });
            }
            const doc: ScannedDoc = { abs, path: rel, body, header, hash, docId, sections };
            docs.push(doc);
            byPath.set(rel, doc);
        }

        const sectionsByDoc = new Map<string, Map<string, string>>();
        for (const doc of docs) {
            sectionsByDoc.set(doc.docId, new Map(doc.sections.map((section) => [section.anchor, section.sectionId])));
        }
        const pointer = (value?: string): string | null => {
            if (!value) return null;
            if (value.startsWith('doc:')) return byPath.get(value.slice(4))?.docId || docs.find((doc) => doc.docId === value.slice(4))?.docId || null;
            const normalized = value.replace(/^\.\//, '').split('#')[0];
            return byPath.get(normalized)?.docId || null;
        };

        const links: any[] = [];
        const edges = new Map<string, any>();
        const findings: any[] = [];
        const types = new Map<string, any>();
        for (const doc of docs) {
            const type = (doc.header.type || 'doc').toLowerCase().replace(/[^a-z0-9-]/g, '-');
            const representation = doc.header.representation === 'agent' || doc.header.human_sot
                ? 'agent' : doc.header.representation === 'machine' ? 'machine' : 'human';
            types.set(type, { type, label: type, representation });
            const sourceDocId = pointer(doc.header.source_of_truth);
            const humanSotDocId = pointer(doc.header.human_sot);
            if (sourceDocId && sourceDocId !== doc.docId) edges.set(`${doc.docId}|source_of_truth|${sourceDocId}`, { edgeId: `e-${doc.docId}-source`, fromDocId: doc.docId, toDocId: sourceDocId, kind: 'source_of_truth' });
            if (humanSotDocId && humanSotDocId !== doc.docId) edges.set(`${doc.docId}|human_sot|${humanSotDocId}`, { edgeId: `e-${doc.docId}-human`, fromDocId: doc.docId, toDocId: humanSotDocId, kind: 'human_sot' });

            const linkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
            let match: RegExpExecArray | null;
            while ((match = linkRegex.exec(doc.body))) {
                const rawTarget = match[1].trim();
                if (/^(https?:|mailto:|#)/.test(rawTarget)) continue;
                const [rawPath, rawAnchor] = rawTarget.split('#');
                let targetPath: string;
                if (rawPath.startsWith('/')) targetPath = rawPath.slice(1);
                else targetPath = relative(root, resolve(dirname(doc.abs), rawPath)).split(sep).join('/');
                const target = byPath.get(targetPath);
                if (!target) {
                    links.push({ docId: doc.docId, rawTarget, resolvedDocId: null, resolvedAnchor: rawAnchor || null, resolvedSectionId: null, status: 'unresolved', provenance: 'declared' });
                    findings.push({ docId: doc.docId, severity: 'warning', code: 'UNRESOLVED_LINK', detail: { target: rawTarget } });
                    continue;
                }
                const sectionId = rawAnchor ? sectionsByDoc.get(target.docId)?.get(slug(rawAnchor)) || null : null;
                links.push({ docId: doc.docId, rawTarget, resolvedDocId: target.docId, resolvedAnchor: rawAnchor || null, resolvedSectionId: sectionId, status: rawAnchor && !sectionId ? 'anchor-missing' : 'resolved', provenance: 'derived' });
                if (rawAnchor && !sectionId) findings.push({ docId: doc.docId, severity: 'warning', code: 'ANCHOR_MISSING', detail: { target: rawTarget } });
                if (target.docId !== doc.docId) edges.set(`${doc.docId}|references|${target.docId}`, { edgeId: `e-${doc.docId}-${target.docId}`, fromDocId: doc.docId, toDocId: target.docId, kind: 'references' });
            }
            if (!doc.header.id && (doc.path.startsWith('sdlc/') || doc.path.startsWith('docs/'))) {
                findings.push({ docId: doc.docId, severity: 'warning', code: 'HEADER_ID_MISSING', detail: { path: doc.path } });
            }
        }

        const manifest = {
            manifest_version: 1,
            consumer_id: id,
            root,
            generated_at: new Date().toISOString(),
            documents: docs.map((doc) => ({
                doc_id: doc.docId,
                path: doc.path,
                type: (doc.header.type || 'doc').toLowerCase(),
                status: doc.header.status || 'DRAFT',
                title: doc.header.title || doc.sections[0]?.heading || doc.path,
                content_hash: doc.hash,
                headings: doc.sections.map((section) => ({ id: section.sectionId, level: section.level, text: section.heading })),
            })),
        };
        const manifestId = `manifest-${Date.now()}`;
        const buildId = `kb-${Date.now()}`;
        const hash = sourceHash.digest('hex');
        const docRows = docs.map((doc) => {
            const type = (doc.header.type || 'doc').toLowerCase().replace(/[^a-z0-9-]/g, '-');
            const representation = doc.header.representation === 'agent' || doc.header.human_sot ? 'agent' : doc.header.representation === 'machine' ? 'machine' : 'human';
            return {
                docId: doc.docId, path: doc.path, type,
                status: STATUSES.has((doc.header.status || '').toUpperCase()) ? (doc.header.status || 'DRAFT').toUpperCase() : 'DRAFT',
                owner: doc.header.owner || null, representation,
                origin: representation === 'human' ? 'human' : 'agent', custodian: 'repo',
                liveness: 'living', ktState: 'raw',
                sourcePointer: doc.header.source_of_truth || null, humanSotPointer: doc.header.human_sot || null,
                sourceDocId: pointer(doc.header.source_of_truth), humanSotDocId: pointer(doc.header.human_sot),
                title: doc.header.title || doc.sections[0]?.heading || doc.path,
                contentHash: doc.hash, header: doc.header,
            };
        });
        const chunks = docs.flatMap((doc) => chunkDocument(doc));
        const payload = {
            types: [...types.values()],
            docs: docRows,
            sections: docs.flatMap((doc) => doc.sections.map((section) => ({ ...section, docId: doc.docId }))),
            links,
            edges: [...edges.values()],
            chunks,
            search: docRows.map((doc, index) => ({ docId: doc.docId, text: `${doc.title} ${docs[index].body.slice(0, 4000)}`, excerpt: docs[index].body.replace(/\s+/g, ' ').slice(0, 300) })),
            findings,
            runs: [{ buildId, sourceHash: hash, status: 'ok', stats: { docs: docs.length, sections: payloadSections(docs), chunks: chunks.length, edges: edges.size, links: links.length, findings: findings.length } }],
            manifests: [{ manifestId, buildId, manifestVersion: 1, generatorVersion: 'eso-indexer@1', sourceHash: hash, payload: manifest }],
        };
        await this.store.replaceKnowledgeIndex(id, payload);
        mkdirSync(join(root, '.harness'), { recursive: true });
        atomicWrite(join(root, '.harness', 'knowledge-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        return { ...(await this.store.knowledgeSummary(id)), manifestPath: '.harness/knowledge-manifest.json', buildId, chunks: chunks.length };
    }
}

function payloadSections(docs: ScannedDoc[]): number {
    return docs.reduce((sum, doc) => sum + doc.sections.length, 0);
}
