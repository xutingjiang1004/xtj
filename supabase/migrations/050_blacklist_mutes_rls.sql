-- =====================================================================
-- Migration 050: blacklist / mutes 启用 RLS + 收回 anon/authenticated 权限
-- 审计 P1：001 建表后从未 ENABLE RLS / REVOKE，若生产仍有默认 GRANT，
-- 持 anon key 可枚举封禁名单或自解禁。
-- 策略：仅 service_role 可读写；不建任何 anon/authenticated policy。
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.blacklist') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.blacklist FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.blacklist TO service_role';
    -- 确保无宽松 policy 残留
    EXECUTE 'DROP POLICY IF EXISTS blacklist_select_all ON public.blacklist';
    EXECUTE 'DROP POLICY IF EXISTS blacklist_all ON public.blacklist';
  END IF;

  IF to_regclass('public.mutes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.mutes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.mutes FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.mutes TO service_role';
    EXECUTE 'DROP POLICY IF EXISTS mutes_select_all ON public.mutes';
    EXECUTE 'DROP POLICY IF EXISTS mutes_all ON public.mutes';
  END IF;
END $$;

COMMIT;
