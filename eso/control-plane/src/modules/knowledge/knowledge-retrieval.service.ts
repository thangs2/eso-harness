import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

const RRF_K = 60;
const DEFAULT_SUMMARY_CHARS = 400;
const CHARS_PER_TOKEN = 4;
const TIERS = new Set(['index', 'summary', 'body']);

type RetrievalTier = 'index' | 'summary' | 'body';

interface RetrieveOptions {
    type?: string;
    status?: string;
    limit?: number;
    graphDepth?: number;
    weights?: { fts?: number; graph?: number; vector?: number };
    /** Progressive disclosure tier. Defaults to `body` (current behaviour). */
    tier?: RetrievalTier | string;
    /** Response budget in tokens; 1 token ≈ 4 chars. */
    budgetTokens?: number | string;
    /** Execution context used to evaluate a document's `applies_when` predicate. */
    context?: Record<string, unknown>;
}

interface Hit {
    doc: any;
    score: number;
    why: string[];
    signals: { fts: number; graph: number; vector: number; exact: number };
}

/**
 * INVALID_STATE is normally a 409 (a consumer lifecycle transition). Retrieval rejects an
 * unknown tier or a malformed budget as an invalid request state, which the P3 contract
 * explicitly maps to 422. The envelope reads `code` + `status`, so this local error keeps the
 * registry error table untouched.
 */
class RetrievalStateError extends Error {
    readonly code = 'INVALID_STATE';
    readonly status = 422;
    readonly detail: string;

    constructor(detail: string) {
        super('Transition is not allowed from the current state');
        this.name = 'PlatformError';
        this.detail = detail;
    }
}

function invalidState(detail: string): never {
    throw new RetrievalStateError(detail);
}

function rankBoost(rank: number): number {
    return 1 / (RRF_K + Math.max(1, rank));
}

function weight(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 10) : fallback;
}

function parseTier(value: unknown): RetrievalTier {
    if (value === undefined || value === null || value === '') return 'body';
    const tier = String(value).trim().toLowerCase();
    if (!TIERS.has(tier)) invalidState(`unknown knowledge retrieval tier: ${String(value)}`);
    return tier as RetrievalTier;
}

function parseBudget(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        invalidState(`knowledge retrieval budgetTokens must be a non-negative number: ${String(value)}`);
    }
    return Math.floor(parsed);
}

function docIdOf(doc: any): string {
    return String(doc?.doc_id ?? doc?.docId ?? doc?.id ?? '');
}

function stripFrontmatter(text: string): string {
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function charLength(text: string): number {
    return Array.from(text).length;
}

function takeChars(text: string, limit: number): string {
    if (limit <= 0) return '';
    return Array.from(text).slice(0, limit).join('');
}

function appliesWhenOf(doc: any): Record<string, unknown> | null {
    let raw = doc?.applies_when ?? doc?.appliesWhen ?? doc?.header_json?.applies_when ?? doc?.header?.applies_when;
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    return Object.keys(value).length > 0 ? value : null;
}

function globMatches(pattern: string, value: string): boolean {
    const normalized = String(pattern).replace(/\\/g, '/');
    let out = '^';
    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        if (char === '*' && normalized[index + 1] === '*') {
            out += '.*';
            index += 1;
        } else if (char === '*') out += '[^/]*';
        else if (char === '?') out += '[^/]';
        else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`${out}$`).test(value);
}

/**
 * Mirrors `matchesAppliesWhen` from `@mu/eso-knowledge/resolver` for the subset knowledge
 * retrieval can receive (`always`, `paths`/`globs`, scalar equality). Documents without an
 * `applies_when` predicate stay unconditional.
 */
function matchesAppliesWhen(aw: Record<string, unknown>, context: Record<string, unknown>): boolean {
    if (aw.always === true) return true;
    if (aw.always === false) return false;
    const patterns = aw.paths ?? aw.globs;
    if (Array.isArray(patterns) && patterns.length > 0) {
        const scoped = context.paths ?? (context.path ? [context.path] : []);
        const targets = (Array.isArray(scoped) ? scoped : [scoped]).map(String);
        if (targets.length === 0) return false;
        return patterns.some((pattern) => targets.some((target) => globMatches(String(pattern), target)));
    }
    const keys = Object.keys(aw).filter((key) => key !== 'always');
    if (keys.length === 0) return true;
    return keys.every((key) => {
        if (!(key in context)) return false;
        const expected = aw[key];
        const actual = context[key];
        if (Array.isArray(expected)) return expected.map(String).includes(String(actual));
        return String(actual) === String(expected);
    });
}

/**
 * `applies_when` is a selection predicate, not a ranking signal: filter candidates first so
 * RRF ranks only documents that apply to the current execution context.
 */
