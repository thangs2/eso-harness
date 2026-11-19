import { describe, expect, it } from 'bun:test';
import { resolveHostCredential } from '../src/credentials';

describe('host-owned credentials', () => {
    it('prefers explicit then keychain then env', () => {
        expect(resolveHostCredential({ explicit: 'x', env: { TOKEN: 'e' }, envKeys: ['TOKEN'] }).source).toBe('explicit');
        expect(resolveHostCredential({ service: 'svc', keychainRead: () => 'k', env: { TOKEN: 'e' }, envKeys: ['TOKEN'] }).source).toBe('keychain');
        expect(resolveHostCredential({ env: { TOKEN: 'e' }, envKeys: ['TOKEN'] }).source).toBe('env');
        expect(resolveHostCredential({ env: {} }).source).toBe('none');
    });

    it('falls back to env when keychain read throws', () => {
        const result = resolveHostCredential({ service: 'svc', keychainRead: () => { throw new Error('no keychain'); }, env: { TOKEN: 'e' }, envKeys: ['TOKEN'] });
        expect(result.source).toBe('env');
        expect(result.secret).toBe('e');
    });
});
