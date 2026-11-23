/**
 * P7/P8 — artifact contract rules, in ONE place.
 *
 * One source, two projections: the human document is the source of truth; an agent document is an
 * index plus a `human_sot` pointer, never a copy of the body. This module owns the scan, the
 * classification, the copy threshold and the findings, so these rules cannot drift:
 *
 *   - `eso/control-plane` KnowledgeMappingService / KnowledgeMappingCheckService (HTTP route)
 *   - `scripts/check-artifact-contract.mjs` (CI merge gate — plain Node ESM, no TS build)
 *
 * Plain ESM on purpose: the gate must run without a TypeScript build. It lives in the pure-ESM
 * knowledge package (not in `control-plane/src`) because that package is the shared rules home the
 * control-plane already imports from (`eso/core`, `eso/learn`, `eso/iam`, `eso/graph` do the same).
 *
 * Rulebook:
 *   - representation `agent` (or any `human_sot`) must point at a resolvable human document
 *     → `MISSING_HUMAN_SOT`, `UNRESOLVED_HUMAN_SOT`, `HUMAN_SOT_NOT_HUMAN`
 *   - an agent body that contains its human body (normalized, >= COPY_MIN_CHARS) is a copy
 *     → `DOC_CONTRACT_VIOLATION` + `COPIED_BODY`
 *   - indexed hash differs from the current file → `STALE_PROJECTION`
 *
 * A missing manifest is reported as `manifestPresent: false`, not as a finding: the service has
 * always treated it as "nothing indexed", and the CI gate prints the same fact without changing the
 * verdict (findings stay identical between the two callers).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Normalized chars a body must reach before an overlap counts as plagiarism. */
export const COPY_MIN_CHARS = 120;

export const SKIP_DIRS = new Set([
    '.git', 'node_modules', 'dist', '.harness', '.cursor', '.agents', '.claude', 'coverage',
]);

export const FINDING_CODES = Object.freeze({
    MISSING_HUMAN_SOT: 'MISSING_HUMAN_SOT',
    UNRESOLVED_HUMAN_SOT: 'UNRESOLVED_HUMAN_SOT',
    HUMAN_SOT_NOT_HUMAN: 'HUMAN_SOT_NOT_HUMAN',
    DOC_CONTRACT_VIOLATION: 'DOC_CONTRACT_VIOLATION',
    COPIED_BODY: 'COPIED_BODY',
    STALE_PROJECTION: 'STALE_PROJECTION',
});

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Minimal YAML-ish frontmatter reader: `key: value` lines, quotes stripped. */
export function parseFrontmatter(text) {
    const match = FRONTMATTER.exec(text);
    if (!match) return {};
    const header = {};
    for (const line of match[1].split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index <= 0) continue;
        header[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    return header;
}

export function withoutFrontmatter(text) {
    return text.replace(FRONTMATTER, '');
}

/** Body used for copy comparison: no frontmatter, whitespace collapsed. */
export function normalizeBody(text) {
    return withoutFrontmatter(text).replace(/\s+/g, ' ').trim();
}

export function contentHash(text) {
    return createHash('sha256').update(text).digest('hex');
}

/** `human_sot` wins over an explicit `representation`; `machine` stays machine. */
export function classifyRepresentation(header) {
    if (header.representation === 'agent' || header.human_sot) return 'agent';
    if (header.representation === 'machine') return 'machine';
    return 'human';
}

/**
 * Read `.harness/knowledge-manifest.json`.
 * @returns {{ manifest: { documents?: Array<{ path?: string, content_hash?: string }> }, present: boolean }}
 */
export function readManifest(root) {
    try {
        const parsed = JSON.parse(readFileSync(join(root, '.harness', 'knowledge-manifest.json'), 'utf8'));
        return { manifest: parsed && typeof parsed === 'object' ? parsed : {}, present: true };
    } catch {
        return { manifest: {}, present: false };
    }
}

function walk(dir, out) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute, out);
        else if (entry.isFile() && entry.name.endsWith('.md')) out.push(absolute);
    }
}

export function summarize(docs) {
    return {
        total: docs.length,
        human: docs.filter((doc) => doc.representation === 'human').length,
        agent: docs.filter((doc) => doc.representation === 'agent').length,
        machine: docs.filter((doc) => doc.representation === 'machine').length,
        fresh: docs.filter((doc) => doc.freshness === 'fresh').length,
        stale: docs.filter((doc) => doc.freshness === 'stale').length,
        unindexed: docs.filter((doc) => doc.freshness === 'unindexed').length,
    };
}

/**
 * Scan every markdown document under `root` and classify it against the manifest.
 * Documents are sorted by path so the gate's JSON output is stable across filesystems.
 *
 * @param {string} root
 * @param {{ documents?: any[] }} [manifest] defaults to the consumer's manifest
 */
