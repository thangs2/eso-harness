import { describe, expect, it } from 'bun:test';
import {
    MAX_STDERR_TAIL,
    MAX_STDOUT_TAIL,
    boundedTail,
    buildBlockedEvidence,
    buildEvidence,
    deriveOutcome,
    eventForOutcome,
    explicitOutcome,
    redactText,
} from '../src/evidence';

const PROMPT = 'Implement the host-side runtime for the ESO P3 ticket without touching ESO code.';

describe('evidence', () => {
    it('derives outcome from block flag, explicit marker and exit code', () => {
        expect(deriveOutcome({ blocked: true, exitCode: 0 })).toBe('BLOCKED');
        expect(deriveOutcome({ exitCode: 0 })).toBe('PASS');
        expect(deriveOutcome({ exitCode: 1 })).toBe('FAIL');
        expect(deriveOutcome({ exitCode: null })).toBe('FAIL');
        expect(deriveOutcome({ exitCode: 0, stdout: 'work\nOUTCOME: FAIL\n' })).toBe('FAIL');
        expect(deriveOutcome({ exitCode: 0, timedOut: true })).toBe('FAIL');
        expect(explicitOutcome('OUTCOME: PASS\nOUTCOME: BLOCKED')).toBe('BLOCKED');
        expect(explicitOutcome('no marker')).toBe(null);
    });

    it('maps outcome to observation events', () => {
        expect(eventForOutcome('PASS')).toBe('worker.completed');
        expect(eventForOutcome('FAIL')).toBe('worker.failed');
        expect(eventForOutcome('BLOCKED')).toBe('worker.failed');
    });

    it('bounds stdout/stderr tails', () => {
        const long = 'x'.repeat(5000);
        expect(boundedTail(long, 100)).toHaveLength(100 + '…[truncated 4900 chars]…\n'.length);
        expect(boundedTail('short', 100)).toBe('short');
        expect(boundedTail(undefined, 10)).toBe('');
    });

    it('redacts the prompt body and tokens', () => {
        const result = redactText(`before ${PROMPT} after token=secret-token-value`, {
            prompt: PROMPT,
            secrets: ['secret-token-value'],
        });
        expect(result.redacted).toBe(true);
        expect(result.text.includes(PROMPT)).toBe(false);
        expect(result.text.includes('secret-token-value')).toBe(false);
        expect(result.text).toContain('[prompt redacted]');
        expect(result.text).toContain('[redacted]');
    });

    it('does not redact short unremarkable strings', () => {
        const result = redactText('hello world', { prompt: 'hi', secrets: [] });
        expect(result.redacted).toBe(false);
        expect(result.text).toBe('hello world');
    });

    it('builds bounded, prompt-free evidence', () => {
        const evidence = buildEvidence({
            adapter: 'cursor',
            model: 'auto',
            modelSource: 'runtime-default',
            tier: 'balanced',
            workerId: 'worker-build',
            flowId: 'that-tinh-tran',
            hostStep: 1,
            exitCode: 0,
            durationMs: 12.7,
            stdout: `did the work\necho: ${PROMPT}\nOUTCOME: PASS`,
            stderr: 'warn warning',
            redaction: { prompt: PROMPT, secrets: [] },
        });
        expect(evidence.outcome).toBe('PASS');
        expect(evidence.durationMs).toBe(13);
        expect(evidence.promptRedacted).toBe(true);
        expect(JSON.stringify(evidence).includes(PROMPT)).toBe(false);
        expect(evidence.stdoutTail.length).toBeLessThanOrEqual(MAX_STDOUT_TAIL);
        expect(evidence.stderrTail.length).toBeLessThanOrEqual(MAX_STDERR_TAIL);
        expect(evidence.model).toBe('auto');
        expect(evidence.tier).toBe('balanced');
    });

    it('builds blocked evidence without any run', () => {
        const evidence = buildBlockedEvidence({
            adapter: 'dry',
            workerId: 'worker-build',
            flowId: 'that-tinh-tran',
            hostStep: 1,
            reason: 'MODEL_UNAVAILABLE',
            detail: 'no model',
        });
        expect(evidence.outcome).toBe('BLOCKED');
        expect(evidence.exitCode).toBe(null);
        expect(evidence.reason).toBe('MODEL_UNAVAILABLE');
        expect(evidence.detail).toBe('no model');
    });
});
