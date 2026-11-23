/**
 * AC legacy batch 5a — US-20 (memory native) + US-24 (transfer tri thức).
 *
 * One test per AC; SCN ids are pinned so `RTM-LEGACY-01` can link them directly.
 * Source: sdlc/06.analysis/03.scn/SCN-20.md · SCN-24.md
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryMemoryFactStore, MemoryService } from '../src/modules/memory/memory.service.js';
import { InMemoryTransferStore, TransferService } from '../src/modules/transfer/transfer.service.js';
import type { Actor } from '../src/platform/registry/types.js';

const operator: Actor = { kind: 'operator', label: 'operator@test' };
const agent: Actor = { kind: 'machine', label: 'agent@test' };
const system: Actor = { kind: 'system', label: 'scheduler@test' };
const consumerId = 'batch5a-acme';

const memoryFixture = (): MemoryService => new MemoryService(new InMemoryMemoryFactStore());
const transferFixture = (): TransferService => new TransferService(new InMemoryTransferStore());

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
    try {
        await fn();
    } catch (error) {
        return String((error as { code?: string }).code ?? (error as Error).message);
    }
    return 'NO_ERROR';
}

describe('AC legacy batch 5a', () => {
    test('SCN-20-1 · AC-20-1 — fact mới ghi ⇒ proposed, chưa dùng làm tri thức bền', async () => {
        const memory = memoryFixture();
        const fact = await memory.propose(
            consumerId,
            {
                key: 'stack.control-plane',
                text: 'control-plane dùng NestJS + Fastify',
                source: 'sdlc/07.technical/10.planes/03.plane-d-data-model.md',
                scope: 'architecture',
            },
            agent,
        );

        // Then: proposed
        assert.equal(fact.status, 'proposed');
        assert.equal(fact.createdBy, agent.label);

        // Postcondition: chưa dùng làm tri thức bền
        assert.deepEqual((await memory.read(consumerId)).facts, []);
        assert.equal(await codeOf(() => memory.requireApproved(consumerId, fact.id)), 'NEEDS_APPROVAL');
        // The proposal is still recorded for the approval queue.
        assert.deepEqual((await memory.list(consumerId)).map((item) => item.id), [fact.id]);
    });

    test('SCN-20-2 · AC-20-2 — người duyệt duyệt ⇒ approved, đọc lại được 100%', async () => {
        const memory = memoryFixture();
        const fact = await memory.propose(
            consumerId,
            { text: 'BR-05: chỉ người duyệt tri thức bền', source: 'sdlc/05.requirements/01.specification/02.brd', scope: 'policy' },
            agent,
        );

        const approved = await memory.approve(consumerId, fact.id, operator);

        // Then: approved
        assert.equal(approved.status, 'approved');
        assert.equal(approved.approvedBy, operator.label);
        assert.ok(approved.approvedAt);

        // Postcondition: đọc lại được 100%
        const { facts } = await memory.read(consumerId, { scope: 'policy' });
        assert.equal(facts.length, 1);
        assert.deepEqual(facts[0], approved);
    });

    test('SCN-20-3 · AC-20-3 — agent tự duyệt ⇒ NEEDS_APPROVAL/FORBIDDEN_ACTOR, không đổi', async () => {
        const memory = memoryFixture();
        const fact = await memory.propose(
            consumerId,
            { text: 'agent không được tự duyệt', source: 'sdlc/06.analysis/02.ac/AC-20.md' },
            agent,
        );

        // Then: NEEDS_APPROVAL/FORBIDDEN_ACTOR
        const machineCode = await codeOf(() => memory.approve(consumerId, fact.id, agent));
        assert.ok(
            machineCode === 'NEEDS_APPROVAL' || machineCode === 'FORBIDDEN_ACTOR',
            `Then = NEEDS_APPROVAL/FORBIDDEN_ACTOR, got ${machineCode}`,
        );
        assert.equal(await codeOf(() => memory.approve(consumerId, fact.id, system)), 'FORBIDDEN_ACTOR');

        // Postcondition: không đổi
        assert.equal((await memory.get(consumerId, fact.id))?.status, 'proposed');
        assert.deepEqual((await memory.read(consumerId)).facts, []);
    });

    test('SCN-24-1 · AC-24-1 — proposal có nguồn ⇒ proposed, chưa vào KB đích', async () => {
        const transfer = transferFixture();
        const proposal = await transfer.propose(
            consumerId,
            {
                from: 'consumer-src',
                to: 'kb-team',
                kind: 'pattern',
                content: 'Approval state machine dùng chung cho memory + transfer',
                source: 'sdlc/06.analysis/02.ac/AC-24.md',
            },
            agent,
        );

        // Then: proposed
        assert.equal(proposal.status, 'proposed');

        // Postcondition: chưa vào KB đích
        assert.deepEqual(await transfer.entries(consumerId, { to: 'kb-team' }), []);
        assert.deepEqual((await transfer.list(consumerId)).map((item) => item.id), [proposal.id]);
    });

    test('SCN-24-2 · AC-24-2 — người duyệt duyệt ⇒ approved + entry trong KB đích', async () => {
        const transfer = transferFixture();
        const proposal = await transfer.propose(
            consumerId,
            {
                from: 'consumer-src',
                to: 'kb-team',
                kind: 'pattern',
                content: 'proposed → approved/rejected là state machine duy nhất',
                source: 'sdlc/05.requirements/01.specification/03.frd/16.knowledge-transfer.md',
            },
            agent,
        );

        const { proposal: approved, entry } = await transfer.approve(consumerId, proposal.id, operator);

        // Then: approved + entry
        assert.equal(approved.status, 'approved');
        assert.equal(approved.entryId, entry.id);
        assert.equal(entry.transferId, proposal.id);
        assert.equal(entry.content, proposal.content);
        assert.equal(entry.source, proposal.source);

        // Postcondition: KB đích có bản
        const entries = await transfer.entries(consumerId, { to: 'kb-team' });
        assert.equal(entries.length, 1);
        assert.deepEqual(entries[0], entry);
    });

    test('SCN-24-3 · AC-24-3 — agent duyệt ⇒ NEEDS_APPROVAL, không đổi', async () => {
        const transfer = transferFixture();
        const proposal = await transfer.propose(
            consumerId,
            {
                from: 'consumer-src',
                to: 'kb-team',
                kind: 'pattern',
                content: 'máy không được duyệt',
                source: 'sdlc/06.analysis/03.scn/SCN-24.md',
            },
            agent,
        );

        // Then: NEEDS_APPROVAL (exact Then cell of AC-24-3)
        assert.equal(await codeOf(() => transfer.approve(consumerId, proposal.id, agent)), 'NEEDS_APPROVAL');

        // Postcondition: không đổi
        assert.equal((await transfer.get(consumerId, proposal.id))?.status, 'proposed');
        assert.deepEqual(await transfer.entries(consumerId, { to: 'kb-team' }), []);
    });
});
