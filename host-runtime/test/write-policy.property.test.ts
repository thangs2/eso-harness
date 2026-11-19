import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateAccess } from '../src/write-policy';

const policies = [
    { id: 'md', path: '**/*.md', pathType: 'glob' as const, read: 'allow' as const, write: 'allow' as const, priority: 60 },
    { id: 'agents', path: 'AGENTS.md', pathType: 'file' as const, read: 'allow' as const, write: 'gated' as const, priority: 120 },
    { id: 'secrets', path: '.env*', pathType: 'glob' as const, read: 'deny' as const, write: 'deny' as const, priority: 200 },
];

function seeded(seed: number) {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
}

describe('write policy properties', () => {
    const root = mkdtempSync(join(tmpdir(), 'write-policy-prop-'));
    it('denies every dotted env path regardless of directory depth', () => {
        const random = seeded(42);
        for (let index = 0; index < 200; index += 1) {
            const depth = 1 + Math.floor(random() * 6);
            const path = [...Array(depth).fill('d'), `.env.${Math.floor(random() * 1000)}`].join('/');
            const decision = evaluateAccess({ root, target: join(root, path), kind: 'write', policies });
            expect(decision.allowed).toBe(false);
            expect(decision.effect).toBe('deny');
        }
    });
    it('allows arbitrary markdown paths and gates AGENTS.md', () => {
        const random = seeded(7);
        for (let index = 0; index < 200; index += 1) {
            const path = `docs-${Math.floor(random() * 1000)}/note-${index}.md`;
            expect(evaluateAccess({ root, target: join(root, path), kind: 'read', policies }).allowed).toBe(true);
        }
        expect(evaluateAccess({ root, target: join(root, 'AGENTS.md'), kind: 'write', policies }).allowed).toBe(false);
    });
    rmSync(root, { recursive: true, force: true });
});
