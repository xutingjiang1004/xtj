BEGIN;
CREATE OR REPLACE FUNCTION xtj_private.photo_sort_size(p_content text)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN coalesce(xtj_private.safe_jsonb(p_content)->>'fileSize','') ~ '^\d{1,20}$'
 THEN least((xtj_private.safe_jsonb(p_content)->>'fileSize')::numeric,9223372036854775807)::bigint ELSE 0 END;
$$;
CREATE INDEX IF NOT EXISTS photo_wall_name_page_idx ON public.posts((coalesce(user_name,'') COLLATE "C"),created_at,id)
 WHERE media_type='__photo_wall__' AND visibility='public' AND is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS photo_wall_size_page_idx ON public.posts(xtj_private.photo_sort_size(content),created_at,id)
 WHERE media_type='__photo_wall__' AND visibility='public' AND is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS photo_wall_views_page_idx ON public.posts((coalesce(views,0)),created_at,id)
 WHERE media_type='__photo_wall__' AND visibility='public' AND is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.xtj_photo_wall_page(p_sort text DEFAULT 'date_desc',p_limit integer DEFAULT 60,p_cursor jsonb DEFAULT NULL,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE at_time timestamptz; row_id uuid; sort_number bigint; sort_name text; page_size integer := least(greatest(p_limit,1),100); result jsonb;
BEGIN
 IF p_sort NOT IN ('date_desc','date_asc','name','size','views') THEN RAISE EXCEPTION 'invalid sort'; END IF;
 IF p_cursor IS NOT NULL THEN
   IF p_cursor->>'sort' IS DISTINCT FROM p_sort THEN RAISE EXCEPTION 'invalid cursor'; END IF;
   at_time := (p_cursor->>'at')::timestamptz; row_id := (p_cursor->>'id')::uuid;
   IF at_time IS NULL OR row_id IS NULL THEN RAISE EXCEPTION 'invalid cursor'; END IF;
   IF p_sort IN ('size','views') THEN sort_number := (p_cursor->>'value')::bigint; END IF;
   IF p_sort='name' THEN sort_name := p_cursor->>'value'; END IF;
 END IF;
 WITH candidates AS (
  SELECT p.id,p.user_name,p.media_url,p.content,p.created_at,p.views,
    coalesce(p.user_name,'') COLLATE "C" AS name_key,xtj_private.photo_sort_size(p.content) AS size_key,coalesce(p.views,0) AS views_key
  FROM public.posts p WHERE p.media_type='__photo_wall__' AND p.visibility='public' AND p.is_deleted IS NOT TRUE
   AND p.media_url IS DISTINCT FROM '__deleted__' AND coalesce(xtj_private.safe_jsonb(p.content)->>'__pw_del__','false')<>'true'
   AND (p_cursor IS NULL OR CASE p_sort
    WHEN 'date_desc' THEN (p.created_at,p.id)<(at_time,row_id)
    WHEN 'date_asc' THEN (p.created_at,p.id)>(at_time,row_id)
    WHEN 'name' THEN (coalesce(p.user_name,'') COLLATE "C",p.created_at,p.id)>(sort_name COLLATE "C",at_time,row_id)
    WHEN 'size' THEN (xtj_private.photo_sort_size(p.content),p.created_at,p.id)<(sort_number,at_time,row_id)
    WHEN 'views' THEN (coalesce(p.views,0),p.created_at,p.id)<(sort_number,at_time,row_id) END)
  ORDER BY CASE WHEN p_sort='name' THEN coalesce(p.user_name,'') COLLATE "C" END ASC,
    CASE WHEN p_sort='size' THEN xtj_private.photo_sort_size(p.content) END DESC,
    CASE WHEN p_sort='views' THEN coalesce(p.views,0) END DESC,
    CASE WHEN p_sort IN ('name','date_asc') THEN p.created_at END ASC,
    CASE WHEN p_sort NOT IN ('name','date_asc') THEN p.created_at END DESC,
    CASE WHEN p_sort IN ('name','date_asc') THEN p.id END ASC,
    CASE WHEN p_sort NOT IN ('name','date_asc') THEN p.id END DESC
  LIMIT page_size+1 OFFSET CASE WHEN p_cursor IS NULL THEN greatest(p_offset,0) ELSE 0 END
 ), numbered AS (
  SELECT *,row_number() OVER(ORDER BY CASE WHEN p_sort='name' THEN name_key END ASC,
    CASE WHEN p_sort='size' THEN size_key END DESC,CASE WHEN p_sort='views' THEN views_key END DESC,
    CASE WHEN p_sort IN ('name','date_asc') THEN created_at END ASC,CASE WHEN p_sort NOT IN ('name','date_asc') THEN created_at END DESC,
    CASE WHEN p_sort IN ('name','date_asc') THEN id END ASC,CASE WHEN p_sort NOT IN ('name','date_asc') THEN id END DESC) AS position FROM candidates
 ), page AS (SELECT * FROM numbered WHERE position<=page_size), last_row AS (SELECT * FROM page ORDER BY position DESC LIMIT 1)
 SELECT jsonb_build_object('data',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'user_name',user_name,'media_url',media_url,'content',content,'created_at',created_at,'views',views) ORDER BY position) FROM page),'[]'::jsonb),
  'sort',p_sort,'has_more',(SELECT count(*)>page_size FROM candidates),'next_cursor',
  CASE WHEN (SELECT count(*)>page_size FROM candidates) THEN (SELECT jsonb_build_object('sort',p_sort,'id',id,'at',created_at,'value',
    CASE p_sort WHEN 'name' THEN name_key WHEN 'size' THEN size_key::text WHEN 'views' THEN views_key::text ELSE NULL END) FROM last_row) ELSE NULL END) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.xtj_photo_wall_page(text,integer,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtj_photo_wall_page(text,integer,jsonb,integer) TO service_role;
REVOKE ALL ON FUNCTION xtj_private.photo_sort_size(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtj_private.photo_sort_size(text) TO service_role;
GRANT USAGE ON SCHEMA xtj_private TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
