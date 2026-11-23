/**
 * F-12 / REQ-20 — memory native của ESO.
 *
 * A fact is written as `proposed`; only a human approval makes it `approved` and readable as
 * durable knowledge (BR-05). The store is injected, so the service is storage-agnostic: the
 * in-memory store below is the test/embedded adapter, a DB/schema adapter can implement the same
 * `MemoryFactStore` contract.
 *
 * AC: sdlc/06.analysis/02.ac/AC-20.md · SCN: sdlc/06.analysis/03.scn/SCN-20.md
 */
import { randomUUID } from 'node:crypto';

import { applyDecision, type ApprovalStamp, type KnowledgeStatus } from '../../common/approval/approval.js';
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId } from '../../platform/registry/store.js';
import type { Actor } from '../../platform/registry/types.js';

export type MemoryStatus = KnowledgeStatus;

export interface MemoryFactInput {
    /** Stable lookup key (optional). */
    key?: string | null;
    text: string;
    /** Non-empty by BR-16 — a fact without a source cannot be recorded. */
    source: string;
    /** Consumer / role / domain scope (O-F12b is still open; opaque string here). */
    scope?: string | null;
}

export interface MemoryFact extends ApprovalStamp {
    id: string;
    consumerId: string;
    key: string | null;
    text: string;
    source: string;
    scope: string | null;
}

export interface MemoryFactFilter {
    status?: MemoryStatus;
    scope?: string | null;
}

export interface MemoryReadOptions {
    scope?: string | null;
}

export interface MemoryReadResult {
    consumerId: string;
    /** Approved facts only, each with its `source` + `approvedAt` intact. */
    facts: MemoryFact[];
}

/** Storage contract — mirrors `PlatformStore`: async methods, no persistence assumptions. */
export interface MemoryFactStore {
    insert(fact: MemoryFact): Promise<void>;
    get(consumerId: string, factId: string): Promise<MemoryFact | null>;
    save(fact: MemoryFact): Promise<void>;
    list(consumerId: string, filter?: MemoryFactFilter): Promise<MemoryFact[]>;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function factKey(consumerId: string, factId: string): string {
    return `${consumerId}:${factId}`;
}

/** In-memory adapter (the `MemoryPlatformStore` equivalent for memory facts). */
export class InMemoryMemoryFactStore implements MemoryFactStore {
    private readonly facts = new Map<string, MemoryFact>();

    async insert(fact: MemoryFact): Promise<void> {
        const key = factKey(fact.consumerId, fact.id);
        if (this.facts.has(key)) fail('INVALID_STATE', `memory fact ${fact.id} already exists`);
        this.facts.set(key, clone(fact));
    }

    async get(consumerId: string, factId: string): Promise<MemoryFact | null> {
        const fact = this.facts.get(factKey(consumerId, factId));
        return fact ? clone(fact) : null;
    }

    async save(fact: MemoryFact): Promise<void> {
        this.facts.set(factKey(fact.consumerId, fact.id), clone(fact));
    }

    async list(consumerId: string, filter: MemoryFactFilter = {}): Promise<MemoryFact[]> {
        return [...this.facts.values()]
            .filter((fact) => fact.consumerId === consumerId)
            .filter((fact) => (filter.status ? fact.status === filter.status : true))
            .filter((fact) => (filter.scope !== undefined ? fact.scope === filter.scope : true))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((fact) => clone(fact));
    }
}

function requiredText(value: unknown, field: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) fail('INVALID_STATE', `${field} is required`);
    return text;
}

export class MemoryService {
    constructor(private readonly store: MemoryFactStore) {}

    /** AC-20-1 — a new fact is recorded as `proposed`, never durable yet. */
    async propose(consumerId: string, input: MemoryFactInput, actor: Actor): Promise<MemoryFact> {
        const id = assertConsumerId(consumerId);
        const fact: MemoryFact = {
            id: randomUUID(),
            consumerId: id,
            key: typeof input?.key === 'string' && input.key.trim() ? input.key.trim() : null,
            text: requiredText(input?.text, 'fact text'),
            source: requiredText(input?.source, 'fact source'),
            scope: typeof input?.scope === 'string' && input.scope.trim() ? input.scope.trim() : null,
            status: 'proposed',
            createdBy: actor?.label || actor?.kind || 'unknown',
            createdAt: new Date().toISOString(),
            approvedBy: null,
            approvedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectReason: null,
        };
        await this.store.insert(fact);
        return fact;
    }

    /** AC-20-2 — only a human operator moves `proposed → approved`. */
    async approve(consumerId: string, factId: string, actor: Actor): Promise<MemoryFact> {
        const fact = await this.requireFact(consumerId, factId);
        const approved = applyDecision(fact, 'approve', actor, new Date().toISOString());
        await this.store.save(approved);
        return approved;
    }

    /** Human rejection keeps the record for audit but never makes it durable. */
    async reject(consumerId: string, factId: string, actor: Actor, reason?: string): Promise<MemoryFact> {
        const fact = await this.requireFact(consumerId, factId);
        const rejected = applyDecision(fact, 'reject', actor, new Date().toISOString(), reason ?? null);
        await this.store.save(rejected);
        return rejected;
    }

    async get(consumerId: string, factId: string): Promise<MemoryFact | null> {
        const id = assertConsumerId(consumerId);
        return this.store.get(id, factId);
    }

    /** All facts, any status — the proposal/audit view. */
    async list(consumerId: string, filter: MemoryFactFilter = {}): Promise<MemoryFact[]> {
        const id = assertConsumerId(consumerId);
        return this.store.list(id, filter);
    }

    /** AC-20-2 postcondition — read durable knowledge back 100% intact. */
    async read(consumerId: string, options: MemoryReadOptions = {}): Promise<MemoryReadResult> {
        const id = assertConsumerId(consumerId);
        const facts = await this.store.list(id, {
            status: 'approved',
            ...(options.scope !== undefined ? { scope: options.scope } : {}),
        });
        return { consumerId: id, facts };
    }

    /** FRD F-12 §3 — demanding durable use of an unapproved fact is `NEEDS_APPROVAL`. */
    async requireApproved(consumerId: string, factId: string): Promise<MemoryFact> {
        const fact = await this.requireFact(consumerId, factId);
        if (fact.status !== 'approved') {
            fail('NEEDS_APPROVAL', `memory fact ${fact.id} is ${fact.status}; durable use requires human approval`);
        }
        return fact;
    }

    private async requireFact(consumerId: string, factId: string): Promise<MemoryFact> {
        const id = assertConsumerId(consumerId);
        const fact = await this.store.get(id, factId);
        if (!fact) fail('INVALID_STATE', `memory fact not found: ${factId}`);
        return fact;
    }
}
