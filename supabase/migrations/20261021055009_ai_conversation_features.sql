BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Preserve a saved key atomically without returning it to the browser.
create or replace function public.save_ai_custom_models_snapshot(
  p_user_name text, p_models jsonb, p_deleted_uids jsonb,
  p_ai_prefs jsonb default '{}'::jsonb, p_replace boolean default false, p_account_id text default null
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  previous_text text;
  account public.posts;
  previous jsonb := '{}'::jsonb;
  old_models jsonb;
  model_map jsonb := '{}'::jsonb;
  deleted jsonb;
  saved_models jsonb;
  snapshot jsonb;
  item jsonb;
  old_item jsonb;
  defaults jsonb := '{"qwen":"https://dashscope.aliyuncs.com/compatible-mode/v1","doubao":"https://ark.cn-beijing.volces.com/api/v3","deepseek":"https://api.deepseek.com","kimi":"https://api.moonshot.cn/v1","zhipu":"https://open.bigmodel.cn/api/paas/v4","openai":"https://api.openai.com/v1"}';
  new_id public.posts.id%type;
begin
  if p_user_name is null or btrim(p_user_name) = '' or length(p_user_name) > 64 then
    raise exception 'invalid model owner';
  end if;
  if jsonb_typeof(p_models) is distinct from 'array' or jsonb_array_length(p_models) > 20
    or jsonb_typeof(p_deleted_uids) is distinct from 'array'
    or jsonb_typeof(p_ai_prefs) is distinct from 'object' then
    raise exception 'invalid model snapshot';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xtj:custom-models:' || p_user_name, 0));
  select * into account from public.posts where user_name=p_user_name and media_type IN ('__auth__','__admin_auth__') order by (media_type='__auth__') desc,created_at desc limit 1 for key share;
  if (account.id is null and p_account_id is distinct from 'admin:'||p_user_name)
    or (account.id is not null and p_account_id is not null and account.id::text<>p_account_id) then raise exception 'account_changed'; end if;
  select content into previous_text from public.posts
    where user_name = p_user_name and media_type = '__custom_ai_models__' and created_at>=coalesce(account.created_at,'1970-01-01'::timestamptz)
    order by created_at desc, id desc limit 1;
  if previous_text is not null then previous := previous_text::jsonb; end if;
  old_models := coalesce(previous->'models', '[]'::jsonb);

  select coalesce(jsonb_agg(uid order by uid), '[]'::jsonb) into deleted from (
    select distinct value #>> '{}' as uid from jsonb_array_elements(
      coalesce(previous->'deleted_uids', '[]'::jsonb) || p_deleted_uids
    ) where jsonb_typeof(value) = 'string' and length(value #>> '{}') between 1 and 64
    union
    select old->>'uid' from jsonb_array_elements(old_models) old
      where p_replace and not exists (
        select 1 from jsonb_array_elements(p_models) incoming where incoming->>'uid' = old->>'uid'
      )
  ) tombstones where uid is not null;

  if not p_replace then
    for item in select value from jsonb_array_elements(old_models) loop
      if item->>'uid' is not null then model_map := model_map || jsonb_build_object(item->>'uid', item); end if;
    end loop;
  end if;
  for item in select value from jsonb_array_elements(p_models) loop
    if item->>'uid' is not null then
      if item->>'key_unchanged'='true' then
        select value into old_item from jsonb_array_elements(old_models)
          where value->>'uid'=item->>'uid' limit 1;
        if old_item is null or old_item->'api_key_enc' is null then raise exception 'model_key_required'; end if;
        if old_item->>'provider' is distinct from item->>'provider' or
          rtrim(coalesce(nullif(old_item->>'base_url',''), defaults->>(old_item->>'provider'),''),'/') <>
          rtrim(coalesce(nullif(item->>'base_url',''), defaults->>(item->>'provider'),''),'/') then
          raise exception 'model_endpoint_key_required';
        end if;
        item := (item - 'key_unchanged') || jsonb_build_object('api_key_enc',old_item->'api_key_enc');
      end if;
      if item->'api_key_enc' is null then raise exception 'model_key_required'; end if;
      model_map := model_map || jsonb_build_object(item->>'uid', item - 'api_key' - 'key_unchanged');
    end if;
  end loop;
  select coalesce(jsonb_agg(value order by key), '[]'::jsonb) into saved_models
    from jsonb_each(model_map) where not (deleted ? key);
  if jsonb_array_length(saved_models) > 20 then raise exception 'too many custom models'; end if;
  snapshot := jsonb_build_object('account_id',coalesce(account.id::text,p_account_id),'models', saved_models, 'deleted_uids', deleted,
    'ai_prefs', coalesce(previous->'ai_prefs', '{}'::jsonb) || p_ai_prefs,
    'updated_at', clock_timestamp());
  insert into public.posts(user_name, media_type, content, actor_key)
    values (p_user_name, '__custom_ai_models__', snapshot::text, 'ai_models_' || gen_random_uuid()) returning id into new_id;
  delete from public.posts where user_name = p_user_name and media_type = '__custom_ai_models__' and id <> new_id;
  return snapshot || jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.save_ai_custom_models_snapshot(text,jsonb,jsonb,jsonb,boolean,text) from public, anon, authenticated;
grant execute on function public.save_ai_custom_models_snapshot(text,jsonb,jsonb,jsonb,boolean,text) to service_role;

-- Private, small preferences. The authentication-row FK erases them when an
-- account is deleted; re-created names cannot inherit the previous account ID.
CREATE TABLE public.ai_conversation_preferences (
  account_id text NOT NULL,
  auth_record_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  conversation_id text NOT NULL CHECK (conversation_id ~ '^[A-Za-z0-9-]{6,128}$'),
  title text NOT NULL DEFAULT '' CHECK (length(title)<=80),
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,conversation_id),
  CHECK ((auth_record_id IS NOT NULL AND auth_record_id::text=account_id) OR
    (auth_record_id IS NULL AND account_id LIKE 'admin:%'))
);
CREATE TABLE public.ai_message_bookmarks (
  account_id text NOT NULL,
  auth_record_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  conversation_id text NOT NULL CHECK (conversation_id ~ '^[A-Za-z0-9-]{6,128}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,message_id),
  CHECK ((auth_record_id IS NOT NULL AND auth_record_id::text=account_id) OR
    (auth_record_id IS NULL AND account_id LIKE 'admin:%'))
);
CREATE INDEX ai_message_bookmarks_page ON public.ai_message_bookmarks(account_id,created_at DESC,message_id DESC);
CREATE INDEX ai_conversation_preferences_auth_idx ON public.ai_conversation_preferences(auth_record_id) WHERE auth_record_id IS NOT NULL;
CREATE INDEX ai_message_bookmarks_auth_idx ON public.ai_message_bookmarks(auth_record_id) WHERE auth_record_id IS NOT NULL;
CREATE INDEX ai_message_bookmarks_message_idx ON public.ai_message_bookmarks(message_id);
ALTER TABLE public.ai_conversation_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_message_bookmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_conversation_preferences,public.ai_message_bookmarks FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_conversation_preferences,public.ai_message_bookmarks TO service_role;

CREATE FUNCTION public.ai_conversation_features(p_user_name text,p_account_id text,p_op text,p_value jsonb DEFAULT '{}')
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
        SELECT 1 FROM public.posts p WHERE p.user_name=p_user_name AND p.media_type='__ai_agent_msg__' AND p.created_at>=since
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
    SELECT p.* INTO found_message FROM public.posts p WHERE p.user_name=p_user_name AND p.media_type='__ai_agent_msg__' AND p.created_at>=since
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
      WHERE b.account_id=p_account_id AND p.user_name=p_user_name AND p.created_at>=since AND p.media_type='__ai_agent_msg__'
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
    WHERE p.user_name=p_user_name AND p.media_type='__ai_agent_msg__' AND p.created_at>=since
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
REVOKE ALL ON FUNCTION public.ai_conversation_features(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_conversation_features(text,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.soft_delete_ai_conversation(p_user_name text, p_conversation_id text)
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
  UPDATE public.posts AS p
  SET media_url = (
    CASE WHEN jsonb_typeof(xtj_private.safe_jsonb(p.media_url)) = 'object'
      THEN xtj_private.safe_jsonb(p.media_url)
      ELSE jsonb_build_object('role', CASE WHEN p.media_url = 'assistant' THEN 'assistant' ELSE 'user' END)
    END || jsonb_build_object('deleted', true, 'deleted_at', clock_timestamp())
  )::text
  WHERE p.user_name = p_user_name AND p.media_type = '__ai_agent_msg__'
    AND p.actor_key LIKE ('ai\_msg\_conv\_' || p_conversation_id || '\_%') ESCAPE '\'
    AND coalesce(nullif(xtj_private.safe_jsonb(p.media_url)->>'convId', ''), p_conversation_id) = p_conversation_id
    AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted', 'false') <> 'true';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.ai_conversation_preferences WHERE conversation_id=p_conversation_id AND
    (account_id='admin:'||p_user_name OR account_id IN (SELECT id::text FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__')));
  DELETE FROM public.ai_message_bookmarks WHERE conversation_id=p_conversation_id AND
    (account_id='admin:'||p_user_name OR account_id IN (SELECT id::text FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__')));
  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.soft_delete_ai_conversation(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_ai_conversation(text, text) TO service_role;

COMMIT;
