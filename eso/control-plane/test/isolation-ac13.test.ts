/**
 * AC-13 — isolation: consumer không hợp lệ bị chặn ở biên.
 * AC-13-1: id không tồn tại ⇒ CONSUMER_NOT_FOUND
 * AC-13-2: retired/deleted/purged ⇒ CONSUMER_NOT_FOUND
 * AC-13-3: slug sai ⇒ INVALID_CONSUMER_ID (không chạm DB)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryPlatformStore, RegistryService, type Actor } from '../src/platform/registry/index.js';
import { IsolationService, assertConsumerSlug } from '../src/common/db/isolation.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };
const root = '/tmp/eso-ac13';

async function fixture() {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    await registry.createConsumer({ id: 'iso-ready', name: 'ready', root, actor });
    await registry.createConsumer({ id: 'iso-retired', name: 'retired', root, actor });
    await store.setStatus('iso-retired', 'retired', new Date().toISOString());
    await registry.createConsumer({ id: 'iso-deleted', name: 'deleted', root, actor });
    await store.setStatus('iso-deleted', 'deleted', new Date().toISOString());
    return { store, isolation: new IsolationService(store) };
}

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
        await fn();
    } catch (error) {
        return String((error as { code?: string }).code ?? (error as Error).message);
    }
    return 'NO_ERROR';
};

describe('AC-13 — isolation biên consumer', () => {
    test('AC-13-1 · id không tồn tại ⇒ CONSUMER_NOT_FOUND', async () => {
        const { isolation } = await fixture();
        assert.equal(await codeOf(() => isolation.resolve('iso-missing')), 'CONSUMER_NOT_FOUND');
    });

    test('AC-13-2 · retired/deleted ⇒ CONSUMER_NOT_FOUND (cùng thông điệp)', async () => {
        const { isolation } = await fixture();
        assert.equal(await codeOf(() => isolation.resolve('iso-retired')), 'CONSUMER_NOT_FOUND');
        assert.equal(await codeOf(() => isolation.resolve('iso-deleted')), 'CONSUMER_NOT_FOUND');
    });

    test('AC-13-3 · slug sai ⇒ INVALID_CONSUMER_ID', () => {
        for (const raw of ['c_b', '..', 'a/b', 'C_B', '']) {
            try {
                assertConsumerSlug(raw as string);
                assert.fail(`phải reject: ${JSON.stringify(raw)}`);
            } catch (error) {
                assert.equal((error as { code?: string }).code, 'INVALID_CONSUMER_ID', `raw=${JSON.stringify(raw)}`);
            }
        }
    });

    test('AC-13-1 · consumer ready vẫn resolve được (đối chứng)', async () => {
        const { isolation } = await fixture();
        const record = await isolation.resolve('iso-ready');
        assert.equal(record.id, 'iso-ready');
    });
});
