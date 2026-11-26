/**
 * Platform registry types — the shape of `platform.consumer` / `platform.consumer_event`.
 *
 * Source of truth: sdlc/07.technical/10.planes/03.plane-d-data-model.md §2.
 * This module is the L1.1 slice; later slices add behaviour around the same record.
 */

export type ConsumerStatus =
    | 'ready'
    | 'retired'
    | 'deleted'
    | 'purged'
    | 'error';

export type ActorKind = 'operator' | 'machine' | 'system';

export interface Actor {
    kind: ActorKind;
    label: string;
}

export interface ConsumerRecord {
    id: string;
    name: string;
    root: string;
    sdlcRoot: string | null;
    schemaName: string;
    status: ConsumerStatus;
    version: number;
    storageMode: 'schema';
    materializedHash: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ConsumerEvent {
    id?: number;
    consumerId: string;
    eventType: string;
    actorKind: ActorKind;
    actorLabel: string | null;
    at: string;
    detail: Record<string, unknown>;
}

export interface CreateConsumerInput {
    id: string;
    name: string;
    root: string;
    sdlcRoot?: string | null;
    actor: Actor;
    now?: string;
}

export interface ListConsumersOptions {
    includeDeleted?: boolean;
    status?: ConsumerStatus | null;
    /** BUG-45: bounded list. Defaults to 100, capped at 500. */
    limit?: number;
    offset?: number;
}

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

/** Normalize a list window so no caller can ask for an unbounded consumer list. */
export function normalizeListWindow(
    options: Pick<ListConsumersOptions, 'limit' | 'offset'> = {}
): { limit: number; offset: number } {
    const rawLimit = Number(options.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
    const rawOffset = Number(options.offset);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    return { limit, offset };
}

export const CONSUMER_STATUSES: ReadonlySet<string> = new Set([
    'ready',
    'retired',
    'deleted',
    'purged',
    'error',
]);

export const ACTOR_KINDS: ReadonlySet<string> = new Set([
    'operator',
    'machine',
    'system',
]);

export type StackVersionStatus = 'draft' | 'published' | 'retired';

/**
 * Vision test V2 — the surfaces telemetry counts. `surface.*` is a page/screen open;
 * `raw.*` is raw evidence (JSON) opened in the UI. Raw JSON opened in a terminal or host
 * transcript is outside ESO's observation and is deliberately not modelled.
 */
export const UI_SURFACES = [
    'surface.observatory.open',
    'surface.events.open',
    'surface.request.open',
    'raw.evidence.expand',
    'raw.json.copy',
] as const;

export type UiSurface = (typeof UI_SURFACES)[number];

export const UI_SURFACE_SET: ReadonlySet<string> = new Set(UI_SURFACES);

/** One append-only UI surface view (`platform.ui_event`). */
export interface UiEvent {
    consumerId: string;
    surface: UiSurface;
    session: string | null;
    at: string;
}

export interface UiEventQuery {
    from?: string | null;
    to?: string | null;
    consumerId?: string | null;
}

export interface StackVersionRecord {
    consumerId: string;
    version: number;
    status: StackVersionStatus;
    layers: unknown[];
    publishedAt: string | null;
    createdAt: string;
}

/** P2 — the four levels ESO can adjudicate for a turn. */
export const TURN_VERDICT_LEVELS = ['allow', 'deny', 'partial', 'unknown'] as const;
export type TurnVerdictLevel = (typeof TURN_VERDICT_LEVELS)[number];

/** One proof gap: what ESO could not establish, and why it matters. */
export interface TurnVerdictGap {
    code: string;
    what: string;
    consequence: string;
}

/** A reference the host cited as the rule/basis of its decision. */
export interface TurnVerdictRuleRef {
    kind: string;
    path?: string;
    line?: number;
    [key: string]: unknown;
}

/** Adjudicated claim of one trace (`platform.turn_verdict`, append-only, 1 row / trace). */
export interface TurnVerdict {
    traceId: string;
    consumerId: string;
    level: TurnVerdictLevel;
    basis: string;
    actor: Record<string, unknown> | null;
    gaps: TurnVerdictGap[];
    score: number;
    ruleRefs: TurnVerdictRuleRef[];
    receiptId: string | null;
    computedAt: string;
}

/**
 * Q2 — one recorded file-write scope decision (`platform.scope_decision`, append-only).
 *
 * A row is written only when the caller supplied a trace id; a check without a trace cannot be
 * attributed to a turn and is deliberately not recorded. `code`/`message` mirror the domain
 * refusal (null when allowed), and `actor` is stored verbatim as jsonb.
 */
export interface ScopeDecision {
    decisionId: string;
    consumerId: string;
    traceId: string | null;
    target: string;
    allowed: boolean;
    code: string | null;
    message: string | null;
    actor: Record<string, unknown> | null;
    at: string;
}

/** P4 — the sealed spec version of a receipt payload. Bumping it changes the hashed bytes. */
export const RECEIPT_SPEC_VERSION = 2;

/** Chain sentinel: the first receipt of a consumer has no predecessor hash. */
export const RECEIPT_GENESIS_HASH = 'GENESIS';

/**
 * B0-9 (option C) — the normative page spec a request detail points at. ESO references the
 * document; it never copies its prose into code or into a UI string.
 *
 * `version` MUST equal the doc's `sot_doc_version`: `qc/eso-request-spec-ref.test.mjs` reads the
 * file and fails on drift. Nothing reads `sdlc/` at runtime — that tree is not shipped in images,
 * so this constant is the only runtime copy and it must be bumped together with the doc.
 */
export const REQUEST_SPEC_REF = {
    doc: 'sdlc/08.ui-design/20.pages/20.request-detail.md',
    version: '3.2.0',
    section: '§6 Behavior spec',
    anchor: '#6-behavior-spec-std-page-behavior-1',
} as const;

/** The spec-ref fields a receipt seals. `anchor` is a UI convenience and stays out of the hashed bytes. */
export interface ReceiptSpecRef {
    doc: string;
    version: string;
    section: string;
}

/**
 * P4 — the only verdict fields a receipt seals. `ruleRefs`, `receiptId` and `computedAt` are
 * deliberately excluded: they are either derived later or would make the payload self-referential.
 */
export interface ReceiptVerdictSummary {
    level: TurnVerdictLevel;
    basis: string;
    actor: Record<string, unknown> | null;
    gaps: TurnVerdictGap[];
    score: number;
}

/**
 * P4 — one observation reference. It names the raw observation; it never copies prompt text or
 * evidence values, so a receipt can be shared without leaking the turn's content.
 */
export interface ReceiptEventDigest {
    observationId: string;
    event: string;
    outcome: string | null;
    at: string;
}

/** S5 — one server-verified evidence source sealed into a v2+ receipt. */
export interface ReceiptEvidenceSource {
    requirementId: string | null;
    where: string;
    hash: string | null;
    verifiedAt: string;
    verified: boolean;
}

/** P4 — the canonical bytes a receipt hash commits to (see `receipt.service.ts`). */
export interface ReceiptPayload {
    specVersion: number;
    consumerId: string;
    traceId: string;
    verdict: ReceiptVerdictSummary;
    eventDigests: ReceiptEventDigest[];
    /**
     * B0-9 — set on receipts issued after the spec reference existed. Optional by design: payloads
     * sealed earlier have no such key, and verification recomputes the hash from the stored bytes.
     */
    specRef?: ReceiptSpecRef;
    /**
     * S5 — server-verified evidence sources extracted from `evidence.verified` observations
     * (specVersion >= 2). Optional on ReceiptPayload so v1 receipts verify unchanged.
     */
    sources?: ReceiptEvidenceSource[];
}

/** One sealed receipt (`platform.evidence_receipt`, append-only, 1 row / trace). */
export interface EvidenceReceipt {
    receiptId: string;
    consumerId: string;
    traceId: string;
    prevHash: string;
    hash: string;
    hmac: string | null;
    specVersion: number;
    verdictLevel: TurnVerdictLevel;
    payload: ReceiptPayload;
    createdAt: string;
}

/**
 * P4 — verification result. `hmacMatches` is honest about capability: with no key configured it is
 * only true when the receipt was stored with `hmac: null`.
 */
export interface ReceiptVerification {
    ok: boolean;
    hashMatches: boolean;
    hmacMatches: boolean;
    chained: boolean;
}
