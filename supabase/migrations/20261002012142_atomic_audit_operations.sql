-- Service-only atomic reservations and storage ownership transitions.
-- No retained user content is rewritten or deleted by this migration.
BEGIN;
CREATE TABLE public.ai_search_credit_claims (
 claim_id uuid PRIMARY KEY,
 user_name text NOT NULL,
 request_id uuid NOT NULL,
 day_key date NOT NULL,
 released boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz
);
CREATE INDEX ai_search_credit_claims_actor_day ON public.ai_search_credit_claims(user_name,day_key);
ALTER TABLE public.ai_search_credit_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_search_credit_claims FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_search_credit_claims TO service_role;

CREATE FUNCTION public.claim_ai_search_credit(
 p_user_name text,p_request_id uuid,p_claim_id uuid,
 p_free_token_limit bigint DEFAULT 100000,p_pro_token_limit bigint DEFAULT 1000000,p_free_search_limit integer DEFAULT 10
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_user text:=lower(btrim(coalesce(p_user_name,''))); v_day date:=public.ai_quota_shanghai_day(); v_q jsonb; v_claim public.ai_search_credit_claims;
BEGIN
 IF v_user='' OR p_request_id IS NULL OR p_claim_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.posts WHERE user_name=v_user AND media_type='__auth__') THEN
  RETURN jsonb_build_object('allowed',false,'reason','no_user','quota',NULL);
 END IF;
 -- Same lock as consume_ai_token_usage; all instances serialize the daily budget.
 PERFORM pg_advisory_xact_lock(hashtext('ai_token:'||v_user));
 SELECT * INTO v_claim FROM public.ai_search_credit_claims WHERE claim_id=p_claim_id FOR UPDATE;
 IF FOUND THEN
  v_q:=public.get_ai_user_quota(v_user,p_free_token_limit,p_pro_token_limit,p_free_search_limit);
  IF v_claim.user_name<>v_user OR v_claim.request_id<>p_request_id THEN RETURN jsonb_build_object('allowed',false,'reason','claim_conflict','quota',v_q); END IF;
  IF v_claim.released OR v_claim.day_key<>v_day THEN RETURN jsonb_build_object('allowed',false,'reason','claim_released','quota',v_q); END IF;
  RETURN jsonb_build_object('allowed',true,'reason',NULL,'quota',v_q,'duplicate',true);
 END IF;
 v_q:=public.get_ai_user_quota(v_user,p_free_token_limit,p_pro_token_limit,p_free_search_limit);
 IF NOT coalesce((v_q->>'can_search')::boolean,false) THEN RETURN jsonb_build_object('allowed',false,'reason','search_limit','quota',v_q); END IF;
 -- ON CONFLICT also fences accidental reuse of one claim UUID across actors.
 INSERT INTO public.ai_search_credit_claims(claim_id,user_name,request_id,day_key) VALUES(p_claim_id,v_user,p_request_id,v_day) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'reason','claim_conflict','quota',v_q); END IF;
 INSERT INTO public.ai_user_quota_daily(user_name,day_key,tokens_used,search_used,updated_at) VALUES(v_user,v_day,0,1,now())
 ON CONFLICT(user_name,day_key) DO UPDATE SET search_used=public.ai_user_quota_daily.search_used+1,updated_at=now();
 v_q:=public.get_ai_user_quota(v_user,p_free_token_limit,p_pro_token_limit,p_free_search_limit);
 RETURN jsonb_build_object('allowed',true,'reason',NULL,'quota',v_q,'duplicate',false);
END $$;

CREATE FUNCTION public.release_ai_search_credit(p_user_name text,p_claim_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_user text:=lower(btrim(coalesce(p_user_name,''))); v_claim public.ai_search_credit_claims;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('ai_token:'||v_user));
 SELECT * INTO v_claim FROM public.ai_search_credit_claims WHERE claim_id=p_claim_id AND user_name=v_user FOR UPDATE;
 IF NOT FOUND OR v_claim.released THEN RETURN jsonb_build_object('ok',true,'released',false); END IF;
 UPDATE public.ai_user_quota_daily SET search_used=greatest(0,search_used-1),updated_at=now() WHERE user_name=v_user AND day_key=v_claim.day_key;
 UPDATE public.ai_search_credit_claims SET released=true,released_at=now() WHERE claim_id=p_claim_id;
 RETURN jsonb_build_object('ok',true,'released',true);
