-- Migration 026: Harden delete_post_with_actor RPC
-- Fixes: actor_key not verified, SECURITY DEFINER without REVOKE, raw SQLERRM leak, no FOR UPDATE lock

CREATE OR REPLACE FUNCTION public.delete_post_with_actor(
  p_post_id UUID,
  p_actor_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post RECORD;
  v_expected_actor_key TEXT;
BEGIN
  IF p_post_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Post ID is required');
  END IF;

  IF p_actor_key IS NULL OR btrim(p_actor_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Actor key is required');
  END IF;

  SELECT id, actor_key, user_name INTO v_post
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Post not found');
  END IF;

  v_expected_actor_key := COALESCE(v_post.actor_key, '');
  IF v_expected_actor_key <> btrim(p_actor_key) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Actor key mismatch');
  END IF;

  DELETE FROM public.likes WHERE post_id = p_post_id;
  DELETE FROM public.comments WHERE post_id = p_post_id;

  DELETE FROM public.posts
  WHERE id <> p_post_id
    AND (
      (media_type = '__post_view__' AND media_url = p_post_id::TEXT)
      OR (media_type = '__report__' AND COALESCE(content::jsonb->>'target_id', '') = p_post_id::TEXT)
    );

  DELETE FROM public.posts WHERE id = p_post_id;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'deleted', true, 'post_id', p_post_id);
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Post not found');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'internal_error', 'error', 'Delete failed');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_post_with_actor(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_post_with_actor(UUID, TEXT) TO service_role;
