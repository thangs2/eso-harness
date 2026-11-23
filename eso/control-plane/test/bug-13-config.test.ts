/**
 * BUG-13 — S3 config: real preview hash + compare-and-swap save (409 STALE_VERSION).
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore, RegistryService, type Actor } from '../src/platform/registry/index.js';
import { RegistrationService } from '../src/modules/consumers/registration/registration.service.js';
import { ConsumerConfigService, configHash } from '../src/modules/consumer-config/consumer-config.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const root = mkdtempSync(join(tmpdir(), 'eso-bug13-'));
    roots.push(root);
    mkdirSync(join(root, '.harness'), { recursive: true });
    writeFileSync(join(root, '.harness', 'config.json'), JSON.stringify({ version: 1, profile: { recipe: 'pro' } }));
    await new RegistrationService(registry, store).register({ id: 'cfg-acme', name: 'Cfg', root, actor });
    return { store, service: new ConsumerConfigService(store), root };
}

describe('BUG-13 config preview/save', () => {
    test('preview trả hash thật, ổn định theo nội dung', async () => {
        const { service, root } = await fixture();
        const first = await service.preview('cfg-acme');
        const second = await service.preview('cfg-acme');
        // registration/provisioning may rewrite the file; the hash must follow the file on disk
        const onDisk = JSON.parse(readFileSync(join(root, '.harness', 'config.json'), 'utf8'));
        assert.equal(first.hash, second.hash);
        assert.equal(first.hash, configHash(onDisk));
        assert.match(first.hash, /^[0-9a-f]{64}$/);
    });

    test('save đúng hash ⇒ ghi file + hash mới', async () => {
        const { service, root } = await fixture();
        const preview = await service.preview('cfg-acme');
        const result = await service.save('cfg-acme', { hash: preview.hash, config: { version: 2, profile: { recipe: 'pro' } } });
        assert.equal(result.ok, true);
        const written = JSON.parse(readFileSync(join(root, '.harness', 'config.json'), 'utf8'));
        assert.equal(written.version, 2);
        assert.equal(result.hash, configHash(written));
    });

    test('save hash cũ ⇒ 409 STALE_VERSION, không ghi', async () => {
        const { service, root } = await fixture();
        const preview = await service.preview('cfg-acme');
        writeFileSync(join(root, '.harness', 'config.json'), JSON.stringify({ version: 9 }));
        await assert.rejects(
            service.save('cfg-acme', { hash: preview.hash, config: { version: 3 } }),
            (error: any) => error.code === 'STALE_VERSION',
        );
        assert.equal(JSON.parse(readFileSync(join(root, '.harness', 'config.json'), 'utf8')).version, 9);
    });

    test('save thiếu hash ⇒ INVALID_STATE', async () => {
        const { service } = await fixture();
        await assert.rejects(service.save('cfg-acme', {}), (error: any) => error.code === 'INVALID_STATE');
    });
});