function filterAppliesWhen(candidates: any[], context?: Record<string, unknown>): any[] {
    if (!context || typeof context !== 'object' || Object.keys(context).length === 0) return candidates;
    return candidates.filter((doc) => {
        const aw = appliesWhenOf(doc);
        return !aw || matchesAppliesWhen(aw, context);
    });
}

export class KnowledgeRetrievalService {
    constructor(private readonly store: PlatformStore, private readonly embeddings?: any) {}

    private bodyOf(doc: any, consumerRoot: string | null): string {
        const inline = doc?.body ?? doc?.content ?? doc?.text;
        if (typeof inline === 'string' && inline.length > 0) return stripFrontmatter(inline);
        const docPath = typeof doc?.path === 'string' ? doc.path : '';
        if (consumerRoot && docPath) {
            const absolute = resolve(consumerRoot, docPath);
            const inside = relative(consumerRoot, absolute);
            if (inside && !inside.startsWith('..') && !isAbsolute(inside)) {
                try {
                    return stripFrontmatter(readFileSync(absolute, 'utf8'));
                } catch {
                    // A missing file is not an error: fall back to the indexed excerpt below.
                }
            }
        }
        const fallback = doc?.headline ?? doc?.excerpt ?? '';
        return typeof fallback === 'string' ? stripFrontmatter(fallback) : '';
    }

    private async consumerRoot(consumerId: string): Promise<string | null> {
        try {
            const consumer = await this.store.getConsumer(consumerId);
            return consumer?.root || null;
        } catch {
            return null;
        }
    }

