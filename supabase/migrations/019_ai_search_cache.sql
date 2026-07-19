-- Add query_hash and search_batch_id for deduplication and upsert support
ALTER TABLE IF EXISTS public.ai_search_results
  ADD COLUMN IF NOT EXISTS query_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS search_batch_id text NOT NULL DEFAULT '';

-- Unique constraint to prevent duplicate results within same search batch
ALTER TABLE IF EXISTS public.ai_search_results
  DROP CONSTRAINT IF EXISTS ai_search_results_owner_query_source_idx;

-- Create unique index for upsert deduplication (required for onConflict)
CREATE UNIQUE INDEX IF NOT EXISTS ai_search_results_owner_query_source_idx
  ON public.ai_search_results (owner_name, query_hash, source, source_id);

-- Periodic cleanup: remove expired results
-- Run via pg_cron or scheduled function: DELETE FROM ai_search_results WHERE expires_at < now();