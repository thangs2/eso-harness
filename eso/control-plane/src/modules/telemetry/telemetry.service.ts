/**
 * Vision test V2 — "bằng chứng thay cho log thô".
 *
 * Raw evidence is defined as the user opening the JSON evidence panel **in the UI**. A raw JSON
 * opened from a terminal or the host transcript is outside ESO's observation and is not counted.
 * `raw.json.copy` is only valid when the UI actually exposes a copy action; today it does not, so
 * the event stays in the enum but no call site emits it.
 *
 * Telemetry is append-only and deliberately carries no prompt text, evidence payload or PII —
 * only the surface, an optional consumer id and an in-memory page session id.
 */
import { ERROR_MESSAGE } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import {
    UI_SURFACE_SET,
    UI_SURFACES,
    type UiEvent,
    type UiEventQuery,
    type UiSurface,
} from '../../platform/registry/types.js';

export interface TelemetryRecordInput {
    surface?: unknown;
    consumerId?: unknown;
    session?: unknown;
}

export interface TelemetrySummaryQuery {
    from?: unknown;
    to?: unknown;
    consumerId?: unknown;
}

export interface TelemetrySummary {
    surface_views: number;
    raw_views: number;
    /** surface_views / (surface_views + raw_views); 0 when both are 0. */
    ratio: number;
    bySurface: Record<string, number>;
}

/**
 * `INVALID_STATE` is normally a 409 lifecycle conflict, but this contract names an unknown
 * surface / malformed window as 422. The error envelope reads `code` + `status`, so a local error
 * keeps the registry table untouched (same precedent as knowledge retrieval).
 */
class TelemetryStateError extends Error {
    readonly code = 'INVALID_STATE';
    readonly status = 422;
    readonly detail: string;

    constructor(detail: string) {
        super(ERROR_MESSAGE.INVALID_STATE);
        this.name = 'PlatformError';
        this.detail = detail;
    }
}

function invalidState(detail: string): never {
    throw new TelemetryStateError(detail);
}

const SESSION_MAX_LENGTH = 200;

function normalizeConsumerId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return '';
    return assertConsumerId(value.trim());
}

function normalizeSession(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const session = value.trim();
    if (!session) return null;
    return session.slice(0, SESSION_MAX_LENGTH);
}

function normalizeTime(value: unknown, field: 'from' | 'to'): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        invalidState(`${field} must be an ISO-8601 timestamp`);
    }
    return value;
}

export class TelemetryService {
    constructor(private readonly store: PlatformStore) {}

    /** Validate the surface against the enum, then append one row. */
    async record(input: TelemetryRecordInput): Promise<UiEvent> {
        const surface = typeof input.surface === 'string' ? input.surface.trim() : '';
        if (!UI_SURFACE_SET.has(surface)) {
            invalidState(`unknown ui surface: ${surface || '(empty)'}`);
        }
        return this.store.recordUiEvent({
            consumerId: normalizeConsumerId(input.consumerId),
            surface: surface as UiSurface,
            session: normalizeSession(input.session),
            at: new Date().toISOString(),
        });
    }

    /**
     * V2 ratio: share of observed views that were a real surface (vs raw JSON). 0 when nothing
     * was observed in the window — an empty window must not be reported as 1 or as NaN.
     */
    async summary(query: TelemetrySummaryQuery = {}): Promise<TelemetrySummary> {
        const filter: UiEventQuery = {
            from: normalizeTime(query.from, 'from'),
            to: normalizeTime(query.to, 'to'),
            consumerId: query.consumerId ? assertConsumerId(String(query.consumerId).trim()) : null,
        };
        const events = await this.store.listUiEvents(filter);
        const bySurface: Record<string, number> = Object.fromEntries(
            UI_SURFACES.map((surface) => [surface, 0])
        );
        for (const event of events) {
            bySurface[event.surface] = (bySurface[event.surface] ?? 0) + 1;
        }
        const surface_views = Object.entries(bySurface)
            .filter(([surface]) => surface.startsWith('surface.'))
            .reduce((total, [, count]) => total + count, 0);
        const raw_views = Object.entries(bySurface)
            .filter(([surface]) => surface.startsWith('raw.'))
            .reduce((total, [, count]) => total + count, 0);
        const denominator = surface_views + raw_views;
        return {
            surface_views,
            raw_views,
            ratio: denominator === 0 ? 0 : surface_views / denominator,
            bySurface,
        };
    }
}
