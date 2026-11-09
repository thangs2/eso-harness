import type { PlatformStore } from '../../registry/store.js';
import type { ConsumerEvent } from '../../registry/types.js';
import { assertConsumerId } from '../../registry/store.js';
import { fail } from '../../registry/errors.js';

/**
 * L1.3 — event read API (append-only).
 *
 * The read model exposes exactly one operation: list. AC-14-3 is enforced by the absence of a
 * route: `resolveEventRoute('DELETE', …)` returns a not-found result and never reaches the store.
 */
export const EVENT_LIST_PATH = '/api/v1/consumers/:id/events';

export interface EventRouteMatch {
    kind: 'list' | 'not_found';
    consumerId?: string;
    status?: number;
    code?: string;
}

const LIST_ROUTE = /^\/api\/v1\/consumers\/([^/]+)\/events$/;

export function resolveEventRoute(method: string, path: string): EventRouteMatch {
    const verb = String(method || '').toUpperCase();
    const match = LIST_ROUTE.exec(String(path || ''));
    if (verb === 'GET' && match) {
        return { kind: 'list', consumerId: decodeURIComponent(match[1]) };
    }
    // DELETE/PUT/PATCH on the timeline are not registered: 404 with a registered code.
    if (match) return { kind: 'not_found', status: 404, code: 'CONSUMER_NOT_FOUND' };
    return { kind: 'not_found', status: 404, code: 'CONSUMER_NOT_FOUND' };
}

export class EventReader {
    constructor(private readonly store: PlatformStore) {}

    async list(consumerId: string, limit = 100): Promise<ConsumerEvent[]> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
        return this.store.listEvents(id, safeLimit);
    }

    /** AC-14-1 helper: the read side never mutates the event it returns. */
    async timeline(consumerId: string): Promise<{ consumerId: string; events: ConsumerEvent[] }> {
        return { consumerId, events: await this.list(consumerId) };
    }
}

/** The read surface is intentionally frozen: no append/update/delete member. */
export const EVENT_READ_API = Object.freeze(['list', 'timeline'] as const);
