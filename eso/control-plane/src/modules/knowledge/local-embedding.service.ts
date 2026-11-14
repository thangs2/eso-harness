import { homedir } from 'node:os';

import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

const MODEL = 'BAAI/bge-m3';
const REMOTE_MODEL = 'Xenova/bge-m3';

export class LocalEmbeddingService {
    private extractorPromise: Promise<any> | null = null;

    constructor(private readonly store: PlatformStore) {}

    private extractor(): Promise<any> {
        if (!this.extractorPromise) {
            this.extractorPromise = (async () => {
                const { pipeline, env } = await import('@huggingface/transformers');
                env.cacheDir = `${homedir()}/.cache/huggingface/transformers`;
                return pipeline('feature-extraction', REMOTE_MODEL, { dtype: 'q8' });
            })();
        }
        return this.extractorPromise;
    }

    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        const extractor = await this.extractor();
        const output = await extractor(texts, { pooling: 'cls', normalize: true });
        const rows: number[][] = [];
        const dimensions = Number(output.dims?.[1] || 0);
        for (let row = 0; row < texts.length; row += 1) {
            rows.push(Array.from(output.data.slice(row * dimensions, (row + 1) * dimensions), (value: any) => Number(value)));
        }
        return rows;
    }

    async embedPending(consumerId: string, batchSize = 8): Promise<any> {
        const id = assertConsumerId(consumerId);
        const chunks = await this.store.knowledgeChunks(id, true, 5000);
        let embedded = 0;
        for (let index = 0; index < chunks.length; index += batchSize) {
            const batch = chunks.slice(index, index + batchSize);
            const vectors = await this.embed(batch.map((chunk: any) => String(chunk.text || '')));
            const items = batch.map((chunk: any, offset: number) => ({ chunkId: chunk.chunk_id, vector: vectors[offset] }))
                .filter((item: any) => item.vector?.length);
            await this.store.updateChunkEmbeddings(id, items);
            embedded += items.length;
        }
        return { model: MODEL, embedded, pending: Math.max(0, chunks.length - embedded), total: (await this.store.knowledgeChunks(id, false, 5000)).length };
    }

    async status(consumerId: string): Promise<any> {
        const id = assertConsumerId(consumerId);
        const all = await this.store.knowledgeChunks(id, false, 5000);
        const count = await this.store.knowledgeVectorCount(id);
        return { model: MODEL, embedded: count, chunks: all.length, ready: count > 0 };
    }
}
