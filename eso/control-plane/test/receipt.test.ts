/**
 * P4 — receipt & integrity.
 *
 * Run: `cd eso/control-plane && bun test test/receipt.test.ts`
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';

import { MemoryPlatformStore, RegistryService, type Actor } from '../src/platform/registry/index.js';
import { REQUEST_SPEC_REF } from '../src/platform/registry/types.js';
import {
    GENESIS_HASH,
    ReceiptService,
    canonicalJson,
    hashPayload,
    receiptHmac,
    receiptKey,
} from '../src/modules/receipt/receipt.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };
const SECRET_USER_QUERY = 'SECRET_USER_QUERY: rewrite the production database';
const SECRET_PROMPT_TEXT = 'SECRET_PROMPT_TEXT: full host prompt body';
const SECRET_EVIDENCE_VALUE = 'SECRET_EVIDENCE_VALUE: sk-live-1234567890';

type Obs = { event: string; evidence: Record<string, unknown> };

function decision(): Obs {
    return {
        event: 'decision.recorded',
        evidence: {
            winner: 'plan',
            verdict: 'allow',
            basis: 'core.slp says build then verify',
            actor: { kind: 'host', id: 'cursor', role: 'builder' },
            refs: [{ kind: 'rule', path: 'agents/rules/core.slp.mdc', line: 42 }],
            schemaVersion: 1,
        },
    };
}

function packet(): Obs {
    return {
        event: 'evidence.packet',
        evidence: { hash: 'sha256:abc123', note: SECRET_EVIDENCE_VALUE },
    };
}

function action(): Obs {
    return {
        event: 'action.recorded',
        evidence: { tool: 'apply_patch', outcome: 'PASS', files: ['src/example.ts'] },
    };
}

function turn(): Obs[] {
    return [
        { event: 'prompt.submitted', evidence: { userQuery: SECRET_USER_QUERY, promptText: SECRET_PROMPT_TEXT } },
        decision(),
        packet(),
        action(),
    ];
}

async function setup(consumerId: string): Promise<MemoryPlatformStore> {
    const store = new MemoryPlatformStore();
    const registry = new RegistryService(store);
    await registry.initialize();
    await registry.createConsumer({ id: consumerId, name: consumerId, root: `/tmp/eso-${consumerId}`, actor });
    return store;
}

async function observe(store: MemoryPlatformStore, consumerId: string, traceId: string, items: Obs[]): Promise<void> {
    for (const [index, item] of items.entries()) {
        await store.insertObservation(consumerId, {
            observationId: `${traceId}-obs-${index}`,
            traceId,
            hostId: 'cursor',
            runtimeKey: 'cursor:cursor-agent',
            workerId: null,
            event: item.event,
            outcome: item.event === 'action.recorded' ? 'PASS' : null,
            evidence: item.evidence,
            at: new Date(Date.UTC(2026, 10, 24, 10, 0, index)).toISOString(),
            idempotencyKey: randomUUID(),
        });
    }
}

function tamper(store: MemoryPlatformStore, receiptId: string): void {
    const row = (store as any).receipts.get(receiptId);
    assert.ok(row, 'receipt must be stored before it can be tampered with');
    row.payload.verdict.basis = 'tampered: no rule was cited';
}

describe('P4 — receipt issue', () => {
    test('chain across two traces: GENESIS then prev_hash = previous hash', async () => {
        const consumerId = 'receipt-unit';
        const store = await setup(consumerId);
        await observe(store, consumerId, 'trace-a', turn());
        await observe(store, consumerId, 'trace-b', [...turn(), action()]);
        const service = new ReceiptService(store);

        const first = await service.issue(consumerId, 'trace-a');
        const second = await service.issue(consumerId, 'trace-b');

        assert.equal(first.prevHash, GENESIS_HASH);
        assert.equal(second.prevHash, first.hash);
        assert.equal(first.hash, hashPayload(first.payload));
        assert.equal(second.hash, hashPayload(second.payload));
        assert.equal(first.prevHash, GENESIS_HASH);
        assert.equal((await store.getLastReceipt(consumerId))?.receiptId, second.receiptId);
    });

    test('idempotent per trace: a repeated issue returns the stored row', async () => {
        const consumerId = 'receipt-unit';
        const store = await setup(consumerId);
        await observe(store, consumerId, 'trace-idem', turn());
        const service = new ReceiptService(store);

        const first = await service.issue(consumerId, 'trace-idem');
        const again = await service.issue(consumerId, 'trace-idem');

        assert.equal(again.receiptId, first.receiptId);
        assert.equal(again.hash, first.hash);
        assert.equal(again.createdAt, first.createdAt);
        assert.equal((store as any).receipts.size, 1);
        assert.equal((await store.getReceiptByTrace(consumerId, 'trace-idem'))?.receiptId, first.receiptId);
    });

    test('canonical payload: keys are exactly the sealed shape, sorted deterministically', async () => {
        const consumerId = 'receipt-unit';
        const store = await setup(consumerId);
        await observe(store, consumerId, 'trace-shape', turn());
        const service = new ReceiptService(store);
        const receipt = await service.issue(consumerId, 'trace-shape');

        assert.equal(receipt.specVersion, 1);
        assert.equal(receipt.verdictLevel, 'allow');
        assert.deepEqual(
            Object.keys(receipt.payload).sort(),
            ['consumerId', 'eventDigests', 'specRef', 'specVersion', 'traceId', 'verdict']
        );
        // B0-9 — the sealed spec reference is a pointer only: doc · version · section, no anchor, no prose.
        // Read the single constant so a doc bump cannot leave the test pinned to a stale version.
        assert.deepEqual(receipt.payload.specRef, {
            doc: REQUEST_SPEC_REF.doc,
            version: REQUEST_SPEC_REF.version,
            section: REQUEST_SPEC_REF.section,
        });
        assert.deepEqual(Object.keys(receipt.payload.specRef ?? {}).sort(), ['doc', 'section', 'version']);
        assert.deepEqual(
            Object.keys(receipt.payload.verdict).sort(),
            ['actor', 'basis', 'gaps', 'level', 'score']
        );
        assert.deepEqual(
            Object.keys(receipt.payload.eventDigests[0]).sort(),
            ['at', 'event', 'observationId', 'outcome']
        );
        assert.deepEqual(receipt.payload.eventDigests.map((digest) => digest.event), [
            'prompt.submitted',
            'decision.recorded',
            'evidence.packet',
            'action.recorded',
        ]);
        // key order must not change the bytes: the canonical form is stable across runs
        assert.equal(canonicalJson(receipt.payload), canonicalJson(JSON.parse(JSON.stringify(receipt.payload))));
    });

    test('payload carries no user query, prompt text or evidence value (PII)', async () => {
        const consumerId = 'receipt-unit';
        const store = await setup(consumerId);
        await observe(store, consumerId, 'trace-pii', turn());
        const service = new ReceiptService(store);
        const receipt = await service.issue(consumerId, 'trace-pii');

        const sealed = JSON.stringify(receipt.payload);
        assert.ok(!sealed.includes(SECRET_USER_QUERY), 'user query must not be sealed');
        assert.ok(!sealed.includes(SECRET_PROMPT_TEXT), 'prompt text must not be sealed');
        assert.ok(!sealed.includes(SECRET_EVIDENCE_VALUE), 'evidence values must not be sealed');
        assert.ok(!sealed.includes('userQuery'));
        assert.ok(!sealed.includes('promptText'));
        assert.ok(!sealed.includes('sk-live'));
    });

    test('no key configured ⇒ hmac is null, honestly', async () => {
        const consumerId = 'receipt-unit';
        const previous = process.env.ESO_RECEIPT_KEY;
        delete process.env.ESO_RECEIPT_KEY;
        try {
            const store = await setup(consumerId);
            await observe(store, consumerId, 'trace-nokey', turn());
            const service = new ReceiptService(store);
            const receipt = await service.issue(consumerId, 'trace-nokey');

            assert.equal(receiptKey(consumerId), null);
            assert.equal(receipt.hmac, null);
            const result = await service.verify(consumerId, receipt.receiptId);
            assert.deepEqual(result, { ok: true, hashMatches: true, hmacMatches: true, chained: true });
        } finally {
            if (previous === undefined) delete process.env.ESO_RECEIPT_KEY;
            else process.env.ESO_RECEIPT_KEY = previous;
        }
    });

    test('key configured ⇒ hmac is stored and verifies', async () => {
        const consumerId = 'receipt-unit';
        const previous = process.env.ESO_RECEIPT_KEY;
        process.env.ESO_RECEIPT_KEY = 'test-receipt-key';
        try {
            const store = await setup(consumerId);
            await observe(store, consumerId, 'trace-keyed', turn());
            const service = new ReceiptService(store);
            const receipt = await service.issue(consumerId, 'trace-keyed');

            assert.notEqual(receipt.hmac, null);
            assert.equal(receipt.hmac, receiptHmac(receiptKey(consumerId), receipt.prevHash, receipt.hash));
            const result = await service.verify(consumerId, receipt.receiptId);
            assert.equal(result.ok, true);
            assert.equal(result.hmacMatches, true);
        } finally {
            if (previous === undefined) delete process.env.ESO_RECEIPT_KEY;
            else process.env.ESO_RECEIPT_KEY = previous;
        }
    });
});

describe('P4 — receipt verify', () => {
    test('verify ok on an untouched receipt', async () => {
        const consumerId = 'receipt-unit';
        const store = await setup(consumerId);
        await observe(store, consumerId, 'trace-ok', turn());
        const service = new ReceiptService(store);
        const receipt = await service.issue(consumerId, 'trace-ok');

        const result = await service.verify(consumerId, receipt.receiptId);
        assert.deepEqual(result, { ok: true, hashMatches: true, hmacMatches: true, chained: true });
    });

    test('a receipt sealed before B0-9 (no specRef) still verifies from its stored bytes', async () => {
        const consumerId = 'receipt-unit';
        const store = await setup(consumerId);
        await observe(store, consumerId, 'trace-legacy-spec', turn());
        const service = new ReceiptService(store);
        const receipt = await service.issue(consumerId, 'trace-legacy-spec');

        // Simulate a row written before the field existed: drop the key and re-seal the old bytes.
        const row = (store as any).receipts.get(receipt.receiptId);
        delete row.payload.specRef;
        row.hash = hashPayload(row.payload);

        const result = await service.verify(consumerId, receipt.receiptId);
        assert.deepEqual(result, { ok: true, hashMatches: true, hmacMatches: true, chained: true });
    });

    test('tamper the payload ⇒ hash mismatch and verify FAIL', async () => {
        const consumerId = 'receipt-unit';
        const store = await setup(consumerId);
        await observe(store, consumerId, 'trace-tamper', turn());
        const service = new ReceiptService(store);
        const receipt = await service.issue(consumerId, 'trace-tamper');
        assert.equal((await service.verify(consumerId, receipt.receiptId)).ok, true);

        tamper(store, receipt.receiptId);

        const result = await service.verify(consumerId, receipt.receiptId);
        assert.equal(result.hashMatches, false);
        assert.equal(result.ok, false);
        assert.equal(result.chained, true, 'the chain link is untouched by a payload edit');
    });

    test('tamper the stored hash ⇒ hmac mismatch when a key is configured', async () => {
        const consumerId = 'receipt-unit';
        const previous = process.env.ESO_RECEIPT_KEY;
        process.env.ESO_RECEIPT_KEY = 'test-receipt-key';
        try {
            const store = await setup(consumerId);
            await observe(store, consumerId, 'trace-hmac', turn());
            const service = new ReceiptService(store);
            const receipt = await service.issue(consumerId, 'trace-hmac');

            (store as any).receipts.get(receipt.receiptId).hash = 'f'.repeat(64);

            const result = await service.verify(consumerId, receipt.receiptId);
            assert.equal(result.hashMatches, false);
            assert.equal(result.hmacMatches, false);
            assert.equal(result.ok, false);
        } finally {
            if (previous === undefined) delete process.env.ESO_RECEIPT_KEY;
            else process.env.ESO_RECEIPT_KEY = previous;
        }
    });

    test('a receipt id that does not exist is a 404, not a fabricated verdict', async () => {
        const consumerId = 'receipt-unit';
        const store = await setup(consumerId);
        const service = new ReceiptService(store);
        await assert.rejects(
            () => service.verify(consumerId, 'rcpt_missing'),
            (error: any) => error?.code === 'NOT_FOUND' && error?.status === 404
        );
    });
});
