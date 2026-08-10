-- Pair for the one-time embedding backfill maintenance migration.
-- Production already completed the backfill; keep the final schema free of pg_net.
drop extension if exists pg_net;
