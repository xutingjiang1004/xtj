-- ============================================================================
-- 047 幂等收口历史遗留的 claim_pro_gift(TEXT, TEXT) 安全窗口
-- ----------------------------------------------------------------------------
-- 背景（审计 07c-infra-build.md 🔴）：005_harden_rpc_rls.sql 定义了
--   claim_pro_gift(p_user_name TEXT, p_gift_id TEXT)
-- SECURITY DEFINER 且包含完整发卡逻辑，但【未 REVOKE anon】；直到 012
-- 才 DROP 该签名并改由仅 service_role 可执行的 claim_pro_gift_for_user
-- 承担发卡。因此 005→012 之间的任何部署，持 anon key 者都能
-- rpc.claim_pro_gift 传入任意 p_user_name 伪造用户名免费领取 Pro/VIP。
--
-- 修复：本迁移幂等执行
--   1) 若 claim_pro_gift(text, text) 签名仍存在，REVOKE 其 PUBLIC/anon/
--      authenticated 的 EXECUTE 权限；
--   2) DROP FUNCTION IF EXISTS public.claim_pro_gift(p_user_name text,
--      p_gift_id text)。
--
-- ⚠️ 需人工在生产库确认：
--   * 执行前建议核对当前残留签名：
--       SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'claim_pro_gift';
--   * 本脚本只影响 claim_pro_gift 的 (text, text) 双参签名（即 005 引入的
--     历史窗口函数），【保留】其他仍在使用的签名/函数（如
--     claim_pro_gift_for_user(TEXT, UUID)），不会误删。
--   * 012/013 已 DROP 过该签名，生产库大概率已无此函数；此时本脚本为
--     纯幂等确认，无副作用。
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'claim_pro_gift'
      AND pg_get_function_identity_arguments(p.oid) = 'text, text'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.claim_pro_gift(text, text) FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.claim_pro_gift(p_user_name text, p_gift_id text);

COMMIT;
