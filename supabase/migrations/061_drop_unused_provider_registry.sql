-- 061: 删除已废弃的 provider_registry / user_model_preferences 表（可选迁移）
--
-- 背景（2026-09-26 深度审计）：
--   render-api/provider-registry.js（764 行）与其 6 条 /api/provider/* 路由**从未被任何
--   运行时或前端消费**：server.js 内无 provider_registry 查询、前端零调用，而且该模块
--   加密落库的 api_key 从来没有解密入口（decryptApiKey 零调用）——即"注册了也用不上"。
--   代码已于同批修复中整体删除，这里清理它遗留的两张表。
--
-- ⚠ 执行前请确认：
--   1) 你确实不需要保留任何历史 provider 配置（这些行的 api_key 是 AES-GCM 密文，
--      在代码删除后已无任何解密路径，保留也无法使用）；
--   2) 若想先留档，执行：
--      CREATE TABLE public._archive_provider_registry AS TABLE public.provider_registry;
--      CREATE TABLE public._archive_user_model_preferences AS TABLE public.user_model_preferences;
--   3) 若想跳过本迁移，直接不执行即可——两张表已 REVOKE anon/authenticated 且无 RLS 策略，
--      留着不会造成越权，只是占用少量空间。
--
-- 幂等：全部 IF EXISTS，可安全重复执行。

BEGIN;

DROP TABLE IF EXISTS public.user_model_preferences;
DROP TABLE IF EXISTS public.provider_registry;

-- 序列由 BIGSERIAL/IDENTITY 自动随表删除；若历史上手工建过独立序列则一并清理
DROP SEQUENCE IF EXISTS public.provider_registry_id_seq;
DROP SEQUENCE IF EXISTS public.user_model_preferences_id_seq;

COMMIT;

-- 验收：应返回 0 行
-- SELECT tablename FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('provider_registry', 'user_model_preferences');
