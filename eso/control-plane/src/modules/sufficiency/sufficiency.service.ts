/**
 * F-15 — sufficiency nội dung (US-23, AC-23-1…3, REQ-23).
 *
 * Reads the F-14 snapshot and answers one question per finding: is the content there, unique and
 * non-contradictory? Detection is lexical and deterministic — no embeddings, no model calls:
 *   - `NEAR_DUPLICATE`       — ≥2 artifacts with near-identical bodies and different ids (`copies[]`);
 *   - `CONTENT_CONTRADICTS`  — two artifacts stating opposite claims (`quotes[]`);
 *   - inventory findings     — `MISSING_KIND` / `ORPHAN_ARTIFACT` / `OWNER_MISSING` pass through.
 *
 * BR-16/F-15 §2.3: a finding without a `consequence` is not actionable and is dropped. The drop is
 * reported in `summary.dropped`, never silent.
 */
import type { PlatformStore } from '../../platform/registry/store.js';
import { assertConsumerId } from '../../platform/registry/store.js';
import {
    InventoryService,
    type InventoryDoc,
    type InventoryFinding,
    type InventoryOptions,
} from '../inventory/inventory.service.js';

/** O-F15 is OPEN; a fixed threshold keeps the check reproducible until the operator picks one. */
export const DEFAULT_DUPLICATE_THRESHOLD = 0.8;
export const MIN_DUPLICATE_TOKENS = 20;
const SHINGLE_SIZE = 5;
const MIN_CLAIM_WORDS = 3;

export interface DuplicateCopy {
    path: string;
    docId: string;
    similarity: number;
}

export interface ContradictionQuote {
    path: string;
    statement: string;
}

export interface SufficiencyFinding {
    code: string;
    kind: string | null;
    reason: string;
    consequence: string;
    severity: 'error' | 'warning';
    copies?: DuplicateCopy[];
    quotes?: ContradictionQuote[];
}

/** Findings produced by an upstream check (F-17 stale, F-13 select, …) and merged here. */
export type UpstreamFinding = Partial<SufficiencyFinding> & { code: string };

export interface SufficiencyOptions extends InventoryOptions {
    duplicateThreshold?: number;
    minTokens?: number;
    upstreamFindings?: UpstreamFinding[];
}

export interface SufficiencyResult {
    consumerId: string;
    status: 'clear' | 'findings';
    blockMerge: boolean;
    findings: SufficiencyFinding[];
    summary: {
        missingKind: number;
        orphanArtifact: number;
        ownerMissing: number;
        nearDuplicate: number;
        contradicts: number;
        upstream: number;
        dropped: number;
    };
}

const NEGATION_SOURCES = [
    '\\bnot\\b', '\\bnever\\b', '\\bno\\b', '\\bcannot\\b', "\\bcan't\\b", '\\bcant\\b',
    "\\bdon't\\b", "\\bdoesn't\\b", "\\bisn't\\b", "\\baren't\\b", "\\bwon't\\b",
    '\\bwithout\\b', '\\bkhông\\b', '\\bchưa\\b', '\\bcấm\\b',
];

/** Words that name the same claim; the `negative` side is the contradiction of the positive one. */
const ANTONYMS: ReadonlyArray<{ canonical: string; words: readonly string[]; negative: boolean }> = [
    { canonical: 'allow', words: ['allow', 'allows', 'allowed', 'permit', 'permits', 'permitted'], negative: false },
    { canonical: 'allow', words: ['forbid', 'forbids', 'forbidden', 'prohibit', 'prohibits', 'prohibited', 'deny', 'denies', 'denied'], negative: true },
    { canonical: 'enable', words: ['enable', 'enables', 'enabled'], negative: false },
    { canonical: 'enable', words: ['disable', 'disables', 'disabled'], negative: true },
    { canonical: 'required', words: ['required', 'require', 'requires', 'mandatory', 'must', 'shall'], negative: false },
    { canonical: 'required', words: ['optional', 'optionally', 'may'], negative: true },
    { canonical: 'include', words: ['include', 'includes', 'included'], negative: false },
    { canonical: 'include', words: ['exclude', 'excludes', 'excluded'], negative: true },
    { canonical: 'public', words: ['public'], negative: false },
    { canonical: 'public', words: ['private', 'internal'], negative: true },
    { canonical: 'pass', words: ['pass', 'passes', 'passed'], negative: false },
    { canonical: 'pass', words: ['fail', 'fails', 'failed'], negative: true },
];

function stripFences(body: string): string {
    return body.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
}

