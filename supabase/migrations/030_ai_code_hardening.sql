-- Persistent, atomic quotas for Cat AI. These RPCs are called only by the
-- service-role backend and deliberately fail closed when the migration is absent.

CREATE TABLE IF NOT EXISTS public.ai_chat_quota_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_chat_quota_events_user_created_idx
  ON public.ai_chat_quota_events (user_name, created_at);

ALTER TABLE public.ai_chat_quota_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_chat_quota_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.ai_chat_quota_events TO service_role;

CREATE OR REPLACE FUNCTION public.consume_cat_comment_quota(
  p_user_name text,
  p_post_id uuid,
  p_user_limit integer,
  p_post_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_count integer;
  v_post_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cat:' || coalesce(p_user_name, '')));
  SELECT count(*) INTO v_user_count FROM public.ai_cat_rate_limits
    WHERE user_name = p_user_name AND created_at >= now() - interval '1 hour';
  IF v_user_count >= p_user_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_limit');
  END IF;
  IF p_post_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('cat-post:' || p_post_id::text));
    SELECT count(*) INTO v_post_count FROM public.ai_cat_rate_limits
      WHERE post_id = p_post_id AND created_at >= now() - interval '1 hour';
    IF v_post_count >= p_post_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'post_limit');
    END IF;
  END IF;
  INSERT INTO public.ai_cat_rate_limits(user_name, post_id, trigger_type)
    VALUES (p_user_name, p_post_id, 'comment');
  RETURN jsonb_build_object('allowed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_ai_chat_quota(
  p_user_name text,
  p_hourly_limit integer,
  p_daily_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hour integer;
  v_day integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('chat:' || coalesce(p_user_name, '')));
  SELECT count(*) INTO v_hour FROM public.ai_chat_quota_events
    WHERE user_name = p_user_name AND created_at >= now() - interval '1 hour';
  IF v_hour >= p_hourly_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'hourly_limit');
  END IF;
  SELECT count(*) INTO v_day FROM public.ai_chat_quota_events
    WHERE user_name = p_user_name AND created_at >= date_trunc('day', now());
  IF v_day >= p_daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'daily_limit');
  END IF;
  INSERT INTO public.ai_chat_quota_events(user_name) VALUES (p_user_name);
  RETURN jsonb_build_object('allowed', true,
    'remainingHour', greatest(0, p_hourly_limit - v_hour - 1),
    'remainingDay', greatest(0, p_daily_limit - v_day - 1));
END;
$$;

REVOKE ALL ON FUNCTION public.consume_cat_comment_quota(text, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_chat_quota(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_cat_comment_quota(text, uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_chat_quota(text, integer, integer) TO service_role;

-- Supports deterministic conversation ordering and page-by-page retrieval.
CREATE INDEX IF NOT EXISTS posts_ai_history_user_conv_created_idx
  ON public.posts (user_name, created_at DESC)
  WHERE media_type = '__ai_chat__';

