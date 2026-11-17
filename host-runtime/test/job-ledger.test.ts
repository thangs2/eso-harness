import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JobLedger, DEFAULT_LEDGER_MAX_ENTRIES, resolveLedgerPath } from '../src/remote/job-ledger';
import { signResult } from '../src/remote/envelope';
import type { ResultEnvelope, SignedResultEnvelope } from '../src/remote/envelope';
import { AGY_RUNTIME_KEY, REMOTE_SECRET, makeTempDir } from './remote-fixtures';

async function signedResult(jobId: string): Promise<SignedResultEnvelope> {
    const result: ResultEnvelope = {
        jobId,
        ok: true,
        outcome: 'PASS',
        evidence: {
            outcome: 'PASS',
            workerId: 'worker-build',
            adapter: 'dry',
            model: 'gemini-4-argon-high',
            effort: 'high',
            exitCode: 0,
            durationMs: 0,
            timedOut: false,
        },
        observationId: `obs-worker-build-1-${jobId}`,
        remoteRuntimeKey: AGY_RUNTIME_KEY,
        at: '2026-11-17T00:00:00.000Z',
        nonce: `nonce-${jobId}`,
    };
    return signResult(result, REMOTE_SECRET);
}

describe('persistent Mode B job ledger', () => {
    it('stores and reloads a signed result from disk', async () => {
        const temp = makeTempDir('hr-ledger-');
        try {
            const filePath = join(temp.dir, 'modeb-jobs.json');
            const ledger = new JobLedger({ filePath });
            expect(ledger.get('job-1')).toBe(null);
            ledger.set('job-1', await signedResult('job-1'));
            expect(ledger.get('job-1')?.envelope.jobId).toBe('job-1');

            const reloaded = new JobLedger({ filePath });
            expect(reloaded.get('job-1')?.envelope.observationId).toBe('obs-worker-build-1-job-1');
            expect(reloaded.size()).toBe(1);
            const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { ledgerVersion: number; entries: Record<string, unknown> };
            expect(parsed.ledgerVersion).toBe(1);
            expect(Object.keys(parsed.entries)).toEqual(['job-1']);
            // The ledger stores signed results, never prompts or tokens.
            const text = readFileSync(filePath, 'utf8');
            expect(text.includes(REMOTE_SECRET)).toBe(false);
        } finally {
            temp.cleanup();
        }
    });

    it('expires entries after the TTL', async () => {
        const temp = makeTempDir('hr-ledger-');
        try {
            let now = 1_000_000;
            const filePath = join(temp.dir, 'modeb-jobs.json');
            const ledger = new JobLedger({ filePath, ttlMs: 1000, nowImpl: () => now });
            ledger.set('job-1', await signedResult('job-1'));
            now += 999;
            expect(ledger.get('job-1')).not.toBe(null);
            now += 10;
            expect(ledger.get('job-1')).toBe(null);
            expect(new JobLedger({ filePath, ttlMs: 1000, nowImpl: () => now }).size()).toBe(0);
        } finally {
            temp.cleanup();
        }
    });

    it('caps entries at maxEntries, keeping the newest', async () => {
        const temp = makeTempDir('hr-ledger-');
        try {
            let now = 1_000_000;
            const ledger = new JobLedger({ filePath: join(temp.dir, 'l.json'), maxEntries: 3, nowImpl: () => now });
            for (let index = 0; index < 5; index += 1) {
                now += 1000;
                ledger.set(`job-${index}`, await signedResult(`job-${index}`));
            }
            expect(ledger.size()).toBe(3);
            expect(ledger.get('job-0')).toBe(null);
            expect(ledger.get('job-1')).toBe(null);
            expect(ledger.get('job-4')).not.toBe(null);
            expect(DEFAULT_LEDGER_MAX_ENTRIES).toBe(200);
        } finally {
            temp.cleanup();
        }
    });

    it('recovers from a corrupt ledger file', async () => {
        const temp = makeTempDir('hr-ledger-');
        try {
            const filePath = join(temp.dir, 'modeb-jobs.json');
            writeFileSync(filePath, '{broken', 'utf8');
            const ledger = new JobLedger({ filePath });
            expect(ledger.size()).toBe(0);
            expect(readdirSync(temp.dir).some((name) => name.startsWith('modeb-jobs.json.corrupt-'))).toBe(true);
            expect(existsSync(filePath)).toBe(false);
            ledger.set('job-1', await signedResult('job-1'));
            expect(new JobLedger({ filePath }).get('job-1')).not.toBe(null);
        } finally {
            temp.cleanup();
        }
    });

    it('resolves the ledger path from option, env and cache dir', () => {
        expect(resolveLedgerPath('/tmp/ledger.json', '/tmp/cache', {})).toBe('/tmp/ledger.json');
        expect(resolveLedgerPath(undefined, '/tmp/cache', { ESO_REMOTE_LEDGER: '/tmp/env-ledger.json' })).toBe('/tmp/env-ledger.json');
        expect(resolveLedgerPath(undefined, '/tmp/cache', {})).toBe(join('/tmp/cache', 'modeb-jobs.json'));
    });
});
