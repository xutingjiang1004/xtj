CREATE TABLE public.account_profile_settings (
 user_name text PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
 settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_profile_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_profile_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.account_profile_settings TO service_role;
CREATE FUNCTION public.save_account_profile_settings(p_user_name text,p_account_id uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE saved jsonb;
BEGIN
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR NOT EXISTS (
  SELECT 1 FROM public.posts WHERE id=p_account_id AND user_name=p_user_name AND media_type='__auth__'
 ) THEN RAISE EXCEPTION 'invalid profile owner'; END IF;
 INSERT INTO public.account_profile_settings(user_name,account_id,settings) VALUES(p_user_name,p_account_id,p_patch)
 ON CONFLICT(user_name) DO UPDATE SET settings=(CASE WHEN account_profile_settings.account_id=p_account_id THEN account_profile_settings.settings ELSE '{}'::jsonb END)||p_patch,
 account_id=p_account_id,updated_at=now() RETURNING settings INTO saved;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_account_profile_settings(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_account_profile_settings(text,uuid,jsonb) TO service_role;
