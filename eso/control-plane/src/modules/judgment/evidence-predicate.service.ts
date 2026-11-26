import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import type { PlatformStore } from '../../platform/registry/store.js';

/**
 * S2 — Server-side deterministic evidence predicate verifier.
 *
 * Evaluates claimed `evidence.packet` items against the consumer's store/KB/workspace
 * at ingest time (never during verdict adjudication, so verdicts stay pure and immune to
 * time-travel mutations after the turn).
 *
 * Option A trigger: only runs when at least one item carries `requirementId` OR has a
 * verifiable `kind` (`knowledge`, `file`, or an explicit predicate kind). Legacy packets
 * without those return `{ checked: false, ... }` to preserve throughput and marker-only
 * semantics.
 */

export const EVIDENCE_PREDICATE_KINDS = [
    'KB_TEMPLATE_PRESENT',
    'KB_DOC_HAS_SECTION',
    'KB_INDEX_COVERS',
    'SNAPSHOT_MATCHES',
] as const;

export type EvidencePredicateKind = (typeof EVIDENCE_PREDICATE_KINDS)[number];

const VERIFIABLE_KINDS: ReadonlySet<string> = new Set([
    'knowledge',
    'file',
    ...EVIDENCE_PREDICATE_KINDS,
]);

const TEMPLATE_REL_PATH = '.harness/knowledge-template.json';

export interface VerifiedEvidenceSource {
    requirementId: string | null;
    id: string;
    kind: string;
    where: string;
    hash: string | null;
    verified: boolean;
    reason?: string;
    verifiedAt: string;
}

export interface PacketVerificationResult {
    checked: boolean;
    allVerified: boolean;
    snapshotId: string | null;
    verifiedAt: string;
    sources: VerifiedEvidenceSource[];
    results: VerifiedEvidenceSource[];
}

interface RawPacketItem {
    id: string;
    kind: string;
    hash: string | null;
    requirementId: string | null;
    section: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
}

function normalizeHash(value: string): string {
    return value.trim().toLowerCase().replace(/^sha256:/, '');
}

function hashesMatch(claimed: string, actual: string): boolean {
    return normalizeHash(claimed) === normalizeHash(actual);
}

function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function parseItem(entry: unknown): RawPacketItem | null {
    if (!isRecord(entry)) return null;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const kind = typeof entry.kind === 'string' ? entry.kind.trim() : '';
    if (!id || !kind) return null;
    const hash = typeof entry.hash === 'string' && entry.hash.trim() ? entry.hash.trim() : null;
    const requirementId = typeof entry.requirementId === 'string' && entry.requirementId.trim()
        ? entry.requirementId.trim()
        : null;
    const section = typeof entry.section === 'string' && entry.section.trim() ? entry.section.trim() : null;
    return { id, kind, hash, requirementId, section };
}

function isVerifiableItem(item: RawPacketItem): boolean {
    return item.requirementId !== null || VERIFIABLE_KINDS.has(item.kind);
}

function safeReadUnder(root: string | null | undefined, target: string): { rel: string; content: string; hash: string } | null {
    if (!root || !target) return null;
    try {
        const base = resolve(root);
        const abs = resolve(base, target);
        if (abs !== base && !abs.startsWith(base + sep)) return null;
        if (!existsSync(abs)) return null;
        if (!statSync(abs).isFile()) return null;
        const content = readFileSync(abs, 'utf8');
        const rel = relative(base, abs).split(sep).join('/');
        return { rel, content, hash: sha256(content) };
    } catch {
        return null;
    }
}

