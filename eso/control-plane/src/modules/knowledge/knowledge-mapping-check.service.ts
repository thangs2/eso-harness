/**
 * Phase 5 — P8 checker for HUMAN ↔ AI document mapping.
 *
 * Read-only. A mapping is only trusted when every projection resolves to a human source and does
 * not duplicate its body. Warnings/failures are findings, not silent absences.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import { KnowledgeMappingService } from './knowledge-mapping.service.js';

interface Finding {
    code: string;
    severity: 'error' | 'warning';
    path: string;
    detail: string;
}

const COPY_MIN_CHARS = 120;

function withoutFrontmatter(text: string): string {
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function normalized(text: string): string {
    return withoutFrontmatter(text).replace(/\s+/g, ' ').trim();
}

export class KnowledgeMappingCheckService {
    private readonly mapping: KnowledgeMappingService;

    constructor(private readonly store: PlatformStore) {
        this.mapping = new KnowledgeMappingService(store);
    }

    async check(consumerId: string) {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const result = await this.mapping.mapping(id);
        const byPath = new Map(result.docs.map((doc) => [doc.path, doc]));
        const findings: Finding[] = [];
        const bodies = new Map<string, string>();
        const bodyOf = (path: string): string => {
            if (!bodies.has(path)) {
                try { bodies.set(path, normalized(readFileSync(join(consumer.root, path), 'utf8'))); }
                catch { bodies.set(path, ''); }
            }
            return bodies.get(path) ?? '';
        };

        for (const doc of result.docs) {
            if (doc.representation === 'agent' && !doc.humanSot) {
                findings.push({ code: 'MISSING_HUMAN_SOT', severity: 'error', path: doc.path, detail: 'agent projection has no human_sot pointer' });
                continue;
            }
            if (!doc.humanSot) continue;
            const human = byPath.get(doc.humanSot);
            if (!human) {
                findings.push({ code: 'UNRESOLVED_HUMAN_SOT', severity: 'error', path: doc.path, detail: `human_sot does not resolve: ${doc.humanSot}` });
                continue;
            }
            if (human.representation !== 'human') {
                findings.push({ code: 'HUMAN_SOT_NOT_HUMAN', severity: 'warning', path: doc.path, detail: `human_sot target is ${human.representation}` });
            }
            const aiBody = bodyOf(doc.path);
            const humanBody = bodyOf(human.path);
            if (humanBody.length >= COPY_MIN_CHARS && aiBody.includes(humanBody)) {
                findings.push({ code: 'DOC_CONTRACT_VIOLATION', severity: 'error', path: doc.path, detail: `body duplicates ${human.path} (copied_body)` });
                findings.push({ code: 'COPIED_BODY', severity: 'error', path: doc.path, detail: `body duplicates ${human.path}` });
            }
            if (doc.freshness === 'stale') {
                findings.push({ code: 'STALE_PROJECTION', severity: 'warning', path: doc.path, detail: 'indexed hash differs from current file' });
            }
        }

        const errors = findings.filter((finding) => finding.severity === 'error').length;
        return {
            consumerId: id,
            status: errors > 0 ? 'fail' : findings.length > 0 ? 'warn' : 'pass',
            checked: result.summary,
            findings,
            counts: { errors, warnings: findings.length - errors },
        };
    }
}
