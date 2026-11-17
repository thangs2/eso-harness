/**
 * Persistent Mode B job ledger (P5).
 *
 * Host B remembers completed jobs so a duplicate `jobId` returns the stored signed result without
 * re-running the worker — even after a restart. Backed by one JSON file with atomic replacement.
 *
 * Bound: TTL 24h, max 200 entries (newest win). A corrupt file is moved aside and the ledger
 * starts empty instead of crashing the remote runtime.
 */

import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { SignedResultEnvelope } from './envelope';
import { atomicWriteFile, readTextFile, resolveCacheDir } from '../offline-cache';

export const DEFAULT_LEDGER_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_LEDGER_MAX_ENTRIES = 200;
export const DEFAULT_LEDGER_FILE_NAME = 'modeb-jobs.json';

export interface JobLedgerOptions {
    /** Explicit file path; otherwise ESO_REMOTE_LEDGER or <cacheDir>/modeb-jobs.json. */
    filePath?: string;
    cacheDir?: string;
    ttlMs?: number;
    maxEntries?: number;
    nowImpl?: () => number;
}

/** Ledger path: explicit → ESO_REMOTE_LEDGER → <cacheDir>/modeb-jobs.json. */
export function resolveLedgerPath(
    explicit?: string,
    cacheDir?: string,
    env: Record<string, string | undefined> = process.env,
): string {
    const fromOption = (explicit ?? '').trim();
    if (fromOption) return fromOption;
    const fromEnv = (env.ESO_REMOTE_LEDGER ?? '').trim();
    if (fromEnv) return fromEnv;
    return join(resolveCacheDir(cacheDir, env), DEFAULT_LEDGER_FILE_NAME);
}

interface LedgerEntry {
    signed: SignedResultEnvelope;
    at: number;
}

interface LedgerFile {
    ledgerVersion: 1;
    entries: Record<string, LedgerEntry>;
}

const LEDGER_VERSION = 1;

function isEntry(value: unknown, jobId: string): value is LedgerEntry {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    const signed = record.signed as Record<string, unknown> | undefined;
    if (!signed || typeof signed.signature !== 'string') return false;
    const envelope = signed.envelope as Record<string, unknown> | undefined;
    if (!envelope || typeof envelope.jobId !== 'string' || envelope.jobId !== jobId) return false;
    return typeof record.at === 'number' && Number.isFinite(record.at);
}

export class JobLedger {
    readonly filePath: string;
    readonly ttlMs: number;
    readonly maxEntries: number;
    private readonly nowImpl: () => number;
    private entries = new Map<string, LedgerEntry>();

    constructor(options: JobLedgerOptions = {}) {
        this.filePath = resolveLedgerPath(options.filePath, options.cacheDir);
        this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_LEDGER_TTL_MS);
        this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_LEDGER_MAX_ENTRIES);
        this.nowImpl = options.nowImpl ?? (() => Date.now());
        this.load();
    }

    get(jobId: string): SignedResultEnvelope | null {
        const entry = this.entries.get(jobId);
        if (!entry) return null;
        if (this.nowImpl() - entry.at > this.ttlMs) {
            this.entries.delete(jobId);
            this.persist();
            return null;
        }
        return entry.signed;
    }

    set(jobId: string, signed: SignedResultEnvelope): void {
        this.entries.set(jobId, { signed, at: this.nowImpl() });
        this.prune();
        this.persist();
    }

    size(): number {
        this.prune();
        return this.entries.size;
    }

    private prune(): void {
        const now = this.nowImpl();
        for (const [jobId, entry] of this.entries) {
            if (now - entry.at > this.ttlMs) this.entries.delete(jobId);
        }
        if (this.entries.size <= this.maxEntries) return;
        const newestFirst = [...this.entries.entries()].sort((left, right) => right[1].at - left[1].at);
        this.entries = new Map(newestFirst.slice(0, this.maxEntries));
    }

    private load(): void {
        const text = readTextFile(this.filePath);
        if (text === null) return;
        if (!text.trim()) return;
        let parsed: LedgerFile;
        try {
            parsed = JSON.parse(text) as LedgerFile;
        } catch {
            this.quarantineCorrupt('not valid JSON');
            return;
        }
        if (!parsed || parsed.ledgerVersion !== LEDGER_VERSION || !parsed.entries || typeof parsed.entries !== 'object') {
            this.quarantineCorrupt('unsupported ledger shape');
            return;
        }
        for (const [jobId, entry] of Object.entries(parsed.entries)) {
            if (isEntry(entry, jobId)) this.entries.set(jobId, entry);
        }
        this.prune();
    }

    private quarantineCorrupt(reason: string): void {
        this.entries.clear();
        try {
            if (existsSync(this.filePath)) renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        } catch {
            // Quarantine is best effort; the next write replaces the file atomically.
        }
        void reason;
    }

    private persist(): void {
        const file: LedgerFile = { ledgerVersion: LEDGER_VERSION, entries: Object.fromEntries(this.entries) };
        atomicWriteFile(this.filePath, JSON.stringify(file));
    }
}
