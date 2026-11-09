import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../../platform/registry/store.js';
import type { Actor, ConsumerRecord, ConsumerStatus } from '../../../platform/registry/types.js';
import { EventWriter, type EventType } from '../../../platform/events/write/event-writer.js';
import {
    buildGeneratedProfile,
    materializeGeneratedProfile,
} from '../registration/registration.service.js';

/**
 * L4.2 — consumer lifecycle: ready ⇄ retired, deleted, restore.
 *
 * Data is never removed here. Every transition is one transaction with its event (L1.2), and the
 * consumer-scoped data route is fail-closed for anything that is not `ready`.
 */
export type LifecycleAction = 'retire' | 'reactivate' | 'delete' | 'restore';

const ACTION_EVENT: Record<LifecycleAction, EventType> = {
    retire: 'retired',
    reactivate: 'reactivated',
    delete: 'deleted',
    restore: 'restored',
};

const ACTION_FROM: Record<LifecycleAction, ConsumerStatus[]> = {
    retire: ['ready'],
    reactivate: ['retired'],
    delete: ['ready', 'retired'],
    restore: ['deleted'],
};

const ACTION_TO: Record<LifecycleAction, ConsumerStatus> = {
    retire: 'retired',
    reactivate: 'ready',
    delete: 'deleted',
    restore: 'ready',
};

export class LifecycleService {
    private readonly writer: EventWriter;

    constructor(private readonly store: PlatformStore) {
        this.writer = new EventWriter(store);
    }

    async get(id: string): Promise<ConsumerRecord> {
        const record = await this.store.getConsumer(assertConsumerId(id));
        if (!record || record.status === 'purged') fail('CONSUMER_NOT_FOUND');
        return record;
    }

    async transition(id: string, action: LifecycleAction, actor: Actor): Promise<ConsumerRecord> {
        const consumerId = assertConsumerId(id);
        const current = await this.store.getConsumer(consumerId);
        if (!current || current.status === 'purged') fail('CONSUMER_NOT_FOUND');
        if (!ACTION_FROM[action].includes(current.status)) {
            fail('INVALID_STATE', `${action} is not allowed from ${current.status}`);
        }

        await this.writer.transition(consumerId, ACTION_TO[action], ACTION_EVENT[action], actor);

        if (action === 'restore') await this.ensureProfile(consumerId);
        return (await this.store.getConsumer(consumerId))!;
    }

    /** The consumer-scoped data route is 404 unless the consumer is ready (fail-closed). */
    async assertDataRoute(id: string): Promise<ConsumerRecord> {
        const consumerId = assertConsumerId(id);
        const record = await this.store.getConsumer(consumerId);
        if (!record || record.status !== 'ready') fail('CONSUMER_NOT_FOUND');
        return record;
    }

    async canReadData(id: string): Promise<boolean> {
        try {
            await this.assertDataRoute(id);
            return true;
        } catch {
            return false;
        }
    }

    private async ensureProfile(id: string): Promise<void> {
        const record = (await this.store.getConsumer(id))!;
        const file = join(record.root, '.harness', 'config.json');
        if (existsSync(file)) return;
        const generated = buildGeneratedProfile(record, {
            id: record.id,
            name: record.name,
            root: record.root,
            sdlcRoot: record.sdlcRoot,
            profile: {},
            zones: [],
            actor: { kind: 'system', label: 'lifecycle' },
        });
        const hash = materializeGeneratedProfile(record.root, generated);
        await this.store.setMaterializedHash(id, hash);
    }
}
