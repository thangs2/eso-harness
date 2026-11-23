/**
 * F-11 evidence ledger — append-only records, content-hash bound to a source.
 * No update, no delete: the route layer answers 405; unknown ids answer 404.
 *
 * BUG-46: records live in the same durable `knowledge_evidence` table as `/ingest/events`
 * envelopes (`origin='evidence'` vs `origin='ingest'`), so a control-plane restart keeps them and
 * there is one source of truth. `EvidenceLedgerService` holds no state of its own.
 */
import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId, type EvidenceRow, type PlatformStore } from '../../platform/registry/store.js';

export interface EvidenceRecord {
    id: string;
    consumerId: string;
    kind: string;
    contentHash: string;
    sourceHash: string;
    at: string;
}

function iso(value: string | Date | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toRecord(consumerId: string, row: EvidenceRow): EvidenceRecord {
    const at = iso(row.occurred_at) ?? iso(row.received_at) ?? new Date().toISOString();
    return {
        id: row.evidence_id,
        consumerId,
        kind: row.kind,
        contentHash: row.content_hash ?? '',
        sourceHash: row.source_hash ?? '',
        at,
    };
}

export class EvidenceLedgerService {
    constructor(private readonly store: PlatformStore) {}

    async append(
        consumerId: string,
        input: { id?: string; kind?: string; contentHash?: string; sourceHash?: string }
    ): Promise<EvidenceRecord> {
        const consumer = assertConsumerId(consumerId);
        const id = String(input?.id || '').trim();
        const kind = String(input?.kind || '').trim();
        const contentHash = String(input?.contentHash || '').trim();
        const sourceHash = String(input?.sourceHash || '').trim();
        if (!id || !kind || !contentHash) throw new PlatformError('INVALID_STATE', 'id, kind and contentHash are required');
        if (!sourceHash) throw new PlatformError('INVALID_STATE', 'sourceHash is required');
        if (contentHash !== sourceHash) {
            throw new PlatformError('DOC_CONTRACT_VIOLATION', `contentHash ${contentHash} does not match source ${sourceHash}`);
        }
        const at = new Date().toISOString();
        const [appended] = await this.store.appendEvidence(consumer, [{
            evidenceId: id,
            origin: 'evidence',
            kind,
            contentHash,
            sourceHash,
            occurredAt: at,
            receivedAt: at,
        }]);
        if (!appended?.created) throw new PlatformError('INVALID_STATE', 'evidence id already exists');
        return toRecord(consumer, appended.record);
    }

    async get(consumerId: string, id: string): Promise<EvidenceRecord> {
        const consumer = assertConsumerId(consumerId);
        const row = await this.store.getEvidence(consumer, id, { origin: 'evidence' });
        if (!row) throw new PlatformError('NOT_FOUND', `evidence ${id} not found`);
        return toRecord(consumer, row);
    }

    async list(consumerId: string): Promise<EvidenceRecord[]> {
        const consumer = assertConsumerId(consumerId);
        const rows = await this.store.listEvidence(consumer, { origin: 'evidence' });
        return rows.map((row) => toRecord(consumer, row));
    }

    /** Append-only: the route layer must never call these. */
    update(): never {
        throw new PlatformError('INVALID_STATE', 'evidence ledger is append-only (405)');
    }
}
