-- Fix RLS policies for avatar upload and user info display
-- Migration 015 was too restrictive: blocked __avatar__ INSERT and __user_info__ SELECT
-- Drop the old read policy and recreate with __avatar__ and __user_info__ included
DROP POLICY IF EXISTS posts_public_feed_read ON public.posts;
DROP POLICY IF EXISTS avatar_insert_own ON public.posts;
DROP POLICY IF EXISTS avatar_userinfo_select ON public.posts;

-- Recreate the public feed read policy with __avatar__ and __user_info__ added
CREATE POLICY posts_public_feed_read ON public.posts
FOR SELECT TO anon, authenticated
USING (
  is_deleted IS NOT TRUE
  AND (
    media_type IS NULL
    OR media_type = ''
    OR media_type IN ('image', 'video', 'text', 'photo', 'album', 'audio', '__avatar__', '__user_info__')
  )
  AND (
    visibility IS NULL
    OR visibility = 'public'
    OR media_type IN ('__avatar__', '__user_info__')
  )
);

-- Allow INSERT for __avatar__ records (anyone can upload their avatar)
CREATE POLICY avatar_insert_own ON public.posts
FOR INSERT TO anon, authenticated
WITH CHECK (
  media_type = '__avatar__'
  AND actor_key = '__avatar__'
);

COMMIT;
