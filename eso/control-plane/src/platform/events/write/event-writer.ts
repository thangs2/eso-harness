import type { PlatformStore } from '../../registry/store.js';
import type { Actor, ConsumerEvent, ConsumerStatus } from '../../registry/types.js';
import { assertConsumerId } from '../../registry/store.js';
import { fail } from '../../registry/errors.js';

/**
 * L1.2 — event store write path.
 *
 * Append-only: there is no update/delete function here by design. Every lifecycle write is
 * `status change + event` in one transaction, so a failure leaves neither half behind.
 */
export const EVENT_TYPES = [
    'created',
    'updated',
    'retired',
    'reactivated',
    'deleted',
    'restored',
    'purged',
    'materialized',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface WriteEventInput {
    consumerId: string;
    eventType: EventType;
    actor: Actor;
    at?: string;
    detail?: Record<string, unknown>;
}

export class EventWriter {
    constructor(private readonly store: PlatformStore) {}

    async append(input: WriteEventInput): Promise<ConsumerEvent> {
        const consumerId = assertConsumerId(input.consumerId);
        if (!EVENT_TYPES.includes(input.eventType)) {
            fail('INVALID_STATE', `unknown event type: ${input.eventType}`);
        }
        return this.store.appendEvent({
            consumerId,
            eventType: input.eventType,
            actorKind: input.actor.kind,
            actorLabel: input.actor.label || null,
            at: input.at ?? new Date().toISOString(),
            detail: input.detail ?? {},
        });
    }

    /**
     * The one write path used by lifecycle slices: status and event share a transaction.
     * Returns the event so the caller can expose its id/timestamp.
     */
    async transition(
        consumerId: string,
        nextStatus: ConsumerStatus,
        eventType: EventType,
        actor: Actor,
        options: { at?: string; detail?: Record<string, unknown> } = {}
    ): Promise<ConsumerEvent> {
        const id = assertConsumerId(consumerId);
        const at = options.at ?? new Date().toISOString();
        return this.store.transaction(async (tx) => {
            const current = await tx.getConsumer(id);
            if (!current) fail('CONSUMER_NOT_FOUND');
            if (current.status === 'purged') fail('CONSUMER_NOT_FOUND');
            await tx.updateConsumer(id, { status: nextStatus, updatedAt: at });
            return tx.appendEvent({
                consumerId: id,
                eventType,
                actorKind: actor.kind,
                actorLabel: actor.label || null,
                at,
                detail: options.detail ?? {},
            });
        });
    }

    async list(consumerId: string, limit = 100): Promise<ConsumerEvent[]> {
        return this.store.listEvents(assertConsumerId(consumerId), limit);
    }
}
