import { describe, expect } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { clampMaxSteps, MAX_HOST_STEPS } from '../src/entrypoint';
import { buildEvidence, MAX_STDERR_TAIL, MAX_STDOUT_TAIL } from '../src/evidence';
import { idempotencyKeyFor, observationIdFor } from '../src/observation-client';
import { resolveModel } from '../src/model-resolver';
import { stableJson, signJob, signResult, verifyJobSignature, verifyResultSignature } from '../src/remote/envelope';
import type { JobEnvelope, ResultEnvelope } from '../src/remote/envelope';
import { JobLedger } from '../src/remote/job-ledger';
import { validateWorkspace } from '../src/remote/workspace';
import { makeTempDir } from './remote-fixtures';
import { property, rng } from './property-harness';
import type { Rng } from './property-harness';

const SECRET = 'property-modeb-secret-0123456789';

function key(r: Rng): string {
    return `${r.string(4, 'abcdefghijklmnopqrstuvwxyz')}:${r.string(5, 'abcdefghijklmnopqrstuvwxyz0123456789-')}`;
}

function randomJson(r: Rng, depth = 0): unknown {
    if (depth > 2) return r.pick([null, true, false, r.int(-9, 9), r.string(6)]);
    switch (r.int(0, 3)) {
        case 0:
            return r.int(-100, 100);
        case 1:
            return r.string(r.int(0, 12));
        case 2:
            return Array.from({ length: r.int(0, 3) }, () => randomJson(r, depth + 1));
        default: {
            const object: Record<string, unknown> = {};
            for (let index = 0; index < r.int(0, 3); index += 1) object[r.string(r.int(1, 8))] = randomJson(r, depth + 1);
            return object;
        }
    }
}

function shuffledObject(r: Rng, value: Record<string, unknown>): Record<string, unknown> {
    const entries = Object.entries(value);
    for (let index = entries.length - 1; index > 0; index -= 1) {
        const swap = r.int(0, index);
        [entries[index], entries[swap]] = [entries[swap]!, entries[index]!];
    }
    return Object.fromEntries(entries);
}

function randomJob(r: Rng): JobEnvelope {
    return {
        jobId: `job-${r.string(1, 'abcdef')}-${r.int(1, 999)}`,
        fromRuntimeKey: key(r),
        toRuntimeKey: key(r),
        workspaceRef: { repo: `/tmp/ws-${r.string(1, 'abcdef')}`, branch: r.bool() ? 'main' : undefined },
        workerId: `worker-${r.string(1, 'abcdef')}`,
        flowId: 'property-flow',
        prompt: r.string(r.int(1, 80), 'abc def'),
        policy: { adapter: r.pick(['dry', 'cursor', 'agy'] as const), dryRun: r.bool(), model: r.bool() ? `model-${r.int(1, 9)}` : undefined },
        modelTier: r.pick(['fast', 'balanced', 'reasoning']),
        evidenceRequirements: { includeStdoutTail: r.bool(), maxStdoutTail: r.int(0, 500) },
        createdAt: new Date(0).toISOString(),
        nonce: r.string(8),
    };
}

function randomResult(r: Rng): ResultEnvelope {
    return {
        jobId: `job-${r.int(1, 999)}`,
        ok: r.bool(),
        outcome: r.pick(['PASS', 'FAIL', 'BLOCKED'] as const),
        evidence: {
            outcome: r.pick(['PASS', 'FAIL', 'BLOCKED'] as const),
            workerId: `worker-${r.string(1, 'abcdef')}`,
            adapter: r.pick(['dry', 'cursor', 'agy'] as const),
            model: r.bool() ? `model-${r.int(1, 9)}` : null,
            exitCode: r.bool() ? r.int(0, 2) : null,
            durationMs: r.int(0, 5000),
        },
        observationId: r.bool() ? `obs-${r.string(4)}` : null,
        remoteRuntimeKey: key(r),
        at: new Date(0).toISOString(),
        nonce: r.string(8),
    };
}

