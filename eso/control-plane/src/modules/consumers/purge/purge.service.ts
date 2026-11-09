import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../../platform/registry/store.js';
import type { Actor, ConsumerRecord } from '../../../platform/registry/types.js';
import { GENERATED_MARKER } from '../registration/registration.service.js';

/**
 * L4.3 — purge.
 *
 * Allowed only from `deleted`/`retired`, only with an exact `confirm_id`. One transaction drops the
 * consumer schema and writes the `purged` event; the registry record stays for audit. The generated
 * file is removed only when it carries the `_generated` marker (never a hand-written file).
 */
export class PurgeService {
    constructor(private readonly store: PlatformStore) {}

    async purge(id: string, confirmId: string, actor: Actor): Promise<ConsumerRecord> {
        const consumerId = assertConsumerId(id);
        const current = await this.store.getConsumer(consumerId);
        if (!current || current.status === 'purged') fail('CONSUMER_NOT_FOUND');
        if (current.status !== 'deleted' && current.status !== 'retired') {
            fail('INVALID_STATE', `purge is not allowed from ${current.status}`);
        }
        if (confirmId !== consumerId) fail('PURGE_CONFIRM_MISMATCH');

        const now = new Date().toISOString();
        await this.store.transaction(async (tx) => {
            await tx.dropSchema(consumerId);
            await tx.updateConsumer(consumerId, { status: 'purged', materializedHash: null, updatedAt: now });
            await tx.appendEvent({
                consumerId,
                eventType: 'purged',
                actorKind: actor.kind,
                actorLabel: actor.label || null,
                at: now,
                detail: { schemaDropped: true, fileRemoved: hasGeneratedMarker(current.root) },
            });
        });

        removeGeneratedFile(current.root);
        return (await this.store.getConsumer(consumerId))!;
    }

    async getPurged(id: string): Promise<ConsumerRecord | null> {
        return this.store.getConsumer(assertConsumerId(id));
    }
}

function profilePath(root: string): string {
    return join(root, '.harness', 'config.json');
}

function hasGeneratedMarker(root: string): boolean {
    const file = profilePath(root);
    if (!existsSync(file)) return false;
    try {
        return JSON.parse(readFileSync(file, 'utf8'))._generated === GENERATED_MARKER;
    } catch {
        return false;
    }
}

function removeGeneratedFile(root: string): void {
    if (!hasGeneratedMarker(root)) return;
    try {
        rmSync(profilePath(root), { force: true });
    } catch {
        // The registry record is already purged; a leftover file is reported by profile check.
    }
}
