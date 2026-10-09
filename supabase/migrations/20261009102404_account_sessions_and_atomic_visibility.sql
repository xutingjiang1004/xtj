BEGIN;
-- Keep the authentication row UUID as the lifetime of an account. A name may
-- be reused, but its chat graph and credentials cannot be reactivated.
ALTER TABLE public.chat_users ADD COLUMN account_id uuid;
UPDATE public.chat_users u SET account_id = a.id FROM public.posts a
WHERE a.user_name=u.user_name AND a.media_type='__auth__' AND u.deleted_at IS NULL;
CREATE UNIQUE INDEX chat_users_account_id_unique ON public.chat_users(account_id) WHERE account_id IS NOT NULL;
UPDATE public.chat_users SET user_name='__retired__'||id::text WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.chat_ensure_user(p_user_name text,p_registered boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_user public.chat_users; v_auth uuid;
BEGIN
 IF p_user_name IS NULL OR length(btrim(p_user_name)) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'invalid chat user name'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('xtj:account:'||p_user_name,0));
 SELECT id INTO v_auth FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__') ORDER BY (media_type='__auth__') DESC,created_at DESC LIMIT 1;
 SELECT * INTO v_user FROM public.chat_users WHERE user_name=p_user_name FOR UPDATE;
 IF FOUND AND (v_user.deleted_at IS NOT NULL OR (v_user.account_id IS NOT NULL AND v_user.account_id IS DISTINCT FROM v_auth)) THEN
  UPDATE public.chat_users SET user_name='__retired__'||id::text,is_registered=false,deleted_at=coalesce(deleted_at,now()),updated_at=now() WHERE id=v_user.id;
  v_user.id:=NULL;
 END IF;
 IF v_user.id IS NULL THEN
  INSERT INTO public.chat_users(user_name,is_registered,account_id) VALUES(p_user_name,v_auth IS NOT NULL,v_auth) RETURNING id INTO v_user.id;
 ELSIF v_auth IS NOT NULL THEN
  UPDATE public.chat_users SET is_registered=true,account_id=v_auth,updated_at=now() WHERE id=v_user.id;
 END IF;
 RETURN v_user.id;
END $$;