    async retrieve(consumerId: string, query: string, options: RetrieveOptions = {}): Promise<any> {
        const id = assertConsumerId(consumerId);
        const tier = parseTier(options.tier);
        const budgetTokens = parseBudget(options.budgetTokens);
        let remainingChars = budgetTokens === null ? Number.POSITIVE_INFINITY : budgetTokens * CHARS_PER_TOKEN;
        let truncated = false;
        const q = (query || '').trim();
        if (!q) {
            return {
                query: q,
                mode: 'hybrid',
                tier,
                budgetTokens,
                truncated: false,
                vector: { enabled: false, reason: 'no query' },
                results: [],
                counts: { fts: 0, graph: 0, vector: 0, merged: 0 },
            };
        }
        const limit = Math.max(1, Math.min(Number(options.limit) || 20, 50));
        const weights = {
            fts: weight(options.weights?.fts, weight(process.env.ESO_RRF_FTS_WEIGHT, 1)),
            graph: weight(options.weights?.graph, weight(process.env.ESO_RRF_GRAPH_WEIGHT, 0.8)),
            vector: weight(options.weights?.vector, weight(process.env.ESO_RRF_VECTOR_WEIGHT, 1)),
        };
        const ftsLimit = Math.max(10, limit * 2);
        const context = options.context && typeof options.context === 'object' ? options.context : undefined;
        const fts = filterAppliesWhen(await this.store.knowledgeFtsSearch(id, q, ftsLimit), context);
        const seeds = fts.slice(0, Math.min(5, fts.length)).map((doc: any) => doc.doc_id);
        const graph = filterAppliesWhen(await this.store.knowledgeGraphCandidates(id, seeds, limit * 3), context);
        let vectorHits: any[] = [];
        let vectorInfo: any = { enabled: false, reason: 'embedding provider not configured; FTS + graph only' };
        const vectorCount = await this.store.knowledgeVectorCount(id);
        if (vectorCount > 0 && this.embeddings) {
            try {
                const [queryVector] = await this.embeddings.embed([q]);
                vectorHits = filterAppliesWhen(await this.store.knowledgeVectorSearch(id, queryVector, limit * 2), context);
                vectorInfo = { enabled: true, count: vectorCount, model: 'BAAI/bge-m3' };
            } catch (error) {
                vectorInfo = { enabled: false, reason: `embedding failed: ${(error as Error)?.message || error}` };
            }
        } else if (vectorCount > 0) {
            vectorInfo = { enabled: false, reason: 'embedding service unavailable' };
        }
        const byId = new Map<string, Hit>();

        fts.forEach((doc: any, index: number) => {
            const existing = byId.get(doc.doc_id);
            const boost = rankBoost(index + 1) * weights.fts;
            if (existing) {
                existing.score += boost;
                existing.why.push('fts');
                existing.signals.fts += boost;
            } else {
                byId.set(doc.doc_id, {
                    doc: { ...doc, rank: undefined, headline: undefined },
                    score: boost,
                    why: ['fts'],
                    signals: { fts: boost, graph: 0, vector: 0, exact: 0 },
                });
            }
        });
        graph.forEach((doc: any, index: number) => {
            const existing = byId.get(doc.doc_id);
            const boost = rankBoost(index + 1) * weights.graph;
            if (existing) {
                existing.score += boost;
                if (!existing.why.includes('graph')) existing.why.push('graph');
                existing.signals.graph += boost;
            } else {
                byId.set(doc.doc_id, {
                    doc,
                    score: boost,
                    why: ['graph'],
                    signals: { fts: 0, graph: boost, vector: 0, exact: 0 },
                });
            }
        });

        vectorHits.forEach((doc: any, index: number) => {
            const existing = byId.get(doc.doc_id);
            const boost = rankBoost(index + 1) * weights.vector;
            if (existing) {
                existing.score += boost;
                if (!existing.why.includes('vector')) existing.why.push('vector');
                existing.signals.vector += boost;
            } else {
                byId.set(doc.doc_id, {
                    doc,
                    score: boost,
                    why: ['vector'],
                    signals: { fts: 0, graph: 0, vector: boost, exact: 0 },
                });
            }
        });

        const needle = q.toLowerCase();
        for (const hit of byId.values()) {
            const title = String(hit.doc.title || '').toLowerCase();
            const path = String(hit.doc.path || '').toLowerCase();
            if (title === needle || path === needle) {
                hit.score += 1;
                hit.why.push('exact');
                hit.signals.exact += 1;
            } else if (title.includes(needle) || path.includes(needle)) {
                hit.score += 0.3;
                hit.why.push('title');
                hit.signals.exact += 0.3;
            }
        }

        const type = (options.type || '').trim();
        const status = (options.status || '').trim().toUpperCase();
        const ranked = [...byId.values()]
            .filter((hit) => !type || hit.doc.type === type)
            .filter((hit) => !status || String(hit.doc.status).toUpperCase() === status)
            .sort((a, b) => b.score - a.score || String(a.doc.path).localeCompare(String(b.doc.path)))
            .slice(0, limit)
            .map((hit, index) => ({
                rank: index + 1,
                doc: hit.doc,
                score: Number(hit.score.toFixed(6)),
                why: [...new Set(hit.why)],
                signals: {
                    fts: Number(hit.signals.fts.toFixed(6)),
                    graph: Number(hit.signals.graph.toFixed(6)),
                    vector: Number(hit.signals.vector.toFixed(6)),
                    exact: Number(hit.signals.exact.toFixed(6)),
                },
            }));

        let results: any[];
        if (tier === 'index') {
            results = [];
            for (const hit of ranked) {
                const item = {
                    rank: hit.rank,
                    docId: docIdOf(hit.doc),
                    title: hit.doc.title ?? null,
                    applies_when: appliesWhenOf(hit.doc) ?? {},
                    score: hit.score,
                };
                const size = JSON.stringify(item).length;
                if (budgetTokens !== null && size > remainingChars) {
                    truncated = true;
                    break;
                }
                remainingChars -= size;
                results.push(item);
            }
        } else if (tier === 'summary') {
            const consumerRoot = await this.consumerRoot(id);
            results = ranked.map((hit) => {
                const body = this.bodyOf(hit.doc, consumerRoot);
                const allowed = Math.min(DEFAULT_SUMMARY_CHARS, Math.max(0, remainingChars));
                const summary = takeChars(body, allowed);
                const itemTruncated = charLength(summary) < charLength(body);
                remainingChars = Math.max(0, remainingChars - charLength(summary));
                if (itemTruncated) truncated = true;
                return {
                    rank: hit.rank,
                    docId: docIdOf(hit.doc),
                    title: hit.doc.title ?? null,
                    applies_when: appliesWhenOf(hit.doc) ?? {},
                    score: hit.score,
                    summary,
                    truncated: itemTruncated,
                };
            });
        } else {
            results = ranked.map((hit) => {
                let doc = hit.doc;
                let itemTruncated = false;
                if (budgetTokens !== null) {
                    const field = typeof doc?.body === 'string'
                        ? 'body'
                        : typeof doc?.content === 'string'
                            ? 'content'
                            : typeof doc?.text === 'string'
                                ? 'text'
                                : null;
                    if (field) {
                        const full = doc[field] as string;
                        const value = takeChars(full, Math.max(0, remainingChars));
                        itemTruncated = charLength(value) < charLength(full);
                        remainingChars = Math.max(0, remainingChars - charLength(value));
                        if (itemTruncated) {
                            truncated = true;
                            doc = { ...doc, [field]: value };
                        }
                    }
                }
                const item: any = {
                    rank: hit.rank,
                    doc,
                    score: hit.score,
                    why: hit.why,
                    signals: hit.signals,
                };
                if (itemTruncated) item.truncated = true;
                return item;
            });
        }

        return {
            query: q,
            mode: 'hybrid',
            tier,
            budgetTokens,
            truncated,
            weights,
            vector: vectorInfo,
            filters: { type: type || null, status: status || null },
            counts: { fts: fts.length, graph: graph.length, vector: vectorHits.length, merged: byId.size },
            results,
        };
    }
}
