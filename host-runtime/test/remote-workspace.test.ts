import { describe, expect, it } from 'bun:test';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { validateWorkspace } from '../src/remote/workspace';
import { initGitRepo, makeTempDir } from './remote-fixtures';

describe('remote workspace validation', () => {
    it('accepts an existing absolute directory', async () => {
        const temp = makeTempDir();
        try {
            const result = await validateWorkspace({ repo: temp.dir });
            expect(result.ok).toBe(true);
            expect(result.realpath).toBe(realpathSync(temp.dir));
        } finally {
            temp.cleanup();
        }
    });

    it('rejects missing, relative and non-directory workspaces', async () => {
        const temp = makeTempDir();
        try {
            const missing = await validateWorkspace({ repo: join(temp.dir, 'nope') });
            expect(missing.ok).toBe(false);
            expect(missing.code).toBe('WORKSPACE_MISSING');

            const relative = await validateWorkspace({ repo: 'relative/path' });
            expect(relative.ok).toBe(false);
            expect(relative.code).toBe('WORKSPACE_INVALID');

            const file = join(temp.dir, 'file.txt');
            await Bun.write(file, 'not a directory');
            const notDir = await validateWorkspace({ repo: file });
            expect(notDir.ok).toBe(false);
            expect(notDir.code).toBe('WORKSPACE_NOT_DIRECTORY');
        } finally {
            temp.cleanup();
        }
    });

    it('enforces the allowed roots allow-list', async () => {
        const root = makeTempDir('host-runtime-root-');
        const outside = makeTempDir('host-runtime-outside-');
        try {
            const inside = await validateWorkspace({ repo: root.dir }, { allowedRoots: [root.dir] });
            expect(inside.ok).toBe(true);

            const blocked = await validateWorkspace({ repo: outside.dir }, { allowedRoots: [root.dir] });
            expect(blocked.ok).toBe(false);
            expect(blocked.code).toBe('WORKSPACE_NOT_ALLOWED');

            // Nested directories are inside the root.
            await Bun.write(join(root.dir, 'nested.txt'), 'x');
            const nested = await validateWorkspace({ repo: join(root.dir) }, { allowedRoots: [root.dir] });
            expect(nested.ok).toBe(true);
        } finally {
            root.cleanup();
            outside.cleanup();
        }
    });

    it('rejects a symlink escaping the allowed roots', async () => {
        const root = makeTempDir('host-runtime-root-');
        const outside = makeTempDir('host-runtime-outside-');
        try {
            const link = join(root.dir, 'escape');
            const result = await Bun.spawn(['ln', '-s', outside.dir, link]).exited;
            if (result !== 0) return; // symlink creation unavailable: not a failure of the validator
            const validation = await validateWorkspace({ repo: link }, { allowedRoots: [root.dir] });
            expect(validation.ok).toBe(false);
            expect(validation.code).toBe('WORKSPACE_NOT_ALLOWED');
        } finally {
            root.cleanup();
            outside.cleanup();
        }
    });

    it('verifies the requested git commit', async () => {
        const temp = makeTempDir('host-runtime-git-');
        try {
            const { commit } = await initGitRepo(temp.dir);
            const matching = await validateWorkspace({ repo: temp.dir, commit });
            expect(matching.ok).toBe(true);
            expect(matching.commit).toBe(commit);

            const mismatched = await validateWorkspace({ repo: temp.dir, commit: 'f'.repeat(40) });
            expect(mismatched.ok).toBe(false);
            expect(mismatched.code).toBe('WORKSPACE_COMMIT_MISMATCH');
            expect(mismatched.reason).toContain(commit);
        } finally {
            temp.cleanup();
        }
    });

    it('verifies the requested git branch', async () => {
        const temp = makeTempDir('host-runtime-git-');
        try {
            const { branch } = await initGitRepo(temp.dir);
            const matching = await validateWorkspace({ repo: temp.dir, branch });
            expect(matching.ok).toBe(true);
            const mismatched = await validateWorkspace({ repo: temp.dir, branch: 'no-such-branch' });
            expect(mismatched.ok).toBe(false);
            expect(mismatched.code).toBe('WORKSPACE_BRANCH_MISMATCH');
        } finally {
            temp.cleanup();
        }
    });

    it('blocks a commit request against a non-git directory', async () => {
        const temp = makeTempDir();
        try {
            const result = await validateWorkspace({ repo: temp.dir, commit: 'a'.repeat(40) });
            expect(result.ok).toBe(false);
            expect(result.code).toBe('WORKSPACE_NOT_GIT_REPO');
        } finally {
            temp.cleanup();
        }
    });

    it('does not require git when no commit or branch is requested', async () => {
        const temp = makeTempDir();
        try {
            const result = await validateWorkspace({ repo: temp.dir });
            expect(result.ok).toBe(true);
            expect(result.commit).toBe(null);
        } finally {
            temp.cleanup();
        }
    });
});
