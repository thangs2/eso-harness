import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type {
    TurnVerdict,
    TurnVerdictGap,
    TurnVerdictLevel,
    TurnVerdictRuleRef,
} from '../../platform/registry/types.js';

/**
 * P2 — verdict & sufficiency core.
 *
 * ESO does not trust the host's claim: it reads the observations of one trace and adjudicates the
 * claim against the evidence contract (P1). The result is append-only (`platform.turn_verdict`) and
 * names every gap as `{code, what, consequence}` — ESO never invents a reason the trace cannot
 * support.
 *
 * Rules (in priority order):
 *   - any `decision.recorded` with verdict `deny`  ⇒ `deny`
 *   - no `decision.recorded` at all                ⇒ `unknown` + gap `HOST_SILENT`
 *   - `decision.recorded.verdict === 'unknown'`    ⇒ `unknown`
 *   - `decision.recorded.verdict === 'partial'`    ⇒ `partial`
 *   - otherwise (claim `allow`)                    ⇒ `allow` unless a proof is missing:
 *       evidence.packet missing ⇒ `partial` + `EVIDENCE_MISSING`
 *       actor missing           ⇒ `partial` + `ACTOR_MISSING`
 *       action.recorded missing ⇒ `partial` + `ACTION_MISSING`
 *
 * Score = max(0, 100 - 25 * gaps.length).
 */

export interface VerdictObservation {
    event?: unknown;
    evidence?: unknown;
    [key: string]: unknown;
}

export interface AdjudicationResult {
    level: TurnVerdictLevel;
    basis: string;
    actor: Record<string, unknown> | null;
    gaps: TurnVerdictGap[];
    score: number;
    ruleRefs: TurnVerdictRuleRef[];
}

/** The proof gaps ESO can name. Each carries the consequence for the reader, not just a code. */
export const VERDICT_GAPS: Readonly<Record<string, Readonly<TurnVerdictGap>>> = Object.freeze({
    HOST_SILENT: Object.freeze({
        code: 'HOST_SILENT',
        what: 'no decision.recorded observation in this trace',
        consequence: 'cannot prove why the turn proceeded',
    }),
    EVIDENCE_MISSING: Object.freeze({
        code: 'EVIDENCE_MISSING',
        what: 'no evidence.packet observation in this trace',
        consequence: 'the claim has no evidence packet to verify it against',
    }),
    ACTOR_MISSING: Object.freeze({
        code: 'ACTOR_MISSING',
        what: 'no actor { kind, id } on any contract observation',
        consequence: 'cannot attribute the turn to a role or identity',
    }),
    ACTION_MISSING: Object.freeze({
        code: 'ACTION_MISSING',
        what: 'no action.recorded observation carrying a tool',
        consequence: 'cannot confirm what the host actually did',
    }),
});

