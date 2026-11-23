/**
 * AC legacy batch 1 — close AC that had code but no AC-named test.
 * SCN/AC ids are pinned so RTM-LEGACY can link them directly.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore, RegistryService, type Actor } from '../src/platform/registry/index.js';
import { RegistrationService } from '../src/modules/consumers/registration/registration.service.js';
import { LifecycleService } from '../src/modules/consumers/lifecycle/lifecycle.service.js';
import { PlatformError, ERROR_STATUS } from '../src/platform/registry/errors.js';
import { BRD_ERROR_CODES, toErrorResponse } from '../src/common/errors/envelope.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };

async function fixture() {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    const dir = mkdtempSync(join(tmpdir(), 'eso-batch1-'));
    await new RegistrationService(registry, store).register({
        id: 'batch-acme', name: 'Batch Acme', root: dir, profile: { recipe: 'pro' }, actor,
    });
    return { store, lifecycle: new LifecycleService(store), dir };
}

describe('AC legacy batch 1', () => {
    test('SCN-03-3 · AC-03-3 — root là file ⇒ 422 ROOT_NOT_FOUND', async () => {
        const store = new MemoryPlatformStore();
        const registry = new RegistryService(store);
        await registry.initialize();
        const dir = mkdtempSync(join(tmpdir(), 'eso-batch1-'));
        try {
            const file = join(dir, 'root.txt');
            writeFileSync(file, 'x');
            await assert.rejects(
                new RegistrationService(registry, store).register({ id: 'root-file', name: 'F', root: file, actor }),
                (e: any) => e.code === 'ROOT_NOT_FOUND',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-07-2 · AC-07-2 — retired ⇒ data route 404 CONSUMER_NOT_FOUND', async () => {
        const { lifecycle, dir } = await fixture();
        try {
            await lifecycle.transition('batch-acme', 'retire', actor);
            await assert.rejects(
                lifecycle.assertDataRoute('batch-acme'),
                (e: any) => e.code === 'CONSUMER_NOT_FOUND',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-07-3 · AC-07-3 — reactivate ⇒ ready', async () => {
        const { lifecycle, dir } = await fixture();
        try {
            await lifecycle.transition('batch-acme', 'retire', actor);
            const back = await lifecycle.transition('batch-acme', 'reactivate', actor);
            assert.equal(back.status, 'ready');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-08-2 · AC-08-2 — restore deleted ⇒ ready', async () => {
        const { lifecycle, dir } = await fixture();
        try {
            await lifecycle.transition('batch-acme', 'delete', actor);
            const restored = await lifecycle.transition('batch-acme', 'restore', actor);
            assert.equal(restored.status, 'ready');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-08-3 · AC-08-3 — restore khi ready ⇒ 409 INVALID_STATE', async () => {
        const { lifecycle, dir } = await fixture();
        try {
            await assert.rejects(
                lifecycle.transition('batch-acme', 'restore', actor),
                (e: any) => e.code === 'INVALID_STATE',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('SCN-16-2 · AC-16-2 — body {code,message} + status đúng', () => {
        const err = new PlatformError('CONSUMER_NOT_FOUND');
        const res = toErrorResponse(err);
        assert.deepEqual(res.body, { code: 'CONSUMER_NOT_FOUND', message: err.message });
        assert.equal(res.status, ERROR_STATUS['CONSUMER_NOT_FOUND']);
        assert.equal(typeof res.body.code, 'string');
        assert.equal(typeof res.body.message, 'string');
    });

    test('SCN-16-3 · AC-16-3 — mã lỗi phải có trong BRD/06', () => {
        for (const code of Object.keys(ERROR_STATUS)) {
            assert.equal(BRD_ERROR_CODES.has(code), true, `${code} must be registered`);
        }
    });
});
