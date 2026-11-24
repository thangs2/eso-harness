/**
 * Vision test V2 — telemetry service + append-only `platform.ui_event` store.
 *
 * Unit tests: surface validation (unknown ⇒ INVALID_STATE 422), append-only recording,
 * summary counts, ratio (0 when the denominator is 0) and window/consumer filtering.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js';

function fixture() {
    const store = new MemoryPlatformStore();
    return { store, service: new TelemetryService(store) };
}

describe('V2 telemetry — record', () => {
    test('records a surface view with consumer + session; every call appends', async () => {
        const { store, service } = fixture();
        const first = await service.record({
            surface: 'surface.observatory.open',
            consumerId: 'acme',
            session: 'page-session-1',
        });
        assert.equal(first.consumerId, 'acme');
        assert.equal(first.surface, 'surface.observatory.open');
        assert.equal(first.session, 'page-session-1');
        assert.equal(Number.isNaN(Date.parse(first.at)), false);

        await service.record({ surface: 'surface.observatory.open', consumerId: 'acme' });
        const rows = await store.listUiEvents();
        assert.equal(rows.length, 2);
        assert.equal(rows[0].session, 'page-session-1');
        assert.equal(rows[1].session, null);
    });

    test('consumerId is optional and session defaults to null', async () => {
        const { service } = fixture();
        const event = await service.record({ surface: 'raw.evidence.expand' });
        assert.equal(event.consumerId, '');
        assert.equal(event.session, null);
    });

    test('unknown / missing surface ⇒ INVALID_STATE 422', async () => {
        const { service } = fixture();
        for (const surface of ['surface.nope', 'raw.evidence.open', '', undefined]) {
            await assert.rejects(
                () => service.record({ surface }),
                (error: any) => error.code === 'INVALID_STATE' && error.status === 422,
            );
        }
    });

    test('malformed consumerId is rejected instead of stored', async () => {
        const { service } = fixture();
        await assert.rejects(
            () => service.record({ surface: 'surface.events.open', consumerId: 'Not A Consumer' }),
            (error: any) => error.code === 'INVALID_CONSUMER_ID',
        );
    });

    test('platform DDL creates platform.ui_event', async () => {
        const { store, service } = fixture();
        await (store as any).ensurePlatformSchema();
        assert.match(store.ddlLog!.join('\n'), /CREATE TABLE IF NOT EXISTS platform\.ui_event\b/);
        const event = await service.record({ surface: 'surface.request.open' });
        assert.equal(event.surface, 'surface.request.open');
    });
});

describe('V2 telemetry — summary', () => {
    test('counts surface vs raw views and computes the ratio', async () => {
        const { service } = fixture();
        await service.record({ surface: 'surface.observatory.open', consumerId: 'acme' });
        await service.record({ surface: 'surface.events.open', consumerId: 'acme' });
        await service.record({ surface: 'surface.request.open', consumerId: 'acme' });
        await service.record({ surface: 'raw.evidence.expand', consumerId: 'acme' });

        const summary = await service.summary({});
        assert.equal(summary.surface_views, 3);
        assert.equal(summary.raw_views, 1);
        assert.equal(summary.ratio, 0.75);
        assert.equal(summary.bySurface['surface.observatory.open'], 1);
        assert.equal(summary.bySurface['surface.events.open'], 1);
        assert.equal(summary.bySurface['surface.request.open'], 1);
        assert.equal(summary.bySurface['raw.evidence.expand'], 1);
        // The copy event has no UI button yet, so it is present in the enum but never counted.
        assert.equal(summary.bySurface['raw.json.copy'], 0);
    });

    test('empty window ⇒ ratio 0, not 1 or NaN', async () => {
        const { service } = fixture();
        const summary = await service.summary({});
        assert.equal(summary.surface_views, 0);
        assert.equal(summary.raw_views, 0);
        assert.equal(summary.ratio, 0);
    });

    test('filters by consumer and by from/to window', async () => {
        const { store, service } = fixture();
        await store.recordUiEvent({
            consumerId: 'acme', surface: 'surface.events.open', session: null,
            at: '2026-11-01T00:00:00.000Z',
        });
        await store.recordUiEvent({
            consumerId: 'acme', surface: 'raw.evidence.expand', session: null,
            at: '2026-11-10T00:00:00.000Z',
        });
        await store.recordUiEvent({
            consumerId: 'other', surface: 'surface.events.open', session: null,
            at: '2026-11-10T00:00:00.000Z',
        });

        const acme = await service.summary({ consumerId: 'acme' });
        assert.equal(acme.surface_views, 1);
        assert.equal(acme.raw_views, 1);

        const window = await service.summary({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z' });
        assert.equal(window.surface_views, 1);
        assert.equal(window.raw_views, 1);

        const early = await service.summary({ to: '2026-11-02T00:00:00.000Z' });
        assert.equal(early.surface_views, 1);
        assert.equal(early.raw_views, 0);
        assert.equal(early.ratio, 1);
    });

    test('malformed from/to ⇒ INVALID_STATE 422', async () => {
        const { service } = fixture();
        await assert.rejects(
            () => service.summary({ from: 'yesterday' }),
            (error: any) => error.code === 'INVALID_STATE' && error.status === 422,
        );
    });
});
