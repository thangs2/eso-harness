-- ESO knowledge index — greenfield bootstrap for one consumer schema.
-- Files are the content source of truth; this schema is a derived, rebuildable index.
-- Usage: psql -v ON_ERROR_STOP=1 -v schema=c_testeso -f knowledge.greenfield.sql
-- WARNING: this drops and recreates the consumer schema. Never run it on a live consumer
-- without explicit confirmation that the index can be rebuilt.

\if :{?schema}
\else
\set schema c_testeso
\endif

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

DROP SCHEMA IF EXISTS :"schema" CASCADE;
CREATE SCHEMA :"schema";

SET search_path TO :"schema", public;

CREATE TABLE knowledge_meta (
  schema_version    integer NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  manifest_path     text,
  manifest_version  integer,
  generator_version text
);

CREATE TABLE knowledge_type (
  type              text PRIMARY KEY,
  label             text NOT NULL,
  required_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_profile    jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_owner     text,
  representation    text NOT NULL CHECK (representation IN ('human','agent','machine')),
  default_liveness  text NOT NULL DEFAULT 'living' CHECK (default_liveness IN ('frozen','living')),
  default_kt_state  text NOT NULL DEFAULT 'raw' CHECK (default_kt_state IN ('raw','proposed','approved','retired')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_doc (
  doc_id            text PRIMARY KEY,
  path              text NOT NULL,
  type              text NOT NULL REFERENCES knowledge_type(type),
  status            text NOT NULL CHECK (status IN ('DRAFT','OPEN','READY','READY-SPLIT','BLOCKED')),
  owner             text,
  representation    text NOT NULL CHECK (representation IN ('human','agent','machine')),
  origin            text NOT NULL DEFAULT 'human' CHECK (origin IN ('human','agent','machine')),
  custodian         text NOT NULL DEFAULT 'repo' CHECK (custodian IN ('repo','provider','plugin')),
  liveness          text NOT NULL DEFAULT 'living' CHECK (liveness IN ('frozen','living')),
  kt_state          text NOT NULL DEFAULT 'raw' CHECK (kt_state IN ('raw','proposed','approved','retired')),
  source_doc_id     text REFERENCES knowledge_doc(doc_id) ON DELETE SET NULL,
  human_sot_doc_id  text REFERENCES knowledge_doc(doc_id) ON DELETE SET NULL,
  source_pointer    text,
  human_sot_pointer text,
  title             text,
  content_hash      text NOT NULL,
  header_json       jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_doc_path_not_empty CHECK (length(path) > 0),
  CONSTRAINT knowledge_doc_hash_not_empty CHECK (length(content_hash) > 0),
  CONSTRAINT knowledge_doc_no_self_source CHECK (source_doc_id IS DISTINCT FROM doc_id),
  CONSTRAINT knowledge_doc_no_self_human CHECK (human_sot_doc_id IS DISTINCT FROM doc_id)
);

CREATE TABLE knowledge_doc_path (
  doc_id     text NOT NULL REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  path       text NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to   timestamptz,
  PRIMARY KEY (doc_id, path, valid_from)
);

CREATE UNIQUE INDEX knowledge_doc_path_one_current
  ON knowledge_doc_path (path)
  WHERE valid_to IS NULL;

CREATE TABLE knowledge_doc_section (
  doc_id            text NOT NULL REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  section_id        text NOT NULL,
  parent_section_id text,
  ordinal           integer NOT NULL DEFAULT 0,
  level             integer NOT NULL CHECK (level >= 1),
  heading           text NOT NULL,
  anchor            text NOT NULL,
  content_hash      text,
  PRIMARY KEY (doc_id, section_id),
  UNIQUE (doc_id, anchor)
);

CREATE INDEX knowledge_doc_section_parent ON knowledge_doc_section (doc_id, parent_section_id);

CREATE TABLE knowledge_edge (
  edge_id     text PRIMARY KEY,
  from_doc_id text NOT NULL REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  to_doc_id   text NOT NULL REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN (
                'references','derived_from','source_of_truth','human_sot',
                'supersedes','owns_kinds','blocks','mentions_ticket'
              )),
  conflict    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_doc_id, to_doc_id, kind),
  CONSTRAINT knowledge_edge_no_self CHECK (from_doc_id <> to_doc_id)
);

CREATE INDEX knowledge_edge_from ON knowledge_edge (from_doc_id, kind);
CREATE INDEX knowledge_edge_to   ON knowledge_edge (to_doc_id, kind);

CREATE TABLE knowledge_edge_claim (
  edge_id    text NOT NULL REFERENCES knowledge_edge(edge_id) ON DELETE CASCADE,
  seq        integer NOT NULL CHECK (seq >= 1),
  provenance text NOT NULL CHECK (provenance IN ('declared','derived')),
  source     text NOT NULL CHECK (source IN ('header','markdown-link','provider','path')),
  claim      text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (edge_id, seq)
);