export function collectDocuments(root, manifest) {
    const loaded = manifest === undefined ? readManifest(root) : { manifest, present: true };
    const indexed = new Map();
    for (const doc of Array.isArray(loaded.manifest.documents) ? loaded.manifest.documents : []) {
        if (doc?.path && doc?.content_hash) indexed.set(String(doc.path), String(doc.content_hash));
    }

    const absolutePaths = [];
    walk(root, absolutePaths);
    const docs = absolutePaths.map((absolute) => {
        const path = relative(root, absolute).split(sep).join('/');
        const text = readFileSync(absolute, 'utf8');
        const header = parseFrontmatter(text);
        const representation = classifyRepresentation(header);
        const currentHash = contentHash(text);
        const indexedHash = indexed.get(path) ?? null;
        const freshness = !indexedHash ? 'unindexed' : indexedHash === currentHash ? 'fresh' : 'stale';
        const freshnessStatus = freshness === 'fresh' ? 'current' : freshness === 'stale' ? 'stale' : 'unknown';
        return {
            path,
            status: freshnessStatus,
            representation,
            humanSot: header.human_sot || null,
            sourceOfTruth: header.source_of_truth || null,
            currentHash,
            indexedHash,
            freshness,
        };
    });
    docs.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

    return { docs, summary: summarize(docs), manifestPresent: loaded.present };
}

/** Cached, normalized body reader for one consumer root. Unreadable files yield `''`. */
export function createBodyReader(root) {
    const cache = new Map();
    return (path) => {
        if (!cache.has(path)) {
            try { cache.set(path, normalizeBody(readFileSync(join(root, path), 'utf8'))); }
            catch { cache.set(path, ''); }
        }
        return cache.get(path) ?? '';
    };
}

/**
 * Apply the rulebook to already-collected documents.
 * @returns {{ status: 'pass' | 'warn' | 'fail', findings: Array<{ code: string, severity: 'error' | 'warning', path: string, detail: string }>, counts: { errors: number, warnings: number } }}
 */
export function evaluateArtifactContract({ docs, bodyOf }) {
    const byPath = new Map(docs.map((doc) => [doc.path, doc]));
    const findings = [];

    for (const doc of docs) {
        if (doc.representation === 'agent' && !doc.humanSot) {
            findings.push({ code: FINDING_CODES.MISSING_HUMAN_SOT, severity: 'error', path: doc.path, detail: 'agent projection has no human_sot pointer' });
            continue;
        }
        if (!doc.humanSot) continue;
        const human = byPath.get(doc.humanSot);
        if (!human) {
            findings.push({ code: FINDING_CODES.UNRESOLVED_HUMAN_SOT, severity: 'error', path: doc.path, detail: `human_sot does not resolve: ${doc.humanSot}` });
            continue;
        }
        if (human.representation !== 'human') {
            findings.push({ code: FINDING_CODES.HUMAN_SOT_NOT_HUMAN, severity: 'warning', path: doc.path, detail: `human_sot target is ${human.representation}` });
        }
        const aiBody = bodyOf(doc.path);
        const humanBody = bodyOf(human.path);
        if (humanBody.length >= COPY_MIN_CHARS && aiBody.includes(humanBody)) {
            findings.push({ code: FINDING_CODES.DOC_CONTRACT_VIOLATION, severity: 'error', path: doc.path, detail: `body duplicates ${human.path} (copied_body)` });
            findings.push({ code: FINDING_CODES.COPIED_BODY, severity: 'error', path: doc.path, detail: `body duplicates ${human.path}` });
        }
        if (doc.freshness === 'stale') {
            findings.push({ code: FINDING_CODES.STALE_PROJECTION, severity: 'warning', path: doc.path, detail: 'indexed hash differs from current file' });
        }
    }

    const errors = findings.filter((finding) => finding.severity === 'error').length;
    return {
        status: errors > 0 ? 'fail' : findings.length > 0 ? 'warn' : 'pass',
        findings,
        counts: { errors, warnings: findings.length - errors },
    };
}

/**
 * The report shape shared by the HTTP checker and the CI gate.
 * @returns {{ consumerId: string, status: 'pass' | 'warn' | 'fail', checked: object, findings: any[], counts: { errors: number, warnings: number } }}
 */
export function buildContractReport({ consumerId, docs, summary, bodyOf }) {
    const evaluation = evaluateArtifactContract({ docs, bodyOf });
    return {
        consumerId,
        status: evaluation.status,
        checked: summary ?? summarize(docs),
        findings: evaluation.findings,
        counts: evaluation.counts,
    };
}
