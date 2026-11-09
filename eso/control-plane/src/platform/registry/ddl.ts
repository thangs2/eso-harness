/**
 * DDL for the platform registry.
 *
 * Normative source: sdlc/07.technical/10.bootstrap-planes/03.plane-d-data-model.md §2.
 * Bootstrap is CREATE ... IF NOT EXISTS at control-plane start; there is no migration runner and
 * no schema_version table.
 */

export const PLATFORM_SCHEMA = 'platform';
export const CONSUMER_TABLE = 'platform.consumer';
export const CONSUMER_EVENT_TABLE = 'platform.consumer_event';

export const PLATFORM_DDL: readonly string[] = [
    `CREATE SCHEMA IF NOT EXISTS platform`,
    `CREATE TABLE IF NOT EXISTS platform.consumer (
        id                text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
        name              text not null,
        root              text not null,
        sdlc_root         text,
        schema_name       text not null unique,
        status            text not null check (status in ('ready','retired','deleted','purged','error')),
        version           integer not null default 1,
        storage_mode      text not null default 'schema' check (storage_mode = 'schema'),
        materialized_hash text,
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now()
    )`,
    `CREATE TABLE IF NOT EXISTS platform.consumer_event (
        id          bigserial primary key,
        consumer_id text not null,
        event_type  text not null,
        actor_kind  text not null check (actor_kind in ('operator','machine','system')),
        actor_label text,
        at          timestamptz not null default now(),
        detail      jsonb not null default '{}'::jsonb
    )`,
    `CREATE INDEX IF NOT EXISTS idx_consumer_event_consumer_at
        ON platform.consumer_event (consumer_id, at desc)`,
];

export const CONSUMER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

export function schemaNameFor(consumerId: string): string {
    if (!CONSUMER_ID_PATTERN.test(consumerId)) {
        throw new Error(`INVALID_CONSUMER_ID:${consumerId}`);
    }
    return `c_${consumerId}`;
}

/** Quote a schema identifier we generated ourselves. Never accepts user-supplied SQL. */
export function quoteSchema(schema: string): string {
    if (!/^c_[a-z0-9][a-z0-9-]{1,31}$/.test(schema)) {
        throw new Error(`INVALID_SCHEMA_NAME:${schema}`);
    }
    return `"${schema}"`;
}
