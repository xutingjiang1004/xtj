-- Server-owned state for AI site tools. Browser roles have no direct access.
CREATE TABLE IF NOT EXISTS public.ai_search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name text NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL,
  title text NOT NULL,
  snippet text NOT NULL DEFAULT '',
  jump_target jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE TABLE IF NOT EXISTS public.ai_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('post', 'announcement')),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_action_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name text NOT NULL,
  action_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'executed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  executed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ai_maintenance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by text NOT NULL,
  module text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_search_results_owner_created_idx ON public.ai_search_results (owner_name, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_drafts_owner_updated_idx ON public.ai_drafts (owner_name, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_confirmations_owner_status_idx ON public.ai_action_confirmations (owner_name, status, expires_at);
CREATE INDEX IF NOT EXISTS ai_maintenance_status_updated_idx ON public.ai_maintenance_tasks (status, updated_at DESC);

ALTER TABLE public.ai_search_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_maintenance_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_search_results, public.ai_drafts, public.ai_action_confirmations, public.ai_maintenance_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_search_results, public.ai_drafts, public.ai_action_confirmations, public.ai_maintenance_tasks TO service_role;