END $$;
REVOKE ALL ON FUNCTION public.claim_ai_search_credit(text,uuid,uuid,bigint,bigint,integer),public.release_ai_search_credit(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_search_credit(text,uuid,uuid,bigint,bigint,integer),public.release_ai_search_credit(text,uuid) TO service_role;

ALTER TABLE public.storage_cleanup_jobs DROP CONSTRAINT IF EXISTS storage_cleanup_jobs_status_check;
ALTER TABLE public.storage_cleanup_jobs ADD CONSTRAINT storage_cleanup_jobs_status_check CHECK(status IN ('pending','processing','completed','failed'));

CREATE FUNCTION public.enqueue_storage_cleanup(p_photo_id uuid,p_bucket text,p_paths text[],p_last_error text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_job public.storage_cleanup_jobs; v_paths jsonb; v_duplicate boolean; v_created boolean;
BEGIN
 IF p_photo_id IS NULL OR p_bucket IS NULL OR p_bucket !~ '^[a-zA-Z0-9_-]{1,100}$' OR coalesce(cardinality(p_paths),0) NOT BETWEEN 1 AND 500
 OR EXISTS(SELECT 1 FROM unnest(p_paths) p WHERE p IS NULL OR length(p) NOT BETWEEN 1 AND 1024 OR p~'(^|/)\.\.?(/|$)' OR p~'[[:cntrl:]\\]') THEN RAISE EXCEPTION 'invalid_cleanup_paths'; END IF;
 SELECT jsonb_agg(p ORDER BY p) INTO v_paths FROM (SELECT DISTINCT unnest(p_paths) p) d;
 INSERT INTO public.storage_cleanup_jobs(photo_id,bucket,paths,last_error) VALUES(p_photo_id,p_bucket,v_paths,left(p_last_error,500)) ON CONFLICT(photo_id) DO NOTHING;
 v_created:=FOUND;
 SELECT * INTO v_job FROM public.storage_cleanup_jobs WHERE photo_id=p_photo_id FOR UPDATE;
 IF v_job.bucket<>p_bucket THEN RAISE EXCEPTION 'cleanup_bucket_conflict'; END IF;
 v_duplicate:=NOT v_created AND v_job.status<>'completed' AND v_job.paths @> v_paths;
 IF v_job.status<>'completed' THEN SELECT jsonb_agg(p ORDER BY p) INTO v_paths FROM (SELECT DISTINCT jsonb_array_elements_text(v_job.paths||v_paths) p) d; END IF;
 UPDATE public.storage_cleanup_jobs SET paths=v_paths,status='pending',
 attempts=CASE WHEN v_job.status='completed' THEN 0 ELSE attempts END,last_error=left(coalesce(p_last_error,''),500),
 updated_at=now(),completed_at=NULL,claim_token=NULL,lease_until=NULL WHERE id=v_job.id RETURNING * INTO v_job;
 RETURN jsonb_build_object('ok',true,'queued',true,'jobId',v_job.id,'paths',v_job.paths,'duplicate',v_duplicate);
END $$;
REVOKE ALL ON FUNCTION public.enqueue_storage_cleanup(uuid,text,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_storage_cleanup(uuid,text,text[],text) TO service_role;

CREATE TABLE public.post_media_uploads (
 storage_path text PRIMARY KEY,
 user_name text NOT NULL,
 upload_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','attached','cleanup')),
 media_url text,
 attached_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
 cleaned_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_media_uploads_actor_upload ON public.post_media_uploads(user_name,upload_id);
ALTER TABLE public.post_media_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_media_uploads FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.post_media_uploads TO service_role;

CREATE FUNCTION public.claim_post_media_cleanup(p_actor text,p_path text,p_upload_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_upload public.post_media_uploads;
BEGIN
 SELECT * INTO v_upload FROM public.post_media_uploads WHERE storage_path=p_path FOR UPDATE;
 IF NOT FOUND OR v_upload.user_name IS DISTINCT FROM p_actor OR v_upload.upload_id IS DISTINCT FROM p_upload_id THEN RETURN jsonb_build_object('ok',false,'code','media_ownership'); END IF;
 IF EXISTS(SELECT 1 FROM public.posts WHERE (id=v_upload.attached_post_id OR (v_upload.media_url IS NOT NULL AND media_url=v_upload.media_url)) AND is_deleted IS NOT TRUE) THEN
  UPDATE public.post_media_uploads SET status='attached',updated_at=now() WHERE storage_path=p_path;
  RETURN jsonb_build_object('ok',true,'referenced',true);
 END IF;
 UPDATE public.post_media_uploads SET status='cleanup',updated_at=now() WHERE storage_path=p_path;
 RETURN jsonb_build_object('ok',true,'referenced',false);
END $$;

CREATE FUNCTION public.create_post_with_media(p_actor text,p_path text,p_upload_id text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_upload public.post_media_uploads; v_post public.posts; v_input public.posts;
BEGIN
 SELECT * INTO v_upload FROM public.post_media_uploads WHERE storage_path=p_path FOR UPDATE;
 IF NOT FOUND OR v_upload.user_name IS DISTINCT FROM p_actor OR v_upload.upload_id IS DISTINCT FROM p_upload_id OR p_payload->>'user_name' IS DISTINCT FROM p_actor THEN RETURN jsonb_build_object('ok',false,'code','media_ownership'); END IF;
 IF coalesce(p_payload->>'media_url','')='' OR coalesce(p_payload->>'media_type','') NOT IN ('image','video','audio') THEN RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
 SELECT * INTO v_post FROM public.posts WHERE id=v_upload.attached_post_id;
 IF FOUND THEN
  IF v_post.user_name IS DISTINCT FROM p_actor OR v_post.media_url IS DISTINCT FROM p_payload->>'media_url' OR v_post.is_deleted IS TRUE THEN RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'post',to_jsonb(v_post),'duplicate',true);
 END IF;
 IF v_upload.status='cleanup' THEN RETURN jsonb_build_object('ok',false,'code','media_cleanup'); END IF;
 IF v_upload.status='attached' THEN RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
 SELECT * INTO v_input FROM jsonb_populate_record(NULL::public.posts,p_payload);
 INSERT INTO public.posts(user_name,content,media_url,media_type,actor_key,visibility,is_pinned,pinned_at,updated_at,
 location_name,location_province,location_city,location_district,location_level,ip_province,ip_city,ip_region_text,ip_region_status,ip_resolved_at,ip_lookup_started_at,ip_region_error)
 VALUES(p_actor,v_input.content,v_input.media_url,v_input.media_type,v_input.actor_key,coalesce(v_input.visibility,'public'),false,NULL,NULL,
 v_input.location_name,v_input.location_province,v_input.location_city,v_input.location_district,v_input.location_level,v_input.ip_province,v_input.ip_city,v_input.ip_region_text,v_input.ip_region_status,v_input.ip_resolved_at,v_input.ip_lookup_started_at,v_input.ip_region_error)
 RETURNING * INTO v_post;
 UPDATE public.post_media_uploads SET status='attached',media_url=v_post.media_url,attached_post_id=v_post.id,updated_at=now() WHERE storage_path=p_path;
 RETURN jsonb_build_object('ok',true,'post',to_jsonb(v_post),'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.claim_post_media_cleanup(text,text,text),public.create_post_with_media(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_post_media_cleanup(text,text,text),public.create_post_with_media(text,text,text,jsonb) TO service_role;

-- Deny remains an AND barrier even if future permissive policies are introduced.
DO $$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['chat_users','chat_friend_requests','chat_friendships','chat_user_blocks','chat_conversations','chat_conversation_members','chat_messages','chat_message_user_state','chat_attachments'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',v_table||'_block_browser',v_table);
  EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false)',v_table||'_block_browser',v_table);
 END LOOP;
END $$;

-- Clear old IP geography when a real new authentication event is committed.
CREATE OR REPLACE FUNCTION public.record_user_auth_event(p_user_name text, p_source text, p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_registered timestamptz;
  v_id uuid;
  v_event jsonb;
  v_patch jsonb;
BEGIN
  IF p_source NOT IN ('login_success','register_success') OR jsonb_typeof(p_event) <> 'object' OR octet_length(p_event::text)>8192 THEN
    RAISE EXCEPTION 'invalid_auth_event';
  END IF;
  SELECT min(created_at) INTO v_registered FROM public.posts WHERE user_name=p_user_name AND media_type='__auth__';
  IF v_registered IS NULL THEN RAISE EXCEPTION 'account_not_found'; END IF;
  SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO v_event FROM jsonb_each(p_event)
   WHERE key IN ('ip','ip_source','ip_version','user_agent','device_type','os','browser','device_id');
  v_event := v_event || jsonb_build_object('source',p_source,'authority','server_authentication','method','password','login_at',v_now,'registered_at',v_registered,'received_at',v_now);
  INSERT INTO public.posts(user_name,media_type,media_url,content,actor_key,created_at)
   VALUES(p_user_name,'__login_event__',v_event->>'device_id',v_event::text,'auth_event_'||gen_random_uuid()::text,v_now) RETURNING id INTO v_id;
  v_patch := jsonb_build_object('reg_time',v_registered,'registered_at',v_registered,'last_login',v_now,'last_visit',v_now,'last_ip',v_event->>'ip','last_ip_source',v_event->>'ip_source','last_login_source','server_authentication','last_auth_event_id',v_id,'last_ip_location',NULL,'last_ip_location_ip',NULL);
  INSERT INTO public.posts(user_name,media_type,content,actor_key)
   VALUES(p_user_name,'__user_info__',v_patch::text,'user_info_'||md5(p_user_name))
   ON CONFLICT(user_name) WHERE media_type='__user_info__' DO UPDATE SET content=(xtj_private.safe_jsonb(public.posts.content)||v_patch)::text
   WHERE CASE WHEN pg_input_is_valid(xtj_private.safe_jsonb(public.posts.content)->>'last_login','timestamptz') THEN (xtj_private.safe_jsonb(public.posts.content)->>'last_login')::timestamptz<=v_now ELSE true END;
  RETURN jsonb_build_object('event_id',v_id,'login_at',v_now,'registered_at',v_registered);
END; $$;

CREATE FUNCTION public.record_auth_ip_location(p_event_id uuid,p_ip text,p_location jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_event public.posts; v_body jsonb; v_updated integer;
BEGIN
 IF p_event_id IS NULL OR p_ip IS NULL OR jsonb_typeof(p_location) IS DISTINCT FROM 'object' OR octet_length(p_location::text)>8192 THEN RETURN jsonb_build_object('ok',false,'code','event_mismatch'); END IF;
 SELECT * INTO v_event FROM public.posts WHERE id=p_event_id AND media_type='__login_event__' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','event_mismatch'); END IF;
 v_body:=xtj_private.safe_jsonb(v_event.content);
 IF v_body->>'authority' IS DISTINCT FROM 'server_authentication' OR v_body->>'method' IS DISTINCT FROM 'password' OR coalesce(v_body->>'source','') NOT IN ('login_success','register_success') OR v_body->>'ip' IS DISTINCT FROM p_ip
 OR NOT EXISTS(SELECT 1 FROM public.posts WHERE user_name=v_event.user_name AND media_type='__auth__') THEN RETURN jsonb_build_object('ok',false,'code','event_mismatch'); END IF;
 UPDATE public.posts SET content=(v_body||jsonb_build_object('ip_location',p_location))::text WHERE id=p_event_id;
 UPDATE public.posts SET content=(xtj_private.safe_jsonb(content)||jsonb_build_object('last_ip_location',p_location,'last_ip_location_ip',p_ip))::text
 WHERE user_name=v_event.user_name AND media_type='__user_info__'
 AND xtj_private.safe_jsonb(content)->>'last_auth_event_id'=p_event_id::text
 AND xtj_private.safe_jsonb(content)->>'last_login'=v_body->>'login_at'
 AND xtj_private.safe_jsonb(content)->>'last_ip'=p_ip;
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'event_updated',true,'current_updated',v_updated>0);
END $$;
REVOKE ALL ON FUNCTION public.record_auth_ip_location(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_auth_ip_location(uuid,text,jsonb) TO service_role;
COMMIT;