function markdownHasSection(content: string, wanted: string): boolean {
    const targetRaw = wanted.trim().toLowerCase();
    const targetSlug = slug(wanted);
    const headings = content.matchAll(/^#{1,6}\s+(.+?)\s*$/gm);
    for (const match of headings) {
        const heading = match[1].trim();
        if (heading.toLowerCase() === targetRaw) return true;
        if (targetSlug && slug(heading) === targetSlug) return true;
    }
    return false;
}

export class EvidencePredicateService {
    constructor(private readonly store: PlatformStore) {}

    /**
     * Deterministically verify an `evidence.packet`'s items against the consumer's store/KB.
     * Never throws: missing consumer, missing KB, or I/O errors produce `verified: false` entries.
     */
    async verifyPacket(consumerId: string, packetEvidence: unknown): Promise<PacketVerificationResult> {
        const verifiedAt = new Date().toISOString();
        const rawItems = isRecord(packetEvidence) && Array.isArray(packetEvidence.items)
            ? packetEvidence.items.map(parseItem).filter((item): item is RawPacketItem => item !== null)
            : [];

        const verifiable = rawItems.filter(isVerifiableItem);
        if (verifiable.length === 0) {
            return {
                checked: false,
                allVerified: true,
                snapshotId: null,
                verifiedAt,
                sources: [],
                results: [],
            };
        }

        const consumer = await this.safeCall(() => this.store.getConsumer(consumerId), null);
        const summary = await this.safeCall(() => this.store.knowledgeSummary(consumerId), null);
        const snapshotId: string | null =
            consumer?.materializedHash
            ?? summary?.manifest?.source_hash
            ?? summary?.manifest?.manifest_id
            ?? null;

        const docsCache = await this.safeCall(() => this.store.knowledgeDocs(consumerId, undefined, 200), []);
        const coverageCache = await this.safeCall(() => this.store.knowledgeCoverage(consumerId), []);

        const sources: VerifiedEvidenceSource[] = [];
        for (const item of verifiable) {
            const source = await this.verifyItem(consumerId, item, {
                consumer,
                snapshotId,
                docsCache: Array.isArray(docsCache) ? docsCache : [],
                coverageCache: Array.isArray(coverageCache) ? coverageCache : [],
                verifiedAt,
            });
            sources.push(source);
        }

        const allVerified = sources.every((entry) => entry.verified);
        return {
            checked: true,
            allVerified,
            snapshotId,
            verifiedAt,
            sources,
            results: sources,
        };
    }

    private async verifyItem(
        consumerId: string,
        item: RawPacketItem,
        ctx: {
            consumer: { root?: string | null; sdlcRoot?: string | null; materializedHash?: string | null } | null;
            snapshotId: string | null;
            docsCache: any[];
            coverageCache: any[];
            verifiedAt: string;
        },
    ): Promise<VerifiedEvidenceSource> {
        if (!ctx.consumer) {
            return {
                requirementId: item.requirementId,
                id: item.id,
                kind: item.kind,
                where: item.id,
                hash: item.hash,
                verified: false,
                reason: `consumer not found: ${consumerId}`,
                verifiedAt: ctx.verifiedAt,
            };
        }

        switch (item.kind) {
            case 'KB_TEMPLATE_PRESENT':
                return this.verifyKbTemplatePresent(item, ctx);
            case 'KB_DOC_HAS_SECTION':
                return this.verifyKbDocHasSection(consumerId, item, ctx);
            case 'KB_INDEX_COVERS':
                return this.verifyKbIndexCovers(consumerId, item, ctx);
            case 'SNAPSHOT_MATCHES':
                return this.verifySnapshotMatches(item, ctx);
            default:
                return this.verifyArtifact(consumerId, item, ctx);
        }
    }

    private verifyKbTemplatePresent(
        item: RawPacketItem,
        ctx: {
            consumer: { root?: string | null } | null;
            coverageCache: any[];
            verifiedAt: string;
        },
    ): VerifiedEvidenceSource {
        const file = safeReadUnder(ctx.consumer?.root, TEMPLATE_REL_PATH);
        if (file) {
            try {
                const parsed = JSON.parse(file.content);
                const kinds = Array.isArray(parsed)
                    ? parsed
                    : Array.isArray(parsed?.kinds)
                        ? parsed.kinds
                        : Array.isArray(parsed?.requiredKinds)
                            ? parsed.requiredKinds
                            : [];
                if (kinds.length === 0) {
                    return {
                        requirementId: item.requirementId,
                        id: item.id,
                        kind: item.kind,
                        where: TEMPLATE_REL_PATH,
                        hash: file.hash,
                        verified: false,
                        reason: 'knowledge template declares no kinds',
                        verifiedAt: ctx.verifiedAt,
                    };
                }
                if (item.hash && !hashesMatch(item.hash, file.hash)) {
                    return {
                        requirementId: item.requirementId,
                        id: item.id,
                        kind: item.kind,
                        where: TEMPLATE_REL_PATH,
                        hash: file.hash,
                        verified: false,
                        reason: 'knowledge template hash mismatch',
                        verifiedAt: ctx.verifiedAt,
                    };
                }
                return {
                    requirementId: item.requirementId,
                    id: item.id,
                    kind: item.kind,
                    where: TEMPLATE_REL_PATH,
                    hash: file.hash,
                    verified: true,
                    verifiedAt: ctx.verifiedAt,
                };
            } catch {
                return {
                    requirementId: item.requirementId,
                    id: item.id,
                    kind: item.kind,
                    where: TEMPLATE_REL_PATH,
                    hash: file.hash,
                    verified: false,
                    reason: 'knowledge template is invalid JSON',
                    verifiedAt: ctx.verifiedAt,
                };
            }
        }

        if (ctx.coverageCache.length > 0 && !item.hash) {
            return {
                requirementId: item.requirementId,
                id: item.id,
                kind: item.kind,
                where: 'knowledge_coverage',
                hash: null,
                verified: true,
                verifiedAt: ctx.verifiedAt,
            };
        }

        return {
            requirementId: item.requirementId,
            id: item.id,
            kind: item.kind,
            where: TEMPLATE_REL_PATH,
            hash: item.hash,
            verified: false,
            reason: 'knowledge template not found',
            verifiedAt: ctx.verifiedAt,
        };
    }

    private async verifyKbDocHasSection(
        consumerId: string,
        item: RawPacketItem,
        ctx: {
            consumer: { root?: string | null; sdlcRoot?: string | null } | null;
            docsCache: any[];
            verifiedAt: string;
        },
    ): Promise<VerifiedEvidenceSource> {
        const hashIdx = item.id.indexOf('#');
        const docRef = hashIdx >= 0 ? item.id.slice(0, hashIdx).trim() : item.id;
        const wantedSection = item.section ?? (hashIdx >= 0 ? item.id.slice(hashIdx + 1).trim() : '');

        if (!docRef || !wantedSection) {
            return {
                requirementId: item.requirementId,
                id: item.id,
                kind: item.kind,
                where: item.id,
                hash: item.hash,
                verified: false,
                reason: 'KB_DOC_HAS_SECTION requires "<doc>#<section>"',
                verifiedAt: ctx.verifiedAt,
            };
        }

        // 1. Check indexed knowledge doc in store
        const indexed = await this.safeCall(() => this.store.knowledgeDoc(consumerId, docRef), null);
        if (indexed?.doc) {
            const sections: any[] = Array.isArray(indexed.sections) ? indexed.sections : [];
            const wantedSlug = slug(wantedSection);
            const hasSection = sections.some((s) => {
                const heading = String(s?.heading ?? '').trim().toLowerCase();
                const anchor = String(s?.anchor ?? '').trim().toLowerCase();
                return heading === wantedSection.toLowerCase()
                    || anchor === wantedSlug
                    || slug(heading) === wantedSlug;
            });
            const actualHash = typeof indexed.doc.content_hash === 'string' ? indexed.doc.content_hash : null;
            const where = String(indexed.doc.path ?? docRef);
            if (!hasSection) {
                return {
                    requirementId: item.requirementId,
                    id: item.id,
                    kind: item.kind,
                    where,
                    hash: actualHash,
                    verified: false,
                    reason: `section "${wantedSection}" not found in ${where}`,
                    verifiedAt: ctx.verifiedAt,
                };
            }
            return this.finalizeHashCheck(item, where, actualHash, ctx.verifiedAt);
        }

        // 2. Check filesystem under consumer.root or consumer.sdlcRoot
        const file = safeReadUnder(ctx.consumer?.root, docRef) ?? safeReadUnder(ctx.consumer?.sdlcRoot, docRef);
        if (file) {
            if (!markdownHasSection(file.content, wantedSection)) {
                return {
                    requirementId: item.requirementId,
                    id: item.id,
                    kind: item.kind,
                    where: file.rel,
                    hash: file.hash,
                    verified: false,
                    reason: `section "${wantedSection}" not found in ${file.rel}`,
                    verifiedAt: ctx.verifiedAt,
                };
            }
            return this.finalizeHashCheck(item, file.rel, file.hash, ctx.verifiedAt);
        }

        return {
            requirementId: item.requirementId,
            id: item.id,
            kind: item.kind,
            where: docRef,
            hash: item.hash,
            verified: false,
            reason: `document not found: ${docRef}`,
            verifiedAt: ctx.verifiedAt,
        };
    }

    private async verifyKbIndexCovers(
        consumerId: string,
        item: RawPacketItem,
        ctx: {
            consumer: { root?: string | null; sdlcRoot?: string | null } | null;
            docsCache: any[];
            coverageCache: any[];
            verifiedAt: string;
        },
    ): Promise<VerifiedEvidenceSource> {
        const direct = await this.safeCall(() => this.store.knowledgeDoc(consumerId, item.id), null);
        if (direct?.doc) {
            const where = String(direct.doc.path ?? item.id);
            const actualHash = typeof direct.doc.content_hash === 'string' ? direct.doc.content_hash : null;
            return this.finalizeHashCheck(item, where, actualHash, ctx.verifiedAt);
        }

        const matchedDoc = ctx.docsCache.find(
            (d) => d?.doc_id === item.id || d?.path === item.id || d?.type === item.id,
        );
        if (matchedDoc) {
            const where = String(matchedDoc.path ?? matchedDoc.doc_id ?? item.id);
            const actualHash = typeof matchedDoc.content_hash === 'string' ? matchedDoc.content_hash : null;
            return this.finalizeHashCheck(item, where, actualHash, ctx.verifiedAt);
        }

        const matchedCoverage = ctx.coverageCache.find((c) => c?.type === item.id && Number(c?.docs ?? 0) > 0);
        if (matchedCoverage && !item.hash) {
            return {
                requirementId: item.requirementId,
                id: item.id,
                kind: item.kind,
                where: `knowledge_coverage:${item.id}`,
                hash: null,
                verified: true,
                verifiedAt: ctx.verifiedAt,
            };
        }

        const file = safeReadUnder(ctx.consumer?.root, item.id) ?? safeReadUnder(ctx.consumer?.sdlcRoot, item.id);
        if (file) {
            return this.finalizeHashCheck(item, file.rel, file.hash, ctx.verifiedAt);
        }

        return {
            requirementId: item.requirementId,
            id: item.id,
            kind: item.kind,
            where: item.id,
            hash: item.hash,
            verified: false,
            reason: `knowledge index does not cover "${item.id}"`,
            verifiedAt: ctx.verifiedAt,
        };
    }

    private verifySnapshotMatches(
        item: RawPacketItem,
        ctx: {
            snapshotId: string | null;
            verifiedAt: string;
        },
    ): VerifiedEvidenceSource {
        const claimed = item.hash ?? item.id;
        if (!ctx.snapshotId) {
            return {
                requirementId: item.requirementId,
                id: item.id,
                kind: item.kind,
                where: 'consumer.snapshot',
                hash: null,
                verified: false,
                reason: 'no consumer snapshot available',
                verifiedAt: ctx.verifiedAt,
            };
        }
        if (!hashesMatch(claimed, ctx.snapshotId)) {
            return {
                requirementId: item.requirementId,
                id: item.id,
                kind: item.kind,
                where: 'consumer.snapshot',
                hash: ctx.snapshotId,
                verified: false,
                reason: 'snapshot hash mismatch',
                verifiedAt: ctx.verifiedAt,
            };
        }
        return {
            requirementId: item.requirementId,
            id: item.id,
            kind: item.kind,
            where: 'consumer.snapshot',
            hash: ctx.snapshotId,
            verified: true,
            verifiedAt: ctx.verifiedAt,
        };
    }

    private async verifyArtifact(
        consumerId: string,
        item: RawPacketItem,
        ctx: {
            consumer: { root?: string | null; sdlcRoot?: string | null } | null;
            docsCache: any[];
            verifiedAt: string;
        },
    ): Promise<VerifiedEvidenceSource> {
        // 1. Direct knowledge doc lookup
        const indexed = await this.safeCall(() => this.store.knowledgeDoc(consumerId, item.id), null);
        if (indexed?.doc) {
            const where = String(indexed.doc.path ?? item.id);
            const actualHash = typeof indexed.doc.content_hash === 'string' ? indexed.doc.content_hash : null;
            return this.finalizeHashCheck(item, where, actualHash, ctx.verifiedAt);
        }

        // 2. Knowledge docs list match by doc_id or path
        const matchedDoc = ctx.docsCache.find((d) => d?.doc_id === item.id || d?.path === item.id);
        if (matchedDoc) {
            const where = String(matchedDoc.path ?? matchedDoc.doc_id ?? item.id);
            const actualHash = typeof matchedDoc.content_hash === 'string' ? matchedDoc.content_hash : null;
            return this.finalizeHashCheck(item, where, actualHash, ctx.verifiedAt);
        }

        // 3. Consumer artifact in store
        const artifact = await this.safeCall(() => this.store.getArtifact(consumerId, item.id), null);
        if (artifact) {
            const actualHash = sha256(artifact.body ?? '');
            return this.finalizeHashCheck(item, artifact.id, actualHash, ctx.verifiedAt);
        }

        // 4. File in consumer workspace root or sdlcRoot
        const file = safeReadUnder(ctx.consumer?.root, item.id) ?? safeReadUnder(ctx.consumer?.sdlcRoot, item.id);
        if (file) {
            return this.finalizeHashCheck(item, file.rel, file.hash, ctx.verifiedAt);
        }

        return {
            requirementId: item.requirementId,
            id: item.id,
            kind: item.kind,
            where: item.id,
            hash: item.hash,
            verified: false,
            reason: `evidence item not found: ${item.id}`,
            verifiedAt: ctx.verifiedAt,
        };
    }

    private finalizeHashCheck(
        item: RawPacketItem,
        where: string,
        actualHash: string | null,
        verifiedAt: string,
    ): VerifiedEvidenceSource {
        if (item.hash) {
            if (!actualHash) {
                return {
                    requirementId: item.requirementId,
                    id: item.id,
                    kind: item.kind,
                    where,
                    hash: null,
                    verified: false,
                    reason: 'stored content hash unavailable to verify claimed hash',
                    verifiedAt,
                };
            }
            if (!hashesMatch(item.hash, actualHash)) {
                return {
                    requirementId: item.requirementId,
                    id: item.id,
                    kind: item.kind,
                    where,
                    hash: actualHash,
                    verified: false,
                    reason: 'content hash mismatch',
                    verifiedAt,
                };
            }
        }
        return {
            requirementId: item.requirementId,
            id: item.id,
            kind: item.kind,
            where,
            hash: actualHash,
            verified: true,
            verifiedAt,
        };
    }

    private async safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
        try {
            return await fn();
        } catch {
            return fallback;
        }
    }
}
