import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import type { ConsumerRecord } from '../../platform/registry/types.js';
import {
    buildGeneratedProfile,
    materializeGeneratedProfile,
    stableStringify,
} from '../consumers/registration/registration.service.js';

/**
 * L4.4 — profile materialize + drift check (F-05).
 *
 * DB is the source (`materialized_hash`); the file is a generated artifact. Check never writes.
 */
export type ProfileStatus = 'ok' | 'drift' | 'missing' | 'invalid';

export interface ProfileCheck {
    status: ProfileStatus;
    expected: string | null;
    actual: string | null;
}

export interface ProfileView {
    profile: Record<string, unknown>;
    hash: string | null;
}

export class ProfileService {
    constructor(private readonly store: PlatformStore) {}

    async materialize(id: string): Promise<ProfileView> {
        const record = await this.getConsumer(id);
        assertRoot(record.root);

        const raw = readRaw(record.root);
        const generated = buildGeneratedProfile(record, {
            id: record.id,
            name: record.name,
            root: record.root,
            sdlcRoot: record.sdlcRoot,
            profile: (raw?.profile as Record<string, unknown>) ?? {},
            zones: Array.isArray(raw?.zones) ? raw.zones : [],
            actor: { kind: 'system', label: 'profile-materialize' },
        });
        const hash = materializeGeneratedProfile(record.root, generated);
        await this.store.setMaterializedHash(record.id, hash);
        return { profile: generated as unknown as Record<string, unknown>, hash };
    }

    async check(id: string): Promise<ProfileCheck> {
        const record = await this.getConsumer(id);
        const expected = record.materializedHash ?? null;
        const file = join(record.root, '.harness', 'config.json');
        if (!existsSync(file)) return { status: 'missing', expected, actual: null };

        let parsed: any;
        try {
            parsed = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            return { status: 'invalid', expected, actual: null };
        }

        const payload = {
            id: parsed.id,
            name: parsed.name,
            root: parsed.root,
            sdlcRoot: parsed.sdlcRoot ?? null,
            profile: parsed.profile ?? {},
            zones: parsed.zones ?? [],
        };
        const actual = createHash('sha256').update(stableStringify(payload)).digest('hex');
        return {
            status: expected && actual === expected && parsed.hash === actual ? 'ok' : 'drift',
            expected,
            actual,
        };
    }

    async get(id: string): Promise<ProfileView> {
        const record = await this.getConsumer(id);
        const raw = readRaw(record.root);
        return { profile: raw ?? {}, hash: record.materializedHash ?? null };
    }

    private async getConsumer(id: string): Promise<ConsumerRecord> {
        const consumerId = assertConsumerId(id);
        const record = await this.store.getConsumer(consumerId);
        if (!record || record.status === 'purged') fail('CONSUMER_NOT_FOUND');
        return record;
    }
}

function assertRoot(root: string): void {
    if (!existsSync(root) || !statSync(root).isDirectory()) fail('ROOT_NOT_FOUND');
}

function readRaw(root: string): Record<string, any> | null {
    const file = join(root, '.harness', 'config.json');
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}
