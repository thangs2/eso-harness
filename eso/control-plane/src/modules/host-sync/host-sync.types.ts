/**
 * F-33 / US-41 — host sync domain types.
 *
 * A host folder is a **projection** of the canonical harness (`AGENTS.md` + `agents/`), never a
 * second source. Sync merges into the operator-selected host folders and must not change the
 * consumer identity or version (BR-24 / BR-25).
 */

/** Hosts ESO knows how to project in this batch; anything else fails closed. */
export const SYNC_HOST_IDS = ['cursor', 'antigravity', 'claude', 'dsh'] as const;

export type SyncHostId = (typeof SYNC_HOST_IDS)[number];

export type SyncStatus = 'synced';

export interface HostSyncRequest {
    /** Consumer root that holds the canonical `AGENTS.md`, `agents/` and `.harness/`. */
    root: string;
    /** Operator-selected hosts; no auto-detection. */
    hosts: string[];
}

export interface ProjectionFile {
    /** Canonical path relative to the consumer root, e.g. `agents/rules/core.law-gate.mdc`. */
    source: string;
    /** Projection path relative to the consumer root. */
    target: string;
}

export interface HostProjection {
    host: SyncHostId;
    /** Host folder relative to the consumer root, e.g. `.cursor`. */
    dir: string;
    files: ProjectionFile[];
    /** Files already in the host folder that ESO does not own; never rewritten. */
    preserved: string[];
}

export interface HostSyncResult {
    root: string;
    hosts: SyncHostId[];
    projections: HostProjection[];
    manifestPath: string;
    manifest: Record<string, unknown>;
    /** Consumer version read from `.harness/manifest.json` before sync; unchanged by sync. */
    consumerVersion: number | null;
    syncedAt: string;
}

/** Minimal filesystem port; lets tests inject failures and keeps the service side-effect free. */
export interface SyncFileSystem {
    exists(path: string): boolean;
    isDirectory(path: string): boolean;
    readFile(path: string): string;
    writeFile(path: string, content: string): void;
    mkdirp(path: string): void;
    /** Recursive file paths relative to `dir`, sorted, files only. */
    listFiles(dir: string): string[];
}

export interface HostSyncOptions {
    io?: SyncFileSystem;
    now?: () => Date;
}

export interface HostLayout {
    id: SyncHostId;
    dir: string;
    /** Rule projection extension: `.mdc` for Cursor, `.md` for the markdown-only trees. */
    ruleExt: '.mdc' | '.md';
}