describe('property — Mode A invariants', () => {
    property('clampMaxSteps always returns an integer in [1, MAX_HOST_STEPS]', (r) => ({
        value: r.bool() ? r.int(-500, MAX_HOST_STEPS + 500) : r.bool() ? Number.NaN : 0.5,
    }), ({ value }) => {
        const steps = clampMaxSteps(value);
        expect(Number.isInteger(steps)).toBe(true);
        expect(steps).toBeGreaterThanOrEqual(1);
        expect(steps).toBeLessThanOrEqual(MAX_HOST_STEPS);
    });

    property('observation id and idempotency key are deterministic per step', (r) => ({
        trace: r.string(10),
        worker: r.bool() ? `worker-${r.string(4)}` : null,
        step: r.int(1, 30),
    }), ({ trace, worker, step }) => {
        expect(observationIdFor(trace, worker, step)).toBe(observationIdFor(trace, worker, step));
        expect(idempotencyKeyFor(trace, worker, step)).toBe(idempotencyKeyFor(trace, worker, step));
        expect(observationIdFor(trace, worker, step + 1)).not.toBe(observationIdFor(trace, worker, step));
    });

    property('evidence never leaks prompt/secrets and stays bounded', (r) => {
        const prompt = `PROMPT-${r.string(20)}`;
        const secret = `SECRET-${r.string(20)}`;
        return { prompt, secret, stdout: `${prompt}\n${secret}\nOUTCOME: PASS`, stderr: secret };
    }, ({ prompt, secret, stdout, stderr }) => {
        const evidence = buildEvidence({
            adapter: 'dry', model: null, modelSource: 'default', tier: null,
            workerId: 'worker-build', flowId: 'property-flow', hostStep: 1,
            exitCode: 0, durationMs: 3, stdout, stderr,
            redaction: { prompt, secrets: [secret] },
        });
        const serialized = JSON.stringify(evidence);
        expect(serialized.includes(prompt)).toBe(false);
        expect(serialized.includes(secret)).toBe(false);
        expect(evidence.stdoutTail.length).toBeLessThanOrEqual(MAX_STDOUT_TAIL);
        expect(evidence.stderrTail.length).toBeLessThanOrEqual(MAX_STDERR_TAIL);
    });

    property('explicit model always wins model resolution', (r) => {
        const explicit = `model-${r.string(5)}`;
        return { explicit, models: [r.string(5), r.string(5)], tier: r.pick(['fast', 'balanced', 'reasoning']) };
    }, ({ explicit, models, tier }) => {
        const resolution = resolveModel({
            explicitModel: explicit,
            runtime: { hostId: 'h', runtimeId: 'r', runtimeKey: 'h:r', runtimeKind: 'cli', models, modelTiers: { [tier]: { model: 'tier-model' } } },
            placement: { workerId: 'w', allowedHosts: ['h:r'], modelTier: tier as never, nativeAgent: {}, fallback: 'block' },
            runtimeKey: 'h:r',
        });
        expect(resolution.model).toBe(explicit);
        expect(resolution.source).toBe('explicit');
    });
});

describe('property — Mode B invariants', () => {
    property('stableJson is independent of object key order', (r) => {
        const value = randomJson(r);
        return { value, reordered: value && typeof value === 'object' && !Array.isArray(value) ? shuffledObject(r, value as Record<string, unknown>) : value };
    }, ({ value, reordered }) => {
        expect(stableJson(reordered)).toBe(stableJson(value));
    });

    property('signed job/result roundtrip preserves fields and rejects tampering', (r) => ({
        job: randomJob(r),
        result: randomResult(r),
    }), async ({ job, result }) => {
        const signedJob = await signJob(job, SECRET);
        expect(await verifyJobSignature(signedJob, SECRET)).toEqual(job);
        const signedResult = await signResult(result, SECRET);
        expect(await verifyResultSignature(signedResult, SECRET)).toEqual(result);

        const tamperedJob = { ...job, jobId: `${job.jobId}-tampered` };
        await expect(verifyJobSignature({ envelope: tamperedJob, signature: signedJob.signature }, SECRET)).rejects.toMatchObject({
            code: 'ENVELOPE_SIGNATURE_INVALID',
        });

        const tamperedResult = { ...result, jobId: `${result.jobId}-tampered` };
        await expect(verifyResultSignature({ envelope: tamperedResult, signature: signedResult.signature }, SECRET)).rejects.toMatchObject({
            code: 'ENVELOPE_SIGNATURE_INVALID',
        });
    });

    property('workspace outside allow-list is rejected and inside is accepted', (r) => {
        const root = makeTempDir('property-ws-root-');
        const outside = makeTempDir('property-ws-outside-');
        const nested = join(root.dir, `nested-${r.string(4)}`);
        mkdirSync(nested, { recursive: true });
        return { root, outside, nested };
    }, async ({ root, outside, nested }) => {
        try {
            const allowed = await validateWorkspace({ repo: nested }, { allowedRoots: [root.dir] });
            expect(allowed.ok).toBe(true);
            const denied = await validateWorkspace({ repo: outside.dir }, { allowedRoots: [root.dir] });
            expect(denied.ok).toBe(false);
            expect(denied.code).toBe('WORKSPACE_NOT_ALLOWED');
        } finally {
            root.cleanup();
            outside.cleanup();
        }
    });

    property('ledger returns the same signed result for a replayed job id', (r) => {
        const dir = makeTempDir('property-ledger-');
        return { dir, jobId: `job-${r.string(6)}`, result: randomResult(r) };
    }, async ({ dir, jobId, result }) => {
        try {
            const signed = await signResult({ ...result, jobId }, SECRET);
            const ledger = new JobLedger({ filePath: join(dir.dir, 'ledger.json') });
            ledger.set(jobId, signed);
            expect(ledger.get(jobId)).toEqual(signed);
            const reopened = new JobLedger({ filePath: join(dir.dir, 'ledger.json') });
            expect(reopened.get(jobId)).toEqual(signed);
        } finally {
            dir.cleanup();
        }
    });
});
