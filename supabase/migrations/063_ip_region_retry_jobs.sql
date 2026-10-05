-- Persist retry state so Render restarts do not discard IP region lookups.
-- The temporary lookup address is AES-GCM encrypted by the server and cleared
-- when the lookup reaches a terminal state.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS ip_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ip_next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS ip_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS ip_lookup_ip_enc text;

-- Recover pending legacy rows once after migration. Rows without an encrypted
-- address are finalized by the worker because the original client IP was not saved.
UPDATE public.posts
SET ip_next_retry_at = COALESCE(ip_lookup_started_at, created_at, now())
WHERE ip_region_status = 'pending'
  AND ip_next_retry_at IS NULL;

CREATE INDEX IF NOT EXISTS posts_ip_retry_due_idx
  ON public.posts (ip_next_retry_at)
  WHERE ip_region_status = 'pending';

CREATE INDEX IF NOT EXISTS posts_feed_cursor_idx
  ON public.posts (created_at DESC, id DESC);
