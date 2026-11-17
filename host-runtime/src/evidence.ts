/**
 * Evidence building — what the host observed, shaped for ESO's observation append log.
 *
 * Rules:
 *   - outcome is PASS / FAIL / BLOCKED (explicit `OUTCOME:` line wins, else exit code)
 *   - stdout/stderr are bounded tails, never full output
 *   - the prompt body is NEVER included (redacted if an adapter echoes it)
 *   - tokens are redacted
 */

import type { FlowOutcome } from './flow-engine';

export type Outcome = FlowOutcome;

export const MAX_STDOUT_TAIL = 2000;
export const MAX_STDERR_TAIL = 1000;
export const PROMPT_REDACTED = '[prompt redacted]';
export const SECRET_REDACTED = '[redacted]';

export interface AdapterRunFacts {
    adapter: string;
    model: string | null;
    modelSource: string;
    tier: string | null;
    effort?: string | null;
    workerId: string | null;
    flowId: string | null;
    hostStep: number;
    exitCode: number | null;
    durationMs: number;
    stdout?: string;
    stderr?: string;
    blocked?: boolean;
    reason?: string;
    detail?: string;
    timedOut?: boolean;
}

export interface WorkerEvidence {
    outcome: Outcome;
    exitCode: number | null;
    durationMs: number;
    model: string | null;
    modelSource: string;
    tier: string | null;
    effort?: string | null;
    adapter: string;
    workerId: string | null;
    flowId: string | null;
    hostStep: number;
    stdoutTail: string;
    stderrTail: string;
    promptRedacted: boolean;
    timedOut: boolean;
    reason?: string;
    detail?: string;
}

export interface EvidenceRedaction {
    /** The prompt body — never allowed into evidence. */
    prompt?: string;
    /** Bearer/host tokens — never allowed into logs or evidence. */
    secrets?: string[];
}

/** Last `max` characters, with an explicit marker when truncated. */
export function boundedTail(text: string | null | undefined, max: number): string {
    const value = typeof text === 'string' ? text : '';
    if (value.length <= max) return value;
    return `…[truncated ${value.length - max} chars]…\n${value.slice(-max)}`;
}

export interface RedactionResult {
    text: string;
    redacted: boolean;
}

/** Remove the prompt body and known secrets from a text blob. */
export function redactText(text: string | null | undefined, redaction: EvidenceRedaction = {}): RedactionResult {
    let value = typeof text === 'string' ? text : '';
    let redacted = false;

    const prompt = (redaction.prompt ?? '').trim();
    if (prompt.length >= 16) {
        const before = value;
        value = value.split(prompt).join(PROMPT_REDACTED);
        // Also handle a prompt embedded with normalized whitespace.
        const collapsed = prompt.replace(/\s+/g, ' ');
        if (collapsed !== prompt && value.includes(collapsed)) value = value.split(collapsed).join(PROMPT_REDACTED);
        if (value !== before) redacted = true;
    }

    for (const secret of redaction.secrets ?? []) {
        const token = (secret ?? '').trim();
        if (token.length < 8) continue;
        if (value.includes(token)) {
            value = value.split(token).join(SECRET_REDACTED);
            redacted = true;
        }
    }

    return { text: value, redacted };
}

/** Last explicit OUTCOME marker in the output, if the model honoured the reply contract. */
export function explicitOutcome(stdout: string | null | undefined): Outcome | null {
    const text = typeof stdout === 'string' ? stdout : '';
    const pattern = /^\s*OUTCOME:\s*(PASS|FAIL|BLOCKED)\s*$/gim;
    let found: Outcome | null = null;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        found = match[1].toUpperCase() as Outcome;
    }
    return found;
}

export function deriveOutcome(input: {
    blocked?: boolean;
    exitCode: number | null;
    stdout?: string;
    timedOut?: boolean;
}): Outcome {
    if (input.blocked) return 'BLOCKED';
    const declared = explicitOutcome(input.stdout);
    if (declared) return declared;
    if (input.timedOut) return 'FAIL';
    return input.exitCode === 0 ? 'PASS' : 'FAIL';
}

export function eventForOutcome(outcome: Outcome): 'worker.completed' | 'worker.failed' {
    return outcome === 'PASS' ? 'worker.completed' : 'worker.failed';
}

export interface BuildEvidenceInput extends AdapterRunFacts {
    redaction?: EvidenceRedaction;
}

/** Evidence payload posted to ESO — bounded, redacted, no prompt body. */
export function buildEvidence(input: BuildEvidenceInput): WorkerEvidence {
    const stdout = redactText(input.stdout, input.redaction);
    const stderr = redactText(input.stderr, input.redaction);

    const evidence: WorkerEvidence = {
        outcome: deriveOutcome(input),
        exitCode: input.exitCode,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        model: input.model,
        modelSource: input.modelSource,
        tier: input.tier,
        adapter: input.adapter,
        workerId: input.workerId,
        flowId: input.flowId,
        hostStep: input.hostStep,
        stdoutTail: boundedTail(stdout.text, MAX_STDOUT_TAIL),
        stderrTail: boundedTail(stderr.text, MAX_STDERR_TAIL),
        promptRedacted: stdout.redacted || stderr.redacted,
        timedOut: Boolean(input.timedOut),
    };
    if (input.effort) evidence.effort = input.effort;
    if (input.reason) evidence.reason = input.reason;
    if (input.detail) {
        const detail = redactText(input.detail, input.redaction);
        evidence.detail = boundedTail(detail.text, 500);
    }
    return evidence;
}

/** Evidence for a block decided before/without an adapter run (e.g. MODEL_UNAVAILABLE). */
export function buildBlockedEvidence(input: {
    adapter: string;
    model?: string | null;
    modelSource?: string;
    tier?: string | null;
    workerId?: string | null;
    flowId?: string | null;
    hostStep: number;
    reason: string;
    detail?: string;
    redaction?: EvidenceRedaction;
}): WorkerEvidence {
    return buildEvidence({
        adapter: input.adapter,
        model: input.model ?? null,
        modelSource: input.modelSource ?? 'none',
        tier: input.tier ?? null,
        workerId: input.workerId ?? null,
        flowId: input.flowId ?? null,
        hostStep: input.hostStep,
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        blocked: true,
        reason: input.reason,
        detail: input.detail,
        redaction: input.redaction,
    });
}
