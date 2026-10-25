BEGIN;
CREATE FUNCTION public.admin_statistics(p_start date DEFAULT NULL,p_end date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF p_start IS NOT NULL AND p_end IS NOT NULL AND p_start>p_end THEN RAISE EXCEPTION 'invalid statistics range' USING ERRCODE='22023'; END IF;
 WITH source AS MATERIALIZED (
   SELECT user_name,media_type,media_url,is_deleted,created_at,(created_at AT TIME ZONE 'UTC')::date AS day,
     xtj_private.safe_jsonb(content) AS body
   FROM public.posts WHERE media_type IS NULL OR media_type='' OR
     media_type IN ('text','image','video','audio','photo','album','__auth__','__visit__','__attack__','__photo_wall__')
 ), accounts AS (
   SELECT user_name,min(day) AS day FROM source WHERE media_type='__auth__' AND user_name IS NOT NULL AND btrim(user_name)<>'' GROUP BY user_name
 ), events AS (
   SELECT 'posts' AS kind,day,''::text AS attack_type FROM source
     WHERE (media_type IS NULL OR media_type IN ('','text','image','video','audio','photo','album'))
       AND is_deleted IS DISTINCT FROM true AND coalesce(body->'target_type','null'::jsonb) IN ('null','false','0','""')
   UNION ALL SELECT 'photos',day,'' FROM source WHERE media_type='__photo_wall__' AND is_deleted IS DISTINCT FROM true
     AND media_url IS DISTINCT FROM '__deleted__' AND coalesce(body->>'__pw_del__','false')<>'true'
   UNION ALL SELECT 'users',day,'' FROM accounts
   UNION ALL SELECT 'visits',CASE WHEN coalesce(nullif(media_url,''),body->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
       AND pg_input_is_valid(coalesce(nullif(media_url,''),body->>'date'),'date')
     THEN coalesce(nullif(media_url,''),body->>'date')::date ELSE day END,'' FROM source WHERE media_type='__visit__'
   UNION ALL SELECT 'attacks',CASE WHEN coalesce(nullif(body->>'date',''),media_url,'') ~ '^\d{4}-\d{2}-\d{2}$'
       AND pg_input_is_valid(coalesce(nullif(body->>'date',''),media_url),'date')
     THEN coalesce(nullif(body->>'date',''),media_url)::date ELSE day END,coalesce(nullif(media_url,''),'unknown') FROM source WHERE media_type='__attack__'
   UNION ALL SELECT 'comments',(created_at AT TIME ZONE 'UTC')::date,'' FROM public.comments
   UNION ALL SELECT 'likes',(created_at AT TIME ZONE 'UTC')::date,'' FROM public.likes
 ), filtered AS MATERIALIZED (
   SELECT * FROM events WHERE (p_start IS NULL OR day>=p_start) AND (p_end IS NULL OR day<=p_end)
 ), daily AS MATERIALIZED (
   SELECT day,count(*) FILTER(WHERE kind='visits') AS visits,count(*) FILTER(WHERE kind='attacks') AS attacks,
     count(*) FILTER(WHERE kind='posts') AS posts,count(*) FILTER(WHERE kind='comments') AS comments,
     count(*) FILTER(WHERE kind='likes') AS likes,count(*) FILTER(WHERE kind='users') AS new_users
   FROM filtered GROUP BY day
 ), types AS (SELECT attack_type,count(*) AS count FROM filtered WHERE kind='attacks' GROUP BY attack_type)
 SELECT jsonb_build_object(
   'summary',jsonb_build_object(
     'total_users',count(*) FILTER(WHERE kind='users'),'total_posts',count(*) FILTER(WHERE kind='posts'),
     'total_comments',count(*) FILTER(WHERE kind='comments'),'total_likes',count(*) FILTER(WHERE kind='likes'),
     'total_photos',count(*) FILTER(WHERE kind='photos'),'total_visits',count(*) FILTER(WHERE kind='visits'),
     'total_attacks',count(*) FILTER(WHERE kind='attacks'),
     'firewall_intercepts',count(*) FILTER(WHERE kind='attacks' AND attack_type IN ('CORS','CSRF')),
     'daily_visits',coalesce((SELECT jsonb_object_agg(day::text,visits) FROM daily WHERE visits>0),'{}'),
     'daily_attacks',coalesce((SELECT jsonb_object_agg(day::text,attacks) FROM daily WHERE attacks>0),'{}'),
     'attack_types',coalesce((SELECT jsonb_object_agg(attack_type,count) FROM types),'{}'),
     'truncated',false,'cached_at',now()),
   'daily',coalesce((SELECT jsonb_agg(jsonb_build_object('date',day,'visits',visits,'attacks',attacks,'posts',posts,'comments',comments,'likes',likes,'new_users',new_users) ORDER BY day) FROM daily WHERE visits+attacks+posts+comments+likes+new_users>0),'[]'),
   'date_range',jsonb_build_object('start',coalesce(p_start::text,'all'),'end',coalesce(p_end::text,'all'))
 ) INTO result FROM filtered;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_statistics(date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_statistics(date,date) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
