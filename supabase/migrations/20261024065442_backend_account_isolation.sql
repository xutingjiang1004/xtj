BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE public.posts ADD COLUMN ai_account_id text;
ALTER TABLE public.ai_search_results ADD COLUMN ai_account_id text;
CREATE INDEX posts_ai_account_history_idx ON public.posts(ai_account_id,created_at DESC,id DESC)
 WHERE media_type IN ('__ai_agent_msg__','**ai_agent_conv_summary**','__ai_agent_profile__','__ai_agent_memory__');
CREATE INDEX ai_search_results_account_idx ON public.ai_search_results(ai_account_id,id);
-- No trustworthy owner UUID was stored in legacy messages or search copies.
-- Leave these owner-null and inaccessible to ordinary accounts. Never infer
-- ownership from a reusable name or a timestamp; no historical rows are deleted.
CREATE FUNCTION xtj_private.ai_owner_current(p_name text,p_owner text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT p_owner IS NOT NULL AND (EXISTS (SELECT 1 FROM public.posts WHERE user_name=p_name
   AND media_type IN ('__auth__','__admin_auth__') AND id::text=p_owner)
   OR (p_owner='admin:'||p_name AND NOT EXISTS (SELECT 1 FROM public.posts WHERE user_name=p_name
     AND media_type IN ('__auth__','__admin_auth__'))));
$$;
REVOKE ALL ON FUNCTION xtj_private.ai_owner_current(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtj_private.ai_owner_current(text,text) TO service_role;
CREATE FUNCTION xtj_private.guard_private_ai_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE owner_name text;
BEGIN
 IF TG_TABLE_NAME='posts' THEN
   IF coalesce(NEW.media_type,'') NOT IN ('__ai_agent_msg__','**ai_agent_conv_summary**','__ai_agent_profile__','__ai_agent_memory__') THEN
     IF TG_OP='UPDATE' AND OLD.ai_account_id IS NOT NULL THEN RAISE EXCEPTION 'ai_owner_immutable'; END IF;
     RETURN NEW;
   END IF;
   owner_name:=NEW.user_name;
   IF TG_OP='UPDATE' AND (OLD.ai_account_id IS DISTINCT FROM NEW.ai_account_id OR OLD.user_name IS DISTINCT FROM NEW.user_name
      OR OLD.media_type IS DISTINCT FROM NEW.media_type) THEN RAISE EXCEPTION 'ai_owner_immutable'; END IF;
 ELSE
   owner_name:=NEW.owner_name;
   IF TG_OP='UPDATE' AND (OLD.ai_account_id IS DISTINCT FROM NEW.ai_account_id OR OLD.owner_name IS DISTINCT FROM NEW.owner_name) THEN
     RAISE EXCEPTION 'ai_owner_immutable'; END IF;
 END IF;
 -- Coordinate with auth deletion: inserts either precede deletion and are
 -- removed by its trigger, or follow deletion and fail against the old UUID.
 PERFORM id FROM public.posts WHERE id::text=NEW.ai_account_id AND user_name=owner_name
   AND media_type IN ('__auth__','__admin_auth__') FOR KEY SHARE;
 IF NOT xtj_private.ai_owner_current(owner_name,NEW.ai_account_id) THEN RAISE EXCEPTION 'ai_account_changed'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION xtj_private.guard_private_ai_owner() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtj_private.guard_private_ai_owner() TO service_role;
CREATE TRIGGER guard_private_ai_owner BEFORE INSERT OR UPDATE ON public.posts
 FOR EACH ROW EXECUTE FUNCTION xtj_private.guard_private_ai_owner();
CREATE TRIGGER guard_private_ai_search_owner BEFORE INSERT OR UPDATE ON public.ai_search_results
 FOR EACH ROW EXECUTE FUNCTION xtj_private.guard_private_ai_owner();
CREATE FUNCTION xtj_private.delete_account_private_ai() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.media_type IN ('__auth__','__admin_auth__') THEN
   DELETE FROM public.posts WHERE ai_account_id=OLD.id::text;
   DELETE FROM public.ai_search_results WHERE ai_account_id=OLD.id::text;
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION xtj_private.delete_account_private_ai() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtj_private.delete_account_private_ai() TO service_role;
CREATE TRIGGER delete_account_private_ai AFTER DELETE ON public.posts
 FOR EACH ROW EXECUTE FUNCTION xtj_private.delete_account_private_ai();

DROP FUNCTION public.list_ai_conversations(text,text,integer,timestamptz,text,text);

CREATE OR REPLACE FUNCTION public.list_ai_conversations(
  p_user_name text, p_mode text DEFAULT NULL, p_limit integer DEFAULT 50,
  p_before_at timestamptz DEFAULT NULL, p_before_id text DEFAULT NULL,
  p_conversation_id text DEFAULT NULL
, p_account_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
WITH source AS (
  SELECT p.id, p.created_at, coalesce(p.content, '') AS content,
    xtj_private.safe_jsonb(p.content) AS body,
    CASE WHEN p.media_url = 'assistant' THEN 'assistant' ELSE 'user' END AS legacy_role,
    xtj_private.safe_jsonb(p.media_url) AS meta,
    substring(p.actor_key FROM '^ai_msg_conv_([A-Za-z0-9-]{6,128})_') AS actor_conversation_id
  FROM public.posts p
  WHERE p.user_name = p_user_name AND p.media_type = '__ai_agent_msg__' AND p.ai_account_id=p_account_id AND xtj_private.ai_owner_current(p_user_name,p_account_id)
    AND (p_conversation_id IS NULL OR p.actor_key LIKE
      ('ai\_msg\_conv\_' || p_conversation_id || '\_%') ESCAPE '\')
), live AS (
  SELECT id, created_at,
    left(CASE WHEN coalesce(meta->>'role', legacy_role) = 'assistant'
      THEN coalesce(nullif(body->>'reply', ''), nullif(body->>'answer', ''), content)
      ELSE content END, 100) AS preview,
    coalesce(nullif(meta->>'convId', ''), actor_conversation_id) AS conversation_id,
    coalesce(meta->>'role', legacy_role) AS role,
    meta->>'chat_mode' = 'deep_think' OR
      (coalesce(meta->>'role', legacy_role) = 'assistant' AND meta->>'type' = 'tavily_research') AS deep,
    CASE WHEN meta->>'seq' ~ '^[0-9]{1,9}$' THEN (meta->>'seq')::integer ELSE 0 END AS message_seq
  FROM source WHERE coalesce(meta->>'deleted', 'false') <> 'true'
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, message_seq DESC,
      CASE WHEN role = 'assistant' THEN 1 ELSE 0 END DESC, id DESC) AS last_rank,
    row_number() OVER (PARTITION BY conversation_id, role ORDER BY created_at, id) AS first_role_rank
  FROM live WHERE conversation_id ~ '^[A-Za-z0-9-]{6,128}$'
    AND (p_conversation_id IS NULL OR conversation_id = p_conversation_id)
), grouped AS (
  SELECT conversation_id, max(created_at) AS updated_at, count(*) AS message_count,
    coalesce(max(left(preview, 20)) FILTER (WHERE role = 'user' AND first_role_rank = 1), '新对话') AS title,
    max(preview) FILTER (WHERE last_rank = 1) AS last_message,
    CASE WHEN bool_or(coalesce(deep, false)) THEN 'deep_think' ELSE 'normal' END AS chat_mode
  FROM ranked GROUP BY conversation_id
), page AS (
  SELECT * FROM grouped WHERE (p_mode IS NULL OR p_mode = '' OR chat_mode = p_mode)
    AND (p_before_at IS NULL OR updated_at < p_before_at OR
      (updated_at = p_before_at AND conversation_id < p_before_id))
  ORDER BY updated_at DESC, conversation_id DESC LIMIT least(greatest(p_limit, 1), 100) + 1
), visible AS (
  SELECT * FROM page ORDER BY updated_at DESC, conversation_id DESC LIMIT least(greatest(p_limit, 1), 100)
), boundary AS (
  SELECT updated_at, conversation_id FROM visible ORDER BY updated_at, conversation_id LIMIT 1
)
SELECT jsonb_build_object('ok', true,
  'conversations', coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY updated_at DESC, conversation_id DESC) FROM visible v), '[]'::jsonb),
  'has_more', (SELECT count(*) FROM page) > least(greatest(p_limit, 1), 100),
  'next_cursor', CASE WHEN (SELECT count(*) FROM page) > least(greatest(p_limit, 1), 100)
    THEN (SELECT jsonb_build_object('at', updated_at, 'id', conversation_id)::text FROM boundary) ELSE NULL END);