CREATE TABLE knowledge_link (
  link_id          bigserial PRIMARY KEY,
  doc_id           text NOT NULL REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  raw_target       text NOT NULL,
  resolved_doc_id  text REFERENCES knowledge_doc(doc_id) ON DELETE SET NULL,
  resolved_anchor  text,
  resolved_section_id text,
  status           text NOT NULL CHECK (status IN ('resolved','unresolved','external','anchor-missing')),
  provenance       text NOT NULL DEFAULT 'declared',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_link_section_fkey FOREIGN KEY (resolved_doc_id, resolved_section_id)
    REFERENCES knowledge_doc_section (doc_id, section_id) ON DELETE SET NULL
);

CREATE INDEX knowledge_link_unresolved
  ON knowledge_link (doc_id)
  WHERE status <> 'resolved';

CREATE TABLE knowledge_external_ref (
  doc_id      text NOT NULL REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  provider    text NOT NULL,
  external_id text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('ticket','story','task','bug','design','document')),
  url         text,
  direction   text NOT NULL DEFAULT 'out' CHECK (direction IN ('in','out')),
  PRIMARY KEY (doc_id, provider, external_id, kind)
);

CREATE INDEX knowledge_external_ref_lookup
  ON knowledge_external_ref (provider, external_id);

CREATE TABLE knowledge_doc_search (
  doc_id  text PRIMARY KEY REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  tsv     tsvector NOT NULL,
  excerpt text NOT NULL DEFAULT ''
);

CREATE INDEX knowledge_doc_search_tsv ON knowledge_doc_search USING GIN (tsv);
CREATE INDEX knowledge_doc_search_trgm ON knowledge_doc_search USING GIN (excerpt gin_trgm_ops);

CREATE TABLE knowledge_doc_chunk (
  chunk_id  text PRIMARY KEY,
  doc_id    text NOT NULL REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  ordinal   integer NOT NULL,
  anchor    text,
  text      text NOT NULL,
  content_hash text,
  embedding vector(1024),
  model     text,
  UNIQUE (doc_id, ordinal)
);

CREATE INDEX knowledge_doc_chunk_doc ON knowledge_doc_chunk (doc_id);
CREATE INDEX knowledge_doc_chunk_hash ON knowledge_doc_chunk (content_hash);
CREATE INDEX knowledge_doc_chunk_vec
  ON knowledge_doc_chunk USING hnsw (embedding vector_cosine_ops);

