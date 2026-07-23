-- Migration: Add missing delete_post_with_actor RPC

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
BEGIN
  -- Verify post exists
  SELECT * INTO v_post FROM posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Post not found');
  END IF;

  -- Delete the post
  DELETE FROM posts WHERE id = p_post_id;
  
  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
