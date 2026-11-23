/**
 * F-11 evidence ledger — append-only records, content-hash bound to a source.
 * No update, no delete: the route layer answers 405; unknown ids answer 404.
 */
import { PlatformError } from '../../platform/registry/errors.js';

export interface EvidenceRecord {
    id: string;
    consumerId: string;
    kind: string;
    contentHash: string;
    sourceHash: string;
    at: string;
}

export class EvidenceLedgerService {
    private readonly rows = new Map<string, EvidenceRecord>();

    private key(consumerId: string, id: string): string {
        return `${consumerId}::${id}`;
    }

    append(consumerId: string, input: { id?: string; kind?: string; contentHash?: string; sourceHash?: string }): EvidenceRecord {
        const id = String(input?.id || '').trim();
        const kind = String(input?.kind || '').trim();
        const contentHash = String(input?.contentHash || '').trim();
        const sourceHash = String(input?.sourceHash || '').trim();
        if (!id || !kind || !contentHash) throw new PlatformError('INVALID_STATE', 'id, kind and contentHash are required');
        if (!sourceHash) throw new PlatformError('INVALID_STATE', 'sourceHash is required');
        if (contentHash !== sourceHash) {
            throw new PlatformError('DOC_CONTRACT_VIOLATION', `contentHash ${contentHash} does not match source ${sourceHash}`);
        }
        const key = this.key(consumerId, id);
        if (this.rows.has(key)) throw new PlatformError('INVALID_STATE', 'evidence id already exists');
        const record: EvidenceRecord = { id, consumerId, kind, contentHash, sourceHash, at: new Date().toISOString() };
        this.rows.set(key, record);
        return record;
    }

    get(consumerId: string, id: string): EvidenceRecord {
        const record = this.rows.get(this.key(consumerId, id));
        if (!record) throw new PlatformError('NOT_FOUND', `evidence ${id} not found`);
        return record;
    }

    list(consumerId: string): EvidenceRecord[] {
        return [...this.rows.values()].filter((row) => row.consumerId === consumerId);
    }

    /** Append-only: the route layer must never call these. */
    update(): never {
        throw new PlatformError('INVALID_STATE', 'evidence ledger is append-only (405)');
    }
}