CREATE TABLE knowledge_index_build (
  build_id    text PRIMARY KEY,
  source_hash text NOT NULL,
  status      text NOT NULL CHECK (status IN ('running','ok','partial','error')),
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE knowledge_manifest (
  manifest_id       text PRIMARY KEY,
  build_id          text REFERENCES knowledge_index_build(build_id) ON DELETE SET NULL,
  manifest_version  integer NOT NULL DEFAULT 1,
  generator_version text NOT NULL,
  source_hash       text NOT NULL,
  payload           jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_manifest_build ON knowledge_manifest (build_id, created_at DESC);

CREATE TABLE knowledge_finding (
  finding_id  bigserial PRIMARY KEY,
  doc_id      text REFERENCES knowledge_doc(doc_id) ON DELETE CASCADE,
  severity    text NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  code        text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_finding_open ON knowledge_finding (severity, created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX knowledge_finding_doc ON knowledge_finding (doc_id, created_at DESC);

CREATE TABLE knowledge_worker (
  worker_id    text PRIMARY KEY,
  name         text NOT NULL,
  role         text NOT NULL,
  layer        text NOT NULL CHECK (layer IN ('peer','gate')),
  scope        text NOT NULL DEFAULT '',
  capabilities text[] NOT NULL DEFAULT '{}',
  verbs        text[] NOT NULL DEFAULT '{read,append}',
  bar          text NOT NULL DEFAULT '[]',
  escalation   text NOT NULL DEFAULT 'allow',
  status       text NOT NULL CHECK (status IN ('declared','active','paused','retired')),
  file_path    text NOT NULL,
  content_hash text NOT NULL,
  indexed_at   timestamptz NOT NULL DEFAULT now()
);

-- Host placement policy for a worker. ESO stores the policy; the owning host enforces it.
CREATE TABLE knowledge_worker_host_policy (
  worker_id     text PRIMARY KEY REFERENCES knowledge_worker(worker_id) ON DELETE CASCADE,
  allowed_hosts text[] NOT NULL DEFAULT '{}',
  model_tier    text NOT NULL DEFAULT 'balanced' CHECK (model_tier IN ('fast','balanced','reasoning')),
  model         text,
  models        jsonb NOT NULL DEFAULT '{}'::jsonb,
  modes         text[] NOT NULL DEFAULT '{A,B}',
  native_agent  jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallback      text NOT NULL DEFAULT 'block' CHECK (fallback IN ('block','next-host','next-tier')),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Observation/evidence append log from hosts (observability only; no run/execution state).
CREATE TABLE knowledge_observation (
  observation_id  text PRIMARY KEY,
  trace_id        text NOT NULL,
  host_id         text NOT NULL,
  runtime_key     text NOT NULL,
  worker_id       text,
  event           text NOT NULL,
  outcome         text,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  at              timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_observation_trace ON knowledge_observation (trace_id, received_at DESC);
CREATE INDEX knowledge_observation_received ON knowledge_observation (received_at DESC);

CREATE TABLE knowledge_worker_handoff (
  handoff_id      text PRIMARY KEY,
  from_worker_id  text NOT NULL,
  to_worker_id    text NOT NULL,
  condition       text,
  status          text NOT NULL CHECK (status IN ('pending','accepted','rejected')),
  work            jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz
);

CREATE INDEX knowledge_worker_handoff_to ON knowledge_worker_handoff (to_worker_id, status, created_at DESC);

CREATE TABLE knowledge_worker_import (
  import_id   bigserial PRIMARY KEY,
  source_file text NOT NULL,
  source_hash text NOT NULL,
  source_type text NOT NULL,
  worker_id   text NOT NULL,
  action      text NOT NULL CHECK (action IN ('import','replace','copy','skip','audit')),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_worker_import_worker ON knowledge_worker_import (worker_id, imported_at DESC);

CREATE TABLE knowledge_worker_event (
  event_id       bigserial PRIMARY KEY,
  worker_id      text NOT NULL,
  event          text NOT NULL,
  verb           text,
  path           text,
  decision       text NOT NULL,
  reasons        jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence       jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id       text,
  span_id        text,
  parent_span_id text,
  host_binding_id text,
  flow_edge_id   text,
  duration_ms    integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_worker_event_worker ON knowledge_worker_event (worker_id, created_at DESC);
CREATE INDEX knowledge_worker_event_trace ON knowledge_worker_event (trace_id, created_at DESC);

CREATE TABLE knowledge_worker_placement (
  worker_id       text NOT NULL REFERENCES knowledge_worker(worker_id) ON DELETE CASCADE,
  host_binding_id text NOT NULL,
  PRIMARY KEY (worker_id, host_binding_id)
);

CREATE TABLE knowledge_flow (
  flow_id      text NOT NULL,
  version      integer NOT NULL,
  name         text NOT NULL,
  status       text NOT NULL CHECK (status IN ('draft','published')),
  is_default   boolean NOT NULL DEFAULT false,
  definition   jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hash  text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (flow_id, version)
);

CREATE INDEX knowledge_flow_default ON knowledge_flow (is_default) WHERE is_default;

CREATE TABLE knowledge_worker_edge (
  from_worker_id text NOT NULL REFERENCES knowledge_worker(worker_id) ON DELETE CASCADE,
  to_worker_id   text NOT NULL REFERENCES knowledge_worker(worker_id) ON DELETE CASCADE,
  on_label       text NOT NULL DEFAULT '',
  PRIMARY KEY (from_worker_id, to_worker_id, on_label)
);

INSERT INTO knowledge_type (type, label, required_sections, header_profile, representation, default_liveness)
VALUES
  ('brd','Business Requirement Document','["Problem","Scope","Rules"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth","phase"]}','human','frozen'),
  ('prd','Product Requirement Document','["Problem","Scope","Capabilities"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth","phase"]}','human','frozen'),
  ('frd','Functional Requirement Document','["Behaviour","Rules"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth","phase"]}','human','frozen'),
  ('srs','Software Requirement Specification','["Requirements","Acceptance"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth","phase"]}','human','frozen'),
  ('adr','Architecture Decision Record','["Context","Decision","Consequences"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth","phase"]}','human','frozen'),
  ('spec','Specification','["Contract"]','{"ai":["id","type","status","owner","sot_doc_version","representation","human_sot","refs"]}','agent','living'),
  ('runbook','Runbook','["Steps","Rollback"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth"]}','human','living'),
  ('manifest','Manifest','["Contract"]','{"machine":["id","type","status","owner","sot_doc_version","representation"]}','machine','living'),
  ('decision','Decision Record','["Decision","Reason","Consequences"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth","phase"]}','human','frozen'),
  ('open-register','Open Register','["Question","Owner","Unblock"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth"]}','human','living'),
  ('wbs','Work Breakdown Structure','["Deliverables"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth"]}','human','living'),
  ('wbs-dictionary','WBS Dictionary','["Scope","Owner","Acceptance"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth"]}','human','living'),
  ('atomic-wbs','Atomic WBS','["Work Package","Acceptance"]','{"human":["id","type","status","owner","sot_doc_version","representation","source_of_truth"]}','human','living')
ON CONFLICT (type) DO NOTHING;

INSERT INTO knowledge_meta (schema_version) VALUES (1);
