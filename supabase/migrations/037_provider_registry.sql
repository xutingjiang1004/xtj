-- Provider Registry: 存储已配置的 AI 提供商
-- user_model_preferences: 用户级别的模型偏好

-- provider_registry 表
CREATE TABLE IF NOT EXISTS public.provider_registry (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('openai','deepseek','anthropic','custom')),
  api_key_encrypted TEXT NOT NULL,
  api_key_iv       TEXT NOT NULL,
  api_key_tag      TEXT NOT NULL,
  base_url      TEXT,
  models_config JSONB DEFAULT '[]'::jsonb,
  capabilities  JSONB DEFAULT '[]'::jsonb,
  enabled       BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_registry_enabled ON public.provider_registry(enabled);
CREATE INDEX IF NOT EXISTS idx_provider_registry_type ON public.provider_registry(provider_type);

-- user_model_preferences 表
CREATE TABLE IF NOT EXISTS public.user_model_preferences (
  id                BIGSERIAL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  provider_id       BIGINT NOT NULL REFERENCES public.provider_registry(id) ON DELETE CASCADE,
  model_id          TEXT NOT NULL,
  custom_parameters JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_user_model_prefs_user ON public.user_model_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_prefs_provider ON public.user_model_preferences(provider_id);

-- ============================================================
-- ★ 2026-08-05 安全修复：两张表此前无 RLS、无 REVOKE，
--   anon 可读 provider_registry 的 api_key_encrypted/iv/tag（密文可被
--   下载离线破解）并可篡改供应商配置把 AI 对话转发到攻击者服务器。
--   修复：ENABLE RLS + 撤销 anon/authenticated 全部权限。
--   后端 service_role 绕过 RLS，provider-registry.js 全部操作不受影响。
-- ============================================================

ALTER TABLE public.provider_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_model_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.provider_registry FROM anon, authenticated;
REVOKE ALL ON public.user_model_preferences FROM anon, authenticated;
REVOKE ALL ON public.provider_registry_id_seq FROM anon, authenticated;
REVOKE ALL ON public.user_model_preferences_id_seq FROM anon, authenticated;

