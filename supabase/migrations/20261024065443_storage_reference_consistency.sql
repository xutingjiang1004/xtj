BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.managed_image_objects (
 path text PRIMARY KEY CHECK (path ~ '^(profile-images/|site-support/)'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','deleting')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.managed_image_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.managed_image_objects FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.managed_image_objects TO service_role;
CREATE FUNCTION xtj_private.managed_image_path(p_value text) RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_value ~ '^(profile-images/|site-support/)' THEN p_value
 ELSE substring(p_value FROM '/storage/v1/object/(?:public|sign)/uploads/((?:profile-images/|site-support/)[^?]+)') END;
$$;
CREATE FUNCTION xtj_private.managed_image_referenced(p_path text) RETURNS boolean LANGUAGE sql STABLE
SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.account_profile_settings s
   WHERE xtj_private.managed_image_path(s.settings->>'cover_url')=p_path OR xtj_private.managed_image_path(s.settings->>'background_url')=p_path)
 OR EXISTS(SELECT 1 FROM public.posts p WHERE p.media_type='__admin_meta__' AND p.media_url='author_support'
   AND (xtj_private.safe_jsonb(p.content)->>'wechat'=p_path OR xtj_private.safe_jsonb(p.content)->>'alipay'=p_path));
$$;
CREATE FUNCTION public.register_managed_image(p_path text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$
BEGIN
 IF p_path !~ '^(profile-images/[a-f0-9]{20}/[a-f0-9-]+\.(jpeg|png|webp|gif|avif)|site-support/(wechat|alipay)_[a-f0-9-]+\.(png|jpg|webp))$' THEN RAISE EXCEPTION 'invalid image path'; END IF;
 INSERT INTO public.managed_image_objects(path) VALUES(p_path);
 RETURN true;
END $$;
-- Called by reference triggers inside the same transaction. Claiming deletion
-- takes the same row lock and permanently prevents republishing a retired path.
CREATE FUNCTION xtj_private.activate_managed_image(p_path text) RETURNS void LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
DECLARE state_value text;
BEGIN
 IF p_path IS NULL THEN RETURN; END IF;
 INSERT INTO public.managed_image_objects(path,state) VALUES(p_path,'active') ON CONFLICT DO NOTHING;
 SELECT state INTO state_value FROM public.managed_image_objects WHERE path=p_path FOR UPDATE;
 IF state_value='deleting' THEN RAISE EXCEPTION 'image_retired'; END IF;
 UPDATE public.managed_image_objects SET state='active' WHERE path=p_path;
END $$;
CREATE FUNCTION xtj_private.queue_managed_image(p_path text) RETURNS void LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
BEGIN
 IF p_path IS NULL OR p_path !~ '^(profile-images/[a-f0-9]{20}/[a-f0-9-]+\.(jpeg|png|webp|gif|avif)|site-support/(wechat|alipay)_[a-f0-9-]+\.(png|jpg|webp))$' THEN RETURN; END IF;
 PERFORM public.enqueue_storage_cleanup(md5('managed-image:'||p_path)::uuid,'uploads',ARRAY[p_path],'managed_image_retired');
END $$;
CREATE FUNCTION xtj_private.profile_image_references() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
DECLARE field text; old_path text; new_path text;
BEGIN
 FOREACH field IN ARRAY ARRAY['cover_url','background_url'] LOOP
   old_path:=NULL; new_path:=NULL;
   IF TG_OP<>'INSERT' THEN old_path:=xtj_private.managed_image_path(OLD.settings->>field); END IF;
   IF TG_OP<>'DELETE' THEN new_path:=xtj_private.managed_image_path(NEW.settings->>field); END IF;
   IF old_path IS DISTINCT FROM new_path THEN
     PERFORM xtj_private.activate_managed_image(new_path);
     PERFORM xtj_private.queue_managed_image(old_path);
   END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER profile_image_references AFTER INSERT OR UPDATE OR DELETE ON public.account_profile_settings
 FOR EACH ROW EXECUTE FUNCTION xtj_private.profile_image_references();
CREATE OR REPLACE FUNCTION public.save_account_profile_settings(p_user_name text,p_account_id uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved jsonb;
BEGIN
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid profile owner'; END IF;
 PERFORM id FROM public.posts WHERE id=p_account_id AND user_name=p_user_name AND media_type='__auth__' FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid profile owner'; END IF;
 INSERT INTO public.account_profile_settings(user_name,account_id,settings) VALUES(p_user_name,p_account_id,p_patch)
 ON CONFLICT(user_name) DO UPDATE SET settings=(CASE WHEN account_profile_settings.account_id=p_account_id THEN account_profile_settings.settings ELSE '{}'::jsonb END)||p_patch,
 account_id=p_account_id,updated_at=now() RETURNING settings INTO saved;
 RETURN saved;
END $$;
CREATE FUNCTION public.update_author_support(p_admin_name text,p_provider text,p_path text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE config public.posts; codes jsonb; old_path text;
BEGIN
 IF p_provider IS NULL OR p_provider NOT IN ('wechat','alipay') OR p_admin_name IS NULL OR btrim(p_admin_name)='' OR
   p_path IS NULL OR p_path !~ ('^site-support/'||p_provider||'_[a-f0-9-]+\.(png|jpg|webp)$') THEN RAISE EXCEPTION 'invalid support update'; END IF;
 -- Covers the first insert as well as existing rows across all server instances.
 PERFORM pg_advisory_xact_lock(hashtextextended('xtj:author-support:'||p_admin_name,0));
 SELECT * INTO config FROM public.posts WHERE user_name=p_admin_name AND media_type='__admin_meta__' AND media_url='author_support'
   ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 codes:=coalesce(xtj_private.safe_jsonb(config.content),'{}'::jsonb);
 IF jsonb_typeof(codes)<>'object' THEN codes:='{}'::jsonb; END IF;
 old_path:=codes->>p_provider;
 PERFORM xtj_private.activate_managed_image(p_path);
 codes:=codes||jsonb_build_object(p_provider,p_path);
 IF config.id IS NULL THEN
   INSERT INTO public.posts(user_name,media_type,media_url,actor_key,content) VALUES(p_admin_name,'__admin_meta__','author_support','author_support',codes::text);
 ELSE UPDATE public.posts SET content=codes::text WHERE id=config.id; END IF;
 IF old_path IS DISTINCT FROM p_path THEN PERFORM xtj_private.queue_managed_image(old_path); END IF;
 RETURN codes;
END $$;
CREATE FUNCTION public.claim_managed_image_cleanup(p_paths text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE image_path text; accepted text[]:='{}';
BEGIN
 FOREACH image_path IN ARRAY p_paths LOOP
   IF image_path !~ '^(profile-images/|site-support/)' THEN RAISE EXCEPTION 'invalid image cleanup'; END IF;
   INSERT INTO public.managed_image_objects(path,state) VALUES(image_path,'active') ON CONFLICT DO NOTHING;
   PERFORM path FROM public.managed_image_objects WHERE path=image_path FOR UPDATE;
   IF xtj_private.managed_image_referenced(image_path) THEN CONTINUE; END IF;
   -- A successful claim is a tombstone; no later save can reference this path.
   UPDATE public.managed_image_objects SET state='deleting' WHERE path=image_path;
   accepted:=array_append(accepted,image_path);
 END LOOP;
 RETURN jsonb_build_object('ok',true,'paths',accepted);
END $$;
-- Bounded sweep catches legacy orphans, uploads that never committed, and
-- response-loss cases. One day protects active uploads. Referenced rows are
-- skipped in SQL so they cannot pin the scan to an eternal first page.
CREATE FUNCTION public.enqueue_managed_image_orphans() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE object_path text; queued integer:=0;
BEGIN
 FOR object_path IN SELECT name FROM storage.objects o WHERE bucket_id='uploads' AND name ~ '^(profile-images/|site-support/)'
   AND o.created_at<now()-interval '1 day'
   AND NOT xtj_private.managed_image_referenced(o.name)
   AND NOT EXISTS(SELECT 1 FROM public.storage_cleanup_jobs j WHERE j.photo_id=md5('managed-image:'||o.name)::uuid AND j.status IN ('pending','processing'))
   ORDER BY name LIMIT 100 LOOP
   PERFORM xtj_private.queue_managed_image(object_path); queued:=queued+1;
 END LOOP;
 RETURN queued;
END $$;
REVOKE ALL ON FUNCTION public.register_managed_image(text),public.update_author_support(text,text,text),
 public.claim_managed_image_cleanup(text[]),public.enqueue_managed_image_orphans() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_managed_image(text),public.update_author_support(text,text,text),
 public.claim_managed_image_cleanup(text[]),public.enqueue_managed_image_orphans() TO service_role;
REVOKE ALL ON FUNCTION xtj_private.managed_image_path(text),xtj_private.managed_image_referenced(text),
 xtj_private.activate_managed_image(text),xtj_private.queue_managed_image(text),xtj_private.profile_image_references() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION xtj_private.managed_image_path(text),xtj_private.managed_image_referenced(text),
 xtj_private.activate_managed_image(text),xtj_private.queue_managed_image(text),xtj_private.profile_image_references() TO service_role;
COMMIT;
