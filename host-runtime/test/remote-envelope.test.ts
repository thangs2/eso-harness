import { describe, expect, it } from 'bun:test';
import {
    EnvelopeError,
    constantTimeEqual,
    createNonce,
    signJob,
    signResult,
    stableJson,
    validateJobEnvelope,
    verifyJobSignature,
    verifyResultSignature,
} from '../src/remote/envelope';
import type { JobEnvelope, ResultEnvelope } from '../src/remote/envelope';
import { AGY_RUNTIME_KEY, REMOTE_SECRET, TEST_RUNTIME_KEY } from './remote-fixtures';

function job(overrides: Partial<JobEnvelope> = {}): JobEnvelope {
    return {
        jobId: 'job-1',
        fromRuntimeKey: TEST_RUNTIME_KEY,
        toRuntimeKey: AGY_RUNTIME_KEY,
        workspaceRef: { repo: '/tmp/ws', commit: undefined },
        workerId: 'worker-build',
        flowId: 'that-tinh-tran',
        prompt: 'Implement the ticket without touching ESO.',
        policy: { adapter: 'dry', dryRun: true },
        modelTier: 'balanced',
        evidenceRequirements: {},
        createdAt: '2026-11-17T00:00:00.000Z',
        nonce: 'nonce-1',
        ...overrides,
    };
}

async function expectEnvelopeCode(fn: () => unknown, code: string): Promise<void> {
    try {
        await fn();
        throw new Error(`expected EnvelopeError ${code}`);
    } catch (error) {
        expect(error instanceof EnvelopeError).toBe(true);
        expect((error as EnvelopeError).code).toBe(code);
    }
}

