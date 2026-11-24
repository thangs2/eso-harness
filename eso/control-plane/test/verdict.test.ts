/**
 * P2 — verdict & sufficiency core.
 *
 * Run: `cd eso/control-plane && bun test test/verdict.test.ts`
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';

import { MemoryPlatformStore, RegistryService, type Actor } from '../src/platform/registry/index.js';
import { adjudicate, VerdictService } from '../src/modules/verdict/verdict.service.js';

const actor: Actor = { kind: 'operator', label: 'operator@test' };

type Obs = { event: string; evidence: Record<string, unknown> };

function decision(overrides: Record<string, unknown> = {}, withActor = true): Obs {
    return {
        event: 'decision.recorded',
        evidence: {
            winner: 'plan',
            verdict: 'allow',
            basis: 'rule core.slp says build then verify',
            refs: [{ kind: 'rule', path: 'agents/rules/core.slp.mdc', line: 42 }],
            ...(withActor ? { actor: { kind: 'host', id: 'cursor', role: 'builder' } } : {}),
            schemaVersion: 1,
            ...overrides,
        },
    };
}

function packet(withActor = true): Obs {
    return {
        event: 'evidence.packet',
        evidence: { hash: 'sha256:abc123', ...(withActor ? { actor: { kind: 'host', id: 'cursor' } } : {}) },
    };
}

function action(withActor = true): Obs {
    return {
        event: 'action.recorded',
        evidence: {
            tool: 'apply_patch',
            outcome: 'PASS',
            files: ['src/example.ts'],
            ...(withActor ? { actor: { kind: 'host', id: 'cursor' } } : {}),
        },
    };
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
            outcome: null,
            evidence: item.evidence,
            at: new Date(Date.UTC(2026, 10, 24, 10, 0, index)).toISOString(),
            idempotencyKey: randomUUID(),
        });
    }
}

describe('P2 — adjudicate (pure)', () => {
    test('deny claim ⇒ deny', () => {
        const result = adjudicate('verdict-unit', [decision({ verdict: 'deny' })]);
        assert.equal(result.level, 'deny');
        assert.deepEqual(result.gaps, []);
        assert.equal(result.score, 100);
        assert.match(result.basis, /^claim=deny:/);
        assert.equal(result.actor?.id, 'cursor');
    });

    test('no decision.recorded ⇒ unknown + HOST_SILENT with a consequence', () => {
        const result = adjudicate('verdict-unit', [action(), packet()]);
        assert.equal(result.level, 'unknown');
        assert.equal(result.gaps.length, 1);
        assert.equal(result.gaps[0].code, 'HOST_SILENT');
        assert.match(result.gaps[0].consequence, /cannot prove why/);
        assert.equal(result.score, 75);
        assert.match(result.basis, /^claim=none:/);
    });

    test('host verdict unknown ⇒ unknown', () => {
        const result = adjudicate('verdict-unit', [decision({ verdict: 'unknown' })]);
        assert.equal(result.level, 'unknown');
        assert.deepEqual(result.gaps, []);
    });

    test('host verdict partial ⇒ partial', () => {
        const result = adjudicate('verdict-unit', [decision({ verdict: 'partial' })]);
        assert.equal(result.level, 'partial');
        assert.deepEqual(result.gaps, []);
    });

    test('allow without evidence.packet ⇒ partial + EVIDENCE_MISSING', () => {
        const result = adjudicate('verdict-unit', [decision(), action()]);
        assert.equal(result.level, 'partial');
        assert.deepEqual(result.gaps.map((gap) => gap.code), ['EVIDENCE_MISSING']);
        assert.equal(result.score, 75);
    });

    test('allow without actor ⇒ partial + ACTOR_MISSING', () => {
        const result = adjudicate('verdict-unit', [decision({}, false), packet(false), action(false)]);
        assert.equal(result.level, 'partial');
        assert.deepEqual(result.gaps.map((gap) => gap.code), ['ACTOR_MISSING']);
        assert.equal(result.actor, null);
    });

    test('allow without action.recorded tool ⇒ partial + ACTION_MISSING', () => {
        const result = adjudicate('verdict-unit', [decision(), packet()]);
        assert.equal(result.level, 'partial');
        assert.deepEqual(result.gaps.map((gap) => gap.code), ['ACTION_MISSING']);
        assert.ok(result.gaps[0].what.includes('action.recorded'));
        assert.ok(result.gaps[0].consequence.length > 0);
    });

    test('full allow ⇒ allow, score 100, refs + actor carried', () => {
        const result = adjudicate('verdict-unit', [decision(), packet(), action()]);
        assert.equal(result.level, 'allow');
        assert.deepEqual(result.gaps, []);
        assert.equal(result.score, 100);
        assert.equal(result.actor?.role, 'builder');
        assert.deepEqual(result.ruleRefs, [{ kind: 'rule', path: 'agents/rules/core.slp.mdc', line: 42 }]);
        assert.match(result.basis, /build then verify/);
    });

    test('score = max(0, 100 - 25 per gap)', () => {
        const allMissing = adjudicate('verdict-unit', [decision({}, false)]);
        assert.equal(allMissing.level, 'partial');
        assert.equal(allMissing.gaps.length, 3);
        assert.equal(allMissing.score, 25);
    });
});

describe('P2 — ensureVerdict (idempotent append)', () => {
    test('computes once, stores once, returns the same computedAt', async () => {
        const consumerId = 'verdict-unit';
        const store = await setup(consumerId);
        await observe(store, consumerId, 'trace-idem', [decision(), packet(), action()]);

        const service = new VerdictService(store);
        const first = await service.ensureVerdict(consumerId, 'trace-idem');
        const second = await service.ensureVerdict(consumerId, 'trace-idem');

        assert.equal(first.level, 'allow');
        assert.equal(first.score, 100);
        assert.equal(first.traceId, 'trace-idem');
        assert.equal(first.consumerId, consumerId);
        assert.equal(first.receiptId, null);
        assert.equal(second.computedAt, first.computedAt);
        assert.equal(second.basis, first.basis);
        assert.equal((store as any).turnVerdicts.size, 1);
        const stored = await store.getTurnVerdict(consumerId, 'trace-idem');
        assert.deepEqual(stored, first);
    });

    test('unknown request id is a 404, not a fabricated verdict', async () => {
        const consumerId = 'verdict-unit';
        const store = await setup(consumerId);
        const service = new VerdictService(store);
        await assert.rejects(
            () => service.ensureVerdict(consumerId, 'trace-never-seen'),
            (error: any) => error?.code === 'NOT_FOUND' && error?.status === 404
        );
        assert.equal((store as any).turnVerdicts.size, 0);
    });
});
