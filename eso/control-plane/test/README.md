# Control-plane tests

Run the suite from `eso/control-plane`:

```bash
bun test test/
```

## Database-backed tests

Most tests use `MemoryPlatformStore` and need no database. A subset of scenario tests
(`tdd-qc` blocks in `profile.test.ts`, `purge.test.ts`, `isolation.test.ts`, `auth.test.ts`,
`registry.test.ts`, `update.test.ts`, `consumer.test.ts`, `control-plane.test.ts`,
`event-read.test.ts`, `platform-registry.test.ts`, `provisioning-*.test.ts`, …) exercise the
PostgreSQL adapter and are skipped/failed when `ESO_TEST_DB_URL` is not set:

```bash
export ESO_TEST_DB_URL='postgres://<user>:<password>@127.0.0.1:5432/eso_test'
bun test test/
```

The database must exist and allow `CREATE EXTENSION vector` (pgvector) because consumer-schema
provisioning runs `sql/knowledge.bootstrap.sql`. Tests create/drop their own `c_<id>` schemas.

## Host-placement tests (no database)

`test/host-placement.test.ts` covers host/runtime config, host tokens, observation ingest and
config-snapshot normalization on top of `MemoryPlatformStore`:

```bash
bun test test/host-placement.test.ts
```
