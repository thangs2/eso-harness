/**
 * Workspace validation for Mode B.
 *
 * Host B must never execute a remote worker in a directory it did not expect:
 *   - repo must be an absolute path to an existing directory (realpath'd, symlinks resolved);
 *   - if allowed roots are configured, the realpath must live inside one of them;
 *   - optional branch/commit must match the actual checkout (git rev-parse).
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import type { WorkspaceRef } from './envelope';
import { sanitizeChildEnv, spawnProcess } from '../adapters/types';

export type WorkspaceErrorCode =
    | 'WORKSPACE_INVALID'
    | 'WORKSPACE_MISSING'
    | 'WORKSPACE_NOT_DIRECTORY'
    | 'WORKSPACE_NOT_ALLOWED'
    | 'WORKSPACE_NOT_GIT_REPO'
    | 'WORKSPACE_COMMIT_MISMATCH'
    | 'WORKSPACE_BRANCH_MISMATCH';

export interface WorkspaceValidation {
    ok: boolean;
    code?: WorkspaceErrorCode;
    reason?: string;
    repo: string;
    realpath?: string;
    commit?: string | null;
    branch?: string | null;
}

export interface ValidateWorkspaceOptions {
    allowedRoots?: string[];
    timeoutMs?: number;
    env?: Record<string, string | undefined>;
}

const DEFAULT_GIT_TIMEOUT_MS = 10_000;

function insideRoot(target: string, root: string): boolean {
    return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

async function gitValue(
    realpath: string,
    args: string[],
    options: ValidateWorkspaceOptions,
): Promise<string | null> {
    const result = await spawnProcess('git', ['-C', realpath, ...args], {
        timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
        env: sanitizeChildEnv(options.env ?? process.env),
    });
    if (!result.ok) return null;
    const value = result.stdout.trim();
    return value || null;
}

/**
 * Validate a remote workspace reference. Never throws for a bad workspace: returns
 * `{ ok:false, code, reason }` so the server can answer with a typed error.
 */
export async function validateWorkspace(
    ref: WorkspaceRef,
    options: ValidateWorkspaceOptions = {},
): Promise<WorkspaceValidation> {
    const repo = typeof ref?.repo === 'string' ? ref.repo.trim() : '';
    if (!repo) return { ok: false, code: 'WORKSPACE_INVALID', reason: 'workspaceRef.repo is required', repo };
    if (!isAbsolute(repo)) {
        return { ok: false, code: 'WORKSPACE_INVALID', reason: 'workspaceRef.repo must be an absolute path', repo };
    }
    if (!existsSync(repo)) {
        return { ok: false, code: 'WORKSPACE_MISSING', reason: 'workspaceRef.repo does not exist', repo };
    }
    let realpath: string;
    try {
        const stats = statSync(repo);
        if (!stats.isDirectory()) {
            return { ok: false, code: 'WORKSPACE_NOT_DIRECTORY', reason: 'workspaceRef.repo is not a directory', repo };
        }
        realpath = realpathSync(repo);
    } catch (error) {
        return {
            ok: false,
            code: 'WORKSPACE_INVALID',
            reason: `workspaceRef.repo cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
            repo,
        };
    }

    const roots = (options.allowedRoots ?? []).map((root) => root.trim()).filter(Boolean);
    if (roots.length) {
        const resolvedRoots: string[] = [];
        for (const root of roots) {
            const absolute = isAbsolute(root) ? root : resolve(root);
            try {
                if (existsSync(absolute)) resolvedRoots.push(realpathSync(absolute));
            } catch {
                // A misconfigured root is ignored rather than granting access to something else.
            }
        }
        if (!resolvedRoots.some((root) => insideRoot(realpath, root))) {
            return {
                ok: false,
                code: 'WORKSPACE_NOT_ALLOWED',
                reason: 'workspaceRef.repo is outside ESO_REMOTE_ALLOWED_WS',
                repo,
                realpath,
            };
        }
    }

    const wantsCommit = typeof ref.commit === 'string' && ref.commit.trim().length > 0;
    const wantsBranch = typeof ref.branch === 'string' && ref.branch.trim().length > 0;
    let actualCommit: string | null = null;
    let actualBranch: string | null = null;

    if (wantsCommit || wantsBranch) {
        actualCommit = await gitValue(realpath, ['rev-parse', 'HEAD'], options);
        if (!actualCommit) {
            return {
                ok: false,
                code: 'WORKSPACE_NOT_GIT_REPO',
                reason: 'workspaceRef.repo is not a git checkout',
                repo,
                realpath,
            };
        }
        actualBranch = await gitValue(realpath, ['rev-parse', '--abbrev-ref', 'HEAD'], options);
        if (wantsCommit) {
            const wantedCommit = String(ref.commit).trim();
            if (actualCommit !== wantedCommit) {
                return {
                    ok: false,
                    code: 'WORKSPACE_COMMIT_MISMATCH',
                    reason: `workspace commit is ${actualCommit}, job requires ${wantedCommit}`,
                    repo,
                    realpath,
                    commit: actualCommit,
                };
            }
        }
        if (wantsBranch) {
            const wantedBranch = String(ref.branch).trim();
            if (actualBranch !== wantedBranch) {
                return {
                    ok: false,
                    code: 'WORKSPACE_BRANCH_MISMATCH',
                    reason: `workspace branch is ${actualBranch ?? 'unknown'}, job requires ${wantedBranch}`,
                    repo,
                    realpath,
                    branch: actualBranch,
                };
            }
        }
    }

    return {
        ok: true,
        repo,
        realpath,
        commit: actualCommit,
        branch: actualBranch,
    };
}
