BEGIN;

-- Update only the authenticated account's original failed tool step. Row locks
-- serialize sibling retries and conversation deletion without replacing content.
CREATE FUNCTION public.save_ai_tool_retry_result(
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
  WHERE p.user_name=p_user_name AND p.media_type='__ai_agent_msg__' AND p.created_at>=account_at
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
  IF target.user_name IS DISTINCT FROM p_user_name OR target.media_type IS DISTINCT FROM '__ai_agent_msg__' OR
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
REVOKE ALL ON FUNCTION public.save_ai_tool_retry_result(text,text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_ai_tool_retry_result(text,text,text,text,text,jsonb,jsonb) TO service_role;
COMMIT;
