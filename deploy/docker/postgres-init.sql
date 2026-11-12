-- ESO database initialization. Runs once for a fresh Docker volume; safe to run again by hand.
-- Application tables belong to the control-plane initialization, not this file.

SET TIME ZONE 'UTC';
ALTER DATABASE eso SET timezone TO 'UTC';

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
