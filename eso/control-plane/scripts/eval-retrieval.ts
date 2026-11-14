import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BunSqlPlatformStore } from '../src/platform/registry/store.js';
import { KnowledgeRetrievalService } from '../src/modules/knowledge/knowledge-retrieval.service.js';
import { KnowledgeEvalService } from '../src/modules/knowledge/knowledge-eval.service.js';
import { LocalEmbeddingService } from '../src/modules/knowledge/local-embedding.service.js';

const BunRuntime = (globalThis as any).Bun;
if (!BunRuntime?.SQL) {
    console.error('Bun runtime required');
    process.exit(2);
}

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
    args.set(process.argv[index].replace(/^--/, ''), process.argv[index + 1]);
}
const consumer = args.get('consumer') || 'testeso';
const fixturePath = resolve(args.get('fixture') || 'test/fixtures/retrieval.eval.json');
const k = Number(args.get('k') || 5);
const sql = new BunRuntime.SQL(process.env.ESO_DB_URL || process.env.ESO_TEST_DB_URL);
const store = new BunSqlPlatformStore(sql);
const embeddings = new LocalEmbeddingService(store);
const retrieval = new KnowledgeRetrievalService(store, embeddings);
const evalService = new KnowledgeEvalService(retrieval);
const cases = JSON.parse(readFileSync(fixturePath, 'utf8'));
const result = await evalService.evaluate(consumer, cases, k);
console.log(JSON.stringify(result, null, 2));
await sql.close();
