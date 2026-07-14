BEGIN;

-- Keep one authentication record per account before enforcing uniqueness.
-- Existing credential values are deliberately not transformed in SQL: the
-- API upgrades them to scrypt after verifying the user's real password.
DELETE FROM public.posts AS older
USING public.posts AS newer
WHERE older.media_type = '__auth__'
  AND newer.media_type = '__auth__'
  AND older.user_name = newer.user_name
  AND (
    older.created_at < newer.created_at
    OR (older.created_at = newer.created_at AND older.id::text < newer.id::text)
  );

CREATE UNIQUE INDEX IF NOT EXISTS posts_one_auth_record_per_user
  ON public.posts (user_name)
  WHERE media_type = '__auth__';

COMMIT;
