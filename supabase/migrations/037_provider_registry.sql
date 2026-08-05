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
