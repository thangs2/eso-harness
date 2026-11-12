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
  schema_version integer NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
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
  status           text NOT NULL CHECK (status IN ('resolved','unresolved','external','anchor-missing')),
  provenance       text NOT NULL DEFAULT 'declared',
  created_at       timestamptz NOT NULL DEFAULT now()
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
  embedding vector(1536),
  model     text,
  UNIQUE (doc_id, ordinal)
);

CREATE INDEX knowledge_doc_chunk_doc ON knowledge_doc_chunk (doc_id);
CREATE INDEX knowledge_doc_chunk_vec
  ON knowledge_doc_chunk USING hnsw (embedding vector_cosine_ops);

CREATE TABLE knowledge_index_run (
  build_id    text PRIMARY KEY,
  source_hash text NOT NULL,
  status      text NOT NULL CHECK (status IN ('running','ok','partial','error')),
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
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
