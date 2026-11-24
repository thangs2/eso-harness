/**
 * Platform registry types — the shape of `platform.consumer` / `platform.consumer_event`.
 *
 * Source of truth: sdlc/07.technical/10.planes/03.plane-d-data-model.md §2.
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
    /** BUG-45: bounded list. Defaults to 100, capped at 500. */
    limit?: number;
    offset?: number;
}

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

/** Normalize a list window so no caller can ask for an unbounded consumer list. */
export function normalizeListWindow(
    options: Pick<ListConsumersOptions, 'limit' | 'offset'> = {}
): { limit: number; offset: number } {
    const rawLimit = Number(options.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
    const rawOffset = Number(options.offset);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    return { limit, offset };
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

export type StackVersionStatus = 'draft' | 'published' | 'retired';

/**
 * Vision test V2 — the surfaces telemetry counts. `surface.*` is a page/screen open;
 * `raw.*` is raw evidence (JSON) opened in the UI. Raw JSON opened in a terminal or host
 * transcript is outside ESO's observation and is deliberately not modelled.
 */
export const UI_SURFACES = [
    'surface.observatory.open',
    'surface.events.open',
    'surface.request.open',
    'raw.evidence.expand',
    'raw.json.copy',
] as const;

export type UiSurface = (typeof UI_SURFACES)[number];

export const UI_SURFACE_SET: ReadonlySet<string> = new Set(UI_SURFACES);

/** One append-only UI surface view (`platform.ui_event`). */
export interface UiEvent {
    consumerId: string;
    surface: UiSurface;
    session: string | null;
    at: string;
}

export interface UiEventQuery {
    from?: string | null;
    to?: string | null;
    consumerId?: string | null;
}

export interface StackVersionRecord {
    consumerId: string;
    version: number;
    status: StackVersionStatus;
    layers: unknown[];
    publishedAt: string | null;
    createdAt: string;
}
