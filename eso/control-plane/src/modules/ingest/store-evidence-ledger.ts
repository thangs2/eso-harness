/**
 * BUG-46 — store-backed implementation of the `EvidenceLedger` port.
 *
 * The port is the seam `EvidenceIngestService` was written against; this adapter is the only
 * production implementation. It writes through `PlatformStore.appendEvidence`, so a batch survives
 * a restart and the `/ingest/events` route and the `/evidence` route share one table.
 *
 * Append-only: the adapter only implements `appendBatch` + `list`; there is no update/delete.
 */
import type { AppendedRecord, EvidenceLedger, EvidenceRecord } from './ingest.service.js';
import type { EvidenceRow, EvidenceWrite, PlatformStore } from '../../platform/registry/store.js';

function iso(value: string | Date | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function toWrite(record: EvidenceRecord): EvidenceWrite {
    return {
        evidenceId: record.eventId,
        origin: 'ingest',
        schema: record.schema,
        kind: record.kind,
        occurredAt: record.occurredAt,
        receivedAt: record.receivedAt,
        payload: record.payload,
        provenance: record.provenance,
        redaction: record.redaction,
    };
}

function fromRow(consumerId: string, row: EvidenceRow): EvidenceRecord {
    const receivedAt = iso(row.received_at) ?? new Date().toISOString();
    return {
        consumerId,
        eventId: row.evidence_id,
        schema: row.schema ?? '',
        kind: row.kind,
        occurredAt: iso(row.occurred_at) ?? receivedAt,
        receivedAt,
        payload: row.payload ?? {},
        provenance: row.provenance ?? {},
        redaction: row.redaction ?? {},
    };
}

export class StoreEvidenceLedger implements EvidenceLedger {
    constructor(private readonly store: PlatformStore) {}

    async appendBatch(records: ReadonlyArray<EvidenceRecord>): Promise<AppendedRecord[]> {
        const appended: AppendedRecord[] = new Array(records.length);
        const byConsumer = new Map<string, number[]>();
        records.forEach((record, index) => {
            const indexes = byConsumer.get(record.consumerId) ?? [];
            indexes.push(index);
            byConsumer.set(record.consumerId, indexes);
        });
        for (const [consumerId, indexes] of byConsumer) {
            const rows = await this.store.appendEvidence(
                consumerId,
                indexes.map((index) => toWrite(records[index]))
            );
            rows.forEach((entry, position) => {
                appended[indexes[position]] = {
                    record: freezeDeep(fromRow(consumerId, entry.record)),
                    created: entry.created,
                };
            });
        }
        return appended;
    }

    async list(consumerId: string): Promise<EvidenceRecord[]> {
        const rows = await this.store.listEvidence(consumerId, { origin: 'ingest' });
        return rows.map((row) => freezeDeep(fromRow(consumerId, row)));
    }
}
