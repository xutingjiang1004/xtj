-- Atomic persistent rate limiting: one counter row per (media_type, media_url) key.
-- Apply after migration 034. Fixes the read-modify-write race in
-- checkPersistentRateLimit: concurrent requests used to read the same count and
-- both write count+1, letting attackers consume 2 hits while only 1 is counted.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_posts_actor_key_unique
  ON public.posts (media_url)
  WHERE media_type = '__rate_limit__'
    AND media_url IS NOT NULL
    AND media_url ~ '^rl_[a-zA-Z0-9_-]{1,200}$';

COMMIT;
