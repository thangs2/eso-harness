import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import {
    RECEIPT_GENESIS_HASH,
    RECEIPT_SPEC_VERSION,
    REQUEST_SPEC_REF,
    type EvidenceReceipt,
    type ReceiptEventDigest,
    type ReceiptEvidenceSource,
    type ReceiptPayload,
    type ReceiptSpecRef,
    type ReceiptVerification,
    type ReceiptVerdictSummary,
    type TurnVerdict,
} from '../../platform/registry/types.js';
import { VerdictService } from '../verdict/verdict.service.js';

/**
 * P4 — receipt & integrity.
 *
 * A receipt seals ESO's adjudication of one turn into a hash-chained, append-only record:
 *
 *   payload  = { specVersion, consumerId, traceId, verdict:{level,basis,actor,gaps,score},
 *                eventDigests:[{observationId,event,outcome,at}],
 *                specRef:{doc,version,section} }   ← B0-9, new receipts only
 *   hash     = sha256(canonicalJSON(payload))
 *   prev_hash= hash of the consumer's previous receipt, or GENESIS for the first one
 *   hmac     = HMAC-SHA256(key, prev_hash + hash), key = `${ESO_RECEIPT_KEY}:${consumerId}`
 *              (stored as `null`, honestly, when the key is not configured)
 *
 * The payload names observations; it never copies prompt text, user queries or evidence values,
 * so a receipt can be shared and re-verified without leaking the turn's content.
 */

/** Highest observation limit both stores accept (Memory and BunSql both cap at 500). */
const TRACE_OBSERVATION_LIMIT = 500;

/** The chain sentinel for the first receipt of a consumer. */
export const GENESIS_HASH = RECEIPT_GENESIS_HASH;

