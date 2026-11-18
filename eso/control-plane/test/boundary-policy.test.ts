import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { BoundaryPolicyService, DEFAULT_POLICIES } from '../src/modules/boundaries/boundary-policy.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import { RegistryService } from '../src/platform/registry/service.js';
import { RegistrationService } from '../src/modules/consumers/registration/registration.service.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const registration = new RegistrationService(registry, store);
    const root = mkdtempSync(join(tmpdir(), 'eso-boundary-'));
    roots.push(root);
    await registration.register({
        id: 'boundary-consumer', name: 'Boundary', root,
        profile: { canonical: { agents: 'agents', harness: '.harness' }, observation: { consent: true } },
        actor: { kind: 'operator', label: 'operator@test' },
    });
    return { store, root, service: new BoundaryPolicyService(store) };
}

describe('boundary policy + grants', () => {
    it('returns defaults, saves CRUD policy and projects folder-policy.json', async () => {
        const { service, root } = await fixture();
        const initial = await service.get('boundary-consumer');
        assert.equal(initial.defaults, true);
        assert.equal(initial.policies.length, DEFAULT_POLICIES.length);
        const policies = initial.policies.map((policy) => policy.id === 'default-sdlc'
            ? { ...policy, write: 'gated' as const }
            : policy);
        const saved = await service.save('boundary-consumer', policies, { kind: 'operator', label: 'operator@test' });
        assert.equal(saved.defaults, false);
        assert.equal(saved.policies.find((policy) => policy.id === 'default-sdlc')?.write, 'gated');
        const projected = JSON.parse(readFileSync(join(root, '.harness', 'policy', 'folder-policy.json'), 'utf8'));
        assert.equal(projected.policies.find((policy: any) => policy.id === 'default-sdlc').write, 'gated');
    });

    it('creates single-use write grant with 15m TTL and revokes it', async () => {
        const { service, root } = await fixture();
        const grant = await service.createGrant('boundary-consumer', {
            kind: 'write', targetPrefix: 'data-lake/**', purpose: 'test', ttlMs: 15 * 60_000,
        }, { kind: 'operator', label: 'operator@test' });
        assert.equal(grant.kind, 'write');
        assert.equal(grant.mode, 'once');
        assert.ok(grant.expiresAt);
        assert.ok(existsSync(join(root, '.harness', 'policy', 'grants.json')));
        const listed = await service.get('boundary-consumer');
        assert.equal(listed.grants.length, 1);
        await service.revokeGrant('boundary-consumer', grant.grantId, { kind: 'operator', label: 'operator@test' });
        const after = await service.get('boundary-consumer');
        assert.equal(after.grants.length, 0);
    });

    it('rejects reusable write grant and invalid TTL', async () => {
        const { service } = await fixture();
        await assert.rejects(service.createGrant('boundary-consumer', { kind: 'write', targetPrefix: 'x', mode: 'always' }, { kind: 'operator' }), (error: any) => /always/.test(String(error.detail)));
        await assert.rejects(service.createGrant('boundary-consumer', { kind: 'write', targetPrefix: 'x', ttlMs: 99_999_999 }, { kind: 'operator' }), (error: any) => /TTL/.test(String(error.detail)));
    });

    it('seeds missing policy for fleet rollout and is idempotent', async () => {
        const { service, root } = await fixture();
        const first = await service.ensureSeed('boundary-consumer');
        assert.equal(first.seeded, true);
        assert.equal(existsSync(join(root, '.harness', 'policy', 'folder-policy.json')), true);
        const second = await service.ensureSeed('boundary-consumer');
        assert.equal(second.seeded, false);
        const rollout = await service.rollout({ kind: 'operator', label: 'operator@test' });
        assert.equal(rollout.consumers >= 1, true);
        assert.equal(rollout.results.some((item) => item.consumerId === 'boundary-consumer'), true);
    });

    it('allows always read grant without expiry and rejects bad policy', async () => {
        const { service } = await fixture();
        const grant = await service.createGrant('boundary-consumer', { kind: 'read', targetPrefix: '/tmp/shared', mode: 'always' }, { kind: 'operator' });
        assert.equal(grant.expiresAt, null);
        await assert.rejects(service.save('boundary-consumer', [{ path: '', pathType: 'glob', read: 'allow', write: 'deny', index: false, priority: 1 }], { kind: 'operator' }), (error: any) => /path/.test(String(error.detail)));
    });
});
