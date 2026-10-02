-- Existing deployments may have optional legacy management/trigger RPCs that
-- never existed in a fresh schema. Harden each present function without making
-- clean replay depend on recreating retired browser APIs.
DO $$
DECLARE signature text; fn regprocedure;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'public.auto_expire_blacklist()','public.auto_expire_mutes()',
 'public.get_user_ban_info(text)','public.get_user_blacklist_info(text)','public.get_user_mute_info(text)',
 'public.is_user_banned(text)','public.is_user_blacklisted(text)','public.is_user_muted(text)'
 ] LOOP
  fn:=to_regprocedure(signature);
  IF fn IS NOT NULL THEN
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
   EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,public',fn);
  END IF;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY[
 'public.ai_quota_shanghai_day()','public.bump_comment_count()','public.bump_comments_count()',
 'public.bump_like_count()','public.bump_likes_count()'
 ] LOOP
  fn:=to_regprocedure(signature);
  IF fn IS NOT NULL THEN EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,public',fn); END IF;
 END LOOP;
END $$;
