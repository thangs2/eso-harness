import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../../platform/registry/store.js';
import type { Actor, ConsumerRecord } from '../../../platform/registry/types.js';
import {
    buildGeneratedProfile,
    materializeGeneratedProfile,
} from '../registration/registration.service.js';

/**
 * L4.1 — update profile with optimistic versioning.
 *
 * AC-06: `expected_version` must equal the current version; a match produces version+1 and
 * regenerates `.harness/config.json` + `materialized_hash`. The id is immutable.
 */
export interface UpdateConsumerInput {
    id?: string;
    name?: string;
    profile?: Record<string, unknown>;
    zones?: unknown[];
    expected_version: number;
    actor: Actor;
}

export interface UpdateResult {
    consumer: ConsumerRecord;
    profile: Record<string, unknown>;
}

function readRawProfile(root: string): Record<string, any> | null {
    const file = join(root, '.harness', 'config.json');
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

export class UpdateConsumerService {
    constructor(private readonly store: PlatformStore) {}

    async update(id: string, input: UpdateConsumerInput): Promise<UpdateResult> {
        const consumerId = assertConsumerId(id);
        const current = await this.store.getConsumer(consumerId);
        if (!current || current.status === 'purged') fail('CONSUMER_NOT_FOUND');

        if (input.id !== undefined && input.id !== consumerId) {
            fail('INVALID_CONSUMER_ID', 'body id must match the path id');
        }

        const expected = Number(input.expected_version);
        if (!Number.isInteger(expected) || expected !== current.version) {
            fail('STALE_VERSION', `expected ${input.expected_version}, current ${current.version}`);
        }

        const now = new Date().toISOString();
        const nextVersion = current.version + 1;

        await this.store.transaction(async (tx) => {
            await tx.updateConsumer(consumerId, {
                name: input.name?.trim() || current.name,
                version: nextVersion,
                updatedAt: now,
            });
            await tx.appendEvent({
                consumerId,
                eventType: 'updated',
                actorKind: input.actor.kind,
                actorLabel: input.actor.label || null,
                at: now,
                detail: { version: nextVersion },
            });
        });

        let updated = (await this.store.getConsumer(consumerId))!;
        const previous = readRawProfile(current.root);
        const profile = input.profile ?? previous?.profile ?? {};
        const zones = input.zones ?? previous?.zones ?? [];

        try {
            const generated = buildGeneratedProfile(updated, {
                id: consumerId,
                name: updated.name,
                root: updated.root,
                sdlcRoot: updated.sdlcRoot,
                profile,
                zones,
                actor: input.actor,
            });
            const hash = materializeGeneratedProfile(updated.root, generated);
            await this.store.setMaterializedHash(consumerId, hash);
            updated = (await this.store.getConsumer(consumerId))!;
            return { consumer: updated, profile };
        } catch (error) {
            await this.store.setStatus(consumerId, 'error', new Date().toISOString());
            if ((error as any)?.code) throw error;
            fail('MATERIALIZE_FAILED', String((error as Error)?.message || error));
        }
    }
}
