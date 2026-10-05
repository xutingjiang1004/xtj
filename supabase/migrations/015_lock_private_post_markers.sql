BEGIN;

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Remove legacy policies that exposed every marker row or allowed browser writes.
DROP POLICY IF EXISTS posts_select_all ON public.posts;
DROP POLICY IF EXISTS anon_select_posts ON public.posts;
DROP POLICY IF EXISTS posts_insert_all ON public.posts;
DROP POLICY IF EXISTS posts_update_all ON public.posts;
DROP POLICY IF EXISTS anon_update_posts ON public.posts;
DROP POLICY IF EXISTS anon_delete_posts ON public.posts;
DROP POLICY IF EXISTS anon_posts_public_read ON public.posts;
DROP POLICY IF EXISTS posts_public_feed_read ON public.posts;

REVOKE ALL ON public.posts FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.posts FROM anon, authenticated;
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO service_role;

CREATE POLICY posts_public_feed_read
ON public.posts
FOR SELECT
TO anon, authenticated
USING (
  (media_type IS NULL OR media_type = '' OR media_type IN ('image', 'video', 'text', 'photo', 'album', 'audio'))
  AND (visibility IS NULL OR visibility = 'public')
  AND is_deleted IS NOT TRUE
);

COMMIT;
