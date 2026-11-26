import { PlatformError } from '../../platform/registry/errors.js';

/**
 * P1 — observed event contract v1.
 *
 * Hosts append *observed* events. This module validates the three payload shapes the revamp
 * pipeline reads (`decision.recorded`, `action.recorded`, `evidence.packet`) inside the
 * `evidence` JSONB object. It never stores, mutates or invents data: validation only, so the
 * observation log stays the raw record of what the host claimed.
 *
 * Unknown event kinds pass through untouched — the observation log predates this contract and
 * must keep accepting every event a host already sends.
 */

export const SCHEMA_VERSION = 1;

export const CONTRACT_EVENT_KINDS = ['decision.recorded', 'action.recorded', 'evidence.packet'] as const;
export type ContractEventKind = (typeof CONTRACT_EVENT_KINDS)[number];

export const DECISION_VERDICTS = ['allow', 'deny', 'partial', 'unknown'] as const;
export type DecisionVerdict = (typeof DECISION_VERDICTS)[number];

/** P6a — host-reported preflight bucket on a decision (B0-1). */
export const PREFLIGHT_STATES = ['HOT', 'WARM', 'COLD'] as const;
export type PreflightState = (typeof PREFLIGHT_STATES)[number];

/** P6a — host-reported brain tier on a decision (B0-6). */
export const BRAIN_TIERS = ['zero', 'flash', 'pro'] as const;
export type BrainTier = (typeof BRAIN_TIERS)[number];

/**
 * P8 — JEV (judgment evidence verification) the host reports on its own decision (B0-3).
 *
 * The host states the mode it ran, whether observation consent was granted, and — whenever the
 * mode is not `off` — the confidence the band was derived from. ESO does not take the band on
 * trust: `jev.service.adjudicateReported` recomputes it from the consumer's thresholds.
 */
export const JEV_MODES = ['off', 'shadow', 'active'] as const;
export type JevMode = (typeof JEV_MODES)[number];

export const JEV_BANDS = ['auto', 'confirm', 'open'] as const;
export type JevBand = (typeof JEV_BANDS)[number];

export const JEV_DECISIONS = ['auto', 'confirm', 'ask', 'observe'] as const;
export type JevDecisionKind = (typeof JEV_DECISIONS)[number];

export interface DecisionJev {
    mode: JevMode;
    consent: boolean;
    /** Required by the contract whenever `mode !== 'off'` — the band is never guessed. */
    confidence?: number;
    band?: JevBand;
    decision?: JevDecisionKind;
    reason?: string;
}

export const ACTION_OUTCOMES = ['PASS', 'FAIL', 'BLOCKED'] as const;
export type ActionOutcome = (typeof ACTION_OUTCOMES)[number];

