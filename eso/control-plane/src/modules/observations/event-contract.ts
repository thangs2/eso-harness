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
