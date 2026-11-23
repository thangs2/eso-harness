import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId } from '../../platform/registry/store.js';

/**
 * F-28 · REQ-36 · US-36 · AC-36 — evidence ingest from a host adapter (push-only).
 *
 * Contract (`D-118`, `D-119`):
 *   `POST /v1/ingest/events` with a batch of `eso.event.v1` envelopes, HTTP `202`, body
 *   `{accepted, duplicate, rejected, events[]}`. `event_id` is the idempotency key; a repeat is a
 *   `duplicate` and appends nothing. `received_at` is created by ESO, never by the host.
 *
 * The ledger is append-only: the port exposes `appendBatch` + `list` only, records are frozen on
 * write, and a batch is validated before anything is written (AC-36-3: no partial write).
 *
 * Persistence note: `c_<id>.evidence_event` + `ingest_receipt` DDL is not part of this slice — the
 * `EvidenceLedger` port is the seam the route/DB owner wires. The in-memory ledger is the
 * service-level implementation used by the AC tests.
 */

/** The only envelope version ESO accepts today (`D-118`). */
export const INGEST_SCHEMA = 'eso.event.v1';

/** Registered envelope versions. Unknown values are rejected as `UNKNOWN_SCHEMA`. */
export const INGEST_SCHEMAS: ReadonlySet<string> = new Set([INGEST_SCHEMA]);

/** Batch/body limits must be declared in the contract (`F-28` §5). */
export const INGEST_LIMITS = {
    /** Max events per batch. */
    maxEvents: 500,
    /** Max serialized request body, bytes. */
    maxBytes: 1_048_576,
    /** Max serialized `payload` of one event, bytes. */
    maxEventBytes: 65_536,
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `occurred_at` may not be in the future; allow a small host clock skew. */
const FUTURE_SKEW_MS = 60_000;

export interface EvidenceRecord {
    consumerId: string;
    eventId: string;
    schema: string;
    kind: string;
    occurredAt: string;
    receivedAt: string;
    payload: unknown;
    provenance: unknown;
    redaction: unknown;
}

export interface AppendedRecord {
    record: EvidenceRecord;
    /** `false` when the `event_id` was already in the ledger (duplicate). */
    created: boolean;
}

export interface IngestedEvent {
    /** Envelope id, echoed in the response so an adapter can reconcile its spool. */
    event_id: string;
    /** ESO acceptance time (or the original acceptance time for a duplicate). */
    received_at: string;
    duplicate: boolean;
}

export interface IngestResult {
    accepted: number;
    duplicate: number;
    /** Batch validation is atomic, so a 202 never carries a rejected item. */
    rejected: never[];
    events: IngestedEvent[];
}

/** Append-only port. There is deliberately no update/delete member. */
export interface EvidenceLedger {
    appendBatch(records: ReadonlyArray<EvidenceRecord>): Promise<AppendedRecord[]>;
    list(consumerId: string): Promise<EvidenceRecord[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, max = 512): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new PlatformError('INVALID_EVENT', `${field} is required`);
    if (text.length > max) throw new PlatformError('INVALID_EVENT', `${field} must be at most ${max} characters`);
    return text;
}

function freezeDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        value.forEach(freezeDeep);
        return Object.freeze(value) as T;
    }
    if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(freezeDeep);
        return Object.freeze(value) as T;
    }
    return value;
}

/**
 * Service-level ledger: atomic per batch, idempotent per `(consumerId, event_id)`, append-only.
 */
export class InMemoryEvidenceLedger implements EvidenceLedger {
    private readonly records = new Map<string, EvidenceRecord[]>();
    private readonly byKey = new Map<string, EvidenceRecord>();

    async appendBatch(records: ReadonlyArray<EvidenceRecord>): Promise<AppendedRecord[]> {
        const appended: AppendedRecord[] = [];
        const pending: EvidenceRecord[] = [];
        for (const record of records) {
            const key = `${record.consumerId}\u0000${record.eventId}`;
            const existing = this.byKey.get(key);
            if (existing) {
                appended.push({ record: freezeDeep({ ...existing }), created: false });
                continue;
            }
            const frozen = freezeDeep({ ...record });
            this.byKey.set(key, frozen);
            pending.push(frozen);
            appended.push({ record: frozen, created: true });
        }
        const byConsumer = new Map<string, EvidenceRecord[]>();
        for (const record of pending) {
            const rows = byConsumer.get(record.consumerId) ?? [];
            rows.push(record);
            byConsumer.set(record.consumerId, rows);
        }
        for (const [consumerId, rows] of byConsumer) {
            this.records.set(consumerId, [...(this.records.get(consumerId) ?? []), ...rows]);
        }
        return appended;
    }

    async list(consumerId: string): Promise<EvidenceRecord[]> {
        return (this.records.get(consumerId) ?? []).map((record) => freezeDeep({ ...record }));
    }
}

export class EvidenceIngestService {
    constructor(private readonly ledger: EvidenceLedger = new InMemoryEvidenceLedger()) {}