/**
 * Deterministic JSON: object keys sorted at every depth, `undefined` dropped, array order kept.
 * The same function runs at issue and at verify, so the hash commits to bytes, not to a map order.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
}

/** `sha256(canonicalJSON(payload))` as lowercase hex. */
export function hashPayload(payload: ReceiptPayload): string {
    return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * The per-consumer HMAC key. The env var is the root secret; the consumer id is mixed in so two
 * consumers cannot replay one another's receipts. Returns `null` when the operator set no key —
 * then the receipt stores `hmac: null` instead of pretending to be signed.
 */
export function receiptKey(consumerId: string, env: NodeJS.ProcessEnv = process.env): string | null {
    const base = typeof env.ESO_RECEIPT_KEY === 'string' ? env.ESO_RECEIPT_KEY.trim() : '';
    return base ? `${base}:${consumerId}` : null;
}

/** HMAC over `prev_hash + hash`; `null` when no key is configured. */
export function receiptHmac(key: string | null, prevHash: string, hash: string): string | null {
    if (!key) return null;
    return createHmac('sha256', key).update(prevHash + hash).digest('hex');
}

function secureEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

function isoAt(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    return String(value ?? '');
}

/** The only verdict fields the payload commits to (no ruleRefs, no receiptId, no computedAt). */
function verdictSummary(verdict: TurnVerdict): ReceiptVerdictSummary {
    return {
        level: verdict.level,
        basis: verdict.basis,
        actor: verdict.actor ?? null,
        gaps: [...(verdict.gaps ?? [])]
            .map((gap) => ({ code: gap.code, what: gap.what, consequence: gap.consequence }))
            .sort((left, right) => left.code.localeCompare(right.code)),
        score: verdict.score,
    };
}

/** Observation references only: no `evidence`, no prompt text, no query. */
function eventDigests(rows: ReadonlyArray<any>, traceId: string): ReceiptEventDigest[] {
    return rows
        .filter((row) => String(row?.trace_id ?? row?.traceId ?? '') === traceId)
        .map((row) => ({
            observationId: String(row?.observation_id ?? row?.observationId ?? ''),
            event: String(row?.event ?? ''),
            outcome: row?.outcome === null || row?.outcome === undefined ? null : String(row.outcome),
            at: isoAt(row?.at ?? row?.received_at ?? row?.receivedAt),
        }))
        .sort((left, right) => left.at.localeCompare(right.at) || left.observationId.localeCompare(right.observationId));
}

function parseEvidenceRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string') {
        try {
            return parseEvidenceRecord(JSON.parse(value));
        } catch {
            return null;
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

/** S5 — extract server-verified sources from `evidence.verified` observations, sorted deterministically. */
function verifiedSources(rows: ReadonlyArray<any>, traceId: string): ReceiptEvidenceSource[] {
    const out: ReceiptEvidenceSource[] = [];
    for (const row of rows) {
        if (String(row?.trace_id ?? row?.traceId ?? '') !== traceId) continue;
        if (String(row?.event ?? '') !== 'evidence.verified') continue;
        const evidence = parseEvidenceRecord(row?.evidence);
        if (!evidence || !Array.isArray(evidence.sources)) continue;
        const fallbackAt = typeof evidence.verifiedAt === 'string' && evidence.verifiedAt.trim()
            ? evidence.verifiedAt.trim()
            : isoAt(row?.at ?? row?.received_at ?? row?.receivedAt);
        for (const entry of evidence.sources) {
            const source = parseEvidenceRecord(entry);
            if (!source) continue;
            const where = String(source.where ?? source.id ?? '').trim();
            if (!where) continue;
            out.push({
                requirementId: typeof source.requirementId === 'string' && source.requirementId.trim()
                    ? source.requirementId.trim()
                    : null,
                where,
                hash: typeof source.hash === 'string' && source.hash.trim() ? source.hash.trim() : null,
                verifiedAt: typeof source.verifiedAt === 'string' && source.verifiedAt.trim()
                    ? source.verifiedAt.trim()
                    : fallbackAt,
                verified: Boolean(source.verified),
            });
        }
    }
    return out.sort(
        (left, right) =>
            (left.requirementId ?? '').localeCompare(right.requirementId ?? '')
            || left.where.localeCompare(right.where)
            || left.verifiedAt.localeCompare(right.verifiedAt)
            || (left.hash ?? '').localeCompare(right.hash ?? '')
            || Number(left.verified) - Number(right.verified)
    );
}

/** Build the canonical payload from a stored verdict plus the raw observations of its trace. */
export function buildReceiptPayload(
    consumerId: string,
    traceId: string,
    verdict: TurnVerdict,
    observations: ReadonlyArray<any>
): ReceiptPayload {
    return {
        specVersion: RECEIPT_SPEC_VERSION,
        consumerId,
        traceId,
        verdict: verdictSummary(verdict),
        eventDigests: eventDigests(observations, traceId),
        // B0-9 — a new receipt commits to the normative spec it was adjudicated against. The
        // reference only: no spec prose is sealed, and the doc is never read at runtime.
        specRef: specRefOf(REQUEST_SPEC_REF),
        // S5 — server-verified evidence sources sealed into v2+ receipts.
        sources: verifiedSources(observations, traceId),
    };
}

/** Project the shared constant onto the sealed shape (`anchor` is UI-only, never hashed). */
function specRefOf(ref: typeof REQUEST_SPEC_REF): ReceiptSpecRef {
    return { doc: ref.doc, version: ref.version, section: ref.section };
}

export class ReceiptService {
    private readonly verdict: VerdictService;

    constructor(private readonly store: PlatformStore, verdict?: VerdictService) {
        this.verdict = verdict ?? new VerdictService(store);
    }

    /**
     * Issue-or-get: a trace has at most one receipt, so a repeated call returns the stored row
     * instead of forking the chain. The verdict is the stored adjudication (P2), never recomputed.
     */
    async issue(consumerId: string, traceId: string): Promise<EvidenceReceipt> {
        const id = assertConsumerId(consumerId);
        const trace = typeof traceId === 'string' ? traceId.trim() : '';
        if (!trace) throw new PlatformError('NOT_FOUND', 'Request not found: empty request id');

        const existing = await this.store.getReceiptByTrace(id, trace);
        if (existing) return existing;

        const verdict = await this.verdict.ensureVerdict(id, trace);
        const observations = await this.store.listObservations(id, TRACE_OBSERVATION_LIMIT);
        const payload = buildReceiptPayload(id, trace, verdict, observations);

        const previous = await this.store.getLastReceipt(id);
        const prevHash = previous?.hash ?? GENESIS_HASH;
        const hash = hashPayload(payload);
        const hmac = receiptHmac(receiptKey(id), prevHash, hash);

        return this.store.insertReceipt({
            receiptId: `rcpt_${randomUUID()}`,
            consumerId: id,
            traceId: trace,
            prevHash,
            hash,
            hmac,
            specVersion: RECEIPT_SPEC_VERSION,
            verdictLevel: verdict.level,
            payload,
            createdAt: new Date().toISOString(),
        });
    }

    /**
     * Recompute the hash from the sealed payload and compare. The HMAC is checked over the stored
     * `prev_hash + hash`, so tampering with either the payload or the hash itself is caught.
     * `chained` checks the link to the consumer's chain, order-independently, and rejects forks:
     * exactly one genesis root and at most one successor per receipt.
     */
    async verify(consumerId: string, receiptId: string): Promise<ReceiptVerification> {
        const id = assertConsumerId(consumerId);
        const receipt = await this.store.getReceipt(id, String(receiptId ?? '').trim());
        if (!receipt) throw new PlatformError('NOT_FOUND', `Receipt not found: ${receiptId}`);

        const hashMatches = hashPayload(receipt.payload) === receipt.hash;
        const key = receiptKey(id);
        const hmacMatches = key
            ? receipt.hmac !== null && secureEqual(receiptHmac(key, receipt.prevHash, receipt.hash) ?? '', receipt.hmac)
            : receipt.hmac === null;
        const chained = await this.isChained(id, receipt);

        return {
            ok: hashMatches && hmacMatches && chained,
            hashMatches,
            hmacMatches,
            chained,
        };
    }

    private async isChained(consumerId: string, receipt: EvidenceReceipt): Promise<boolean> {
        const chain = (await this.store.listReceipts(consumerId))
            .filter((row) => row.receiptId !== receipt.receiptId);
        const isGenesis = receipt.prevHash === GENESIS_HASH;
        const linked = isGenesis
            ? chain.every((row) => row.prevHash !== GENESIS_HASH)
            : chain.some((row) => row.hash === receipt.prevHash);
        const forked = chain.filter((row) => row.prevHash === receipt.hash).length > 1;
        return linked && !forked;
    }
}
