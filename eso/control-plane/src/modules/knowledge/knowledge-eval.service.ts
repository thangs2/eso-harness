import { assertConsumerId } from '../../platform/registry/store.js';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service.js';

interface EvalCase {
    query: string;
    expected: string[];
    type?: string;
    status?: string;
}

export class KnowledgeEvalService {
    constructor(private readonly retrieval: KnowledgeRetrievalService) {}

    async evaluate(consumerId: string, cases: EvalCase[], k = 5, weights?: any): Promise<any> {
        const id = assertConsumerId(consumerId);
        const topK = Math.max(1, Math.min(Number(k) || 5, 20));
        const details = [];
        let recallSum = 0;
        let strictCount = 0;
        let reciprocalRankSum = 0;
        let answered = 0;

        for (const testCase of cases) {
            const expected = new Set((testCase.expected || []).filter(Boolean));
            if (!testCase.query || expected.size === 0) continue;
            answered += 1;
            const started = performance.now();
            const result = await this.retrieval.retrieve(id, testCase.query, {
                type: testCase.type,
                status: testCase.status,
                limit: topK,
                weights,
            });
            const elapsed = performance.now() - started;
            const paths = result.results.map((hit: any) => hit.doc.path);
            const found = paths.filter((path: string) => expected.has(path));
            const recall = found.length / expected.size;
            const strict = [...expected].every((path) => paths.includes(path));
            const firstIndex = paths.findIndex((path: string) => expected.has(path));
            const reciprocalRank = firstIndex >= 0 ? 1 / (firstIndex + 1) : 0;
            recallSum += recall;
            strictCount += strict ? 1 : 0;
            reciprocalRankSum += reciprocalRank;
            details.push({
                query: testCase.query,
                expected: [...expected],
                paths,
                found,
                recall: Number(recall.toFixed(4)),
                strict,
                reciprocalRank: Number(reciprocalRank.toFixed(4)),
                latencyMs: Number(elapsed.toFixed(1)),
                vector: result.vector,
            });
        }

        return {
            k: topK,
            cases: answered,
            metrics: {
                recallAtK: answered ? Number((recallSum / answered).toFixed(4)) : 0,
                strictRecallAllAtK: answered ? Number((strictCount / answered).toFixed(4)) : 0,
                mrr: answered ? Number((reciprocalRankSum / answered).toFixed(4)) : 0,
                p95LatencyMs: percentile(details.map((item) => item.latencyMs), 0.95),
            },
            details,
        };
    }
}

function percentile(values: number[], p: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return Number(sorted[index].toFixed(1));
}
