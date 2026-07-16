BEGIN;

CREATE SCHEMA IF NOT EXISTS xtj_private;
REVOKE ALL ON SCHEMA xtj_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION xtj_private.safe_jsonb(p_value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN p_value::JSONB;
EXCEPTION WHEN OTHERS THEN
  RETURN '{}'::JSONB;
END;
$$;

REVOKE ALL ON FUNCTION xtj_private.safe_jsonb(TEXT) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA xtj_private TO service_role;
GRANT EXECUTE ON FUNCTION xtj_private.safe_jsonb(TEXT) TO service_role;

-- Collapse legacy duplicates before enforcing one private profile document per user.
DO $$
DECLARE
  v_user TEXT;
  v_keep UUID;
  v_row RECORD;
  v_merged JSONB;
BEGIN
  FOR v_user IN
    SELECT user_name FROM public.posts
    WHERE media_type = '__user_info__'
    GROUP BY user_name HAVING count(*) > 1
  LOOP
    v_merged := '{}'::JSONB;
    v_keep := NULL;
    FOR v_row IN
      SELECT id, content FROM public.posts
      WHERE media_type = '__user_info__' AND user_name = v_user
      ORDER BY created_at ASC, id ASC
    LOOP
      IF v_keep IS NULL THEN v_keep := v_row.id; END IF;
      IF jsonb_typeof(xtj_private.safe_jsonb(v_row.content)) = 'object' THEN
        v_merged := v_merged || xtj_private.safe_jsonb(v_row.content);
      END IF;
    END LOOP;
    UPDATE public.posts SET content = v_merged::TEXT WHERE id = v_keep;
    DELETE FROM public.posts
    WHERE media_type = '__user_info__' AND user_name = v_user AND id <> v_keep;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS posts_one_user_info_per_user
  ON public.posts (user_name)
  WHERE media_type = '__user_info__';

CREATE OR REPLACE FUNCTION public.merge_user_info(
  p_user_name TEXT,
  p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_content JSONB;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' OR length(p_user_name) > 100 THEN
    RAISE EXCEPTION 'invalid user name';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid user info patch';
  END IF;

  INSERT INTO public.posts (user_name, media_type, content, actor_key)
  VALUES (p_user_name, '__user_info__', p_patch::TEXT, 'user_info_' || md5(p_user_name))
  ON CONFLICT (user_name) WHERE media_type = '__user_info__'
  DO UPDATE SET content = (xtj_private.safe_jsonb(public.posts.content) || p_patch)::TEXT
  RETURNING content::JSONB INTO v_content;

  RETURN v_content;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_user_info(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_user_info(TEXT, JSONB) TO service_role;

COMMIT;
