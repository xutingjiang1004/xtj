-- Serialize per post across all API instances. Keep the existing UTC-day
-- view-history keys and historical counts; never infer missing history.
CREATE INDEX IF NOT EXISTS posts_view_history_lookup_idx
  ON public.posts (media_url, user_name, actor_key)
  WHERE media_type = '__post_view__';

CREATE OR REPLACE FUNCTION public.record_post_view(p_post_id uuid, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target public.posts%ROWTYPE;
  event_id uuid;
  viewed_at timestamptz := clock_timestamp();
  view_key text;
  post_text text;
  envelope jsonb;
  new_views integer;
BEGIN
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_actor');
  END IF;
  SELECT * INTO target FROM public.posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND OR target.is_deleted IS TRUE
     OR coalesce(target.media_type, '') NOT IN ('', 'text', 'image', 'video', 'audio', 'photo', 'album')
     OR (target.visibility IS NOT NULL AND target.visibility <> 'public' AND target.user_name <> p_actor) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'post_not_found');
  END IF;
  IF target.user_name = p_actor THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false, 'reason', 'self_view', 'views', coalesce(target.views, 0));
  END IF;
  view_key := 'pview_' || p_post_id::text || '_' || lower(p_actor) || '_' || to_char(viewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  IF EXISTS (SELECT 1 FROM public.posts WHERE media_type = '__post_view__'
    AND media_url = p_post_id::text AND user_name = p_actor AND actor_key = view_key) THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false, 'reason', 'already_viewed_today', 'views', coalesce(target.views, 0));
  END IF;
  post_text := coalesce(target.content, '');
  BEGIN
    envelope := post_text::jsonb;
    IF envelope->>'__type' = '__xtj_post_v2__' AND jsonb_typeof(envelope->'text') = 'string' THEN
      post_text := envelope->>'text';
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    NULL;
  END;
  INSERT INTO public.posts(user_name, media_type, media_url, content, actor_key, created_at)
    VALUES(p_actor, '__post_view__', p_post_id::text,
      jsonb_build_object('post_id', p_post_id, 'post_author', target.user_name,
        'post_content', left(post_text, 200), 'media_url', coalesce(target.media_url, ''),
        'media_type', coalesce(target.media_type, ''), 'viewed_at', viewed_at)::text,
      view_key, viewed_at) RETURNING id INTO event_id;
  UPDATE public.posts SET views = coalesce(views, 0) + 1 WHERE id = p_post_id RETURNING views INTO new_views;
  RETURN jsonb_build_object('ok', true, 'recorded', true, 'id', event_id, 'viewed_at', viewed_at, 'views', new_views);
END;
$$;
REVOKE ALL ON FUNCTION public.record_post_view(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_post_view(uuid, text) TO service_role;
