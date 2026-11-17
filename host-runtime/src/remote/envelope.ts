/**
 * Mode B host-to-host envelopes.
 *
 * Host A dispatches a signed job envelope to host B; B returns a signed result envelope.
 * ESO is not involved in the dispatch: it only observes the observations both hosts append.
 *
 * Signing: HMAC-SHA256 over a domain-separated, deterministic (recursively sorted) JSON body.
 * Verification is constant-time and validates the whole envelope shape first, so an attacker
 * cannot smuggle unknown fields into a signed document.
 */

export const ENVELOPE_DOMAIN = 'eso-modeb-v1';
export const MAX_PROMPT_CHARS = 200_000;
export const MIN_REMOTE_SECRET_CHARS = 8;
export const ADAPTER_NAMES = ['dry', 'cursor', 'agy'] as const;

export type EnvelopeErrorCode =
    | 'ENVELOPE_INVALID'
    | 'ENVELOPE_SECRET_MISSING'
    | 'ENVELOPE_SIGNATURE_INVALID';

export class EnvelopeError extends Error {
    readonly code: EnvelopeErrorCode;

    constructor(code: EnvelopeErrorCode, message: string) {
        super(message);
        this.name = 'EnvelopeError';
        this.code = code;
    }
}

export interface WorkspaceRef {
    repo: string;
    branch?: string;
    commit?: string;
}

export interface JobPolicy {
    adapter: string;
    dryRun: boolean;
    model?: string;
    maxSteps?: number;
    timeoutMs?: number;
}

export interface EvidenceRequirements {
    includeStdoutTail?: boolean;
    maxStdoutTail?: number;
    includeStderrTail?: boolean;
    maxStderrTail?: number;
}

export interface JobEnvelope {
    jobId: string;
    fromRuntimeKey: string;
    toRuntimeKey: string;
    workspaceRef: WorkspaceRef;
    workerId: string;
    flowId: string;
    prompt: string;
    policy: JobPolicy;
    modelTier: string;
    evidenceRequirements: EvidenceRequirements;
    createdAt: string;
    nonce: string;
}

export type RemoteOutcome = 'PASS' | 'FAIL' | 'BLOCKED';

export interface RemoteEvidence {
    outcome: RemoteOutcome;
    workerId: string;
    adapter: string;
    model: string | null;
    modelSource?: string;
    tier?: string | null;
    effort?: string | null;
    exitCode: number | null;
    durationMs: number;
    timedOut?: boolean;
    errorCode?: string;
    errorMessage?: string;
}

export interface ResultEnvelope {
    jobId: string;
    ok: boolean;
    outcome: RemoteOutcome;
    evidence: RemoteEvidence;
    /** Observation id written by host B (the full bounded evidence lives in ESO). */
    observationId: string | null;
    remoteRuntimeKey: string;
    at: string;
    nonce: string;
}

export interface SignedEnvelope<T> {
    envelope: T;
    signature: string;
}

export type SignedJobEnvelope = SignedEnvelope<JobEnvelope>;
export type SignedResultEnvelope = SignedEnvelope<ResultEnvelope>;

const RUNTIME_KEY_PATTERN = /^[^:\s]+:[^:\s]+$/;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/i;

/** Deterministic JSON: recursively sorted object keys (the signed bytes). */
export function stableJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => sortKeys(item));
    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
        return sorted;
    }
    return value;
}

/** Constant-time hex/string compare (length mismatch still walks the longer string). */
export function constantTimeEqual(left: string, right: string): boolean {
    const a = typeof left === 'string' ? left : '';
    const b = typeof right === 'string' ? right : '';
    const length = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let index = 0; index < length; index += 1) {
        diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
    }
    return diff === 0;
}

