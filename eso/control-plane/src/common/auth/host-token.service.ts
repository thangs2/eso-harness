import { createHash, randomBytes } from 'node:crypto';

import { PlatformError } from '../../platform/registry/errors.js';
import type { PlatformStore } from '../../platform/registry/store.js';

/**
 * Scoped host bearer tokens (P2).
 *
 * A token is bound to one (host, runtime, consumer). Only the SHA-256 hash is stored; the plaintext
 * token is returned exactly once at issue time. Tokens never grant operator access.
 */
export interface HostActor {
    kind: 'host';
    label: string;
    hostId: string;
    runtimeId: string;
    consumerId: string;
}

export function hashHostToken(token: string): string {
    return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

export class HostTokenService {
    constructor(private readonly store: PlatformStore) {}

    /** Issue a host token scoped to host runtime + consumer. Plaintext token is returned once. */
    async issue(hostId: string, runtimeId: string, consumerId: string): Promise<any> {
        const host = await this.store.getHostRuntime(hostId, runtimeId);
        if (!host) throw new PlatformError('HOST_RUNTIME_NOT_FOUND', `Host runtime not registered: ${hostId}:${runtimeId}`);
        const consumer = await this.store.getConsumer(consumerId);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${consumerId}`);
        const token = randomBytes(32).toString('base64url');
        const tokenId = `ht-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
        const createdAt = new Date().toISOString();
        const row = await this.store.createHostToken({
            tokenId,
            hostId,
            runtimeId,
            consumerId,
            tokenHash: hashHostToken(token),
            createdAt,
        });
        return {
            tokenId: row.token_id,
            token,
            hostId: row.host_id,
            runtimeId: row.runtime_id,
            consumerId: row.consumer_id,
            createdAt: row.created_at,
        };
    }

    /** Revoke one token for a host runtime. Unknown/already-revoked token -> 404. */
    async revoke(hostId: string, runtimeId: string, tokenId: string): Promise<any> {
        const row = await this.store.revokeHostToken(hostId, runtimeId, tokenId);
        if (!row) throw new PlatformError('HOST_TOKEN_NOT_FOUND', `Host token not found: ${tokenId}`);
        return { tokenId: row.token_id, hostId: row.host_id, runtimeId: row.runtime_id, consumerId: row.consumer_id, revokedAt: row.revoked_at };
    }

    /** Authenticate a host token: hash lookup, not revoked, touch last_used_at. */
    async authenticate(token: string): Promise<HostActor> {
        const row = await this.store.getHostTokenByHash(hashHostToken(token));
        if (!row || row.revoked_at) throw new PlatformError('AUTH_INVALID');
        await this.store.touchHostToken(row.token_id);
        return {
            kind: 'host',
            label: row.token_id,
            hostId: row.host_id,
            runtimeId: row.runtime_id,
            consumerId: row.consumer_id,
        };
    }
}