$$;

REVOKE ALL ON FUNCTION public.list_ai_conversations(text,text,integer,timestamptz,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_ai_conversations(text,text,integer,timestamptz,text,text,text) TO service_role;

DROP FUNCTION public.list_ai_research_records(text,integer);

CREATE OR REPLACE FUNCTION public.list_ai_research_records(p_user_name text, p_limit integer DEFAULT 10, p_account_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
WITH page AS (
  SELECT p.id, p.created_at, xtj_private.safe_jsonb(p.content) AS body,
    coalesce(nullif(xtj_private.safe_jsonb(p.media_url)->>'convId', ''),
      substring(p.actor_key FROM '^ai_msg_conv_([A-Za-z0-9-]{6,128})_')) AS conversation_id
  FROM public.posts p WHERE p.user_name = p_user_name AND p.media_type = '__ai_agent_msg__' AND p.ai_account_id=p_account_id AND xtj_private.ai_owner_current(p_user_name,p_account_id)
    AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted', 'false') <> 'true'
    AND xtj_private.safe_jsonb(p.content)->>'type' = 'tavily_research'
  ORDER BY p.created_at DESC, p.id DESC LIMIT least(greatest(p_limit, 1), 50)
)
SELECT jsonb_build_object('ok', true, 'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id', id, 'created_at', created_at, 'conversation_id', conversation_id,
  'query', coalesce(body->>'query', ''), 'answer', coalesce(body->>'answer', ''),
  'sources', CASE WHEN jsonb_typeof(body->'sources') = 'array' THEN body->'sources' ELSE '[]'::jsonb END
) ORDER BY created_at DESC, id DESC) FROM page), '[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.list_ai_research_records(text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_ai_research_records(text,integer,text) TO service_role;