function assertSecret(secret: string): string {
    if (typeof secret !== 'string' || secret.trim().length < MIN_REMOTE_SECRET_CHARS) {
        throw new EnvelopeError(
            'ENVELOPE_SECRET_MISSING',
            `ESO_REMOTE_TOKEN is missing or shorter than ${MIN_REMOTE_SECRET_CHARS} characters`,
        );
    }
    return secret.trim();
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(assertSecret(secret)),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return Array.from(new Uint8Array(signature))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function signingInput(kind: 'job' | 'result', envelope: unknown): string {
    return `${ENVELOPE_DOMAIN}\n${kind}\n${stableJson(envelope)}`;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new EnvelopeError('ENVELOPE_INVALID', `${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, label: string, maxLength = 500): string {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) {
        throw new EnvelopeError('ENVELOPE_INVALID', `${label}.${key} is required`);
    }
    if (value.length > maxLength) {
        throw new EnvelopeError('ENVELOPE_INVALID', `${label}.${key} is longer than ${maxLength} characters`);
    }
    return value;
}

function optionalString(record: Record<string, unknown>, key: string, label: string, maxLength = 500): string | undefined {
    const value = record[key];
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw new EnvelopeError('ENVELOPE_INVALID', `${label}.${key} must be a string`);
    if (value.length > maxLength) {
        throw new EnvelopeError('ENVELOPE_INVALID', `${label}.${key} is longer than ${maxLength} characters`);
    }
    return value;
}

function runtimeKey(record: Record<string, unknown>, key: string, label: string): string {
    const value = requiredString(record, key, label, 200);
    if (!RUNTIME_KEY_PATTERN.test(value)) {
        throw new EnvelopeError('ENVELOPE_INVALID', `${label}.${key} must be hostId:runtimeId`);
    }
    return value;
}

function validateWorkspaceRef(value: unknown): WorkspaceRef {
    const record = asRecord(value, 'workspaceRef');
    const repo = requiredString(record, 'repo', 'workspaceRef', 2000);
    const ref: WorkspaceRef = { repo };
    const branch = optionalString(record, 'branch', 'workspaceRef', 200);
    const commit = optionalString(record, 'commit', 'workspaceRef', 200);
    if (branch) ref.branch = branch;
    if (commit) ref.commit = commit;
    return ref;
}

function validatePolicy(value: unknown): JobPolicy {
    const record = asRecord(value, 'policy');
    const adapter = requiredString(record, 'adapter', 'policy', 20);
    if (!(ADAPTER_NAMES as readonly string[]).includes(adapter)) {
        throw new EnvelopeError('ENVELOPE_INVALID', `policy.adapter must be one of ${ADAPTER_NAMES.join(' | ')}`);
    }
    const policy: JobPolicy = { adapter, dryRun: record.dryRun === true };
    if (record.dryRun !== undefined && typeof record.dryRun !== 'boolean') {
        throw new EnvelopeError('ENVELOPE_INVALID', 'policy.dryRun must be a boolean');
    }
    const model = optionalString(record, 'model', 'policy', 200);
    if (model) policy.model = model;
    if (record.maxSteps !== undefined) {
        const maxSteps = Number(record.maxSteps);
        if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) {
            throw new EnvelopeError('ENVELOPE_INVALID', 'policy.maxSteps must be an integer 1..20');
        }
        policy.maxSteps = maxSteps;
    }
    if (record.timeoutMs !== undefined) {
        const timeoutMs = Number(record.timeoutMs);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
            throw new EnvelopeError('ENVELOPE_INVALID', 'policy.timeoutMs must be a positive integer');
        }
        policy.timeoutMs = timeoutMs;
    }
    return policy;
}

function validateEvidenceRequirements(value: unknown): EvidenceRequirements {
    const record = value === undefined || value === null ? {} : asRecord(value, 'evidenceRequirements');
    const requirements: EvidenceRequirements = {};
    if (record.includeStdoutTail !== undefined) requirements.includeStdoutTail = record.includeStdoutTail === true;
    if (record.includeStderrTail !== undefined) requirements.includeStderrTail = record.includeStderrTail === true;
    if (record.maxStdoutTail !== undefined) {
        const max = Number(record.maxStdoutTail);
        if (!Number.isInteger(max) || max < 0 || max > 20_000) {
            throw new EnvelopeError('ENVELOPE_INVALID', 'evidenceRequirements.maxStdoutTail must be an integer 0..20000');
        }
        requirements.maxStdoutTail = max;
    }
    if (record.maxStderrTail !== undefined) {
        const max = Number(record.maxStderrTail);
        if (!Number.isInteger(max) || max < 0 || max > 20_000) {
            throw new EnvelopeError('ENVELOPE_INVALID', 'evidenceRequirements.maxStderrTail must be an integer 0..20000');
        }
        requirements.maxStderrTail = max;
    }
    return requirements;
}

export function validateJobEnvelope(value: unknown): JobEnvelope {
    const record = asRecord(value, 'job');
    const prompt = requiredString(record, 'prompt', 'job', MAX_PROMPT_CHARS);
    if (!prompt.trim()) throw new EnvelopeError('ENVELOPE_INVALID', 'job.prompt must not be blank');
    const createdAt = requiredString(record, 'createdAt', 'job', 100);
    if (Number.isNaN(Date.parse(createdAt))) {
        throw new EnvelopeError('ENVELOPE_INVALID', 'job.createdAt must be an ISO timestamp');
    }
    const job: JobEnvelope = {
        jobId: requiredString(record, 'jobId', 'job', 200),
        fromRuntimeKey: runtimeKey(record, 'fromRuntimeKey', 'job'),
        toRuntimeKey: runtimeKey(record, 'toRuntimeKey', 'job'),
        workspaceRef: validateWorkspaceRef(record.workspaceRef),
        workerId: requiredString(record, 'workerId', 'job', 200),
        flowId: requiredString(record, 'flowId', 'job', 200),
        prompt,
        policy: validatePolicy(record.policy),
        modelTier: optionalString(record, 'modelTier', 'job', 50) ?? 'unspecified',
        evidenceRequirements: validateEvidenceRequirements(record.evidenceRequirements),
        createdAt,
        nonce: requiredString(record, 'nonce', 'job', 200),
    };
    if (job.fromRuntimeKey === job.toRuntimeKey) {
        throw new EnvelopeError('ENVELOPE_INVALID', 'job.fromRuntimeKey and job.toRuntimeKey must differ');
    }
    return job;
}

export function validateResultEnvelope(value: unknown): ResultEnvelope {
    const record = asRecord(value, 'result');
    const outcome = requiredString(record, 'outcome', 'result', 20) as RemoteOutcome;
    if (outcome !== 'PASS' && outcome !== 'FAIL' && outcome !== 'BLOCKED') {
        throw new EnvelopeError('ENVELOPE_INVALID', 'result.outcome must be PASS | FAIL | BLOCKED');
    }
    const evidenceRecord = asRecord(record.evidence, 'result.evidence');
    // Include evidence.outcome in the signed shape: changing it must break the signature.
    const evidenceOutcomeRaw = optionalString(evidenceRecord, 'outcome', 'result.evidence', 20) ?? outcome;
    if (evidenceOutcomeRaw !== 'PASS' && evidenceOutcomeRaw !== 'FAIL' && evidenceOutcomeRaw !== 'BLOCKED') {
        throw new EnvelopeError('ENVELOPE_INVALID', 'result.evidence.outcome must be PASS | FAIL | BLOCKED');
    }
    const evidence: RemoteEvidence = {
        outcome: evidenceOutcomeRaw,
        workerId: requiredString(evidenceRecord, 'workerId', 'result.evidence', 200),
        adapter: requiredString(evidenceRecord, 'adapter', 'result.evidence', 30),
        model: optionalString(evidenceRecord, 'model', 'result.evidence', 200) ?? null,
        exitCode: evidenceRecord.exitCode === undefined || evidenceRecord.exitCode === null ? null : Number(evidenceRecord.exitCode),
        durationMs: Number(evidenceRecord.durationMs ?? 0),
    };
    if (evidence.exitCode !== null && !Number.isFinite(evidence.exitCode)) {
        throw new EnvelopeError('ENVELOPE_INVALID', 'result.evidence.exitCode must be a number or null');
    }
    if (!Number.isFinite(evidence.durationMs) || evidence.durationMs < 0) {
        throw new EnvelopeError('ENVELOPE_INVALID', 'result.evidence.durationMs must be a non-negative number');
    }
    const modelSource = optionalString(evidenceRecord, 'modelSource', 'result.evidence', 50);
    if (modelSource) evidence.modelSource = modelSource;
    const tier = evidenceRecord.tier;
    if (tier === null || typeof tier === 'string') evidence.tier = tier as string | null;
    const effort = optionalString(evidenceRecord, 'effort', 'result.evidence', 50);
    if (effort) evidence.effort = effort;
    if (evidenceRecord.timedOut !== undefined) evidence.timedOut = evidenceRecord.timedOut === true;
    const errorCode = optionalString(evidenceRecord, 'errorCode', 'result.evidence', 100);
    if (errorCode) evidence.errorCode = errorCode;
    const errorMessage = optionalString(evidenceRecord, 'errorMessage', 'result.evidence', 1000);
    if (errorMessage) evidence.errorMessage = errorMessage;

    const at = requiredString(record, 'at', 'result', 100);
    if (Number.isNaN(Date.parse(at))) throw new EnvelopeError('ENVELOPE_INVALID', 'result.at must be an ISO timestamp');

    return {
        jobId: requiredString(record, 'jobId', 'result', 200),
        ok: record.ok === true,
        outcome,
        evidence,
        observationId: optionalString(record, 'observationId', 'result', 500) ?? null,
        remoteRuntimeKey: requiredString(record, 'remoteRuntimeKey', 'result', 200),
        at,
        nonce: requiredString(record, 'nonce', 'result', 200),
    };
}

export async function signJob(job: JobEnvelope, secret: string): Promise<SignedJobEnvelope> {
    const validated = validateJobEnvelope(job);
    const signature = await hmacSha256Hex(secret, signingInput('job', validated));
    return { envelope: validated, signature };
}

export async function verifyJobSignature(signed: unknown, secret: string): Promise<JobEnvelope> {
    const wrapper = asRecord(signed, 'signed job');
    const signature = optionalString(wrapper, 'signature', 'signed job', 128);
    if (!signature || !HEX_SIGNATURE.test(signature)) {
        throw new EnvelopeError('ENVELOPE_SIGNATURE_INVALID', 'job signature is missing or malformed');
    }
    const job = validateJobEnvelope(wrapper.envelope);
    const expected = await hmacSha256Hex(secret, signingInput('job', job));
    if (!constantTimeEqual(expected, signature.toLowerCase())) {
        throw new EnvelopeError('ENVELOPE_SIGNATURE_INVALID', 'job signature does not match');
    }
    return job;
}

export async function signResult(result: ResultEnvelope, secret: string): Promise<SignedResultEnvelope> {
    const validated = validateResultEnvelope(result);
    const signature = await hmacSha256Hex(secret, signingInput('result', validated));
    return { envelope: validated, signature };
}

export async function verifyResultSignature(signed: unknown, secret: string): Promise<ResultEnvelope> {
    const wrapper = asRecord(signed, 'signed result');
    const signature = optionalString(wrapper, 'signature', 'signed result', 128);
    if (!signature || !HEX_SIGNATURE.test(signature)) {
        throw new EnvelopeError('ENVELOPE_SIGNATURE_INVALID', 'result signature is missing or malformed');
    }
    const result = validateResultEnvelope(wrapper.envelope);
    const expected = await hmacSha256Hex(secret, signingInput('result', result));
    if (!constantTimeEqual(expected, signature.toLowerCase())) {
        throw new EnvelopeError('ENVELOPE_SIGNATURE_INVALID', 'result signature does not match');
    }
    return result;
}

export function createNonce(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}