interface ObservationView {
    kind: string;
    evidence: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string') {
        try {
            return asRecord(JSON.parse(value));
        } catch {
            return null;
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function observationView(event: VerdictObservation): ObservationView {
    return {
        kind: typeof event?.event === 'string' ? event.event : '',
        evidence: asRecord(event?.evidence) ?? {},
    };
}

/** Actor is only accepted with a non-empty id; kind/role are carried through untouched. */
function actorFrom(evidences: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> | null {
    for (const evidence of evidences) {
        const actor = asRecord(evidence.actor);
        if (actor && typeof actor.id === 'string' && actor.id.trim()) return { ...actor };
    }
    return null;
}

/** References the host cited as its rule/basis; unknown fields are dropped, never invented. */
function ruleRefsFrom(evidences: ReadonlyArray<Record<string, unknown>>): TurnVerdictRuleRef[] {
    const refs: TurnVerdictRuleRef[] = [];
    const seen = new Set<string>();
    for (const evidence of evidences) {
        if (!Array.isArray(evidence.refs)) continue;
        for (const entry of evidence.refs) {
            const ref = asRecord(entry);
            if (!ref || typeof ref.kind !== 'string' || !ref.kind.trim()) continue;
            const mapped: TurnVerdictRuleRef = { kind: ref.kind };
            if (typeof ref.path === 'string' && ref.path.trim()) mapped.path = ref.path;
            if (typeof ref.line === 'number' && Number.isFinite(ref.line)) mapped.line = ref.line;
            const key = JSON.stringify(mapped);
            if (seen.has(key)) continue;
            seen.add(key);
            refs.push(mapped);
        }
    }
    return refs;
}

function basisFor(claim: string, evidence: Record<string, unknown>): string {
    const basis = typeof evidence.basis === 'string' && evidence.basis.trim()
        ? evidence.basis.trim()
        : 'no basis recorded by host';
    return `claim=${claim}: ${basis}`;
}

function scoreFor(gaps: ReadonlyArray<TurnVerdictGap>): number {
    return Math.max(0, 100 - 25 * gaps.length);
}

function gap(code: keyof typeof VERDICT_GAPS): TurnVerdictGap {
    return { ...VERDICT_GAPS[code] };
}

function hasToolAction(observations: ReadonlyArray<ObservationView>): boolean {
    return observations.some((item) => item.kind === 'action.recorded'
        && typeof item.evidence.tool === 'string'
        && item.evidence.tool.trim().length > 0);
}

/**
 * Pure adjudication over the observations of one trace. Never reads the store, never throws for
 * missing data — a missing proof is a gap, not an error.
 */
export function adjudicate(consumerId: string, events: ReadonlyArray<VerdictObservation>): AdjudicationResult {
    void consumerId; // rules are global today; kept in the signature for per-consumer rule packs.
    const observations = (Array.isArray(events) ? events : []).map(observationView);
    const decisionEvidences = observations
        .filter((item) => item.kind === 'decision.recorded')
        .map((item) => item.evidence);
    const allEvidences = observations.map((item) => item.evidence);
    const actor = actorFrom(decisionEvidences) ?? actorFrom(allEvidences);
    const ruleRefs = ruleRefsFrom(decisionEvidences);

    const denied = decisionEvidences.find((evidence) => evidence.verdict === 'deny');
    if (denied) {
        return {
            level: 'deny',
            basis: basisFor('deny', denied),
            actor,
            gaps: [],
            score: scoreFor([]),
            ruleRefs,
        };
    }

    if (decisionEvidences.length === 0) {
        const gaps = [gap('HOST_SILENT')];
        return {
            level: 'unknown',
            basis: 'claim=none: no decision.recorded observation in this trace',
            actor,
            gaps,
            score: scoreFor(gaps),
            ruleRefs: [],
        };
    }

    const unknownClaim = decisionEvidences.find((evidence) => evidence.verdict === 'unknown');
    if (unknownClaim) {
        return {
            level: 'unknown',
            basis: basisFor('unknown', unknownClaim),
            actor,
            gaps: [],
            score: scoreFor([]),
            ruleRefs,
        };
    }

    const partialClaim = decisionEvidences.find((evidence) => evidence.verdict === 'partial');
    if (partialClaim) {
        return {
            level: 'partial',
            basis: basisFor('partial', partialClaim),
            actor,
            gaps: [],
            score: scoreFor([]),
            ruleRefs,
        };
    }

    // Claim is allow: ESO only sustains it when the three proofs are present.
    const claim = decisionEvidences[decisionEvidences.length - 1];
    const gaps: TurnVerdictGap[] = [];
    if (!observations.some((item) => item.kind === 'evidence.packet')) gaps.push(gap('EVIDENCE_MISSING'));
    if (!actor) gaps.push(gap('ACTOR_MISSING'));
    if (!hasToolAction(observations)) gaps.push(gap('ACTION_MISSING'));
    return {
        level: gaps.length === 0 ? 'allow' : 'partial',
        basis: basisFor('allow', claim),
        actor,
        gaps,
        score: scoreFor(gaps),
        ruleRefs,
    };
}

/** Highest observation limit both stores accept (Memory and BunSql both cap at 500). */
const TRACE_OBSERVATION_LIMIT = 500;

export class VerdictService {
    constructor(private readonly store: PlatformStore) {}

    /**
     * Idempotent: the stored row wins. Otherwise compute from the trace observations, append once,
     * and return the row the store kept (a concurrent writer may have won the insert).
     */
    async ensureVerdict(consumerId: string, traceId: string): Promise<TurnVerdict> {
        const id = assertConsumerId(consumerId);
        const trace = typeof traceId === 'string' ? traceId.trim() : '';
        if (!trace) throw new PlatformError('NOT_FOUND', 'Request not found: empty request id');

        const consumer = await this.store.getConsumer(id);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);

        const stored = await this.store.getTurnVerdict(id, trace);
        if (stored) return stored;

        const rows = await this.store.listObservations(id, TRACE_OBSERVATION_LIMIT);
        const traceRows = rows.filter((row) => String(row?.trace_id ?? row?.traceId ?? '') === trace);
        if (traceRows.length === 0) throw new PlatformError('NOT_FOUND', `Request not found: ${trace}`);

        const result = adjudicate(id, traceRows.map((row) => ({ event: row?.event, evidence: row?.evidence })));
        return this.store.insertTurnVerdict({
            traceId: trace,
            consumerId: id,
            ...result,
            receiptId: null,
            computedAt: new Date().toISOString(),
        });
    }
}
