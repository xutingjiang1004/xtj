-- Keep post pinning transactional. The API service calls this RPC with its
-- service-role key after it has authenticated the actor.

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Existing data may contain more than one pin for an author. Retain the most
-- recently pinned row before enforcing the invariant.
WITH ranked_pins AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_name
           ORDER BY COALESCE(pinned_at, created_at) DESC NULLS LAST, id DESC
         ) AS pin_rank
  FROM public.posts
  WHERE is_pinned IS TRUE
)
UPDATE public.posts AS p
SET is_pinned = false,
    pinned_at = NULL
FROM ranked_pins AS r
WHERE p.id = r.id
  AND r.pin_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS posts_one_pinned_post_per_author
  ON public.posts (user_name)
  WHERE is_pinned IS TRUE;

CREATE OR REPLACE FUNCTION public.set_post_pin(
  p_post_id BIGINT,
  p_actor_user TEXT,
  p_is_admin BOOLEAN,
  p_is_pinned BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post public.posts%ROWTYPE;
  v_owner TEXT;
  v_unpinned_ids BIGINT[] := ARRAY[]::BIGINT[];
BEGIN
  IF p_post_id IS NULL OR p_post_id <= 0 OR p_actor_user IS NULL OR btrim(p_actor_user) = '' OR p_is_pinned IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Invalid pin request');
  END IF;

  -- Read the owner first so all competing changes take the same advisory lock
  -- before either transaction locks a different post row for that owner.
  SELECT user_name INTO v_owner
  FROM public.posts
  WHERE id = p_post_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Post not found');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner, 0));

  SELECT * INTO v_post
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Post not found');
  END IF;

  -- Only user-facing feed posts are pinnable; internal marker rows share this
  -- table and must never be exposed through the pin API.
  IF NOT (v_post.media_type IS NULL OR v_post.media_type IN ('image', 'video', 'text', 'photo', 'album')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_pinnable', 'error', 'Post cannot be pinned');
  END IF;
  IF NOT COALESCE(p_is_admin, false) AND v_post.user_name IS DISTINCT FROM p_actor_user THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Not allowed to pin this post');
  END IF;

  -- Serialise all pin changes for one author, including the first pin where no
  -- existing pinned row is available to lock. This re-check also makes the
  -- lock choice explicit if a future admin tool ever changes ownership.
  IF v_post.user_name IS DISTINCT FROM v_owner THEN
    v_owner := v_post.user_name;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_owner, 0));
  END IF;

  IF p_is_pinned THEN
    WITH cleared AS (
      UPDATE public.posts
      SET is_pinned = false,
          pinned_at = NULL,
          updated_at = now()
      WHERE user_name = v_owner
        AND id <> p_post_id
        AND is_pinned IS TRUE
      RETURNING id
    )
    SELECT COALESCE(array_agg(id), ARRAY[]::BIGINT[]) INTO v_unpinned_ids
    FROM cleared;

    UPDATE public.posts
    SET is_pinned = true,
        pinned_at = now(),
        updated_at = now()
    WHERE id = p_post_id
    RETURNING * INTO v_post;
  ELSE
    -- Unpin only the explicitly requested post; do not affect another pin.
    UPDATE public.posts
    SET is_pinned = false,
        pinned_at = NULL,
        updated_at = now()
    WHERE id = p_post_id
    RETURNING * INTO v_post;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'post', to_jsonb(v_post),
    'unpinned_post_ids', to_jsonb(v_unpinned_ids)
  );
EXCEPTION
  WHEN unique_violation THEN
    -- A legacy external writer may race the migration invariant. The caller
    -- can refresh and retry rather than reporting a false success.
    RETURN jsonb_build_object('ok', false, 'code', 'pin_conflict', 'error', 'Pin state changed concurrently');
END;
$$;

REVOKE ALL ON FUNCTION public.set_post_pin(BIGINT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
