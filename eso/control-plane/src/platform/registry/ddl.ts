/**
 * DDL for the platform registry.
 *
 * Normative source: sdlc/07.technical/10.planes/03.plane-d-data-model.md §2.
 * Initialization is CREATE ... IF NOT EXISTS at control-plane start; there is no DDL runner and no
 * version table.
 */

export const PLATFORM_SCHEMA = 'platform';
export const CONSUMER_TABLE = 'platform.consumer';
export const CONSUMER_EVENT_TABLE = 'platform.consumer_event';
export const STACK_VERSION_TABLE = 'platform.harness_stack_version';
export const HOST_TABLE = 'platform.host';
export const HOST_RUNTIME_TABLE = 'platform.host_runtime';
export const HOST_TOKEN_TABLE = 'platform.host_token';
/** Migration staging name used while reshaping the host registry. */
export const HOST_RUNTIME_LEGACY_TABLE = 'platform.host_runtime_legacy';

/** Host runtime kinds accepted by `platform.host_runtime.runtime_kind`. */
export const HOST_RUNTIME_KINDS = ['ide-native', 'cli', 'acp'] as const;
/** Liveness states for a registered host runtime. */
export const HOST_RUNTIME_HEALTH = ['unknown', 'healthy', 'degraded', 'offline'] as const;
/** Known host types used when inferring a machine type from a legacy runtime id. */
export const HOST_TYPES = ['cursor', 'agy', 'claude', 'codex', 'dsh', 'paseo', 'orca'] as const;

/**
 * Global host registry: one row per machine, shared by every consumer.
 * A host is the machine; each machine can advertise several runtimes (see host_runtime).
 */
export const HOST_DDL = `CREATE TABLE IF NOT EXISTS platform.host (
    host_id         text primary key,
    host_type       text not null,
    label           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
)`;

/**
 * Global host runtime registry: one row per (host, runtime), shared by every consumer.
 * `runtimeKey` is `hostId:runtimeId`. A host is a machine/runtime registration; the workspace
 * belongs to the consumer.
 */
export const HOST_RUNTIME_DDL = `CREATE TABLE IF NOT EXISTS platform.host_runtime (
    host_id         text not null references platform.host(host_id) on delete cascade,
    runtime_id      text not null,
    runtime_kind    text not null check (runtime_kind in ('ide-native','cli','acp')),
    models          jsonb not null default '[]'::jsonb,
    default_model   text not null default '',
    lead_eligible   boolean not null default false,
    health          text not null default 'unknown' check (health in ('unknown','healthy','degraded','offline')),
    last_heartbeat  timestamptz,
    remote_url      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    primary key (host_id, runtime_id)
)`;

/** Idempotent column add for databases created before the remote endpoint existed. */
export const HOST_RUNTIME_REMOTE_URL_DDL = `ALTER TABLE platform.host_runtime ADD COLUMN IF NOT EXISTS remote_url text`;

/**
 * Scoped bearer token for one host runtime + consumer. Only the SHA-256 hash is stored; the
 * plaintext token is shown exactly once at issue time.
 */
export const HOST_TOKEN_DDL = `CREATE TABLE IF NOT EXISTS platform.host_token (
    token_id     text primary key,
    host_id      text not null,
    runtime_id   text not null,
    consumer_id  text not null,
    role         text not null check (role = 'host'),
    token_hash   text not null unique,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at   timestamptz,
    foreign key (host_id, runtime_id) references platform.host_runtime(host_id, runtime_id) on delete cascade
)`;

export const HOST_TOKEN_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_host_token_scope
    ON platform.host_token (consumer_id, host_id, runtime_id)`;

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
    `CREATE TABLE IF NOT EXISTS platform.harness_stack_version (
        consumer_id  text not null,
        version      integer not null check (version > 0),
        status       text not null check (status in ('draft','published','retired')),
        layers       jsonb not null default '[]'::jsonb,
        published_at timestamptz,
        created_at   timestamptz not null default now(),
        primary key (consumer_id, version)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_stack_version_consumer
        ON platform.harness_stack_version (consumer_id, version desc)`,
    `CREATE TABLE IF NOT EXISTS platform.plugin_manifest (
        id              text primary key,
        label           text not null,
        type            text not null check (type in ('host','provider','capability','source')),
        category        text not null default 'other',
        version         text not null default '1.0.0',
        capabilities    jsonb not null default '[]'::jsonb,
        status          text not null default 'installed',
        description     text not null default '',
        config_schema   jsonb not null default '{}'::jsonb,
        source          text not null default 'custom',
        installed_at    timestamptz not null default now(),
        updated_at      timestamptz not null default now()
    )`,
    `CREATE TABLE IF NOT EXISTS platform.provider_record (
        consumer_id     text not null,
        provider_id     text not null,
        external_id     text not null,
        kind            text not null,
        title           text not null,
        status          text,
        url             text,
        payload         jsonb not null default '{}'::jsonb,
        synced_at       timestamptz not null default now(),
        primary key (consumer_id, provider_id, external_id, kind)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_provider_record_provider
        ON platform.provider_record (consumer_id, provider_id, synced_at desc)`,
    `CREATE TABLE IF NOT EXISTS platform.consumer_plugin (
        consumer_id     text not null,
        plugin_id       text not null,
        enabled         boolean not null default false,
        config          jsonb not null default '{}'::jsonb,
        secret_refs     jsonb not null default '{}'::jsonb,
        health          text not null default 'unknown',
        last_checked_at timestamptz,
        updated_at      timestamptz not null default now(),
        primary key (consumer_id, plugin_id)
    )`,
    // Host registry (GLOBAL): one row per machine, then one row per (host, runtime).
    // ESO is control plane only — it never starts these processes, it only records and routes.
    HOST_DDL,
    HOST_RUNTIME_DDL,
    HOST_RUNTIME_REMOTE_URL_DDL,
    `CREATE INDEX IF NOT EXISTS idx_host_runtime_health
        ON platform.host_runtime (health)`,
    HOST_TOKEN_DDL,
    HOST_TOKEN_INDEX_DDL,
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