export const ACTOR_KINDS = ['host', 'operator', 'agent'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface EvidenceRef {
    kind: string;
    path?: string;
    line?: number;
}

export interface EvidenceActor {
    kind: ActorKind;
    id: string;
    role?: string;
}

/**
 * P6a — optional host-reported signals on `decision.recorded`. Absent keys stay absent: the
 * contract never defaults them, so a detail can tell "not reported" from "reported as X".
 */
export interface DecisionPreflightSignal {
    state: PreflightState;
    fingerprint?: string;
}

export interface DecisionReconSignal {
    adapter: string;
    calls: number;
}

export interface DecisionDistillSignal {
    memorySaved: boolean;
    lessons?: number;
}

export interface DecisionEvidence {
    winner: string;
    verdict: DecisionVerdict;
    basis: string;
    jevMode?: string;
    latencyMs?: number;
    refs?: EvidenceRef[];
    hil?: boolean;
    actor?: EvidenceActor;
    schemaVersion?: number;
    /** P6a — B0-1: preflight bucket (and optional fingerprint) the host actually ran. */
    preflight?: DecisionPreflightSignal;
    /** P6a — B0-4: recon adapter calls the host actually made. */
    recon?: DecisionReconSignal[];
    /** P6a — B0-6: brain tier the host actually routed through. */
    brainTier?: BrainTier;
    /** P6a — B0-8: whether distillation saved a memory. */
    distill?: DecisionDistillSignal;
    /** P8 — B0-3: the JEV mode/band the host ran, adjudicated (not trusted) by ESO. */
    jev?: DecisionJev;
}

export interface ActionEvidence {
    tool: string;
    outcome: ActionOutcome;
    files?: string[];
    readBeforeEdit?: boolean;
    diffRef?: string;
    actor?: EvidenceActor;
    schemaVersion?: number;
}

export interface EvidencePacketItem {
    id: string;
    kind: string;
    hash?: string;
    requirementId?: string;
}

export interface EvidencePacketEvidence {
    items?: EvidencePacketItem[];
    hash?: string;
    specVersion?: string | number;
    actor?: EvidenceActor;
    schemaVersion?: number;
}

export interface EventValidationResult {
    ok: true;
}

/**
 * `SCHEMA_UNSUPPORTED` is not (yet) in `ERROR_STATUS`; a `PlatformError` would refuse the code.
 * This local error carries the same `code`/`status` fields the HTTP envelope maps, so the
 * contract can reject a newer host without touching the shared error registry.
 */
export class SchemaUnsupportedError extends PlatformError {
    constructor(detail: string) {
        super('SCHEMA_UNSUPPORTED', detail);
        this.message = `Unsupported observation schema: ${detail}`;
        this.name = 'SchemaUnsupportedError';
    }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isContractEventKind(event: string): event is ContractEventKind {
    return (CONTRACT_EVENT_KINDS as readonly string[]).includes(event);
}

/** Coded `OBSERVATION_INVALID` whose detail *and* message name the offending field. */
function invalid(detail: string): never {
    const error = new PlatformError('OBSERVATION_INVALID', detail);
    error.message = `${error.message}: ${detail}`;
    throw error;
}

function asObject(value: unknown, field: string): UnknownRecord {
    if (!isRecord(value)) invalid(`${field} must be an object`);
    return value as UnknownRecord;
}

function hasValue(value: unknown): boolean {
    return value !== undefined && value !== null;
}

function requiredString(object: UnknownRecord, key: string, field: string): string {
    const value = object[key];
    if (typeof value !== 'string' || !value.trim()) {
        invalid(`${field}.${key} is required (non-empty string)`);
    }
    return value.trim();
}

function optionalString(object: UnknownRecord, key: string, field: string): void {
    if (!hasValue(object[key])) return;
    const value = object[key];
    if (typeof value !== 'string' || !value.trim()) {
        invalid(`${field}.${key} must be a non-empty string`);
    }
}

function optionalBoolean(object: UnknownRecord, key: string, field: string): void {
    if (!hasValue(object[key])) return;
    if (typeof object[key] !== 'boolean') invalid(`${field}.${key} must be a boolean`);
}

function optionalNumber(object: UnknownRecord, key: string, field: string, options: { integer?: boolean; min?: number } = {}): void {
    if (!hasValue(object[key])) return;
    const value = object[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalid(`${field}.${key} must be a number`);
    }
    if (options.integer && !Number.isInteger(value)) {
        invalid(`${field}.${key} must be an integer`);
    }
    if (options.min !== undefined && value < options.min) {
        invalid(`${field}.${key} must be >= ${options.min}`);
    }
}

function optionalStringArray(object: UnknownRecord, key: string, field: string): void {
    if (!hasValue(object[key])) return;
    const value = object[key];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
        invalid(`${field}.${key} must be an array of non-empty strings`);
    }
}

function requiredNumber(object: UnknownRecord, key: string, field: string, options: { integer?: boolean; min?: number } = {}): void {
    if (!hasValue(object[key])) invalid(`${field}.${key} is required (number)`);
    optionalNumber(object, key, field, options);
}

function optionalEnum(object: UnknownRecord, key: string, field: string, allowed: readonly string[]): void {
    if (!hasValue(object[key])) return;
    const value = object[key];
    if (typeof value !== 'string' || !allowed.includes(value)) {
        invalid(`${field}.${key} must be one of ${allowed.join('|')}`);
    }
}

function validateSchemaVersionAndActor(evidence: UnknownRecord): void {
    if (hasValue(evidence.schemaVersion)) {
        const version = evidence.schemaVersion;
        if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
            invalid('evidence.schemaVersion must be an integer >= 1');
        }
        if (version > SCHEMA_VERSION) {
            throw new SchemaUnsupportedError(`evidence.schemaVersion ${version} exceeds ${SCHEMA_VERSION}`);
        }
    }
    if (hasValue(evidence.actor)) {
        const actor = asObject(evidence.actor, 'evidence.actor');
        if (typeof actor.kind !== 'string' || !(ACTOR_KINDS as readonly string[]).includes(actor.kind)) {
            invalid(`evidence.actor.kind must be one of ${ACTOR_KINDS.join('|')}`);
        }
        if (typeof actor.id !== 'string' || !actor.id.trim()) {
            invalid('evidence.actor.id is required (non-empty string)');
        }
        optionalString(actor, 'role', 'evidence.actor');
    }
}

