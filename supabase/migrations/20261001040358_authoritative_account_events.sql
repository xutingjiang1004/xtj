-- Password authentication events are committed with the account's timestamps.
-- Browser telemetry cannot call this function or supply registration/login times.
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
  v_patch := jsonb_build_object('reg_time',v_registered,'registered_at',v_registered,'last_login',v_now,'last_visit',v_now,'last_ip',v_event->>'ip','last_ip_source',v_event->>'ip_source','last_login_source','server_authentication');
  INSERT INTO public.posts(user_name,media_type,content,actor_key)
   VALUES(p_user_name,'__user_info__',v_patch::text,'user_info_'||md5(p_user_name))
   ON CONFLICT(user_name) WHERE media_type='__user_info__' DO UPDATE SET content=(xtj_private.safe_jsonb(public.posts.content)||v_patch)::text;
  RETURN jsonb_build_object('event_id',v_id,'login_at',v_now,'registered_at',v_registered);
END; $$;
REVOKE ALL ON FUNCTION public.record_user_auth_event(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_auth_event(text,text,jsonb) TO service_role;

-- Restore canonical registration timestamps for existing accounts too.
UPDATE public.posts i SET content=(xtj_private.safe_jsonb(i.content)||jsonb_build_object('reg_time',a.registered_at,'registered_at',a.registered_at))::text
 FROM (SELECT user_name,min(created_at) AS registered_at FROM public.posts WHERE media_type='__auth__' GROUP BY user_name) a
 WHERE i.media_type='__user_info__' AND i.user_name=a.user_name;