describe('remote envelope', () => {
    it('signs and verifies a job envelope', async () => {
        const signed = await signJob(job(), REMOTE_SECRET);
        expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
        const verified = await verifyJobSignature(signed, REMOTE_SECRET);
        expect(verified.jobId).toBe('job-1');
        expect(verified.toRuntimeKey).toBe(AGY_RUNTIME_KEY);
    });

    it('is deterministic across object key order', async () => {
        const first = await signJob(job(), REMOTE_SECRET);
        const reordered = JSON.parse(JSON.stringify(job())) as JobEnvelope;
        const shuffled = {
            nonce: reordered.nonce,
            createdAt: reordered.createdAt,
            evidenceRequirements: reordered.evidenceRequirements,
            modelTier: reordered.modelTier,
            policy: reordered.policy,
            prompt: reordered.prompt,
            flowId: reordered.flowId,
            workerId: reordered.workerId,
            workspaceRef: reordered.workspaceRef,
            toRuntimeKey: reordered.toRuntimeKey,
            fromRuntimeKey: reordered.fromRuntimeKey,
            jobId: reordered.jobId,
        } as JobEnvelope;
        const second = await signJob(shuffled, REMOTE_SECRET);
        expect(second.signature).toBe(first.signature);
        expect(stableJson(first.envelope)).toBe(stableJson(second.envelope));
    });

    it('rejects a tampered prompt or target runtime', async () => {
        const signed = await signJob(job(), REMOTE_SECRET);
        await expectEnvelopeCode(
            () => verifyJobSignature({ envelope: { ...signed.envelope, prompt: 'evil' }, signature: signed.signature }, REMOTE_SECRET),
            'ENVELOPE_SIGNATURE_INVALID',
        );
        await expectEnvelopeCode(
            () => verifyJobSignature({ envelope: { ...signed.envelope, toRuntimeKey: 'evil:runtime' }, signature: signed.signature }, REMOTE_SECRET),
            'ENVELOPE_SIGNATURE_INVALID',
        );
    });

    it('rejects the wrong secret and missing/malformed signatures', async () => {
        const signed = await signJob(job(), REMOTE_SECRET);
        await expectEnvelopeCode(() => verifyJobSignature(signed, 'another-secret-123'), 'ENVELOPE_SIGNATURE_INVALID');
        await expectEnvelopeCode(() => verifyJobSignature({ envelope: signed.envelope, signature: '' }, REMOTE_SECRET), 'ENVELOPE_SIGNATURE_INVALID');
        await expectEnvelopeCode(() => verifyJobSignature({ envelope: signed.envelope, signature: 'zz' }, REMOTE_SECRET), 'ENVELOPE_SIGNATURE_INVALID');
    });

    it('rejects malformed envelopes before trusting them', async () => {
        await expectEnvelopeCode(() => signJob(job({ prompt: '   ' }), REMOTE_SECRET), 'ENVELOPE_INVALID');
        await expectEnvelopeCode(() => signJob(job({ toRuntimeKey: 'agy' }), REMOTE_SECRET), 'ENVELOPE_INVALID');
        await expectEnvelopeCode(() => signJob(job({ fromRuntimeKey: AGY_RUNTIME_KEY }), REMOTE_SECRET), 'ENVELOPE_INVALID');
        await expectEnvelopeCode(
            () => signJob(job({ policy: { adapter: 'rm -rf', dryRun: true } }), REMOTE_SECRET),
            'ENVELOPE_INVALID',
        );
        await expectEnvelopeCode(
            () => signJob(job({ policy: { adapter: 'dry', dryRun: true, maxSteps: 99 } }), REMOTE_SECRET),
            'ENVELOPE_INVALID',
        );
        await expectEnvelopeCode(() => signJob(job({ createdAt: 'not-a-date' }), REMOTE_SECRET), 'ENVELOPE_INVALID');
        await expectEnvelopeCode(() => validateJobEnvelope(null), 'ENVELOPE_INVALID');
    });

    it('accepts the main-chat adapter for a remote DSH host', async () => {
        const signed = await signJob(job({ policy: { adapter: 'main-chat', dryRun: false } }), REMOTE_SECRET);
        expect(signed.envelope.policy.adapter).toBe('main-chat');
    });

    it('requires a non-trivial shared secret', async () => {
        await expectEnvelopeCode(() => signJob(job(), 'short'), 'ENVELOPE_SECRET_MISSING');
    });

    it('signs and verifies a result envelope; tampering is rejected', async () => {
        const result: ResultEnvelope = {
            jobId: 'job-1',
            ok: true,
            outcome: 'PASS',
            evidence: {
                outcome: 'PASS',
                workerId: 'worker-build',
                adapter: 'dry',
                model: 'gemini-4-argon-medium',
                exitCode: 0,
                durationMs: 0,
                timedOut: false,
            },
            observationId: 'obs-worker-build-1-job-1',
            remoteRuntimeKey: AGY_RUNTIME_KEY,
            at: '2026-11-17T00:00:05.000Z',
            nonce: 'result-nonce',
        };
        const signed = await signResult(result, REMOTE_SECRET);
        const verified = await verifyResultSignature(signed, REMOTE_SECRET);
        expect(verified.outcome).toBe('PASS');
        expect(verified.observationId).toBe('obs-worker-build-1-job-1');

        await expectEnvelopeCode(
            () => verifyResultSignature({ envelope: { ...signed.envelope, ok: false }, signature: signed.signature }, REMOTE_SECRET),
            'ENVELOPE_SIGNATURE_INVALID',
        );
        await expectEnvelopeCode(
            () =>
                verifyResultSignature(
                    { envelope: { ...signed.envelope, evidence: { ...signed.envelope.evidence, outcome: 'FAIL' } }, signature: signed.signature },
                    REMOTE_SECRET,
                ),
            'ENVELOPE_SIGNATURE_INVALID',
        );
        await expectEnvelopeCode(
            () => signResult({ ...result, outcome: 'MAYBE' as unknown as ResultEnvelope['outcome'] }, REMOTE_SECRET),
            'ENVELOPE_INVALID',
        );
    });

    it('compares strings in constant time', () => {
        expect(constantTimeEqual('abc', 'abc')).toBe(true);
        expect(constantTimeEqual('abc', 'abd')).toBe(false);
        expect(constantTimeEqual('abc', 'ab')).toBe(false);
        expect(constantTimeEqual('', '')).toBe(true);
    });

    it('creates unique nonces', () => {
        const first = createNonce();
        const second = createNonce();
        expect(first).toMatch(/^[0-9a-f]{32}$/);
        expect(first).not.toBe(second);
    });
});
