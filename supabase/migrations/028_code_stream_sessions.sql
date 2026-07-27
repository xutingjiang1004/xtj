-- Migration 028: Code AI stream sessions and events for SSE resume
-- Provides persistent stream session tracking and event logging for
-- the Code workspace streaming endpoint. Enables reconnect, page-refresh
-- recovery, and idempotent request handling.
-- Feature flag: CODE_STREAM_RESUME_ENABLED

-- ── ai_stream_sessions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_stream_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  stream_id     TEXT NOT NULL,
  request_id    TEXT NOT NULL DEFAULT '',
  client_request_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  workspace_id  TEXT NOT NULL DEFAULT '',
  workspace_generation INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','completed','failed','cancelled','expired')),
  last_event_id INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_user_status
  ON public.ai_stream_sessions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_stream_id
  ON public.ai_stream_sessions (stream_id);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_expires
  ON public.ai_stream_sessions (expires_at)
  WHERE status = 'running';

-- ── ai_stream_events ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_stream_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       TEXT NOT NULL,
  stream_id     TEXT NOT NULL,
  event_id      INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  event_data    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 hour'),
  CONSTRAINT uq_stream_event UNIQUE (stream_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_events_stream
  ON public.ai_stream_events (stream_id, event_id);

CREATE INDEX IF NOT EXISTS idx_stream_events_expires
  ON public.ai_stream_events (expires_at);

-- ── RLS: ai_stream_sessions ──────────────────────────────────────────────

ALTER TABLE public.ai_stream_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own stream sessions" ON public.ai_stream_sessions;
CREATE POLICY "Users can view own stream sessions"
  ON public.ai_stream_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "Service can manage stream sessions" ON public.ai_stream_sessions;
CREATE POLICY "Service can manage stream sessions"
  ON public.ai_stream_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── RLS: ai_stream_events ────────────────────────────────────────────────

ALTER TABLE public.ai_stream_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own stream events" ON public.ai_stream_events;
CREATE POLICY "Users can view own stream events"
  ON public.ai_stream_events
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "Service can manage stream events" ON public.ai_stream_events;
CREATE POLICY "Service can manage stream events"
  ON public.ai_stream_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Cleanup function: expire old sessions ────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_stream_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.ai_stream_sessions
     SET status = 'expired', updated_at = now()
   WHERE status = 'running'
     AND expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.ai_stream_events
   WHERE expires_at < now();

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stream_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stream_sessions() TO service_role;