-- One-time production maintenance migration mirrored from the applied Supabase history.
-- The following paired migration removes pg_net immediately after the embedding backfill.
create extension if not exists pg_net with schema extensions;
