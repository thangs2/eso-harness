import { PlatformError } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

/**
 * Observation ingest (P2).
 *
 * ESO is observability only: hosts append immutable observations (what happened on the host) and
 * ESO stores/lists them. There is no run/execution/claim/step state here.
 */

export const OBSERVATION_RUNTIME_KEY_PATTERN = /^[^:\s]+:[^:\s]+$/;

export interface ObservationActor {
    kind?: string;
    hostId?: string;
    runtimeId?: string;
    consumerId?: string;
}

function requiredText(value: unknown, field: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new PlatformError('OBSERVATION_INVALID', `${field} is required`);
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
    constructor(private readonly store: PlatformStore) {}

    async ingest(consumerId: string, body: any, actor: ObservationActor = {}): Promise<any> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        const traceId = requiredText(body?.traceId, 'traceId');
        const hostId = requiredText(body?.hostId, 'hostId');
        const runtimeKey = requiredText(body?.runtimeKey, 'runtimeKey');
        const event = requiredText(body?.event, 'event');
        if (!OBSERVATION_RUNTIME_KEY_PATTERN.test(runtimeKey)) {
            throw new PlatformError('OBSERVATION_INVALID', 'runtimeKey must be hostId:runtimeId');
        }
        if (!runtimeKey.startsWith(`${hostId}:`)) {
            throw new PlatformError('OBSERVATION_INVALID', 'runtimeKey must match hostId');
        }
        if (actor?.kind === 'host') {
            if (actor.consumerId !== id) throw new PlatformError('AUTH_INVALID', 'Host token consumer scope mismatch');
            if (`${actor.hostId}:${actor.runtimeId}` !== runtimeKey) {
                throw new PlatformError('AUTH_INVALID', 'Host token runtime scope mismatch');
            }
        }
        const evidence = body?.evidence === undefined ? {} : body.evidence;
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
            throw new PlatformError('OBSERVATION_INVALID', 'evidence must be an object');
        }
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
            outcome: body?.outcome === undefined || body?.outcome === null || body?.outcome === '' ? null : String(body.outcome),
            evidence,
            at: isoOrNull(body?.at),
            idempotencyKey,
        });
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