    /**
     * Validate the whole batch first, then append atomically.
     *
     * Order: size (`PAYLOAD_TOO_LARGE`, 413) before schema (`UNKNOWN_SCHEMA`, 400) so an oversized
     * body is never parsed envelope-by-envelope.
     */
    async ingest(consumerId: string, body: unknown): Promise<IngestResult> {
        const id = assertConsumerId(consumerId);

        if (!isRecord(body)) throw new PlatformError('INVALID_EVENT', 'body must be an object');
        const events = body.events;
        if (!Array.isArray(events)) throw new PlatformError('INVALID_EVENT', 'events must be an array');
        if (events.length === 0) throw new PlatformError('INVALID_EVENT', 'events must not be empty');

        const bytes = Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8');
        if (bytes > INGEST_LIMITS.maxBytes) {
            throw new PlatformError('PAYLOAD_TOO_LARGE', `body is ${bytes} bytes; limit is ${INGEST_LIMITS.maxBytes}`);
        }
        if (events.length > INGEST_LIMITS.maxEvents) {
            throw new PlatformError('PAYLOAD_TOO_LARGE', `batch has ${events.length} events; limit is ${INGEST_LIMITS.maxEvents}`);
        }

        const envelopeSchema = body.schema;
        if (envelopeSchema !== undefined && !INGEST_SCHEMAS.has(String(envelopeSchema))) {
            throw new PlatformError('UNKNOWN_SCHEMA', `schema is not registered: ${String(envelopeSchema)}`);
        }
        const hasEventSchema = events.every((event) => isRecord(event) && event.schema !== undefined);
        if (envelopeSchema === undefined && !hasEventSchema) {
            throw new PlatformError('UNKNOWN_SCHEMA', 'schema is required on the batch or on every event');
        }

        const receivedAt = new Date().toISOString();
        const drafts = events.map((event, index) => this.normalize(id, event, index, envelopeSchema, receivedAt));
        const appended = await this.ledger.appendBatch(drafts);

        return {
            accepted: appended.filter((entry) => entry.created).length,
            duplicate: appended.filter((entry) => !entry.created).length,
            rejected: [],
            events: appended.map((entry) => ({
                event_id: entry.record.eventId,
                received_at: entry.record.receivedAt,
                duplicate: !entry.created,
            })),
        };
    }

    /** Ledger read for the route/tests; append-only, newest last. */
    async records(consumerId: string): Promise<EvidenceRecord[]> {
        return this.ledger.list(assertConsumerId(consumerId));
    }

    private normalize(
        consumerId: string,
        raw: unknown,
        index: number,
        envelopeSchema: unknown,
        receivedAt: string,
    ): EvidenceRecord {
        if (!isRecord(raw)) throw new PlatformError('INVALID_EVENT', `events[${index}] must be an object`);

        const schemaRaw = raw.schema ?? envelopeSchema;
        if (schemaRaw === undefined) throw new PlatformError('UNKNOWN_SCHEMA', `events[${index}].schema is required`);
        const schema = String(schemaRaw);
        if (!INGEST_SCHEMAS.has(schema)) {
            throw new PlatformError('UNKNOWN_SCHEMA', `events[${index}].schema is not registered: ${schema}`);
        }

        const eventId = requiredText(raw.event_id, `events[${index}].event_id`, 64);
        if (!UUID_PATTERN.test(eventId)) {
            throw new PlatformError('INVALID_EVENT', `events[${index}].event_id must be a UUID`);
        }

        const occurredRaw = requiredText(raw.occurred_at, `events[${index}].occurred_at`, 64);
        const occurredMs = Date.parse(occurredRaw);
        if (Number.isNaN(occurredMs)) {
            throw new PlatformError('INVALID_EVENT', `events[${index}].occurred_at must be an ISO timestamp`);
        }
        if (occurredMs > Date.now() + FUTURE_SKEW_MS) {
            throw new PlatformError('INVALID_EVENT', `events[${index}].occurred_at must not be in the future`);
        }

        const kind = requiredText(raw.kind, `events[${index}].kind`, 128);

        let payload: unknown = raw.payload ?? {};
        if (!isRecord(payload) && !Array.isArray(payload)) {
            throw new PlatformError('INVALID_EVENT', `events[${index}].payload must be an object or array`);
        }
        const payloadBytes = Buffer.byteLength(JSON.stringify(payload) ?? '', 'utf8');
        if (payloadBytes > INGEST_LIMITS.maxEventBytes) {
            throw new PlatformError(
                'PAYLOAD_TOO_LARGE',
                `events[${index}].payload is ${payloadBytes} bytes; limit is ${INGEST_LIMITS.maxEventBytes}`,
            );
        }

        return {
            consumerId,
            eventId,
            schema,
            kind,
            occurredAt: new Date(occurredMs).toISOString(),
            receivedAt,
            payload,
            provenance: raw.provenance ?? {},
            redaction: raw.redaction ?? { applied: true },
        };
    }
}
