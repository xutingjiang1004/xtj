BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS comments_content_search_idx ON public.comments USING gin (content extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS comments_author_search_idx ON public.comments USING gin (user_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS posts_content_search_idx ON public.posts USING gin (content extensions.gin_trgm_ops)
  WHERE is_deleted IS NOT TRUE AND coalesce(media_type,'') IN ('','text','image','video','audio','photo','album');

-- The Express route binds p_actor to its verified account. Browser roles cannot
-- call this service-only search or supply another account's name themselves.
CREATE OR REPLACE FUNCTION public.xtj_search_feed(
  p_query text, p_actor text DEFAULT '', p_author text DEFAULT '', p_visibility text DEFAULT 'all',
  p_only_mine boolean DEFAULT false, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 21,
  p_timezone text DEFAULT 'UTC'
) RETURNS SETOF public.posts LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE pattern text; author_pattern text;
BEGIN
  IF length(btrim(coalesce(p_query,''))) NOT BETWEEN 1 AND 200 OR length(coalesce(p_author,''))>100
    OR p_visibility NOT IN ('all','public','private') OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to)
    OR (p_before_at IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'invalid search input' USING ERRCODE='22023'; END IF;
  pattern := '%' || replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_') || '%';
  author_pattern := '%' || replace(replace(replace(coalesce(p_author,''),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_') || '%';
  RETURN QUERY SELECT p.* FROM public.posts p
  WHERE p.is_deleted IS NOT TRUE AND coalesce(p.media_type,'') IN ('','text','image','video','audio','photo','album')
    AND coalesce(p.user_name,'')<>''
    AND (p.visibility='public' OR p.user_name=nullif(p_actor,'') OR p_actor='xxz')
    AND (p_visibility='all' OR p.visibility=p_visibility)
    AND (NOT p_only_mine OR p.user_name=nullif(p_actor,''))
    AND coalesce(p.user_name,'') ILIKE author_pattern
    AND (p_from IS NULL OR p.created_at>=p_from) AND (p_to IS NULL OR p.created_at<p_to)
    AND (p_before_at IS NULL OR (p.created_at,p.id)<(p_before_at,p_before_id))
    AND NOT (jsonb_typeof(xtj_private.safe_jsonb(p.content))='object' AND (
      SELECT count(*)>=2 FROM unnest(ARRAY['page_load_id','last_attempt_at','resolved_address','resolved_at','capture_reason',
        'precise_location_history','device_id','browser_fingerprint_hash','canvas_fingerprint_hash','webgl_fingerprint_hash']) k
      WHERE xtj_private.safe_jsonb(p.content) ? k))
    AND (coalesce(CASE WHEN xtj_private.safe_jsonb(p.content)->>'__type'='__xtj_post_v2__' THEN xtj_private.safe_jsonb(p.content)->>'text' ELSE p.content END,'') ILIKE pattern
      OR p.user_name ILIKE pattern OR to_char(p.created_at AT TIME ZONE p_timezone,'YYYY-MM-DD') ILIKE pattern
      OR EXISTS (SELECT 1 FROM public.comments c WHERE c.post_id=p.id AND (c.content ILIKE pattern OR c.user_name ILIKE pattern)))
  ORDER BY p.created_at DESC,p.id DESC LIMIT least(greatest(coalesce(p_limit,21),1),51);
END $$;
REVOKE ALL ON FUNCTION public.xtj_search_feed(text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtj_search_feed(text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,uuid,integer,text) TO service_role;
COMMIT;