function validateDecisionSignals(evidence: UnknownRecord): void {
    if (hasValue(evidence.preflight)) {
        const preflight = asObject(evidence.preflight, 'evidence.preflight');
        if (typeof preflight.state !== 'string' || !(PREFLIGHT_STATES as readonly string[]).includes(preflight.state)) {
            invalid(`evidence.preflight.state must be one of ${PREFLIGHT_STATES.join('|')}`);
        }
        optionalString(preflight, 'fingerprint', 'evidence.preflight');
    }
    if (hasValue(evidence.recon)) {
        if (!Array.isArray(evidence.recon)) invalid('evidence.recon must be an array');
        evidence.recon.forEach((entry, index) => {
            const call = asObject(entry, `evidence.recon[${index}]`);
            requiredString(call, 'adapter', `evidence.recon[${index}]`);
            requiredNumber(call, 'calls', `evidence.recon[${index}]`, { integer: true, min: 0 });
        });
    }
    optionalEnum(evidence, 'brainTier', 'evidence', BRAIN_TIERS);
    if (hasValue(evidence.distill)) {
        const distill = asObject(evidence.distill, 'evidence.distill');
        if (typeof distill.memorySaved !== 'boolean') {
            invalid('evidence.distill.memorySaved must be a boolean');
        }
        optionalNumber(distill, 'lessons', 'evidence.distill', { integer: true, min: 0 });
    }
}

/**
 * `JEV_CONFIDENCE_REQUIRED` is a contract error of its own (not `OBSERVATION_INVALID`): the
 * payload shape is right, the JEV report is simply unverifiable without the confidence behind
 * the band. Registered in `ERROR_STATUS`/`BRD_ERROR_CODES`, so the envelope maps it to 422.
 */
function jevConfidenceRequired(detail: string): never {
    const error = new PlatformError('JEV_CONFIDENCE_REQUIRED', detail);
    error.message = `${error.message}: ${detail}`;
    throw error;
}

/** P8 — validate the optional `evidence.jev` block of `decision.recorded`. */
function validateJev(value: unknown): void {
    const field = 'evidence.jev';
    const jev = asObject(value, field);
    if (typeof jev.mode !== 'string' || !(JEV_MODES as readonly string[]).includes(jev.mode)) {
        invalid(`${field}.mode must be one of ${JEV_MODES.join('|')}`);
    }
    if (typeof jev.consent !== 'boolean') invalid(`${field}.consent must be a boolean`);
    if (hasValue(jev.confidence)) {
        const confidence = jev.confidence;
        if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
            invalid(`${field}.confidence must be a number`);
        }
        if (confidence < 0 || confidence > 1) invalid(`${field}.confidence must be between 0 and 1`);
    }
    // B0-3: a shadow/active report without its confidence cannot be adjudicated — refuse it
    // instead of inventing a band. `off` stays valid with no JEV confidence at all.
    if (jev.mode !== 'off' && !hasValue(jev.confidence)) {
        jevConfidenceRequired(`${field}.confidence is required when mode is ${jev.mode}`);
    }
    optionalEnum(jev, 'band', field, JEV_BANDS);
    optionalEnum(jev, 'decision', field, JEV_DECISIONS);
    optionalString(jev, 'reason', field);
}