CREATE OR REPLACE FUNCTION public.chat_sync_legacy_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.media_type IN ('__auth__','__admin_auth__') THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('xtj:account:'||OLD.user_name,0));
   IF NOT EXISTS(SELECT 1 FROM public.posts WHERE user_name=OLD.user_name AND media_type IN ('__auth__','__admin_auth__')) THEN
    UPDATE public.chat_users SET user_name='__retired__'||id::text,is_registered=false,deleted_at=now(),updated_at=now() WHERE user_name=OLD.user_name;
    DELETE FROM public.posts WHERE user_name=OLD.user_name AND media_type IN ('__custom_ai_models__','__refresh_token__');
   END IF;
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.media_type IN ('__auth__','__admin_auth__') AND
   (OLD.user_name IS DISTINCT FROM NEW.user_name OR NEW.media_type IS NULL OR NEW.media_type NOT IN ('__auth__','__admin_auth__')) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('xtj:account:'||OLD.user_name,0));
  IF NOT EXISTS(SELECT 1 FROM public.posts WHERE user_name=OLD.user_name AND media_type IN ('__auth__','__admin_auth__')) THEN
   UPDATE public.chat_users SET user_name='__retired__'||id::text,is_registered=false,deleted_at=now(),updated_at=now() WHERE user_name=OLD.user_name;
   DELETE FROM public.posts WHERE user_name=OLD.user_name AND media_type IN ('__custom_ai_models__','__refresh_token__');
  END IF;
 END IF;
 IF NEW.media_type IN ('__auth__','__admin_auth__') THEN PERFORM public.chat_ensure_user(NEW.user_name,true); END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.rotate_user_refresh_token(p_user_name text,p_account_id text,p_old_jti text,p_new_jti text,p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_auth public.posts; v_old public.posts;
BEGIN
 SELECT * INTO v_auth FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__') ORDER BY (media_type='__auth__') DESC,created_at DESC LIMIT 1 FOR KEY SHARE;
 IF (v_auth.id IS NULL AND p_account_id<>'admin:'||p_user_name) OR (v_auth.id IS NOT NULL AND v_auth.id::text<>p_account_id) THEN RETURN jsonb_build_object('ok',false,'code','account_changed'); END IF;
 IF p_new_jti IS NULL OR p_new_jti=p_old_jti OR p_expires_at<=now() THEN RAISE EXCEPTION 'invalid successor'; END IF;
 DELETE FROM public.posts WHERE media_type='__refresh_token__' AND user_name=p_user_name AND media_url=p_old_jti RETURNING * INTO v_old;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','token_reused'); END IF;
 IF coalesce(v_old.content::jsonb->>'account_id',p_account_id)<>p_account_id OR v_old.created_at<coalesce(v_auth.created_at,'epoch'::timestamptz) THEN RAISE EXCEPTION 'account_changed'; END IF;
 INSERT INTO public.posts(user_name,media_type,media_url,actor_key,content) VALUES(p_user_name,'__refresh_token__',p_new_jti,'rt_'||p_new_jti,jsonb_build_object('jti',p_new_jti,'account_id',p_account_id,'expires_at',p_expires_at)::text);
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.rotate_user_refresh_token(text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_user_refresh_token(text,text,text,text,timestamptz) TO service_role;

-- Every append locks the account, merges every retained snapshot and commits
-- its replacement in the same transaction, including the normalized mirror.
CREATE FUNCTION public.merge_dm_deleted_ids(p_user_name text,p_ids jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_ids jsonb; v_id uuid;
BEGIN
 IF jsonb_typeof(p_ids)<>'array' OR jsonb_array_length(p_ids)>3000 THEN RAISE EXCEPTION 'invalid ids'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('xtj:dm-deleted:'||p_user_name,0));
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO v_ids FROM (
  SELECT DISTINCT id FROM (
   SELECT jsonb_array_elements_text(p_ids) id
   UNION ALL
   SELECT jsonb_array_elements_text(public.chat_safe_legacy_payload(content)->'ids') id FROM public.posts WHERE user_name=p_user_name AND media_type='__dm_deleted__'
  ) x WHERE id~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 ) d;
 INSERT INTO public.posts(user_name,media_type,content,actor_key) VALUES(p_user_name,'__dm_deleted__',jsonb_build_object('ids',v_ids,'updated_at',now())::text,'dm_deleted_'||gen_random_uuid()) RETURNING id INTO v_id;
 DELETE FROM public.posts WHERE user_name=p_user_name AND media_type='__dm_deleted__' AND id<>v_id;
 RETURN jsonb_build_object('ok',true,'ids',v_ids);
END $$;
REVOKE ALL ON FUNCTION public.merge_dm_deleted_ids(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_dm_deleted_ids(text,jsonb) TO service_role;

-- Visibility is decided before pagination for legacy DM readers and AI tools.
CREATE FUNCTION public.visible_legacy_dm_ids(p_actor text,p_ids uuid[]) RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT m.legacy_post_id FROM public.chat_messages m
 JOIN public.chat_users u ON u.user_name=p_actor AND u.is_registered AND u.deleted_at IS NULL
 JOIN public.chat_conversation_members c ON c.conversation_id=m.conversation_id AND c.user_id=u.id
 LEFT JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=u.id
 WHERE m.legacy_post_id=ANY(p_ids) AND m.withdrawn_at IS NULL AND s.hidden_at IS NULL
 AND c.left_at IS NULL AND (c.cleared_before IS NULL OR m.sent_at>c.cleared_before)
$$;
REVOKE ALL ON FUNCTION public.visible_legacy_dm_ids(text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visible_legacy_dm_ids(text,uuid[]) TO service_role;
CREATE FUNCTION public.read_visible_dm_posts(p_actor text,p_peer text DEFAULT NULL,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 201,p_pattern text DEFAULT NULL)
RETURNS SETOF public.posts LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT p.* FROM public.posts p JOIN public.chat_messages m ON m.legacy_post_id=p.id
 JOIN public.chat_users u ON u.user_name=p_actor AND u.is_registered AND u.deleted_at IS NULL
 JOIN public.chat_conversation_members c ON c.conversation_id=m.conversation_id AND c.user_id=u.id
 LEFT JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=u.id
 WHERE p.media_type='__dm__' AND (p.user_name=p_actor OR p.media_url=p_actor)
 AND (p_peer IS NULL OR (p.user_name=p_peer OR p.media_url=p_peer))
 AND m.withdrawn_at IS NULL AND s.hidden_at IS NULL AND c.left_at IS NULL
 AND (c.cleared_before IS NULL OR m.sent_at>c.cleared_before)
 AND (p_before IS NULL OR p.created_at<p_before OR (p.created_at=p_before AND p.id<p_before_id))
 AND (p_pattern IS NULL OR p.content ILIKE p_pattern)
 ORDER BY p.created_at DESC,p.id DESC LIMIT least(greatest(p_limit,1),1001)
$$;
REVOKE ALL ON FUNCTION public.read_visible_dm_posts(text,text,timestamptz,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_visible_dm_posts(text,text,timestamptz,uuid,integer,text) TO service_role;
CREATE OR REPLACE FUNCTION public.chat_rebuild_hidden_state(p_user_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id UUID;
  v_content TEXT;
  v_created_at TIMESTAMPTZ;
  v_payload JSONB;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' THEN
    RETURN;
  END IF;

  v_user_id := public.chat_ensure_user(p_user_name, false);
  SELECT snapshot.content, snapshot.created_at
    INTO v_content, v_created_at
  FROM public.posts snapshot
  WHERE snapshot.user_name = p_user_name
    AND snapshot.media_type = '__dm_deleted__'
  ORDER BY snapshot.created_at DESC, snapshot.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_payload := public.chat_safe_legacy_payload(v_content);
  INSERT INTO public.chat_message_user_state (message_id, user_id, hidden_at)
  SELECT message.id, v_user_id, v_created_at
  FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(v_payload->'ids') = 'array'
      THEN v_payload->'ids' ELSE '[]'::jsonb END
  ) AS hidden(message_id_text)
  JOIN public.chat_messages message ON message.legacy_post_id::text = hidden.message_id_text
  ON CONFLICT (message_id, user_id) DO UPDATE
    SET hidden_at = coalesce(chat_message_user_state.hidden_at,EXCLUDED.hidden_at), updated_at = now();
END;
$function$;


DROP FUNCTION public.save_ai_custom_models_snapshot(text,jsonb,jsonb,jsonb,boolean);
-- Serialize model edits across devices and Render instances. Deleted UIDs are
-- permanent; re-adding a model creates a new UID rather than reviving old caches.
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
    if item->>'uid' is not null then model_map := model_map || jsonb_build_object(item->>'uid', item); end if;
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

ALTER TABLE public.photo_upload_registry ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','attached','cleanup'));
CREATE FUNCTION public.guard_photo_registry_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_path text; v_upload public.photo_upload_registry;
BEGIN
 IF NEW.media_type IS DISTINCT FROM '__photo_wall__' OR NEW.is_deleted IS TRUE THEN RETURN NEW; END IF;
 v_path:=public.chat_safe_legacy_payload(NEW.content)->>'storagePath';
 IF coalesce(v_path,'')='' THEN RETURN NEW; END IF;
 SELECT * INTO v_upload FROM public.photo_upload_registry WHERE storage_path=v_path FOR UPDATE;
 IF NOT FOUND THEN
  IF TG_OP='UPDATE' AND public.chat_safe_legacy_payload(OLD.content)->>'storagePath'=v_path THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'photo_registry_missing';
 END IF;
 IF v_upload.user_name<>NEW.user_name OR v_upload.status='cleanup' THEN RAISE EXCEPTION 'photo_cleanup_or_ownership_conflict'; END IF;
 UPDATE public.photo_upload_registry SET status='attached' WHERE storage_path=v_path;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_registry_reference_guard BEFORE INSERT OR UPDATE OF content,media_url,media_type,is_deleted ON public.posts FOR EACH ROW EXECUTE FUNCTION public.guard_photo_registry_reference();

CREATE FUNCTION public.claim_photo_cleanup_paths(p_paths text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_path text; v_allowed jsonb:='[]';
BEGIN
 IF cardinality(p_paths)>500 THEN RAISE EXCEPTION 'too_many_cleanup_paths'; END IF;
 FOR v_path IN SELECT DISTINCT unnest(p_paths) ORDER BY 1 LOOP
  IF v_path !~ '^(photos|thumbs)/' OR v_path~'(^|/)\.\.?(/|$)' THEN RAISE EXCEPTION 'unsafe_photo_path'; END IF;
  INSERT INTO public.photo_upload_registry(storage_path,user_name,upload_id,status) VALUES(v_path,'__cleanup__','__cleanup__','cleanup') ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.photo_upload_registry WHERE storage_path=v_path FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.posts WHERE media_type='__photo_wall__' AND is_deleted IS NOT TRUE AND media_url IS DISTINCT FROM '__deleted__'
   AND (public.chat_safe_legacy_payload(content)->>'storagePath'=v_path OR position(v_path in coalesce(media_url,''))>0)) THEN
   UPDATE public.photo_upload_registry SET status='attached' WHERE storage_path=v_path;
  ELSE
   UPDATE public.photo_upload_registry SET status='cleanup' WHERE storage_path=v_path;
   v_allowed:=v_allowed||jsonb_build_array(v_path);
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'paths',v_allowed);
END $$;
REVOKE ALL ON FUNCTION public.guard_photo_registry_reference(),public.claim_photo_cleanup_paths(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_photo_registry_reference(),public.claim_photo_cleanup_paths(text[]) TO service_role;
COMMIT;