function normalizedBody(body: string): string {
    return stripFences(body)
        .replace(/^\s{0,3}#{1,6}\s*/gm, ' ')
        .replace(/[*_`>]/g, ' ')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(text: string): string[] {
    return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function shingles(tokens: string[], size: number): Set<string> {
    const out = new Set<string>();
    for (let index = 0; index + size <= tokens.length; index += 1) {
        out.add(tokens.slice(index, index + size).join(' '));
    }
    if (out.size === 0 && tokens.length > 0) out.add(tokens.join(' '));
    return out;
}

/** Jaccard over word shingles — stable, symmetric, and easy to explain in a finding. */
export function similarity(left: string, right: string): number {
    const a = shingles(tokenize(normalizedBody(left)), SHINGLE_SIZE);
    const b = shingles(tokenize(normalizedBody(right)), SHINGLE_SIZE);
    let intersection = 0;
    for (const shingle of a) if (b.has(shingle)) intersection += 1;
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

export interface Claim {
    key: string;
    negative: boolean;
    statement: string;
}

function claimsOf(body: string): Claim[] {
    const claims: Claim[] = [];
    for (const raw of stripFences(body).split(/(?<=[.!?])\s+|\n+/)) {
        const statement = raw.replace(/^\s*(?:[-*+>]|\d+[.)]|#{1,6})\s*/, '').replace(/\s+/g, ' ').trim();
        if (!statement) continue;
        const words = tokenize(statement);
        if (words.length < MIN_CLAIM_WORDS) continue;
        let text = statement.toLowerCase();
        let negative = false;
        for (const source of NEGATION_SOURCES) {
            const pattern = new RegExp(source);
            if (!pattern.test(text)) continue;
            negative = !negative;
            text = text.replace(new RegExp(source, 'g'), ' ');
        }
        for (const group of ANTONYMS) {
            let hit = false;
            for (const word of group.words) {
                const pattern = new RegExp(`\\b${word}\\b`);
                if (!pattern.test(text)) continue;
                hit = true;
                text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), group.canonical);
            }
            if (hit && group.negative) negative = !negative;
        }
        const key = text.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (key.length < 12) continue;
        claims.push({ key, negative, statement: statement.slice(0, 240) });
    }
    return claims;
}

/**
 * BR-16 / F-15 §2.3 — a finding without `reason` + `consequence` is noise, not a finding.
 * Exported so callers can apply the same rule to their own upstream findings.
 */
export function retainActionable<T extends { reason?: string | null; consequence?: string | null }>(findings: readonly T[]): T[] {
    return findings.filter((finding) =>
        typeof finding.reason === 'string' && finding.reason.trim().length > 0
        && typeof finding.consequence === 'string' && finding.consequence.trim().length > 0);
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

export class SufficiencyService {
    private readonly inventory: InventoryService;

    constructor(store: PlatformStore, inventory?: InventoryService) {
        this.inventory = inventory ?? new InventoryService(store);
    }

    async check(consumerId: string, options: SufficiencyOptions = {}): Promise<SufficiencyResult> {
        const id = assertConsumerId(consumerId);
        const { docs, result } = await this.inventory.inspect(id, options);
        const threshold = options.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
        const minTokens = options.minTokens ?? MIN_DUPLICATE_TOKENS;

        const generated: SufficiencyFinding[] = [
            ...result.findings.map((finding) => this.fromInventory(finding)),
            ...this.nearDuplicates(docs, threshold, minTokens),
            ...this.contradictions(docs),
            ...(options.upstreamFindings ?? []).map((finding) => this.fromUpstream(finding)),
        ];
        const findings = retainActionable(generated);
        const dropped = generated.length - findings.length;
        const summary = {
            missingKind: findings.filter((finding) => finding.code === 'MISSING_KIND').length,
            orphanArtifact: findings.filter((finding) => finding.code === 'ORPHAN_ARTIFACT').length,
            ownerMissing: findings.filter((finding) => finding.code === 'OWNER_MISSING').length,
            nearDuplicate: findings.filter((finding) => finding.code === 'NEAR_DUPLICATE').length,
            contradicts: findings.filter((finding) => finding.code === 'CONTENT_CONTRADICTS').length,
            upstream: findings.filter((finding) => !GENERATED_CODES.has(finding.code)).length,
            dropped,
        };
        const sorted = [...findings].sort((left, right) =>
            left.code.localeCompare(right.code)
            || String(left.kind ?? '').localeCompare(String(right.kind ?? ''))
            || String(left.reason).localeCompare(String(right.reason)));

        return {
            consumerId: id,
            status: sorted.length > 0 ? 'findings' : 'clear',
            blockMerge: sorted.some((finding) => finding.severity === 'error'),
            findings: sorted,
            summary,
        };
    }

    private fromInventory(finding: InventoryFinding): SufficiencyFinding {
        return {
            code: finding.code,
            kind: finding.kind,
            reason: finding.reason,
            consequence: finding.consequence,
            severity: finding.severity,
        };
    }

    private fromUpstream(finding: UpstreamFinding): SufficiencyFinding {
        return {
            code: finding.code,
            kind: finding.kind ?? null,
            reason: finding.reason ?? '',
            consequence: finding.consequence ?? '',
            severity: finding.severity ?? 'warning',
            ...(finding.copies ? { copies: finding.copies } : {}),
            ...(finding.quotes ? { quotes: finding.quotes } : {}),
        };
    }

    /**
     * Single-link clustering over pairs above `threshold`. Pairs that are a declared AI projection
     * of the other artifact (F-27 `human_sot`) are intentional copies, not duplicates.
     */
    private nearDuplicates(docs: InventoryDoc[], threshold: number, minTokens: number): SufficiencyFinding[] {
        const eligible = docs
            .filter((doc) => tokenize(normalizedBody(doc.content)).length >= minTokens)
            .sort((left, right) => left.path.localeCompare(right.path));
        const clusters: InventoryDoc[][] = [];
        for (const doc of eligible) {
            const cluster = clusters.find((members) => members.some((member) =>
                !sameLogicalDoc(member, doc) && !isProjectionOf(member, doc) && similarity(member.content, doc.content) >= threshold));
            if (cluster) cluster.push(doc);
            else clusters.push([doc]);
        }

        const findings: SufficiencyFinding[] = [];
        for (const members of clusters) {
            if (members.length < 2) continue;
            const ids = new Set(members.map((member) => member.id ?? member.path));
            if (ids.size < 2) continue;
            const representative = members[0];
            const copies = members.map((member) => ({
                path: member.path,
                docId: member.id ?? member.path,
                similarity: round(similarity(representative.content, member.content)),
            }));
            const kinds = new Set(members.map((member) => member.kind ?? ''));
            findings.push({
                code: 'NEAR_DUPLICATE',
                kind: kinds.size === 1 ? members[0].kind : null,
                reason: `${members.length} artifacts share near-identical content: ${members.map((member) => member.path).join(', ')}`,
                consequence: 'two sources of truth drift apart; an edit lands in one copy and the other keeps passing the gate (BR-16)',
                severity: 'error',
                copies,
            });
        }
        return findings;
    }

    /** A claim key with opposite polarity in two different artifacts is a contradiction. */
    private contradictions(docs: InventoryDoc[]): SufficiencyFinding[] {
        const byKey = new Map<string, Array<{ path: string; docId: string; kind: string | null; negative: boolean; statement: string }>>();
        for (const doc of [...docs].sort((left, right) => left.path.localeCompare(right.path))) {
            for (const claim of claimsOf(doc.content)) {
                const bucket = byKey.get(claim.key) ?? [];
                bucket.push({
                    path: doc.path,
                    docId: doc.id ?? doc.path,
                    kind: doc.kind,
                    negative: claim.negative,
                    statement: claim.statement,
                });
                byKey.set(claim.key, bucket);
            }
        }

        const findings: SufficiencyFinding[] = [];
        for (const bucket of byKey.values()) {
            const positive = bucket.find((entry) => !entry.negative);
            const negative = positive
                ? bucket.find((entry) => entry.negative && entry.path !== positive.path)
                : undefined;
            if (!positive || !negative) continue;
            findings.push({
                code: 'CONTENT_CONTRADICTS',
                kind: positive.kind !== null && positive.kind === negative.kind ? positive.kind : null,
                reason: `${positive.path} states "${positive.statement}" while ${negative.path} states "${negative.statement}"`,
                consequence: 'both statements cannot hold; a reader or gate that trusts the wrong one accepts an invalid claim (BR-16)',
                severity: 'error',
                quotes: [
                    { path: positive.path, statement: positive.statement },
                    { path: negative.path, statement: negative.statement },
                ],
            });
        }
        return findings;
    }
}

const GENERATED_CODES: ReadonlySet<string> = new Set([
    'MISSING_KIND', 'ORPHAN_ARTIFACT', 'OWNER_MISSING', 'NEAR_DUPLICATE', 'CONTENT_CONTRADICTS',
]);

function isProjectionOf(left: InventoryDoc, right: InventoryDoc): boolean {
    const agent = left.representation === 'agent' ? left : right.representation === 'agent' ? right : null;
    const human = agent === left ? right : left;
    return Boolean(agent && agent.humanSot && agent.humanSot === human.path);
}

/** Same frontmatter `id` means one logical document, not two copies (FRD F-15 §2.2). */
function sameLogicalDoc(left: InventoryDoc, right: InventoryDoc): boolean {
    return left.id !== null && right.id !== null && left.id === right.id;
}
