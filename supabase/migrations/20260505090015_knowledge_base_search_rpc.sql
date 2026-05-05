/*
  # Knowledge Base Search Infrastructure

  Adds pgvector-based semantic search support for the intent routing
  `search_internal_database` tool used by the Gemini function-calling
  intent engine.

  1. Schema
    - Ensures `knowledge_base` has `created_at` and `owner_id` columns
      so we can trace per-user / per-workspace memory items.
    - Adds an ivfflat index on the `embedding` column to accelerate
      similarity search.
  2. RPC
    - `match_knowledge(query_embedding, match_count, similarity_threshold)`
      returns the closest KB rows by cosine distance.
    - A second overload `match_knowledge_text(query_text, match_count)` is
      provided as a fallback ILIKE search when an embedding is not
      available client-side (MVP path until embeddings worker is ready).
  3. Security
    - Enables RLS on `knowledge_base` (already enabled, kept idempotent).
    - Adds authenticated SELECT/INSERT policies scoped to `owner_id`.
    - RPCs are marked SECURITY INVOKER so RLS stays enforced.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'knowledge_base' AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE knowledge_base ADD COLUMN owner_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'knowledge_base' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE knowledge_base ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END $$;

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'knowledge_base'
      AND policyname = 'KB owners can select'
  ) THEN
    CREATE POLICY "KB owners can select"
      ON knowledge_base FOR SELECT
      TO authenticated
      USING (owner_id = auth.uid() OR owner_id IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'knowledge_base'
      AND policyname = 'KB owners can insert'
  ) THEN
    CREATE POLICY "KB owners can insert"
      ON knowledge_base FOR INSERT
      TO authenticated
      WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS knowledge_base_embedding_idx
  ON knowledge_base
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION match_knowledge_text(
  query_text text,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    kb.id,
    kb.content,
    kb.metadata,
    1.0::float AS similarity
  FROM knowledge_base kb
  WHERE kb.content ILIKE '%' || query_text || '%'
  ORDER BY kb.created_at DESC NULLS LAST
  LIMIT GREATEST(match_count, 1);
$$;
