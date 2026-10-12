BEGIN;

-- Permissive SELECT policies are ORed. Replace the complete read surface,
-- including deployment-only legacy *_select_all / ALL policies.
DO $$
DECLARE v_table text; v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['likes', 'comments'] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN CONTINUE; END IF;
    FOR v_policy IN SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table AND cmd IN ('SELECT','ALL') LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (
      EXISTS (SELECT 1 FROM public.posts p WHERE p.id = %I.post_id
        AND p.is_deleted IS NOT TRUE AND (p.visibility IS NULL OR p.visibility = ''public'')
        AND (p.media_type IS NULL OR lower(btrim(p.media_type)) IN ('''',''image'',''video'',''audio'',''text'',''photo'',''album''))))',
      v_table || '_read_public', v_table, v_table);
  END LOOP;
END $$;

COMMIT;
