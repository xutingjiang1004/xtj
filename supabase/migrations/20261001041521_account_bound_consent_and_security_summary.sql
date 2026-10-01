-- Bind diagnostic consent to the actual account row; deleting/re-registering a
-- nickname must not inherit the previous account's opt-in.
ALTER TABLE public.user_behavior_consents ADD COLUMN account_id uuid REFERENCES public.posts(id) ON DELETE CASCADE;
UPDATE public.user_behavior_consents c SET account_id=(SELECT id FROM public.posts WHERE user_name=c.user_name AND media_type='__auth__' ORDER BY created_at DESC LIMIT 1);
DELETE FROM public.user_behavior_consents WHERE account_id IS NULL;
ALTER TABLE public.user_behavior_consents ALTER COLUMN account_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.account_security_summary(p_actor text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
WITH records AS (SELECT media_type,created_at,xtj_private.safe_jsonb(content) AS body FROM public.posts WHERE user_name=p_actor AND media_type IN ('__auth__','__login_event__','__user_visit__','__user_behavior__'))
SELECT jsonb_build_object(
 'registered_at',min(created_at) FILTER(WHERE media_type='__auth__'),
 'login_count',count(*) FILTER(WHERE media_type='__login_event__' AND (body->>'authority'='server_authentication' OR body->>'source'='admin_login')),
 'first_login',min(created_at) FILTER(WHERE media_type='__login_event__' AND (body->>'authority'='server_authentication' OR body->>'source'='admin_login')),
 'last_login',max(created_at) FILTER(WHERE media_type='__login_event__' AND (body->>'authority'='server_authentication' OR body->>'source'='admin_login')),
 'visit_count',count(*) FILTER(WHERE media_type='__user_visit__'),
 'behavior_count',coalesce(sum(CASE WHEN media_type='__user_behavior__' THEN CASE WHEN jsonb_typeof(body->'events')='array' THEN jsonb_array_length(body->'events') ELSE 1 END ELSE 0 END),0),
 'scope','retained_server_records'
) FROM records;
$$;
REVOKE ALL ON FUNCTION public.account_security_summary(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_security_summary(text) TO service_role;
