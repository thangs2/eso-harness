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
    model_tiers     jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    primary key (host_id, runtime_id)
)`;

/** Idempotent column add for databases created before the remote endpoint existed. */
export const HOST_RUNTIME_REMOTE_URL_DDL = `ALTER TABLE platform.host_runtime ADD COLUMN IF NOT EXISTS remote_url text`;
/** Idempotent column add for databases created before the model-tier mapping existed. */
export const HOST_RUNTIME_MODEL_TIERS_DDL = `ALTER TABLE platform.host_runtime ADD COLUMN IF NOT EXISTS model_tiers jsonb NOT NULL DEFAULT '{}'::jsonb`;

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

/**
 * Vision test V2 telemetry: one row per UI surface view. Raw evidence is defined as the user
 * opening the JSON evidence panel *in the UI* — terminal/transcript opens are not observable by
 * ESO and are not counted. Append-only; no idempotency key because every view is a new event.
 */
export const UI_EVENT_TABLE = 'platform.ui_event';
export const UI_EVENT_DDL = `CREATE TABLE IF NOT EXISTS platform.ui_event (
    consumer_id text not null,
    surface     text not null,
    session     text,
    at          timestamptz not null default now()
)`;
export const UI_EVENT_AT_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_ui_event_at
    ON platform.ui_event (at desc)`;
export const UI_EVENT_CONSUMER_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_ui_event_consumer_at
    ON platform.ui_event (consumer_id, at desc)`;

/**
 * P2 — adjudicated turn verdict. One row per trace, written once from the observations of that
 * trace. Append-only: the store exposes insert/get only, never update/delete. `gaps` is the list
 * `{code,what,consequence}` the verdict could not prove; `score` is 100 minus 25 per gap.
 */
export const TURN_VERDICT_TABLE = 'platform.turn_verdict';
export const TURN_VERDICT_DDL = `CREATE TABLE IF NOT EXISTS platform.turn_verdict (
    trace_id    text primary key,
    consumer_id text not null,
    level       text not null check (level in ('allow','deny','partial','unknown')),
    basis       text not null,
    actor       jsonb,
    gaps        jsonb not null default '[]'::jsonb,
    score       integer not null,
    rule_refs   jsonb not null default '[]'::jsonb,
    receipt_id  text,
    computed_at timestamptz not null default now()
)`;

export const TURN_VERDICT_CONSUMER_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_turn_verdict_consumer
    ON platform.turn_verdict (consumer_id, computed_at desc)`;

/**
 * P4 — sealed evidence receipt. One row per trace, hash-chained per consumer
 * (`prev_hash` = hash of the consumer's previous receipt, or `GENESIS`). Append-only: the store
 * exposes insert/get/list only, never update/delete. `payload` is the canonical sealed body, kept
 * so a verifier can recompute the hash without trusting any other table.
 */
export const EVIDENCE_RECEIPT_TABLE = 'platform.evidence_receipt';
export const EVIDENCE_RECEIPT_DDL = `CREATE TABLE IF NOT EXISTS platform.evidence_receipt (
    receipt_id    text primary key,
    consumer_id   text not null,
    trace_id      text not null,
    prev_hash     text not null,
    hash          text not null,
    hmac          text,
    spec_version  integer not null default 1,
    verdict_level text not null check (verdict_level in ('allow','deny','partial','unknown')),
    payload       jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    unique (consumer_id, trace_id)
)`;

export const EVIDENCE_RECEIPT_CONSUMER_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_evidence_receipt_consumer
    ON platform.evidence_receipt (consumer_id, created_at asc, receipt_id asc)`;

/**
 * Q2 — append-only record of file-write scope checks. One row per check that named a trace;
 * a check without a trace cannot be attributed to a turn and is not recorded. The detail page
 * reads the latest row for a trace, so the verdict never has to be re-interpreted into a gate.
 */
export const SCOPE_DECISION_TABLE = 'platform.scope_decision';
export const SCOPE_DECISION_DDL = `CREATE TABLE IF NOT EXISTS platform.scope_decision (
    decision_id text primary key,
    consumer_id text not null,
    trace_id    text,
    target      text not null,
    allowed     boolean not null,
    code        text,
    message     text,
    actor       jsonb,
    at          timestamptz not null default now()
)`;

export const SCOPE_DECISION_TRACE_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_scope_decision_trace
    ON platform.scope_decision (consumer_id, trace_id, at desc)`;

export const CONSUMER_ARTIFACTS_TABLE = 'platform.consumer_artifacts';
export const CONSUMER_ARTIFACTS_DDL = `CREATE TABLE IF NOT EXISTS platform.consumer_artifacts (
    id           text primary key,
    consumer_id  text not null references platform.consumer(id) on delete cascade,
    title        text not null,
    origin       text not null check (origin in ('host','user','agent','machine')),
    custodian    text not null check (custodian in ('host-local','staging','repo','provider')),
    kt_state     text not null check (kt_state in ('raw','proposed','approved','retired')),
    liveness     text not null check (liveness in ('ephemeral','living','frozen')),
    derived_from jsonb not null default '[]'::jsonb,
    content_type text not null,
    body         text not null,
    metadata     jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
)`;

export const CONSUMER_ARTIFACTS_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_consumer_artifacts_consumer
    ON platform.consumer_artifacts (consumer_id, kt_state, created_at desc)`;

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
    HOST_RUNTIME_MODEL_TIERS_DDL,
    `CREATE INDEX IF NOT EXISTS idx_host_runtime_health
        ON platform.host_runtime (health)`,
    HOST_TOKEN_DDL,
    HOST_TOKEN_INDEX_DDL,
    UI_EVENT_DDL,
    UI_EVENT_AT_INDEX_DDL,
    UI_EVENT_CONSUMER_INDEX_DDL,
    TURN_VERDICT_DDL,
    TURN_VERDICT_CONSUMER_INDEX_DDL,
    EVIDENCE_RECEIPT_DDL,
    EVIDENCE_RECEIPT_CONSUMER_INDEX_DDL,
    SCOPE_DECISION_DDL,
    SCOPE_DECISION_TRACE_INDEX_DDL,
    CONSUMER_ARTIFACTS_DDL,
    CONSUMER_ARTIFACTS_INDEX_DDL,
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
