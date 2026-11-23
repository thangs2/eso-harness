/**
 * F-16 / REQ-24 — transfer tri thức (propose → approve → entry in the destination KB).
 *
 * An agent may only propose. A human operator approval writes the entry to the destination
 * knowledge base and stamps the proposal; a rejected proposal is kept (with reason) for audit and
 * never reaches the KB (MET-13 = 0 unapproved durable knowledge).
 *
 * AC: sdlc/06.analysis/02.ac/AC-24.md · SCN: sdlc/06.analysis/03.scn/SCN-24.md
 */
import { randomUUID } from 'node:crypto';

import { applyDecision, type ApprovalStamp, type KnowledgeStatus } from '../../common/approval/approval.js';
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId } from '../../platform/registry/store.js';
import type { Actor } from '../../platform/registry/types.js';

export type TransferStatus = KnowledgeStatus;

export interface TransferProposalInput {
    /** Source knowledge base / consumer. */
    from: string;
    /** Destination knowledge base. */
    to: string;
    kind: string;
    content: string;
    /** Required by BR-16 / FRD F-16 §2.4 — no approval without a source. */
    source: string;
}

export interface TransferProposal extends ApprovalStamp {
    id: string;
    consumerId: string;
    from: string;
    to: string;
    kind: string;
    content: string;
    source: string | null;
    /** Set only when the proposal was approved and the destination entry was written. */
    entryId?: string | null;
}

export interface KnowledgeEntry {
    id: string;
    consumerId: string;
    from: string;
    to: string;
    kind: string;
    content: string;
    source: string;
    transferId: string;
    approvedBy: string | null;
    approvedAt: string | null;
}

export interface TransferProposalFilter {
    status?: TransferStatus;
    to?: string;
}

export interface KnowledgeEntryFilter {
    to?: string;
}

export interface TransferApproval {
    proposal: TransferProposal;
    entry: KnowledgeEntry;
}

/** Storage contract — mirrors `PlatformStore`: async methods, no persistence assumptions. */
export interface TransferStore {
    insertProposal(proposal: TransferProposal): Promise<void>;
    getProposal(consumerId: string, proposalId: string): Promise<TransferProposal | null>;
    saveProposal(proposal: TransferProposal): Promise<void>;
    listProposals(consumerId: string, filter?: TransferProposalFilter): Promise<TransferProposal[]>;
    insertEntry(entry: KnowledgeEntry): Promise<void>;
    listEntries(consumerId: string, filter?: KnowledgeEntryFilter): Promise<KnowledgeEntry[]>;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function proposalKey(consumerId: string, proposalId: string): string {
    return `${consumerId}:${proposalId}`;
}

/** In-memory adapter (the `MemoryPlatformStore` equivalent for transfers + destination KB). */
export class InMemoryTransferStore implements TransferStore {
    private readonly proposals = new Map<string, TransferProposal>();
    private readonly entries = new Map<string, KnowledgeEntry>();

    async insertProposal(proposal: TransferProposal): Promise<void> {
        const key = proposalKey(proposal.consumerId, proposal.id);
        if (this.proposals.has(key)) fail('INVALID_STATE', `transfer proposal ${proposal.id} already exists`);
        this.proposals.set(key, clone(proposal));
    }

    async getProposal(consumerId: string, proposalId: string): Promise<TransferProposal | null> {
        const proposal = this.proposals.get(proposalKey(consumerId, proposalId));
        return proposal ? clone(proposal) : null;
    }

    async saveProposal(proposal: TransferProposal): Promise<void> {
        this.proposals.set(proposalKey(proposal.consumerId, proposal.id), clone(proposal));
    }

    async listProposals(consumerId: string, filter: TransferProposalFilter = {}): Promise<TransferProposal[]> {
        return [...this.proposals.values()]
            .filter((proposal) => proposal.consumerId === consumerId)
            .filter((proposal) => (filter.status ? proposal.status === filter.status : true))
            .filter((proposal) => (filter.to ? proposal.to === filter.to : true))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((proposal) => clone(proposal));
    }

    async insertEntry(entry: KnowledgeEntry): Promise<void> {
        this.entries.set(entry.id, clone(entry));
    }

