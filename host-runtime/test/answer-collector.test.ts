import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectLocalAnswers, computePacketHash, extractCitedFilePaths } from '../src/answer-collector';

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('collectLocalAnswers', () => {
    it('hashes real local files deterministically as present + verified with packetItems', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hr-collector-'));
        try {
            const content = '# Workspace Law\nrule-1\n';
            mkdirSync(join(dir, 'src'), { recursive: true });
            writeFileSync(join(dir, 'AGENTS.md'), content, 'utf8');
            writeFileSync(join(dir, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

            const expectedAgentsHash = await sha256Hex(content);
            const expectedAppHash = await sha256Hex('export const x = 1;\n');

            const result = collectLocalAnswers({
                cwd: dir,
                requirements: [{ subject: 'AGENTS.md', source: 'declared' }],
                files: ['src/app.ts'],
            });

            expect(result.answers).toEqual([
                {
                    requirement: 'AGENTS.md',
                    claim: 'AGENTS.md',
                    basis: 'verified',
                    exists: 'present',
                    provider: 'host-runtime:fs-hash',
                    hash: expectedAgentsHash,
                },
                {
                    requirement: 'src/app.ts',
                    claim: 'src/app.ts',
                    basis: 'verified',
                    exists: 'present',
                    provider: 'host-runtime:fs-hash',
                    hash: expectedAppHash,
                },
            ]);

            expect(result.packetItems).toEqual([
                { id: 'AGENTS.md', kind: 'file', hash: expectedAgentsHash, requirementId: 'AGENTS.md' },
                { id: 'src/app.ts', kind: 'file', hash: expectedAppHash },
            ]);
            expect(result.packetHash).toBe(computePacketHash(result.packetItems));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('records absent for missing files or path traversal and never forges present or packetItems', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hr-collector-missing-'));
        try {
            const result = collectLocalAnswers({
                cwd: dir,
                requirements: [{ subject: 'does-not-exist.md', source: 'declared' }],
                files: ['missing.ts', '../outside.txt'],
            });

            expect(result.answers).toEqual([
                {
                    requirement: 'does-not-exist.md',
                    claim: null,
                    basis: 'verified',
                    exists: 'absent',
                    provider: 'host-runtime:fs-hash',
                    hash: null,
                },
                {
                    requirement: 'missing.ts',
                    claim: null,
                    basis: 'verified',
                    exists: 'absent',
                    provider: 'host-runtime:fs-hash',
                    hash: null,
                },
                {
                    requirement: '../outside.txt',
                    claim: null,
                    basis: 'verified',
                    exists: 'absent',
                    provider: 'host-runtime:fs-hash',
                    hash: null,
                },
            ]);
            expect(result.packetItems).toEqual([]);
            expect(result.packetHash).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('extractCitedFilePaths', () => {
    it('extracts markdown file:/// URIs and relative paths under cwd while excluding missing and traversal paths', () => {
        const outer = mkdtempSync(join(tmpdir(), 'hr-cited-outer-'));
        const dir = join(outer, 'repo');
        try {
            mkdirSync(join(dir, 'packages', 'core'), { recursive: true });
            mkdirSync(join(dir, 'src', 'my dir'), { recursive: true });
            writeFileSync(join(outer, 'secret.txt'), 'outside\n', 'utf8');
            writeFileSync(join(dir, 'AGENTS.md'), '# Law\n', 'utf8');
            writeFileSync(join(dir, 'packages', 'core', 'package.json'), '{"name":"core"}\n', 'utf8');
            writeFileSync(join(dir, 'src', 'my dir', 'index.ts'), 'export const a = 1;\n', 'utf8');

            const encodedUri = `file://${encodeURI(join(dir, 'src', 'my dir', 'index.ts'))}#L1-L5`;
            const pkgUri = `file://${join(dir, 'packages', 'core', 'package.json')}#L1`;
            const outsideUri = `file://${join(outer, 'secret.txt')}`;

            const stdout = [
                `Checked [index.ts](${encodedUri}) and [package.json](${pkgUri}).`,
                'Also read `AGENTS.md` and packages/core/package.json (duplicate).',
                `Ignored missing src/ghost.ts, ../secret.txt, and [outside](${outsideUri}).`,
            ].join('\n');

            const cited = extractCitedFilePaths(stdout, dir);
            expect(cited).toEqual([
                'src/my dir/index.ts',
                'packages/core/package.json',
                'AGENTS.md',
            ]);
        } finally {
            rmSync(outer, { recursive: true, force: true });
        }
    });

    it('caps extracted files at maxFiles and ignores directories', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hr-cited-cap-'));
        try {
            mkdirSync(join(dir, 'src'), { recursive: true });
            const lines: string[] = ['Inspect src directory'];
            for (let i = 1; i <= 5; i += 1) {
                writeFileSync(join(dir, 'src', `f${i}.ts`), `export const n = ${i};\n`, 'utf8');
                lines.push(`- src/f${i}.ts`);
            }
            const cited = extractCitedFilePaths(lines.join('\n'), dir, 3);
            expect(cited).toEqual(['src/f1.ts', 'src/f2.ts', 'src/f3.ts']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
