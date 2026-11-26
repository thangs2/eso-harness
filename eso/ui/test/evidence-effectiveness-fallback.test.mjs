/**
 * Defect #1 + #2 — the page must not lose server-side proof when a side call fails.
 *
 * #1 (Axis 3): `GET .../requests/:id/receipt` is fetched with `.catch(() => null)`. The trace already
 *     carries `evidence.verified` — ESO's own server-side check of the evidence packet. When the
 *     receipt call fails, Axis 3 went `not-captured` and the composite dropped even though the
 *     verification proof was present on the trace.
 * #2 (BR-18): the same swallowed errors meant `kb-sufficiency-unavailable` could never be reported,
 *     so "Explicit Unknowns" stayed silent about the exact failure it exists to disclose.
 *
 * Run: cd eso/ui && bun test test/evidence-effectiveness-fallback.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildEvidenceEffectivenessView,
    collectExplicitUnknowns,
} from '../apps/control-plane/src/app/features/observatory/pages/request-detail/evidence-effectiveness.selectors.ts';

const VERIFIED_SOURCES = [
    { id: 'AGENTS.md', verified: true, where: 'AGENTS.md', hash: 'a'.repeat(64), verifiedAt: '2026-11-26T13:40:05.215Z' },
    { id: 'package.json', verified: true, where: 'package.json', hash: 'b'.repeat(64), verifiedAt: '2026-11-26T13:40:05.215Z' },
];

/** A trace whose evidence packet ESO itself verified — independent of the receipt fetch. */
function makeDetail({ withVerified = true } = {}) {
    const events = [
        { observationId: 'o1', traceId: 'trace-1', hostId: 'h', runtimeKey: 'k', workerId: 'worker-scout', event: 'prompt.submitted', outcome: 'SUBMITTED', evidence: {}, at: '2026-11-26T13:40:00.000Z' },
        { observationId: 'o2', traceId: 'trace-1', hostId: 'h', runtimeKey: 'k', workerId: 'worker-scout', event: 'evidence.packet', outcome: 'PASS', evidence: { actor: { id: 'worker-scout', kind: 'host' } }, at: '2026-11-26T13:40:04.000Z' },
        ...(withVerified
            ? [{ observationId: 'o3', traceId: 'trace-1', hostId: 'h', runtimeKey: 'k', workerId: null, event: 'evidence.verified', outcome: 'verified', evidence: { actor: { id: 'predicate-verifier', kind: 'eso' }, sources: VERIFIED_SOURCES }, at: '2026-11-26T13:40:05.000Z' }]
            : []),
        { observationId: 'o4', traceId: 'trace-1', hostId: 'h', runtimeKey: 'k', workerId: 'worker-scout', event: 'action.recorded', outcome: 'PASS', evidence: { tool: 'agy', files: ['AGENTS.md', 'package.json'] }, at: '2026-11-26T13:40:06.000Z' },
    ];
    return {
        request: { id: 'trace-1', traceId: 'trace-1', consumerId: 'fineso', userQuery: 'read-only architecture summary', promptHash: 'h' },
        events,
        verdict: {
            level: 'partial',
            basis: 'claim=partial: pre-turn judgment partial',
            actor: { id: 'worker-scout', kind: 'host', role: 'scout' },
            gaps: [{ code: 'JUDGMENT_GAP_UNKNOWN', what: 'agents/README.md', consequence: 'pre-turn judgment partial' }],
            score: 75,
            ruleRefs: [],
            receiptId: null,
            computedAt: '2026-11-26T13:40:10.000Z',
        },
        signals: null,
        jev: null,
        writeGate: null,
        spec: null,
        receipt: null,
        telemetry: { files: [], tools: [], llmCalls: [] },
        pipeline: [],
        recon: [],
        effectiveness: { stepsTotal: 8, stepsWithEvidence: 3, rolesAssigned: 1, rolesObserved: 1, workersTotal: 8, workersObserved: 1, failures: 0, durationMs: 0, writeGateChecked: false, receiptSealed: false, gaps: 1 },
    };
}

function buildView(detail, { fullReceipt = null, receiptVerification = 'unavailable', kbSufficiency = null } = {}) {
    return buildEvidenceEffectivenessView({
        detail,
        preTurnGate: null,
        actionEvents: [],
        tokenSummary: { input: null, output: null, cacheRead: null, estimated: false },
        fullReceipt,
        receiptVerification,
        kbSufficiency,
    });
}

test('#1 Axis 3 uses evidence.verified when the receipt call fails (trace proof is not lost)', () => {
    const view = buildView(makeDetail(), { fullReceipt: null, receiptVerification: 'unavailable' });
    assert.equal(view.axis3.verifiedCount, 2, 'both server-verified sources must be counted');
    assert.notEqual(view.axis3.state, 'not-captured', 'a verified trace must not render Axis 3 as not-captured');
});

test('#1 Axis 3 stays not-captured when the trace has no evidence.verified at all', () => {
    const view = buildView(makeDetail({ withVerified: false }), { fullReceipt: null, receiptVerification: 'unavailable' });
    assert.equal(view.axis3.verifiedCount, 0);
    assert.equal(view.axis3.state, 'not-captured', 'no proof anywhere means not-captured, never a fabricated state');
});

test('#1 the sealed receipt still wins when it is available', () => {
    const sealed = { specVersion: 2, payload: { sources: [{ verified: true, where: 'AGENTS.md', hash: 'a', verifiedAt: '', requirementId: null }] } };
    const view = buildView(makeDetail(), { fullReceipt: sealed, receiptVerification: 'verified' });
    assert.equal(view.axis3.verifiedCount, 1, 'receipt sources[] remain the authoritative count when present');
});

test('#2 a failed knowledge-sufficiency call is disclosed in Explicit Unknowns (BR-18)', () => {
    const unknowns = collectExplicitUnknowns(makeDetail(), null, null, null, { kbFailed: true });
    assert.ok(
        unknowns.some((u) => u.id === 'kb-sufficiency-unavailable'),
        'the page must say the knowledge sufficiency call failed instead of staying silent',
    );
});

test('#2 a quiet absence (no call attempted / field absent) is NOT reported as a failure', () => {
    const unknowns = collectExplicitUnknowns(makeDetail(), null, null, null);
    assert.ok(
        unknowns.some((u) => u.id === 'kb-sufficiency-unavailable'),
        'a missing snapshot is still disclosed as its own item',
    );
    assert.ok(
        !unknowns.some((u) => u.id === 'receipt-fetch-failed'),
        'no request failed, so no failure may be invented',
    );
});

test('#2 a failed receipt call is disclosed, not silently swallowed', () => {
    const unknowns = collectExplicitUnknowns(makeDetail(), null, null, null, { receiptFailed: true });
    assert.ok(unknowns.some((u) => u.id === 'receipt-fetch-failed'), 'receipt failure must be named');
});
