/**
 * FolderPolicy + Read/WriteGrant.
 *
 * DB is the source of truth for the consumer profile (`settings.boundaries`). Materialized
 * `.harness/policy/folder-policy.json` is for inspection/recovery. Grants are runtime state in
 * `.harness/policy/grants.json` (gitignored) and are projected into the config snapshot.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MaterialProvisioningService } from '../../provisioning/material/material-provisioning.service.js';
import { UpdateConsumerService } from '../consumers/update/update.service.js';
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { Actor } from '../../platform/registry/types.js';

import { DEFAULT_POLICIES, type FolderPolicy, type PathType, type ReadMode, type WriteMode } from './boundary-defaults.js';
export type { FolderPolicy, PathType, ReadMode, WriteMode } from './boundary-defaults.js';
export { DEFAULT_POLICIES } from './boundary-defaults.js';

export interface Grant {
    grantId: string;
    kind: 'read' | 'write';
    policyId: string | null;
    targetPrefix: string;
    mode: 'once' | 'always';
    actor: string;
    purpose: string;
    expiresAt: string | null;
    issuedBy: string;
    issuedAt: string;
    revokedAt: string | null;
    signature: string;
}

export interface BoundaryView {
    consumerId: string;
    policies: FolderPolicy[];
    grants: Grant[];
    defaults: boolean;
    enforcement: 'audit' | 'enforce';
}

const WRITE_MODES = new Set(['bypass', 'gated', 'warn', 'deny']);
const READ_MODES = new Set(['allow', 'deny']);
const PATH_TYPES = new Set(['file', 'directory', 'glob']);

function grantsPath(root: string): string {
    return join(root, '.harness', 'policy', 'grants.json');
}

function readGrants(root: string): Grant[] {
    try {
        const value = JSON.parse(readFileSync(grantsPath(root), 'utf8'));
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

function writeGrants(root: string, grants: Grant[]): void {
    const target = grantsPath(root);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, `${JSON.stringify(grants, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function profileFromConfig(root: string): Record<string, any> {
    const path = join(root, '.harness', 'config.json');
    if (!existsSync(path)) fail('PROFILE_INVALID', 'config.json does not exist');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    const inner = config?.profile?.profile ?? config?.profile;
    return inner && typeof inner === 'object' ? inner : {};
}

function validatePolicy(value: any): FolderPolicy {
    const path = String(value?.path ?? '').trim();
    if (!path || path === '/' || path.includes('\0')) fail('PROFILE_INVALID', 'folder policy path is required');
    const pathType = String(value?.pathType ?? 'glob');
    if (!PATH_TYPES.has(pathType)) fail('PROFILE_INVALID', 'invalid pathType');
    const read = String(value?.read ?? 'deny');
    if (!READ_MODES.has(read)) fail('PROFILE_INVALID', 'invalid read mode');
    const write = String(value?.write ?? 'deny');
    if (!WRITE_MODES.has(write)) fail('PROFILE_INVALID', 'invalid write mode');
    return {
        id: String(value?.id ?? `policy-${randomUUID().slice(0, 8)}`),
        path,
        pathType: pathType as PathType,
        read: read as ReadMode,
        write: write as WriteMode,
        index: Boolean(value?.index),
        priority: Number.isFinite(Number(value?.priority)) ? Number(value.priority) : 50,
        ...(value?.reason ? { reason: String(value.reason) } : {}),
    };
}

export class BoundaryPolicyService {
    private readonly updates: UpdateConsumerService;
    private readonly material: MaterialProvisioningService;

    constructor(private readonly store: PlatformStore) {
        this.updates = new UpdateConsumerService(store);
        this.material = new MaterialProvisioningService(store);
    }

    async get(consumerId: string): Promise<BoundaryView> {
        const consumer = await this.consumer(consumerId);
        const profile = profileFromConfig(consumer.root);
        const explicit = Array.isArray(profile.settings?.boundaries?.policies)
            ? profile.settings.boundaries.policies.map(validatePolicy)
            : null;
        return {
            consumerId: consumer.id,
            policies: explicit ?? DEFAULT_POLICIES.map((policy) => ({ ...policy })),
            grants: readGrants(consumer.root).filter((grant) => !grant.revokedAt),
            defaults: explicit === null,
            enforcement: profile.settings?.boundaries?.enforcement === 'enforce' ? 'enforce' : 'audit',
        };
    }

    async ensureSeed(consumerId: string): Promise<{ consumerId: string; seeded: boolean }> {
        const consumer = await this.consumer(consumerId);
        const file = join(consumer.root, '.harness', 'policy', 'folder-policy.json');
        if (existsSync(file)) return { consumerId: consumer.id, seeded: false };
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, `${JSON.stringify({ generated: 'generated by eso boundaries — do not edit', enforcement: 'audit', policies: DEFAULT_POLICIES }, null, 2)}\n`, 'utf8');
        await this.store.appendEvent({
            consumerId: consumer.id, eventType: 'updated', actorKind: 'operator', actorLabel: 'boundaries-rollout',
            at: new Date().toISOString(), detail: { boundarySeed: true, policies: DEFAULT_POLICIES.length },
        });
        return { consumerId: consumer.id, seeded: true };
    }

    async rollout(actor: Actor): Promise<{ consumers: number; seeded: number; skipped: number; results: Array<{ consumerId: string; seeded: boolean }> }> {
        const consumers = await this.store.listConsumers({ status: 'ready' });
        const results = [];
        for (const consumer of consumers) results.push(await this.ensureSeed(consumer.id));
        return {
            consumers: results.length,
            seeded: results.filter((item) => item.seeded).length,
            skipped: results.filter((item) => !item.seeded).length,
            results,
        };
    }

    async save(consumerId: string, policies: unknown, actor: Actor, enforcement: unknown = 'audit'): Promise<BoundaryView> {
        if (!Array.isArray(policies) || policies.length === 0) fail('PROFILE_INVALID', 'policies must be a non-empty array');
        const nextPolicies = policies.map(validatePolicy);
        const nextEnforcement = enforcement === 'enforce' ? 'enforce' : 'audit';
        const consumer = await this.consumer(consumerId);
        const profile = profileFromConfig(consumer.root);
        const settings = { ...(profile.settings || {}) };
        settings.boundaries = { policies: nextPolicies, enforcement: nextEnforcement };
        const nextProfile = { ...profile, settings };
        await this.updates.update(consumer.id, {
            id: consumer.id,
            name: consumer.name,
            profile: nextProfile,
            zones: [],
            expected_version: consumer.version,
            actor,
        });
        await this.material.provision(consumer.id, { profile: nextProfile, zones: [] });
        mkdirSync(join(consumer.root, '.harness', 'policy'), { recursive: true });
        writeFileSync(join(consumer.root, '.harness', 'policy', 'folder-policy.json'), `${JSON.stringify({ generated: 'generated by eso boundaries — do not edit', enforcement: nextEnforcement, policies: nextPolicies }, null, 2)}\n`, 'utf8');
        return this.get(consumer.id);
    }

    async createGrant(consumerId: string, input: any, actor: Actor): Promise<Grant> {
        const consumer = await this.consumer(consumerId);
        const kind = input?.kind === 'read' ? 'read' : 'write';
        const mode = input?.mode === 'always' ? 'always' : 'once';
        if (kind === 'write' && mode === 'always') fail('INVALID_STATE', 'write grants cannot be always');
        const targetPrefix = String(input?.targetPrefix ?? '').trim();
        if (!targetPrefix) fail('INVALID_STATE', 'targetPrefix is required');
        const ttlMs = Number(input?.ttlMs ?? (kind === 'write' ? 15 * 60_000 : 15 * 60_000));
        const maxTtl = kind === 'write' ? 8 * 60 * 60_000 : 90 * 24 * 60 * 60_000;
        if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > maxTtl) fail('INVALID_STATE', 'grant TTL is out of range');
        const now = new Date();
        const grant: Grant = {
            grantId: `grant-${randomUUID()}`,
            kind,
            policyId: input?.policyId ? String(input.policyId) : null,
            targetPrefix,
            mode,
            actor: String(input?.actor ?? actor.label ?? 'operator'),
            purpose: String(input?.purpose ?? 'operator grant'),
            expiresAt: mode === 'always' ? null : new Date(now.getTime() + ttlMs).toISOString(),
            issuedBy: actor.label || actor.kind,
            issuedAt: now.toISOString(),
            revokedAt: null,
            signature: '',
        };
        grant.signature = createHash('sha256').update(JSON.stringify({ ...grant, signature: '' })).digest('hex');
        const grants = readGrants(consumer.root);
        grants.push(grant);
        writeGrants(consumer.root, grants);
        await this.store.appendEvent({
            consumerId: consumer.id, eventType: 'updated', actorKind: actor.kind, actorLabel: actor.label || null,
            at: now.toISOString(), detail: { boundaryGrant: grant.grantId, kind, targetPrefix, expiresAt: grant.expiresAt },
        });
        return grant;
    }

    async revokeGrant(consumerId: string, grantId: string, actor: Actor): Promise<{ revoked: boolean }> {
        const consumer = await this.consumer(consumerId);
        const grants = readGrants(consumer.root);
        const grant = grants.find((item) => item.grantId === grantId);
        if (!grant) fail('INVALID_STATE', 'grant not found');
        grant.revokedAt = new Date().toISOString();
        writeGrants(consumer.root, grants);
        await this.store.appendEvent({
            consumerId: consumer.id, eventType: 'updated', actorKind: actor.kind, actorLabel: actor.label || null,
            at: grant.revokedAt, detail: { boundaryGrant: grantId, revoked: true },
        });
        return { revoked: true };
    }

    private async consumer(consumerId: string) {
        const consumer = await this.store.getConsumer(assertConsumerId(consumerId));
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        if (consumer.status !== 'ready' && consumer.status !== 'error') fail('INVALID_STATE', `Boundaries require ready/error consumer, got ${consumer.status}`);
        return consumer;
    }
}
