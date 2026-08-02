-- Reliability constraints for concurrent retries and multi-instance cleanup.
-- Apply after migrations 028 and 033.

BEGIN;

-- A blank client_request_id means the caller did not opt into idempotency and
-- must remain repeatable. Non-blank keys are unique per authenticated owner,
-- which makes the database the cross-instance concurrency authority.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_sessions_user_client_request_unique
  ON public.ai_stream_sessions (user_id, client_request_id)
  WHERE btrim(client_request_id) <> '';

-- One photo upload_id maps to one photo row. The API handles 23505 by reading
-- the winning row and only cleaning unreferenced objects.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_posts_actor_key_unique
  ON public.posts (actor_key)
  WHERE media_type = '__photo_wall__'
    AND actor_key IS NOT NULL
    AND actor_key ~ '^photo_[a-zA-Z0-9_-]{6,128}$'
    AND content LIKE '%"storagePath":%';

-- A process-local boolean is not a lock in a multi-instance deployment.
-- These lease fields let workers claim and finish a job only while they own
-- the current token.
ALTER TABLE public.storage_cleanup_jobs
  ADD COLUMN IF NOT EXISTS claim_token TEXT,
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

UPDATE public.storage_cleanup_jobs
   SET lease_until = updated_at
 WHERE status = 'processing'
   AND lease_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_jobs_claimable
  ON public.storage_cleanup_jobs (status, lease_until, created_at);

COMMIT;
