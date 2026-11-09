/**
 * Platform registry types — the shape of `platform.consumer` / `platform.consumer_event`.
 *
 * Source of truth: sdlc/07.technical/10.bootstrap-planes/03.plane-d-data-model.md §2.
 * This module is the L1.1 slice; later slices add behaviour around the same record.
 */

export type ConsumerStatus =
    | 'ready'
    | 'retired'
    | 'deleted'
    | 'purged'
    | 'error';

export type ActorKind = 'operator' | 'machine' | 'system';

export interface Actor {
    kind: ActorKind;
    label: string;
}

export interface ConsumerRecord {
    id: string;
    name: string;
    root: string;
    sdlcRoot: string | null;
    schemaName: string;
    status: ConsumerStatus;
    version: number;
    storageMode: 'schema';
    materializedHash: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ConsumerEvent {
    id?: number;
    consumerId: string;
    eventType: string;
    actorKind: ActorKind;
    actorLabel: string | null;
    at: string;
    detail: Record<string, unknown>;
}

export interface CreateConsumerInput {
    id: string;
    name: string;
    root: string;
    sdlcRoot?: string | null;
    actor: Actor;
    now?: string;
}

export interface ListConsumersOptions {
    includeDeleted?: boolean;
    status?: ConsumerStatus | null;
}

export const CONSUMER_STATUSES: ReadonlySet<string> = new Set([
    'ready',
    'retired',
    'deleted',
    'purged',
    'error',
]);

export const ACTOR_KINDS: ReadonlySet<string> = new Set([
    'operator',
    'machine',
    'system',
]);