    async listEntries(consumerId: string, filter: KnowledgeEntryFilter = {}): Promise<KnowledgeEntry[]> {
        return [...this.entries.values()]
            .filter((entry) => entry.consumerId === consumerId)
            .filter((entry) => (filter.to ? entry.to === filter.to : true))
            .sort((a, b) => String(a.approvedAt).localeCompare(String(b.approvedAt)))
            .map((entry) => clone(entry));
    }
}

function requiredText(value: unknown, field: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) fail('INVALID_STATE', `${field} is required`);
    return text;
}

export class TransferService {
    constructor(private readonly store: TransferStore) {}

    /** AC-24-1 — a sourced proposal starts as `proposed` and does not touch the destination KB. */
    async propose(consumerId: string, input: TransferProposalInput, actor: Actor): Promise<TransferProposal> {
        const id = assertConsumerId(consumerId);
        const proposal: TransferProposal = {
            id: randomUUID(),
            consumerId: id,
            from: requiredText(input?.from, 'proposal from'),
            to: requiredText(input?.to, 'proposal to'),
            kind: requiredText(input?.kind, 'proposal kind'),
            content: requiredText(input?.content, 'proposal content'),
            source: requiredText(input?.source, 'proposal source'),
            status: 'proposed',
            createdBy: actor?.label || actor?.kind || 'unknown',
            createdAt: new Date().toISOString(),
            approvedBy: null,
            approvedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectReason: null,
            entryId: null,
        };
        await this.store.insertProposal(proposal);
        return proposal;
    }

    /** AC-24-2 — human approval ⇒ `approved` + one entry in the destination KB. */
    async approve(consumerId: string, proposalId: string, actor: Actor): Promise<TransferApproval> {
        const proposal = await this.requireProposal(consumerId, proposalId);
        // Actor first: a machine still gets NEEDS_APPROVAL, never a data/state error (AC-24-3).
        const at = new Date().toISOString();
        const approved = applyDecision(proposal, 'approve', actor, at);
        if (!proposal.source) fail('INVALID_STATE', 'cannot approve a transfer without a source');

        const entry: KnowledgeEntry = {
            id: randomUUID(),
            consumerId: proposal.consumerId,
            from: proposal.from,
            to: proposal.to,
            kind: proposal.kind,
            content: proposal.content,
            source: proposal.source,
            transferId: proposal.id,
            approvedBy: approved.approvedBy ?? null,
            approvedAt: at,
        };
        await this.store.insertEntry(entry);
        const withEntry: TransferProposal = { ...approved, entryId: entry.id };
        await this.store.saveProposal(withEntry);
        return { proposal: withEntry, entry };
    }

    /** Human rejection keeps the proposal (and its reason) and never writes the destination KB. */
    async reject(consumerId: string, proposalId: string, actor: Actor, reason?: string): Promise<TransferProposal> {
        const proposal = await this.requireProposal(consumerId, proposalId);
        const rejected = applyDecision(proposal, 'reject', actor, new Date().toISOString(), reason ?? null);
        await this.store.saveProposal(rejected);
        return rejected;
    }

    async get(consumerId: string, proposalId: string): Promise<TransferProposal | null> {
        const id = assertConsumerId(consumerId);
        return this.store.getProposal(id, proposalId);
    }

    async list(consumerId: string, filter: TransferProposalFilter = {}): Promise<TransferProposal[]> {
        const id = assertConsumerId(consumerId);
        return this.store.listProposals(id, filter);
    }

    /** Destination-KB view — only approved transfers have entries here. */
    async entries(consumerId: string, filter: KnowledgeEntryFilter = {}): Promise<KnowledgeEntry[]> {
        const id = assertConsumerId(consumerId);
        return this.store.listEntries(id, filter);
    }

    private async requireProposal(consumerId: string, proposalId: string): Promise<TransferProposal> {
        const id = assertConsumerId(consumerId);
        const proposal = await this.store.getProposal(id, proposalId);
        if (!proposal) fail('INVALID_STATE', `transfer proposal not found: ${proposalId}`);
        return proposal;
    }
}
