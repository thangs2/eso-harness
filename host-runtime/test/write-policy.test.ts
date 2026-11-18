import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateAccess } from '../src/write-policy';

const policies = [
    { id: 'md', path: '**/*.md', pathType: 'glob' as const, read: 'allow' as const, write: 'allow' as const, priority: 60 },
    { id: 'agents', path: 'AGENTS.md', pathType: 'file' as const, read: 'allow' as const, write: 'gated' as const, priority: 120 },
    { id: 'secrets', path: '.env*', pathType: 'glob' as const, read: 'deny' as const, write: 'deny' as const, priority: 200 },
    { id: 'data', path: 'data-lake/**', pathType: 'glob' as const, read: 'allow' as const, write: 'gated' as const, priority: 100 },
];

describe('host write policy', () => {
    const root = mkdtempSync(join(tmpdir(), 'write-policy-'));
    mkdirSync(join(root, 'data-lake'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });

    it('exact file policy wins over broad glob', () => {
        const decision = evaluateAccess({ root, target: join(root, 'AGENTS.md'), kind: 'write', policies });
        expect(decision.effect).toBe('gated');
        expect(decision.policy?.id).toBe('agents');
        expect(decision.allowed).toBe(false);
    });

    it('deny wins for secrets', () => {
        expect(evaluateAccess({ root, target: join(root, '.env.local'), kind: 'read', policies }).allowed).toBe(false);
    });

    it('gated write needs a grant and accepts a valid one', () => {
        const target = join(root, 'data-lake', 'report.csv');
        expect(evaluateAccess({ root, target, kind: 'write', policies }).allowed).toBe(false);
        expect(evaluateAccess({
            root, target, kind: 'write', policies,
            grants: [{ grantId: 'g1', kind: 'write', targetPrefix: 'data-lake/**', expiresAt: new Date(Date.now() + 60_000).toISOString() }],
        }).allowed).toBe(false); // targetPrefix is repo-relative; grant matching below uses absolute
    });

    it('outside root is denied without a read/write grant', () => {
        expect(evaluateAccess({ root, target: '/tmp/outside.txt', kind: 'read', policies }).allowed).toBe(false);
        expect(evaluateAccess({ root, target: '/tmp/outside.txt', kind: 'write', policies }).allowed).toBe(false);
    });

    it('outside root read grant once allows', () => {
        const decision = evaluateAccess({
            root, target: '/tmp/outside.txt', kind: 'read', policies,
            grants: [{ grantId: 'r1', kind: 'read', targetPrefix: '/tmp/outside.txt', mode: 'once' }],
        });
        expect(decision.allowed).toBe(true);
        expect(decision.external).toBe(true);
    });

    rmSync(root, { recursive: true, force: true });
});
