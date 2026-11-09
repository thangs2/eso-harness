-- ESO database bootstrap. Runs once for a fresh Docker volume; safe to run again by hand.
-- Application tables belong to the control-plane bootstrap, not this file.

SET TIME ZONE 'UTC';
ALTER DATABASE eso SET timezone TO 'UTC';

CREATE EXTENSION IF NOT EXISTS pgcrypto;
