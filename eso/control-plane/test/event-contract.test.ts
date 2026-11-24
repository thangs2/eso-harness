/**
 * P1 — evidence contract v1 validation.
 *
 * Run: `cd eso/control-plane && bun test test/event-contract.test.ts`
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PlatformError } from '../src/platform/registry/errors.js';
import {
    SCHEMA_VERSION,
    SchemaUnsupportedError,
    validateObservedEvent,
} from '../src/modules/observations/event-contract.js';

function caught(fn: () => unknown): any {
    try {
        fn();
    } catch (error) {
        return error;
    }
    assert.fail('expected validateObservedEvent to reject');
}

function expectInvalid(event: string, evidence: unknown, pattern: RegExp): PlatformError {
    const error = caught(() => validateObservedEvent(event, evidence));
    assert.ok(error instanceof PlatformError, `expected PlatformError, got ${String(error)}`);
    assert.equal(error.code, 'OBSERVATION_INVALID');
    assert.equal(error.status, 422);
    assert.match(String(error.detail), pattern);
    assert.match(String(error.message), pattern);
    return error;
}

function expectCode(event: string, evidence: unknown, code: string, pattern: RegExp): PlatformError {
    const error = caught(() => validateObservedEvent(event, evidence));
    assert.ok(error instanceof PlatformError, `expected PlatformError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.status, 422);
    assert.match(String(error.detail), pattern);
    return error;
}

const validDecision = () => ({
    winner: 'plan',
    verdict: 'allow',
    basis: 'rule core.slp says build then verify',
});

describe('P1 event contract — decision.recorded', () => {
    test('accepts the minimal decision payload', () => {
        assert.deepEqual(validateObservedEvent('decision.recorded', validDecision()), { ok: true });
    });

    test('accepts optional refs, latencyMs, jevMode, hil and actor', () => {
        const evidence = {
            ...validDecision(),
            jevMode: 'shadow',
            latencyMs: 12,
            refs: [{ kind: 'rule', path: 'agents/rules/core.slp.mdc', line: 42 }, { kind: 'decision' }],
            hil: false,
            actor: { kind: 'host', id: 'cursor', role: 'builder' },
            schemaVersion: 1,
        };
        assert.deepEqual(validateObservedEvent('decision.recorded', evidence), { ok: true });
    });

    test('rejects a missing winner and names the field', () => {
        const { winner, ...rest } = validDecision();
        expectInvalid('decision.recorded', rest, /winner/);
    });

    test('rejects an unknown verdict and names the field', () => {
        expectInvalid('decision.recorded', { ...validDecision(), verdict: 'maybe' }, /verdict/);
    });

    test('rejects a missing basis and names the field', () => {
        const { basis, ...rest } = validDecision();
        expectInvalid('decision.recorded', rest, /basis/);
    });

    test('rejects malformed optional fields and names them', () => {
        expectInvalid('decision.recorded', { ...validDecision(), latencyMs: 'fast' }, /latencyMs/);
        expectInvalid('decision.recorded', { ...validDecision(), hil: 'yes' }, /hil/);
        expectInvalid('decision.recorded', { ...validDecision(), refs: [{ kind: 'rule', line: 0 }] }, /line/);
        expectInvalid('decision.recorded', { ...validDecision(), refs: {} }, /refs/);
    });
});

describe('P6a event contract — decision signals', () => {
    const signalEvidence = () => ({
        ...validDecision(),
        preflight: { state: 'HOT', fingerprint: 'G1:abc' },
        recon: [{ adapter: 'codegraph', calls: 2 }, { adapter: 'docgraph', calls: 1 }],
        brainTier: 'flash',
        distill: { memorySaved: true, lessons: 2 },
    });

    test('accepts all four optional signals', () => {
        assert.deepEqual(validateObservedEvent('decision.recorded', signalEvidence()), { ok: true });
    });

    test('accepts each signal on its own', () => {
        for (const patch of [
            { preflight: { state: 'COLD' } },
            { preflight: { state: 'WARM', fingerprint: 'G2' } },
            { recon: [] },
            { recon: [{ adapter: 'codegraph', calls: 0 }] },
            { brainTier: 'zero' },
            { brainTier: 'pro' },
            { distill: { memorySaved: false } },
            { distill: { memorySaved: true, lessons: 0 } },
        ]) {
            assert.deepEqual(validateObservedEvent('decision.recorded', { ...validDecision(), ...patch }), { ok: true });
        }
    });

    test('absent signals stay absent — no defaults are added', () => {
        const { preflight, recon, brainTier, distill, ...rest } = signalEvidence();
        void preflight;
        void recon;
        void brainTier;
        void distill;
        assert.deepEqual(rest, validDecision());
        for (const key of ['preflight', 'recon', 'brainTier', 'distill']) assert.equal(key in rest, false);
        assert.deepEqual(validateObservedEvent('decision.recorded', rest), { ok: true });
    });

    test('rejects a malformed preflight and names the field', () => {
        expectInvalid('decision.recorded', { ...validDecision(), preflight: 'HOT' }, /preflight/);
        expectInvalid('decision.recorded', { ...validDecision(), preflight: { state: 'warm' } }, /preflight\.state/);
        expectInvalid('decision.recorded', { ...validDecision(), preflight: { state: 'HOT', fingerprint: 7 } }, /preflight\.fingerprint/);
    });

    test('rejects a malformed recon and names the field', () => {
        expectInvalid('decision.recorded', { ...validDecision(), recon: {} }, /evidence\.recon/);
        expectInvalid('decision.recorded', { ...validDecision(), recon: ['codegraph'] }, /recon\[0\]/);
        expectInvalid('decision.recorded', { ...validDecision(), recon: [{ calls: 1 }] }, /recon\[0\]\.adapter/);
        expectInvalid('decision.recorded', { ...validDecision(), recon: [{ adapter: 'codegraph' }] }, /recon\[0\]\.calls/);
        expectInvalid('decision.recorded', { ...validDecision(), recon: [{ adapter: 'codegraph', calls: '2' }] }, /recon\[0\]\.calls/);
        expectInvalid('decision.recorded', { ...validDecision(), recon: [{ adapter: 'codegraph', calls: -1 }] }, /recon\[0\]\.calls/);
    });

    test('rejects a malformed brainTier and names the field', () => {
        expectInvalid('decision.recorded', { ...validDecision(), brainTier: 'turbo' }, /brainTier/);
        expectInvalid('decision.recorded', { ...validDecision(), brainTier: 1 }, /brainTier/);
    });

    test('rejects a malformed distill and names the field', () => {
        expectInvalid('decision.recorded', { ...validDecision(), distill: [] }, /distill/);
        expectInvalid('decision.recorded', { ...validDecision(), distill: { memorySaved: 'yes' } }, /distill\.memorySaved/);
        expectInvalid('decision.recorded', { ...validDecision(), distill: { memorySaved: true, lessons: -1 } }, /distill\.lessons/);
        expectInvalid('decision.recorded', { ...validDecision(), distill: { memorySaved: true, lessons: 1.5 } }, /distill\.lessons/);
    });

    test('does not rewrite signal values', () => {
        const evidence = signalEvidence();
        validateObservedEvent('decision.recorded', evidence);
        assert.deepEqual(evidence, signalEvidence());
    });
});

describe('P8 event contract — decision jev (B0-3)', () => {
    const validJev = () => ({ mode: 'active', consent: true, confidence: 0.91, band: 'auto', decision: 'auto', reason: 'active: auto' });

    test('accepts a full jev report', () => {
        assert.deepEqual(validateObservedEvent('decision.recorded', { ...validDecision(), jev: validJev() }), { ok: true });
    });

    test('accepts shadow with confidence and a minimal report', () => {
        assert.deepEqual(
            validateObservedEvent('decision.recorded', { ...validDecision(), jev: { mode: 'shadow', consent: true, confidence: 0.4, band: 'open' } }),
            { ok: true },
        );
        assert.deepEqual(
            validateObservedEvent('decision.recorded', { ...validDecision(), jev: { mode: 'off', consent: false } }),
            { ok: true },
        );
    });

    test('B0-3 stays valid without jev and without confidence when mode is off', () => {
        assert.deepEqual(validateObservedEvent('decision.recorded', validDecision()), { ok: true });
        assert.deepEqual(validateObservedEvent('decision.recorded', { ...validDecision(), jev: { mode: 'off', consent: true } }), { ok: true });
    });

    test('mode shadow/active without confidence ⇒ JEV_CONFIDENCE_REQUIRED (422)', () => {
        const { confidence, ...noConfidence } = validJev();
        void confidence;
        const error = expectCode('decision.recorded', { ...validDecision(), jev: noConfidence }, 'JEV_CONFIDENCE_REQUIRED', /evidence\.jev\.confidence/);
        assert.match(String(error.message), /confidence/);
        expectCode('decision.recorded', { ...validDecision(), jev: { mode: 'shadow', consent: true } }, 'JEV_CONFIDENCE_REQUIRED', /evidence\.jev\.confidence/);
    });

    test('rejects a non-boolean consent and names evidence.jev.consent', () => {
        expectInvalid('decision.recorded', { ...validDecision(), jev: { ...validJev(), consent: 'yes' } }, /evidence\.jev\.consent/);
        expectInvalid('decision.recorded', { ...validDecision(), jev: { mode: 'active', confidence: 0.9 } }, /evidence\.jev\.consent/);
    });

    test('rejects an unknown mode and names evidence.jev.mode', () => {
        expectInvalid('decision.recorded', { ...validDecision(), jev: { ...validJev(), mode: 'on' } }, /evidence\.jev\.mode/);
        expectInvalid('decision.recorded', { ...validDecision(), jev: { consent: true } }, /evidence\.jev\.mode/);
    });

    test('rejects a wrong-typed band and names evidence.jev.band', () => {
        expectInvalid('decision.recorded', { ...validDecision(), jev: { ...validJev(), band: 3 } }, /evidence\.jev\.band/);
        expectInvalid('decision.recorded', { ...validDecision(), jev: { ...validJev(), band: 'hot' } }, /evidence\.jev\.band/);
    });

    test('rejects malformed confidence, decision, reason and jev container', () => {
        expectInvalid('decision.recorded', { ...validDecision(), jev: { ...validJev(), confidence: '0.9' } }, /evidence\.jev\.confidence/);
        expectInvalid('decision.recorded', { ...validDecision(), jev: { ...validJev(), confidence: 1.5 } }, /evidence\.jev\.confidence/);
        expectInvalid('decision.recorded', { ...validDecision(), jev: { ...validJev(), decision: 'maybe' } }, /evidence\.jev\.decision/);
        expectInvalid('decision.recorded', { ...validDecision(), jev: { ...validJev(), reason: 7 } }, /evidence\.jev\.reason/);
        expectInvalid('decision.recorded', { ...validDecision(), jev: 'active' }, /evidence\.jev/);
        expectInvalid('decision.recorded', { ...validDecision(), jev: ['active'] }, /evidence\.jev/);
    });

    test('does not rewrite the jev report it validates', () => {
        const jev = validJev();
        const evidence = { ...validDecision(), jev };
        validateObservedEvent('decision.recorded', evidence);
        assert.deepEqual(evidence.jev, validJev());
    });
});

describe('P1 event contract — action.recorded', () => {
    const validAction = () => ({
        tool: 'apply_patch',
        outcome: 'PASS',
        files: ['src/modules/observations/observation.service.ts'],
        readBeforeEdit: true,
        diffRef: 'diff-1',
    });

    test('accepts the minimal action payload', () => {
        assert.deepEqual(validateObservedEvent('action.recorded', { tool: 'read_file', outcome: 'BLOCKED' }), { ok: true });
    });

    test('accepts the full action payload', () => {
        assert.deepEqual(validateObservedEvent('action.recorded', validAction()), { ok: true });
    });

    test('rejects a missing tool and names the field', () => {
        const { tool, ...rest } = validAction();
        expectInvalid('action.recorded', rest, /tool/);
    });

    test('rejects an unknown outcome and names the field', () => {
        expectInvalid('action.recorded', { ...validAction(), outcome: 'ok' }, /outcome/);
    });

    test('rejects non-string files and names the field', () => {
        expectInvalid('action.recorded', { ...validAction(), files: ['ok', 3] }, /files/);
    });
});

describe('P1 event contract — evidence.packet', () => {
    test('accepts non-empty items', () => {
        assert.deepEqual(
            validateObservedEvent('evidence.packet', { items: [{ id: 'ev-1', kind: 'test-run' }], specVersion: '1' }),
            { ok: true },
        );
    });

    test('accepts a hash instead of items', () => {
        assert.deepEqual(validateObservedEvent('evidence.packet', { hash: 'sha256:abc' }), { ok: true });
    });

    test('rejects empty items without a hash and names items/hash', () => {
        expectInvalid('evidence.packet', { items: [] }, /items|hash/);
    });

    test('rejects an item without id and names the field', () => {
        expectInvalid('evidence.packet', { items: [{ kind: 'test-run' }] }, /items\[0\]\.id/);
    });

    test('rejects a malformed specVersion and names the field', () => {
        expectInvalid('evidence.packet', { hash: 'sha256:abc', specVersion: {} }, /specVersion/);
    });
});

describe('P1 event contract — envelope', () => {
    test('unknown event kinds pass through untouched', () => {
        assert.deepEqual(validateObservedEvent('worker.build.done', { anything: true }), { ok: true });
        assert.deepEqual(validateObservedEvent('turn.completed', [1, 2, 3]), { ok: true });
        assert.deepEqual(validateObservedEvent('worker.build.done', undefined), { ok: true });
    });

    test('contract events require an object evidence payload', () => {
        expectInvalid('decision.recorded', 'not-an-object', /evidence/);
        expectInvalid('action.recorded', [{ tool: 'x' }], /evidence/);
    });

    test('rejects schemaVersion 2 with SCHEMA_UNSUPPORTED', () => {
        const error = caught(() => validateObservedEvent('decision.recorded', { ...validDecision(), schemaVersion: 2 }));
        assert.ok(error instanceof SchemaUnsupportedError);
        assert.equal(error.code, 'SCHEMA_UNSUPPORTED');
        assert.equal(error.status, 422);
        assert.match(String(error.message), /schemaVersion 2/);
        assert.equal(SCHEMA_VERSION, 1);
    });

    test('defaults to schemaVersion 1 and rejects a malformed version', () => {
        assert.deepEqual(validateObservedEvent('decision.recorded', validDecision()), { ok: true });
        assert.deepEqual(validateObservedEvent('decision.recorded', { ...validDecision(), schemaVersion: 1 }), { ok: true });
        expectInvalid('decision.recorded', { ...validDecision(), schemaVersion: '1' }, /schemaVersion/);
        expectInvalid('decision.recorded', { ...validDecision(), schemaVersion: 0 }, /schemaVersion/);
    });

    test('validates actor kind/id/role and names the field', () => {
        assert.deepEqual(
            validateObservedEvent('action.recorded', { tool: 'read_file', outcome: 'PASS', actor: { kind: 'agent', id: 'w-1', role: 'verify' } }),
            { ok: true },
        );
        expectInvalid('action.recorded', { tool: 'read_file', outcome: 'PASS', actor: { kind: 'robot', id: 'w-1' } }, /actor\.kind/);
        expectInvalid('action.recorded', { tool: 'read_file', outcome: 'PASS', actor: { kind: 'agent' } }, /actor\.id/);
        expectInvalid('action.recorded', { tool: 'read_file', outcome: 'PASS', actor: { kind: 'agent', id: 'w-1', role: 7 } }, /actor\.role/);
    });

    test('does not mutate or add fields to the evidence it validates', () => {
        const evidence = Object.freeze({ ...validDecision(), actor: Object.freeze({ kind: 'operator', id: 'op' }) });
        validateObservedEvent('decision.recorded', evidence);
        assert.deepEqual(evidence, { ...validDecision(), actor: { kind: 'operator', id: 'op' } });
        assert.equal('schemaVersion' in evidence, false);
    });
});
