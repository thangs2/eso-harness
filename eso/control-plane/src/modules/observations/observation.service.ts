import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import { EvidencePredicateService } from '../judgment/evidence-predicate.service.js';
import { validateObservedEvent } from './event-contract.js';

/**
 * Observation ingest (P2).
 *
 * ESO is observability only: hosts append immutable observations (what happened on the host) and
 * ESO stores/lists them. There is no run/execution/claim/step state here.
 */

export const OBSERVATION_RUNTIME_KEY_PATTERN = /^[^:\s]+:[^:\s]+$/;
export const OBSERVATION_EVENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

/** Field/size limits for observation ingest (R7b). */
export const OBSERVATION_LIMITS = {
    eventMax: 128,
    outcomeMax: 64,
    traceIdMax: 200,
    idMax: 128,
    evidenceMaxBytes: 32768,
} as const;

export interface ObservationActor {
    kind?: string;
    hostId?: string;
    runtimeId?: string;
    consumerId?: string;
}

function requiredText(value: unknown, field: string, max?: number): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new PlatformError('OBSERVATION_INVALID', `${field} is required`);
    if (max !== undefined && text.length > max) {
        throw new PlatformError('OBSERVATION_INVALID', `${field} must be at most ${max} characters`);
    }
    return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new PlatformError('OBSERVATION_INVALID', `${field} must be a string`);
    const text = value.trim();
    if (!text) return null;
    if (text.length > max) throw new PlatformError('OBSERVATION_INVALID', `${field} must be at most ${max} characters`);
    return text;
}

function jsonOf(value: unknown, fallback: any): any {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value ?? fallback;
}

function isoOrNull(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new PlatformError('OBSERVATION_INVALID', 'at must be an ISO timestamp');
    return date.toISOString();
}

function observationDto(row: any): any {
    return {
        observationId: row.observation_id ?? row.observationId,
        traceId: row.trace_id ?? row.traceId,
        hostId: row.host_id ?? row.hostId,
        runtimeKey: row.runtime_key ?? row.runtimeKey,
        workerId: row.worker_id ?? row.workerId ?? null,
        event: row.event,
        outcome: row.outcome ?? null,
        evidence: jsonOf(row.evidence, {}),
        at: row.at ?? null,
        idempotencyKey: row.idempotency_key ?? row.idempotencyKey,
        receivedAt: row.received_at ?? row.receivedAt ?? null,
    };
}

export class ObservationService {
    private readonly predicate: EvidencePredicateService;

    constructor(private readonly store: PlatformStore, predicate?: EvidencePredicateService) {
        this.predicate = predicate ?? new EvidencePredicateService(store);
    }

    async ingest(consumerId: string, body: any, actor: ObservationActor = {}): Promise<any> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        const traceId = requiredText(body?.traceId, 'traceId', OBSERVATION_LIMITS.traceIdMax);
        const hostId = requiredText(body?.hostId, 'hostId', OBSERVATION_LIMITS.idMax);
        const runtimeKey = requiredText(body?.runtimeKey, 'runtimeKey', OBSERVATION_LIMITS.idMax);
        const event = requiredText(body?.event, 'event', OBSERVATION_LIMITS.eventMax);
        if (!OBSERVATION_EVENT_PATTERN.test(event)) {
            throw new PlatformError('OBSERVATION_INVALID', 'event must match [a-zA-Z0-9._-]+');
        }
        if (!OBSERVATION_RUNTIME_KEY_PATTERN.test(runtimeKey)) {
            throw new PlatformError('OBSERVATION_INVALID', 'runtimeKey must be hostId:runtimeId');
        }
        if (!runtimeKey.startsWith(`${hostId}:`)) {
            throw new PlatformError('OBSERVATION_INVALID', 'runtimeKey must match hostId');
        }
        const outcome = optionalText(body?.outcome, 'outcome', OBSERVATION_LIMITS.outcomeMax);
        if (actor?.kind === 'host') {
            if (actor.consumerId !== id) throw new PlatformError('AUTH_INVALID', 'Host token consumer scope mismatch');
            if (`${actor.hostId}:${actor.runtimeId}` !== runtimeKey) {
                throw new PlatformError('AUTH_INVALID', 'Host token runtime scope mismatch');
            }
        }
        const evidence = body?.evidence === undefined ? {} : body.evidence;
        if (!evidence || typeof evidence !== 'object') {
            throw new PlatformError('OBSERVATION_INVALID', 'evidence must be a JSON object or array');
        }
        const evidenceBytes = Buffer.byteLength(JSON.stringify(evidence), 'utf8');
        if (evidenceBytes > OBSERVATION_LIMITS.evidenceMaxBytes) {
            throw new PlatformError('OBSERVATION_INVALID', `evidence must be at most ${OBSERVATION_LIMITS.evidenceMaxBytes} bytes`);
        }
        // P1 event contract: validated in place, never rewritten — evidence keeps actor/schemaVersion.
        validateObservedEvent(event, evidence);
        const observationId = String(body?.observationId || '').trim()
            || `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const idempotencyKey = String(body?.idempotencyKey || '').trim() || observationId;
        const { observation, created } = await this.store.insertObservation(id, {
            observationId,
            traceId,
            hostId,
            runtimeKey,
            workerId: body?.workerId === undefined || body?.workerId === null || body?.workerId === '' ? null : String(body.workerId),
            event,
            outcome,
            evidence,
            at: isoOrNull(body?.at),
            idempotencyKey,
        });

        // S2 — server-side evidence predicate verification at ingest time.
        // CRITICAL INVARIANT: ingest NEVER rejects an evidence.packet because verification failed.
        // The host's observation is already persisted; verification only appends an internal
        // `evidence.verified` observation when Option A applies.
        if (created && event === 'evidence.packet') {
            try {
                const verification = await this.predicate.verifyPacket(id, evidence);
                if (verification.checked) {
                    const packetObservationId = String(observation?.observation_id ?? observation?.observationId ?? observationId);
                    await this.store.insertObservation(id, {
                        observationId: `${packetObservationId}:verified`,
                        traceId,
                        hostId: 'eso',
                        runtimeKey: 'eso:predicate-verifier',
                        workerId: null,
                        event: 'evidence.verified',
                        outcome: verification.allVerified ? 'verified' : 'unverified',
                        evidence: {
                            actor: { kind: 'eso', id: 'predicate-verifier' },
                            packetObservationId,
                            allVerified: verification.allVerified,
                            snapshotId: verification.snapshotId,
                            verifiedAt: verification.verifiedAt,
                            sources: verification.sources,
                        },
                        at: verification.verifiedAt,
                        idempotencyKey: `${idempotencyKey}:verified`,
                    });
                }
            } catch {
                // Never crash observation ingest if verification encounters unexpected I/O or store issues.
            }
        }

        return { ok: true, created, observation: observationDto(observation) };
    }

    async list(consumerId: string, limit?: number): Promise<any> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        const rows = await this.store.listObservations(id, Number(limit) || 100);
        return { items: rows.map(observationDto) };
    }
}
