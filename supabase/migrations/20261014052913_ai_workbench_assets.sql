-- Editable text/row artifacts are private to an authenticated account incarnation.
-- No original files or model credentials belong in these records.
CREATE TABLE public.ai_workbench_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name text NOT NULL,
  account_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('clip','table','timeline','decision','note','workflow')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object' AND octet_length(data::text)<=1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_workbench_assets_owner ON public.ai_workbench_assets(account_id,updated_at DESC);
CREATE INDEX ai_workbench_assets_nickname ON public.ai_workbench_assets(user_name,account_id);
ALTER TABLE public.ai_workbench_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_workbench_assets FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.ai_workbench_assets TO service_role;

CREATE FUNCTION public.manage_ai_workbench_asset(
  p_user_name text,p_account_id text,p_op text,p_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,p_title text DEFAULT NULL,p_data jsonb DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE auth_id uuid; r public.ai_workbench_assets; n integer; bytes bigint;
BEGIN
  IF p_account_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    SELECT id INTO auth_id FROM public.posts WHERE id=p_account_id::uuid AND user_name=p_user_name
      AND media_type IN ('__auth__','__admin_auth__') FOR KEY SHARE;
  END IF;
  -- The environment-backed administrator identity comes from the authenticated
  -- server; untrusted clients have neither table nor RPC privileges.
  IF auth_id IS NULL AND NOT (p_account_id='admin:'||p_user_name AND NOT EXISTS
    (SELECT 1 FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__')))
    THEN RETURN jsonb_build_object('ok',false,'error','asset_identity_changed'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai-assets:'||p_account_id,0));
  IF p_op='list' THEN
    RETURN jsonb_build_object('ok',true,'records',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'kind',kind,'title',title,'created_at',created_at,'updated_at',updated_at)
      ORDER BY updated_at DESC,id) FROM public.ai_workbench_assets
      WHERE user_name=p_user_name AND account_id=p_account_id),'[]'::jsonb));
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO r FROM public.ai_workbench_assets WHERE id=p_id AND user_name=p_user_name AND account_id=p_account_id FOR UPDATE;
    IF r.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','asset_not_found'); END IF;
  END IF;
  IF p_op='get' THEN
    IF r.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','asset_not_found'); END IF;
  ELSIF p_op='remove' THEN
    IF r.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','asset_not_found'); END IF;
    DELETE FROM public.ai_workbench_assets WHERE id=r.id;
    RETURN jsonb_build_object('ok',true,'removed',true);
  ELSIF p_op='save' THEN
    IF p_kind IS NULL OR p_kind NOT IN ('clip','table','timeline','decision','note','workflow') OR
      p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 120 OR p_data IS NULL OR
      jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>1048576
      THEN RETURN jsonb_build_object('ok',false,'error','asset_invalid'); END IF;
    IF r.id IS NOT NULL AND p_expected_updated_at IS NOT NULL AND r.updated_at<>p_expected_updated_at
      THEN RETURN jsonb_build_object('ok',false,'error','asset_conflict'); END IF;
    SELECT count(*),COALESCE(sum(octet_length(data::text)),0) INTO n,bytes FROM public.ai_workbench_assets
      WHERE account_id=p_account_id AND (p_id IS NULL OR id<>p_id);
    IF n>=50 OR bytes+octet_length(p_data::text)>10485760
      THEN RETURN jsonb_build_object('ok',false,'error','asset_limit'); END IF;
    IF r.id IS NULL THEN
      INSERT INTO public.ai_workbench_assets(user_name,account_id,kind,title,data)
        VALUES(p_user_name,p_account_id,p_kind,trim(p_title),p_data) RETURNING * INTO r;
    ELSE
      UPDATE public.ai_workbench_assets SET kind=p_kind,title=trim(p_title),data=p_data,updated_at=clock_timestamp()
        WHERE id=r.id RETURNING * INTO r;
    END IF;
  ELSE RETURN jsonb_build_object('ok',false,'error','asset_invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'record',jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,
    'data',r.data,'created_at',r.created_at,'updated_at',r.updated_at));
END $$;
REVOKE ALL ON FUNCTION public.manage_ai_workbench_asset(text,text,text,uuid,text,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_ai_workbench_asset(text,text,text,uuid,text,text,jsonb,timestamptz) TO service_role;

CREATE FUNCTION public.erase_ai_workbench_assets_for_account() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.media_type IN ('__auth__','__admin_auth__') THEN
    DELETE FROM public.ai_workbench_assets WHERE account_id=OLD.id::text;
  ELSIF TG_OP='INSERT' AND NEW.media_type IN ('__auth__','__admin_auth__') THEN
    DELETE FROM public.ai_workbench_assets WHERE user_name=NEW.user_name AND account_id<>NEW.id::text;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.erase_ai_workbench_assets_for_account() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.erase_ai_workbench_assets_for_account() TO service_role;
CREATE TRIGGER erase_ai_workbench_assets AFTER DELETE OR INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.erase_ai_workbench_assets_for_account();