DROP FUNCTION public.soft_delete_ai_conversation(text,text);

CREATE OR REPLACE FUNCTION public.soft_delete_ai_conversation(p_user_name text, p_conversation_id text, p_account_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' OR length(p_user_name) > 64 OR
     p_conversation_id IS NULL OR p_conversation_id !~ '^[A-Za-z0-9-]{6,128}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_conversation');
  END IF;
  IF NOT xtj_private.ai_owner_current(p_user_name,p_account_id) THEN RETURN jsonb_build_object('ok',false,'code','account_changed'); END IF;
  UPDATE public.posts AS p
  SET media_url = (
    CASE WHEN jsonb_typeof(xtj_private.safe_jsonb(p.media_url)) = 'object'
      THEN xtj_private.safe_jsonb(p.media_url)
      ELSE jsonb_build_object('role', CASE WHEN p.media_url = 'assistant' THEN 'assistant' ELSE 'user' END)
    END || jsonb_build_object('deleted', true, 'deleted_at', clock_timestamp())
  )::text
  WHERE p.user_name = p_user_name AND p.media_type = '__ai_agent_msg__' AND p.ai_account_id=p_account_id AND xtj_private.ai_owner_current(p_user_name,p_account_id)
    AND p.actor_key LIKE ('ai\_msg\_conv\_' || p_conversation_id || '\_%') ESCAPE '\'
    AND coalesce(nullif(xtj_private.safe_jsonb(p.media_url)->>'convId', ''), p_conversation_id) = p_conversation_id
    AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted', 'false') <> 'true';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.ai_conversation_preferences WHERE conversation_id=p_conversation_id AND
    account_id=p_account_id;
  DELETE FROM public.ai_message_bookmarks WHERE conversation_id=p_conversation_id AND
    account_id=p_account_id;
  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_ai_conversation(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_ai_conversation(text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_conversation_features(p_user_name text,p_account_id text,p_op text,p_value jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
  account public.posts;
  since timestamptz;
  cid text := p_value->>'conversation_id';
  msg uuid;
  found_message public.posts;
  pref public.ai_conversation_preferences;
  result jsonb;
  take integer := least(100,greatest(1,coalesce((p_value->>'limit')::integer,30)));
  before_at timestamptz := nullif(p_value->>'before_at','')::timestamptz;
  before_id uuid := nullif(p_value->>'before_id','')::uuid;
  date_from timestamptz := nullif(p_value->>'date_from','')::timestamptz;
  date_to timestamptz := nullif(p_value->>'date_to','')::timestamptz;
  query_text text := coalesce(p_value->>'query','');
  model_filter text := coalesce(p_value->>'model','');
  mode_filter text := coalesce(p_value->>'mode','');
BEGIN
  IF p_user_name IS NULL OR length(p_user_name) NOT BETWEEN 1 AND 64 OR
    p_account_id IS NULL OR length(p_account_id)>150 OR jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_history_request');
  END IF;
  SELECT * INTO account FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__')
    ORDER BY (media_type='__auth__') DESC,created_at DESC,id DESC LIMIT 1 FOR KEY SHARE;
  IF (account.id IS NULL AND p_account_id IS DISTINCT FROM 'admin:'||p_user_name) OR
    (account.id IS NOT NULL AND account.id::text<>p_account_id) THEN
    RETURN jsonb_build_object('ok',false,'code','account_changed');
  END IF;
  since:=coalesce(account.created_at,'1970-01-01'::timestamptz);
  IF length(query_text)>120 OR length(model_filter)>128 OR mode_filter NOT IN ('','normal','deep_think') OR
    date_from IS NOT NULL AND date_to IS NOT NULL AND date_from>date_to THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_history_filter');
  END IF;
  IF p_op='metadata' THEN
    IF jsonb_typeof(p_value->'conversation_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_value->'conversation_ids')>100 THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_history_request');
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(m)-'account_id'-'auth_record_id'),'[]') INTO result
    FROM public.ai_conversation_preferences m WHERE m.account_id=p_account_id AND
      p_value->'conversation_ids' ? m.conversation_id AND EXISTS (
        SELECT 1 FROM public.posts p WHERE p.user_name=p_user_name AND p.media_type='__ai_agent_msg__' AND p.ai_account_id=p_account_id AND p.created_at>=since
          AND p.actor_key LIKE ('ai\_msg\_conv\_'||m.conversation_id||'\_%') ESCAPE '\'
          AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted','false')<>'true');
    RETURN jsonb_build_object('ok',true,'records',result);
  END IF;
  IF p_op IN ('set_title','bookmark','remove_bookmark') THEN
    IF cid IS NULL OR cid !~ '^[A-Za-z0-9-]{6,128}$' THEN RETURN jsonb_build_object('ok',false,'code','invalid_conversation'); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('xtj:ai-history-features:'||p_account_id,0));
    IF p_op='remove_bookmark' THEN
      DELETE FROM public.ai_message_bookmarks WHERE account_id=p_account_id AND message_id=(p_value->>'message_id')::uuid AND conversation_id=cid;
      RETURN jsonb_build_object('ok',true);
    END IF;
    SELECT p.* INTO found_message FROM public.posts p WHERE p.user_name=p_user_name AND p.media_type='__ai_agent_msg__' AND p.ai_account_id=p_account_id AND p.created_at>=since
      AND p.actor_key LIKE ('ai\_msg\_conv\_'||cid||'\_%') ESCAPE '\'
      AND coalesce(nullif(xtj_private.safe_jsonb(p.media_url)->>'convId',''),cid)=cid
      AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted','false')<>'true'
      AND (p_op='set_title' OR p.id=(p_value->>'message_id')::uuid OR
        (p_value->>'client_request_id' ~ '^[A-Za-z0-9_-]{1,128}$' AND xtj_private.safe_jsonb(p.media_url)->>'client_request_id'=p_value->>'client_request_id' AND xtj_private.safe_jsonb(p.media_url)->>'role'='assistant'))
      ORDER BY p.created_at DESC,p.id DESC LIMIT 1;
    IF found_message.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','conversation_missing'); END IF;
    IF p_op='set_title' THEN
      IF length(coalesce(p_value->>'title',''))>80 THEN RETURN jsonb_build_object('ok',false,'code','invalid_title'); END IF;
      SELECT * INTO pref FROM public.ai_conversation_preferences WHERE account_id=p_account_id AND conversation_id=cid FOR UPDATE;
      IF coalesce((p_value->>'revision')::bigint,0)<>coalesce(pref.revision,0) THEN
        RETURN jsonb_build_object('ok',false,'code','history_metadata_conflict');
      END IF;
      IF pref.account_id IS NULL AND (SELECT count(*) FROM public.ai_conversation_preferences WHERE account_id=p_account_id)>=500 THEN
        RETURN jsonb_build_object('ok',false,'code','history_metadata_limit');
      END IF;
      INSERT INTO public.ai_conversation_preferences(account_id,auth_record_id,conversation_id,title)
        VALUES(p_account_id,account.id,cid,btrim(coalesce(p_value->>'title','')))
        ON CONFLICT(account_id,conversation_id) DO UPDATE SET title=excluded.title,revision=ai_conversation_preferences.revision+1,updated_at=clock_timestamp()
        RETURNING * INTO pref;
      RETURN jsonb_build_object('ok',true,'record',to_jsonb(pref)-'account_id'-'auth_record_id');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ai_message_bookmarks WHERE account_id=p_account_id AND message_id=found_message.id) AND
      (SELECT count(*) FROM public.ai_message_bookmarks WHERE account_id=p_account_id)>=200 THEN
      RETURN jsonb_build_object('ok',false,'code','bookmark_limit');
    END IF;
    INSERT INTO public.ai_message_bookmarks(account_id,auth_record_id,message_id,conversation_id)
      VALUES(p_account_id,account.id,found_message.id,cid) ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('ok',true,'message_id',found_message.id);
  END IF;
  IF p_op IN ('bookmarks','bookmarks_export') THEN
    WITH page AS (
      SELECT b.message_id AS id,b.conversation_id,b.created_at,p.created_at AS sent_at,m.title,
        coalesce(xtj_private.safe_jsonb(p.media_url)->>'role','assistant') AS role,
        coalesce(xtj_private.safe_jsonb(p.media_url)->>'model',xtj_private.safe_jsonb(p.media_url)#>>'{usage,model}','') AS model,
        CASE WHEN xtj_private.safe_jsonb(p.media_url)->>'chat_mode'='deep_think' OR xtj_private.safe_jsonb(p.media_url)->>'type'='tavily_research' THEN 'deep_think' ELSE 'normal' END AS chat_mode,
        left(regexp_replace(coalesce(nullif(xtj_private.safe_jsonb(p.content)->>'reply',''),nullif(xtj_private.safe_jsonb(p.content)->>'answer',''),p.content),
          'data:[^,[:space:]]+;base64,[A-Za-z0-9+/]+={0,2}','[附件]','g'),1000) AS excerpt,
        CASE WHEN p_op='bookmarks_export' THEN left(regexp_replace(coalesce(nullif(xtj_private.safe_jsonb(p.content)->>'reply',''),nullif(xtj_private.safe_jsonb(p.content)->>'answer',''),p.content),
          'data:[^,[:space:]]+;base64,[A-Za-z0-9+/]+={0,2}','[附件]','g'),500000) END AS text,
        p_op='bookmarks_export' AND length(coalesce(nullif(xtj_private.safe_jsonb(p.content)->>'reply',''),nullif(xtj_private.safe_jsonb(p.content)->>'answer',''),p.content))>500000 AS truncated
      FROM public.ai_message_bookmarks b JOIN public.posts p ON p.id=b.message_id
      LEFT JOIN public.ai_conversation_preferences m ON m.account_id=b.account_id AND m.conversation_id=b.conversation_id
      WHERE b.account_id=p_account_id AND p.user_name=p_user_name AND p.created_at>=since AND p.media_type='__ai_agent_msg__' AND p.ai_account_id=p_account_id
        AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted','false')<>'true'
        AND (date_from IS NULL OR p.created_at>=date_from) AND (date_to IS NULL OR p.created_at<=date_to)
        AND (model_filter='' OR strpos(lower(coalesce(xtj_private.safe_jsonb(p.media_url)->>'model',xtj_private.safe_jsonb(p.media_url)#>>'{usage,model}','')),lower(model_filter))>0)
        AND (query_text='' OR strpos(lower(p.content),lower(query_text))>0 OR strpos(lower(coalesce(m.title,'')),lower(query_text))>0)
        AND (mode_filter='' OR mode_filter=CASE WHEN xtj_private.safe_jsonb(p.media_url)->>'chat_mode'='deep_think' OR xtj_private.safe_jsonb(p.media_url)->>'type'='tavily_research' THEN 'deep_think' ELSE 'normal' END)
        AND (before_at IS NULL OR (b.created_at,b.message_id)<(before_at,before_id))
      ORDER BY b.created_at DESC,b.message_id DESC LIMIT take+1
    ), visible AS (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT take)
    SELECT jsonb_build_object('ok',true,'items',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY created_at DESC,id DESC) FROM visible v),'[]'),
      'has_more',(SELECT count(*) FROM page)>take,'next_cursor',
      CASE WHEN (SELECT count(*) FROM page)>take THEN (SELECT jsonb_build_object('at',created_at,'id',id)::text FROM visible ORDER BY created_at,id LIMIT 1) END) INTO result;
    RETURN result;
  END IF;
  IF p_op IS NULL OR p_op NOT IN ('search','export','message') THEN RETURN jsonb_build_object('ok',false,'code','unknown_history_operation'); END IF;
  IF p_op='export' AND (cid IS NULL OR cid !~ '^[A-Za-z0-9-]{6,128}$') THEN RETURN jsonb_build_object('ok',false,'code','invalid_conversation'); END IF;
  WITH source AS (
    SELECT p.id,p.created_at,coalesce(nullif(meta->>'convId',''),substring(p.actor_key FROM '^ai_msg_conv_([A-Za-z0-9-]{6,128})_')) AS conversation_id,
      coalesce(meta->>'role',CASE WHEN p.media_url='assistant' THEN 'assistant' ELSE 'user' END) AS role,
      coalesce(meta->>'model',meta->>'used_model',meta#>>'{usage,model}',body->>'model','') AS model,
      CASE WHEN meta->>'chat_mode'='deep_think' OR meta->>'type'='tavily_research' THEN 'deep_think' ELSE 'normal' END AS chat_mode,
      regexp_replace(coalesce(nullif(body->>'reply',''),nullif(body->>'answer',''),p.content,''),
        'data:[^,[:space:]]+;base64,[A-Za-z0-9+/]+={0,2}','[附件]','g') AS message
    FROM public.posts p CROSS JOIN LATERAL (SELECT xtj_private.safe_jsonb(p.media_url) AS meta,xtj_private.safe_jsonb(p.content) AS body) parsed
    WHERE p.user_name=p_user_name AND p.media_type='__ai_agent_msg__' AND p.ai_account_id=p_account_id AND p.created_at>=since
      AND coalesce(meta->>'deleted','false')<>'true'
      AND (p_op<>'message' OR p.id=(p_value->>'message_id')::uuid)
      AND (p_op<>'export' OR p.actor_key LIKE ('ai\_msg\_conv\_'||cid||'\_%') ESCAPE '\')
      AND (date_from IS NULL OR p.created_at>=date_from) AND (date_to IS NULL OR p.created_at<=date_to)
      AND (before_at IS NULL OR (p.created_at,p.id)<(before_at,before_id))
  ), matched AS (
    SELECT s.*,m.title FROM source s LEFT JOIN public.ai_conversation_preferences m ON m.account_id=p_account_id AND m.conversation_id=s.conversation_id
    WHERE s.conversation_id ~ '^[A-Za-z0-9-]{6,128}$' AND (p_op<>'export' OR s.conversation_id=cid)
      AND (query_text='' OR strpos(lower(s.message),lower(query_text))>0 OR strpos(lower(coalesce(m.title,'')),lower(query_text))>0)
      AND (model_filter='' OR strpos(lower(s.model),lower(model_filter))>0)
      AND (mode_filter='' OR s.chat_mode=mode_filter)
  ), page AS (
    SELECT id,created_at,conversation_id,role,model,chat_mode,title,
      CASE WHEN p_op IN ('export','message') THEN left(message,500000)
        ELSE substring(message FROM greatest(1,strpos(lower(message),lower(query_text))-100) FOR 600) END AS text,
      p_op IN ('export','message') AND length(message)>500000 AS truncated
    FROM matched ORDER BY created_at DESC,id DESC LIMIT take+1
  ), visible AS (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT take)
  SELECT jsonb_build_object('ok',true,'items',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY created_at DESC,id DESC) FROM visible v),'[]'),
    'has_more',(SELECT count(*) FROM page)>take,'next_cursor',
    CASE WHEN (SELECT count(*) FROM page)>take THEN (SELECT jsonb_build_object('at',created_at,'id',id)::text FROM visible ORDER BY created_at,id LIMIT 1) END) INTO result;
  RETURN result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_history_request');
END;
$$;


CREATE OR REPLACE FUNCTION public.save_ai_tool_retry_result(
  p_user_name text, p_account_id text, p_conversation_id text,
  p_request_id text, p_call_id text, p_feedback jsonb DEFAULT NULL, p_cards jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
  auth_id uuid; account_at timestamptz; ids uuid[]; target public.posts;
  meta jsonb; step jsonb; step_path text[]; matches integer;
  cards jsonb; card jsonb; record jsonb; completed boolean; revision integer;
BEGIN
  IF p_user_name IS NULL OR length(p_user_name) NOT BETWEEN 1 AND 64 OR
    p_conversation_id IS NULL OR p_conversation_id !~ '^[A-Za-z0-9-]{6,128}$' OR
    p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 80 OR
    p_call_id IS NULL OR length(p_call_id) NOT BETWEEN 1 AND 160 THEN
    RETURN jsonb_build_object('ok',false,'error','retry_identity_invalid');
  END IF;
  IF p_account_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    SELECT id,created_at INTO auth_id,account_at FROM public.posts
      WHERE id=p_account_id::uuid AND user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__') FOR KEY SHARE;
  END IF;
  IF auth_id IS NULL THEN
    IF p_account_id='admin:'||p_user_name AND NOT EXISTS (
      SELECT 1 FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__')) THEN
      account_at='1970-01-01'::timestamptz;
    ELSE RETURN jsonb_build_object('ok',false,'error','retry_identity_changed'); END IF;
  END IF;

  SELECT array_agg(p.id) INTO ids FROM public.posts p
  WHERE p.user_name=p_user_name AND p.media_type='__ai_agent_msg__' AND p.ai_account_id=p_account_id AND p.created_at>=account_at
    AND p.is_deleted IS DISTINCT FROM true
    AND p.actor_key LIKE ('ai\_msg\_conv\_'||p_conversation_id||'\_%') ESCAPE '\'
    AND xtj_private.safe_jsonb(p.media_url)->>'role'='assistant'
    AND xtj_private.safe_jsonb(p.media_url)->>'convId'=p_conversation_id
    AND xtj_private.safe_jsonb(p.media_url)->>'client_request_id'=p_request_id;
  IF coalesce(array_length(ids,1),0)<>1 THEN
    RETURN jsonb_build_object('ok',false,'error','retry_turn_unavailable');
  END IF;
  SELECT * INTO target FROM public.posts WHERE id=ids[1] FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','retry_turn_unavailable'); END IF;
  meta=xtj_private.safe_jsonb(target.media_url);
  IF target.ai_account_id IS DISTINCT FROM p_account_id OR target.user_name IS DISTINCT FROM p_user_name OR target.media_type IS DISTINCT FROM '__ai_agent_msg__' OR
    meta->>'role' IS DISTINCT FROM 'assistant' OR meta->>'convId' IS DISTINCT FROM p_conversation_id OR
    meta->>'client_request_id' IS DISTINCT FROM p_request_id OR target.is_deleted IS TRUE OR coalesce(meta->>'deleted','false')='true' THEN
    RETURN jsonb_build_object('ok',false,'error','retry_turn_unavailable');
  END IF;
  SELECT count(*) INTO matches
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(meta->'process_events')='array' THEN meta->'process_events' ELSE '[]'::jsonb END) g
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN g->>'type'='tools' AND jsonb_typeof(g->'tools')='array' THEN g->'tools' ELSE '[]'::jsonb END) t
    WHERE t->>'call_id'=p_call_id;
  IF matches<>1 THEN RETURN jsonb_build_object('ok',false,'error','retry_step_unavailable'); END IF;
  SELECT t.value,ARRAY['process_events',(g.ordinality-1)::text,'tools',(t.ordinality-1)::text] INTO step,step_path
    FROM jsonb_array_elements(meta->'process_events') WITH ORDINALITY g(value,ordinality)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN g.value->>'type'='tools' AND jsonb_typeof(g.value->'tools')='array' THEN g.value->'tools' ELSE '[]'::jsonb END) WITH ORDINALITY t(value,ordinality)
    WHERE t.value->>'call_id'=p_call_id;
  completed=coalesce(step->>'status'='done' AND step ? 'retry_completed_at',false);
  IF coalesce(step->>'status','') NOT IN ('error','interrupted') AND NOT completed THEN
    RETURN jsonb_build_object('ok',false,'error','retry_step_changed');
  END IF;
  IF p_feedback IS NOT NULL AND NOT completed THEN
    IF jsonb_typeof(p_feedback) IS DISTINCT FROM 'object' OR p_feedback->>'success' IS DISTINCT FROM 'true' OR
      p_feedback->>'tool_name' IS DISTINCT FROM step->>'tool_name' OR
      octet_length(p_feedback::text)>65536 OR jsonb_typeof(p_cards) IS DISTINCT FROM 'array' OR
      jsonb_array_length(p_cards)>32 OR octet_length(p_cards::text)>8388608 THEN
      RETURN jsonb_build_object('ok',false,'error','retry_result_invalid');
    END IF;
    SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO cards
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(meta->'site_cards')='array' THEN meta->'site_cards' ELSE '[]'::jsonb END)
      WHERE value->>'tool_call_id' IS DISTINCT FROM p_call_id;
    FOR card IN SELECT value FROM jsonb_array_elements(p_cards) LOOP
      IF jsonb_typeof(card)<>'object' OR card->>'protocol' IS DISTINCT FROM 'xtj.ai.ui.v1' THEN
        RETURN jsonb_build_object('ok',false,'error','retry_result_invalid');
      END IF;
      cards=cards||jsonb_build_array(card||jsonb_build_object('tool_call_id',p_call_id));
    END LOOP;
    IF jsonb_array_length(cards)>32 OR octet_length(cards::text)>16777216 THEN
      RETURN jsonb_build_object('ok',false,'error','retry_artifacts_limit');
    END IF;
    step=(step-'error'-'retry_token')||(p_feedback-'type'-'retry_token')||jsonb_build_object(
      'status','done','call_id',p_call_id,'retry_completed_at',clock_timestamp());
    revision=CASE WHEN meta->>'tool_retry_revision' ~ '^\d{1,9}$' THEN (meta->>'tool_retry_revision')::integer ELSE 0 END+1;
    meta=jsonb_set(meta,step_path,step)||jsonb_build_object('site_cards',cards,'tool_retry_updated_at',clock_timestamp(),'tool_retry_revision',revision);
    UPDATE public.posts SET media_url=meta::text,updated_at=clock_timestamp() WHERE id=target.id;
    completed=true;
  END IF;
  record=jsonb_build_object('id',target.id,'conversation_id',p_conversation_id,'client_request_id',p_request_id,
    'process_events',meta->'process_events','site_cards',coalesce(meta->'site_cards','[]'::jsonb),'tool_retry_updated_at',meta->'tool_retry_updated_at','tool_retry_revision',meta->'tool_retry_revision');
  RETURN jsonb_build_object('ok',true,'completed',completed,'step',step,'record',record);
END;
$$;

COMMIT;
