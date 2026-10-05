-- Repair deployments that already installed the earlier BIGINT pin RPC.
DROP FUNCTION IF EXISTS public.set_post_pin(BIGINT, TEXT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.set_post_pin(
  p_post_id UUID,
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
  v_unpinned_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF p_post_id IS NULL OR p_actor_user IS NULL OR btrim(p_actor_user) = '' OR p_is_pinned IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Invalid pin request');
  END IF;

  SELECT user_name INTO v_owner FROM public.posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Post not found');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner, 0));

  SELECT * INTO v_post FROM public.posts WHERE id = p_post_id FOR UPDATE;
  IF v_post.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Post not found or deleted');
  END IF;
  IF NOT (v_post.media_type IS NULL OR v_post.media_type IN ('image','video','text','photo','album')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_pinnable', 'error', '该类型内容不支持置顶');
  END IF;
  IF v_post.user_name IS DISTINCT FROM v_owner THEN
    v_owner := v_post.user_name;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_owner, 0));
  END IF;
  IF NOT COALESCE(p_is_admin, false) AND v_post.user_name IS DISTINCT FROM p_actor_user THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Not allowed to pin this post');
  END IF;

  IF p_is_pinned THEN
    WITH cleared AS (
      UPDATE public.posts
      SET is_pinned = false, pinned_at = NULL, updated_at = now()
      WHERE user_name = v_owner AND id <> p_post_id AND is_pinned IS TRUE
      RETURNING id
    )
    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO v_unpinned_ids FROM cleared;

    UPDATE public.posts
    SET is_pinned = true, pinned_at = now(), updated_at = now()
    WHERE id = p_post_id RETURNING * INTO v_post;
  ELSE
    UPDATE public.posts
    SET is_pinned = false, pinned_at = NULL, updated_at = now()
    WHERE id = p_post_id RETURNING * INTO v_post;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'post', to_jsonb(v_post),
    'unpinned_post_ids', to_jsonb(v_unpinned_ids)
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 'pin_conflict', 'error', 'Pin state changed concurrently');
END;
$$;

REVOKE ALL ON FUNCTION public.set_post_pin(UUID, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_post_pin(UUID, TEXT, BOOLEAN, BOOLEAN) TO service_role;
