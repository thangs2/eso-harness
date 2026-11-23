/**
 * AC-51 — risk acceptance có hạn + expire khi đọc.
 * Pin modules/debt/domain/debt.ts (acceptRisk / inspectRiskStatus).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptRisk, inspectRiskStatus } from '../src/modules/debt/domain/debt.js';

const codeOf = (fn: () => unknown): string => {
    try { fn(); } catch (error) { return String((error as { code?: string }).code ?? (error as Error).message); }
    return 'NO_ERROR';
};

const openRisk = { id: 'risk-1', kind: 'generic', status: 'open' };
const now = '2026-11-23T00:00:00.000Z';
const hourLater = '2026-11-23T01:00:00.000Z';

describe('AC-51 — debt accept/inspect', () => {
    test('AC-51-1 · accept có due tương lai ⇒ accepted + event + remaining', () => {
        const events: any[] = [];
        const result = acceptRisk({ risk: openRisk, by: 'A-01', due: hourLater, now, eventsLog: events });
        assert.equal(result.status, 'accepted');
        assert.equal(result.accepted_by, 'A-01');
        assert.equal(result.remaining_ms, 3600000);
        assert.equal(events.length, 1);
        assert.equal(events[0].event, 'accepted');
    });

    test('AC-51-2 · thiếu due ⇒ ACCEPT_NO_DUE', () => {
        assert.equal(codeOf(() => acceptRisk({ risk: openRisk, by: 'A-01', due: '', now })), 'ACCEPT_NO_DUE');
    });

    test('AC-51-2 · due đã qua ⇒ EXPIRED_DUE_DATE', () => {
        assert.equal(codeOf(() => acceptRisk({ risk: openRisk, by: 'A-01', due: '2026-11-22T00:00:00.000Z', now })), 'EXPIRED_DUE_DATE');
    });

    test('AC-51-3 · kind ngoài quyền ⇒ FORBIDDEN_ACCEPT + audit', () => {
        const events: any[] = [];
        const code = codeOf(() => acceptRisk({
            risk: { ...openRisk, kind: 'security' }, by: 'A-01', due: hourLater, role: 'dev',
            allowedKindsForRole: ['generic'], now, eventsLog: events,
        }));
        assert.equal(code, 'FORBIDDEN_ACCEPT');
        assert.equal(events[0].event, 'accept_refused_rbac');
    });

    test('AC-51-4 · accept lần hai ⇒ ALREADY_ACCEPTED, assignee giữ', () => {
        const accepted = acceptRisk({ risk: openRisk, by: 'A-01', due: hourLater, now });
        assert.equal(codeOf(() => acceptRisk({ risk: accepted, by: 'A-02', due: hourLater, now })), 'ALREADY_ACCEPTED');
        assert.equal(accepted.accepted_by, 'A-01');
    });

    test('AC-51-5 · tại due còn accepted; quá due ⇒ expired + event', () => {
        const accepted = acceptRisk({ risk: openRisk, by: 'A-01', due: hourLater, now });
        const atDue = inspectRiskStatus({ risk: accepted, now: hourLater });
        assert.equal(atDue.status, 'accepted');
        assert.equal(atDue.remaining_ms, 0);
        const events: any[] = [];
        const late = inspectRiskStatus({ risk: accepted, now: '2026-11-23T02:00:00.000Z', eventsLog: events });
        assert.equal(late.status, 'expired');
        assert.equal(events.length, 1);
        assert.equal(events[0].event, 'expired');
    });
});