function validateDecisionRecorded(evidence: UnknownRecord): void {
    requiredString(evidence, 'winner', 'evidence');
    if (typeof evidence.verdict !== 'string' || !(DECISION_VERDICTS as readonly string[]).includes(evidence.verdict)) {
        invalid(`evidence.verdict must be one of ${DECISION_VERDICTS.join('|')}`);
    }
    requiredString(evidence, 'basis', 'evidence');
    optionalString(evidence, 'jevMode', 'evidence');
    optionalNumber(evidence, 'latencyMs', 'evidence', { min: 0 });
    optionalBoolean(evidence, 'hil', 'evidence');
    if (hasValue(evidence.refs)) {
        if (!Array.isArray(evidence.refs)) invalid('evidence.refs must be an array');
        evidence.refs.forEach((entry, index) => {
            const ref = asObject(entry, `evidence.refs[${index}]`);
            requiredString(ref, 'kind', `evidence.refs[${index}]`);
            optionalString(ref, 'path', `evidence.refs[${index}]`);
            optionalNumber(ref, 'line', `evidence.refs[${index}]`, { integer: true, min: 1 });
        });
    }
    validateDecisionSignals(evidence);
    if (hasValue(evidence.jev)) validateJev(evidence.jev);
}

function validateActionRecorded(evidence: UnknownRecord): void {
    requiredString(evidence, 'tool', 'evidence');
    if (typeof evidence.outcome !== 'string' || !(ACTION_OUTCOMES as readonly string[]).includes(evidence.outcome)) {
        invalid(`evidence.outcome must be one of ${ACTION_OUTCOMES.join('|')}`);
    }
    optionalStringArray(evidence, 'files', 'evidence');
    optionalBoolean(evidence, 'readBeforeEdit', 'evidence');
    optionalString(evidence, 'diffRef', 'evidence');
}

function validateEvidencePacket(evidence: UnknownRecord): void {
    let hasItems = false;
    if (hasValue(evidence.items)) {
        if (!Array.isArray(evidence.items) || evidence.items.length === 0) {
            invalid('evidence.items must be a non-empty array');
        }
        evidence.items.forEach((entry, index) => {
            const item = asObject(entry, `evidence.items[${index}]`);
            requiredString(item, 'id', `evidence.items[${index}]`);
            requiredString(item, 'kind', `evidence.items[${index}]`);
            optionalString(item, 'hash', `evidence.items[${index}]`);
            optionalString(item, 'requirementId', `evidence.items[${index}]`);
        });
        hasItems = true;
    }
    let hasHash = false;
    if (hasValue(evidence.hash)) {
        if (typeof evidence.hash !== 'string' || !evidence.hash.trim()) {
            invalid('evidence.hash must be a non-empty string');
        }
        hasHash = true;
    }
    if (!hasItems && !hasHash) {
        invalid('evidence.packet requires evidence.items (non-empty array) or evidence.hash (string)');
    }
    if (hasValue(evidence.specVersion)) {
        const specVersion = evidence.specVersion;
        const validNumber = typeof specVersion === 'number' && Number.isFinite(specVersion);
        const validString = typeof specVersion === 'string' && Boolean(specVersion.trim());
        if (!validNumber && !validString) invalid('evidence.specVersion must be a non-empty string or a number');
    }
}

/**
 * Validate one observed event against contract v1.
 *
 * @param event the event kind (`body.event`), already pattern-checked by the ingest service.
 * @param evidence the raw `body.evidence` value — validated, never rewritten.
 * @returns `{ ok: true }` when the event is valid, or when the kind is not part of this contract.
 * @throws PlatformError `OBSERVATION_INVALID` (422) naming the missing/invalid field.
 * @throws SchemaUnsupportedError `SCHEMA_UNSUPPORTED` (422) when `schemaVersion > SCHEMA_VERSION`.
 */
export function validateObservedEvent(event: unknown, evidence: unknown): EventValidationResult {
    const kind = typeof event === 'string' ? event : '';
    if (!isContractEventKind(kind)) return { ok: true };
    if (!isRecord(evidence)) invalid(`evidence must be an object for ${kind}`);

    validateSchemaVersionAndActor(evidence);
    switch (kind) {
        case 'decision.recorded':
            validateDecisionRecorded(evidence);
            break;
        case 'action.recorded':
            validateActionRecorded(evidence);
            break;
        case 'evidence.packet':
            validateEvidencePacket(evidence);
            break;
    }
    return { ok: true };
}
