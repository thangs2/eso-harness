import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

const RRF_K = 60;

interface RetrieveOptions {
    type?: string;
    status?: string;
    limit?: number;
    graphDepth?: number;
    weights?: { fts?: number; graph?: number; vector?: number };
}

interface Hit {
    doc: any;
    score: number;
    why: string[];
    signals: { fts: number; graph: number; vector: number; exact: number };
}

function rankBoost(rank: number): number {
    return 1 / (RRF_K + Math.max(1, rank));
}

function weight(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 10) : fallback;
}

export class KnowledgeRetrievalService {
    constructor(private readonly store: PlatformStore, private readonly embeddings?: any) {}

    async retrieve(consumerId: string, query: string, options: RetrieveOptions = {}): Promise<any> {
        const id = assertConsumerId(consumerId);
        const q = (query || '').trim();
        if (!q) {
            return { query: q, mode: 'hybrid', vector: { enabled: false, reason: 'no query' }, results: [], counts: { fts: 0, graph: 0, vector: 0, merged: 0 } };
        }
        const limit = Math.max(1, Math.min(Number(options.limit) || 20, 50));
        const weights = {
            fts: weight(options.weights?.fts, weight(process.env.ESO_RRF_FTS_WEIGHT, 1)),
            graph: weight(options.weights?.graph, weight(process.env.ESO_RRF_GRAPH_WEIGHT, 0.8)),
            vector: weight(options.weights?.vector, weight(process.env.ESO_RRF_VECTOR_WEIGHT, 1)),
        };
        const ftsLimit = Math.max(10, limit * 2);
        const fts = await this.store.knowledgeFtsSearch(id, q, ftsLimit);
        const seeds = fts.slice(0, Math.min(5, fts.length)).map((doc: any) => doc.doc_id);
        const graph = await this.store.knowledgeGraphCandidates(id, seeds, limit * 3);
        let vectorHits: any[] = [];
        let vectorInfo: any = { enabled: false, reason: 'embedding provider not configured; FTS + graph only' };
        const vectorCount = await this.store.knowledgeVectorCount(id);
        if (vectorCount > 0 && this.embeddings) {
            try {
                const [queryVector] = await this.embeddings.embed([q]);
                vectorHits = await this.store.knowledgeVectorSearch(id, queryVector, limit * 2);
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
        const results = [...byId.values()]
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

        return {
            query: q,
            mode: 'hybrid',
            weights,
            vector: vectorInfo,
            filters: { type: type || null, status: status || null },
            counts: { fts: fts.length, graph: graph.length, vector: vectorHits.length, merged: byId.size },
            results,
        };
    }
}
