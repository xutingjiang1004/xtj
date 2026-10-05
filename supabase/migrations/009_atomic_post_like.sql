BEGIN;

-- Preserve the newest legacy like when old clients created duplicates.
DELETE FROM public.likes AS older
USING public.likes AS newer
WHERE older.post_id = newer.post_id
  AND older.user_name = newer.user_name
  AND older.id < newer.id;

-- Required by POST /api/post/like and PostgREST onConflict inference.
CREATE UNIQUE INDEX IF NOT EXISTS likes_one_user_per_post
  ON public.likes (post_id, user_name);

COMMIT;
