-- Private, account-incarnation fenced research frontiers. Only the server may
-- write prepared model context; no API key is stored in a checkpoint.
CREATE TABLE IF NOT EXISTS public.ai_research_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name text NOT NULL,
  account_id text NOT NULL,
  state jsonb NOT NULL CHECK (octet_length(state::text) <= 2097152),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','interrupted','failed','complete')),
  lease uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX IF NOT EXISTS ai_research_checkpoints_owner ON public.ai_research_checkpoints(account_id, updated_at DESC);
ALTER TABLE public.ai_research_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_research_checkpoints FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_research_checkpoints TO service_role;

CREATE OR REPLACE FUNCTION public.manage_ai_research_checkpoint(
  p_user_name text, p_account_id text, p_op text, p_id uuid DEFAULT NULL,
  p_lease uuid DEFAULT NULL, p_state jsonb DEFAULT NULL, p_status text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r public.ai_research_checkpoints; auth_id uuid; n integer;
BEGIN
  SELECT id INTO auth_id FROM public.posts
    WHERE id::text=p_account_id AND user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__')
    FOR KEY SHARE;
  -- The authenticated server also supports its environment-backed administrator
  -- before an auth row exists. Clients cannot invoke this service-only RPC.
  IF auth_id IS NULL AND NOT (p_account_id='admin:' || p_user_name AND NOT EXISTS (SELECT 1 FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__')))
    THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_identity_changed'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai-checkpoint:' || p_account_id, 0));
  DELETE FROM public.ai_research_checkpoints WHERE account_id=p_account_id AND expires_at <= now();
  IF p_op='list' THEN
    RETURN jsonb_build_object('ok',true,'rows',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.updated_at DESC)
      FROM public.ai_research_checkpoints c WHERE c.account_id=p_account_id AND c.user_name=p_user_name AND c.status<>'complete'),'[]'::jsonb));
  END IF;
  IF p_op='start' THEN
    IF p_lease IS NULL OR p_state IS NULL OR jsonb_typeof(p_state)<>'object' OR (p_state->>'version') IS DISTINCT FROM '1'
      THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_invalid'); END IF;
    SELECT count(*) INTO n FROM public.ai_research_checkpoints WHERE account_id=p_account_id AND status='running' AND lease_until>now();
    IF n>0 THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_running'); END IF;
    -- Keep the eight newest resumable jobs; completing a job releases its data.
    DELETE FROM public.ai_research_checkpoints WHERE id IN (SELECT id FROM public.ai_research_checkpoints
      WHERE account_id=p_account_id ORDER BY updated_at DESC OFFSET 7);
    INSERT INTO public.ai_research_checkpoints(user_name,account_id,state,lease,lease_until)
      VALUES(p_user_name,p_account_id,p_state,p_lease,now()+interval '10 minutes') RETURNING * INTO r;
  ELSE
    SELECT * INTO r FROM public.ai_research_checkpoints WHERE id=p_id AND account_id=p_account_id AND user_name=p_user_name FOR UPDATE;
    IF r.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_not_found'); END IF;
    IF p_op='remove' THEN
      IF r.status='running' AND r.lease_until>now() THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_running'); END IF;
      DELETE FROM public.ai_research_checkpoints WHERE id=r.id;
      RETURN jsonb_build_object('ok',true);
    ELSIF p_op='claim' THEN
      IF EXISTS (SELECT 1 FROM public.ai_research_checkpoints WHERE account_id=p_account_id AND id<>r.id AND status='running' AND lease_until>now()) THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_running'); END IF;
      IF r.status='complete' THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_complete'); END IF;
      IF r.status='running' AND r.lease_until>now() THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_running'); END IF;
      IF p_lease IS NULL THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_invalid'); END IF;
      UPDATE public.ai_research_checkpoints SET status='running',lease=p_lease,lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=r.id RETURNING * INTO r;
    ELSIF p_op IN ('save','finish') THEN
      IF p_lease IS NULL OR r.lease IS DISTINCT FROM p_lease OR r.status<>'running' OR r.lease_until<=now()
        THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_lease_lost'); END IF;
      IF p_state IS NULL OR jsonb_typeof(p_state)<>'object' OR (p_state->>'version') IS DISTINCT FROM '1'
        THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_invalid'); END IF;
      IF p_op='finish' AND (p_status IS NULL OR p_status NOT IN ('interrupted','failed','complete'))
        THEN RETURN jsonb_build_object('ok',false,'error','checkpoint_invalid'); END IF;
      UPDATE public.ai_research_checkpoints SET state=p_state,status=CASE WHEN p_op='finish' THEN p_status ELSE 'running' END,
        lease_until=CASE WHEN p_op='finish' THEN now() ELSE now()+interval '10 minutes' END,updated_at=now()
        WHERE id=r.id RETURNING * INTO r;
      IF p_status='complete' THEN DELETE FROM public.ai_research_checkpoints WHERE id=r.id; END IF;
    ELSE RETURN jsonb_build_object('ok',false,'error','checkpoint_invalid'); END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'row',to_jsonb(r));
END $$;
REVOKE ALL ON FUNCTION public.manage_ai_research_checkpoint(text,text,text,uuid,uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_ai_research_checkpoint(text,text,text,uuid,uuid,jsonb,text) TO service_role;

-- A deleted conversation/account must not remain a route to private context.
CREATE OR REPLACE FUNCTION public.erase_ai_research_frontier_for_post() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.media_type IN ('__auth__','__admin_auth__') THEN
    DELETE FROM public.ai_research_checkpoints WHERE account_id=OLD.id::text;
  ELSIF TG_OP='UPDATE' AND NEW.media_type='__ai_agent_msg__' AND
    xtj_private.safe_jsonb(NEW.media_url)->>'deleted'='true' THEN
    DELETE FROM public.ai_research_checkpoints WHERE user_name=NEW.user_name
      AND state->'request'->>'conversation_id'=xtj_private.safe_jsonb(NEW.media_url)->>'convId';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.erase_ai_research_frontier_for_post() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.erase_ai_research_frontier_for_post() TO service_role;
CREATE TRIGGER erase_ai_research_frontier AFTER DELETE OR UPDATE OF media_url ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.erase_ai_research_frontier_for_post();

-- Existing pg_cron remains optional in local PostgreSQL; production uses its
-- database scheduler to erase expired private context without a web worker.
DO $cleanup$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('xtj-research-checkpoint-expiry','17 3 * * *','DELETE FROM public.ai_research_checkpoints WHERE expires_at <= now()');
  END IF;
END $cleanup$;
