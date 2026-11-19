-- Dual-window AI token quota (5-hour rolling lock + Beijing weekly Monday 00:00 reset)
-- Supports both logged-in users (user:<name>) and guests (guest:<id> / ip:<hash>).

CREATE OR REPLACE FUNCTION public.ai_quota_shanghai_week()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (date_trunc('week', timezone('Asia/Shanghai', now())))::date;
$$;

CREATE TABLE IF NOT EXISTS public.ai_quota_windows (
  subject_key text PRIMARY KEY,
  tokens_5h_used bigint NOT NULL DEFAULT 0 CHECK (tokens_5h_used >= 0),
  window_5h_reset_at timestamptz,
  tokens_week_used bigint NOT NULL DEFAULT 0 CHECK (tokens_week_used >= 0),
  week_key date NOT NULL DEFAULT public.ai_quota_shanghai_week(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_quota_windows_week_idx
  ON public.ai_quota_windows (week_key, updated_at DESC);

REVOKE ALL ON TABLE public.ai_quota_windows FROM PUBLIC;
GRANT ALL ON TABLE public.ai_quota_windows TO service_role;

CREATE OR REPLACE FUNCTION public.get_ai_window_quota(
  p_subject_key text,
  p_user_name text DEFAULT NULL,
  p_free_5h_limit bigint DEFAULT 100000,
  p_free_week_limit bigint DEFAULT 1000000,
  p_pro_5h_limit bigint DEFAULT 1000000,
  p_pro_week_limit bigint DEFAULT 10000000,
  p_free_search_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text := lower(trim(coalesce(p_subject_key, '')));
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_is_guest boolean := (v_user = '');
  v_now timestamptz := now();
  v_day date := public.ai_quota_shanghai_day();
  v_week date := public.ai_quota_shanghai_week();
  v_week_reset timestamptz := ((v_week + 7)::timestamp AT TIME ZONE 'Asia/Shanghai');
  v_plan text := 'free';
  v_is_pro boolean := false;
  v_pro_exp timestamptz := NULL;
  v_custom_tok bigint := NULL;
  v_custom_search integer := NULL;
  v_5h_limit bigint := greatest(0, coalesce(p_free_5h_limit, 100000));
  v_week_limit bigint := greatest(0, coalesce(p_free_week_limit, 1000000));
  v_search_limit integer := greatest(0, coalesce(p_free_search_limit, 10));
  v_search_used integer := 0;
  v_5h_used bigint := 0;
  v_5h_reset timestamptz := NULL;
  v_week_used bigint := 0;
  v_5h_rem bigint;
  v_week_rem bigint;
  v_search_rem integer;
  v_can_5h boolean;
  v_can_week boolean;
  v_can_chat boolean;
  v_can_search boolean;
  v_exhausted text := NULL;
  v_win record;
  v_mem record;
  v_daily record;
BEGIN
  IF v_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_subject');
  END IF;

  IF NOT v_is_guest THEN
    SELECT plan, pro_expires_at, token_limit_daily, search_limit_daily
      INTO v_mem
      FROM public.ai_user_membership
     WHERE user_name = v_user;

    IF FOUND THEN
      v_pro_exp := v_mem.pro_expires_at;
      IF v_mem.plan = 'pro' AND (v_mem.pro_expires_at IS NULL OR v_mem.pro_expires_at > v_now) THEN
        v_is_pro := true;
        v_plan := 'pro';
      END IF;
      v_custom_tok := v_mem.token_limit_daily;
      v_custom_search := v_mem.search_limit_daily;
    END IF;

    IF v_custom_tok IS NOT NULL THEN
      IF v_custom_tok = -1 THEN
        v_5h_limit := -1;
        v_week_limit := -1;
      ELSIF v_custom_tok = 0 THEN
        v_5h_limit := 0;
        v_week_limit := 0;
      ELSE
        v_5h_limit := v_custom_tok;
        v_week_limit := v_custom_tok * 10;
      END IF;
    ELSIF v_is_pro THEN
      v_5h_limit := greatest(0, coalesce(p_pro_5h_limit, 1000000));
      v_week_limit := greatest(0, coalesce(p_pro_week_limit, 10000000));
    END IF;

    IF v_custom_search IS NOT NULL THEN
      v_search_limit := v_custom_search;
    ELSIF v_is_pro THEN
      v_search_limit := -1;
    END IF;

    SELECT search_used INTO v_daily
      FROM public.ai_user_quota_daily
     WHERE user_name = v_user AND day_key = v_day;
    IF FOUND THEN
      v_search_used := greatest(0, coalesce(v_daily.search_used, 0));
    END IF;
  END IF;

  SELECT tokens_5h_used, window_5h_reset_at, tokens_week_used, week_key
    INTO v_win
    FROM public.ai_quota_windows
   WHERE subject_key = v_key;

  IF FOUND THEN
    IF v_win.window_5h_reset_at IS NOT NULL AND v_win.window_5h_reset_at > v_now THEN
      v_5h_used := greatest(0, coalesce(v_win.tokens_5h_used, 0));
      v_5h_reset := v_win.window_5h_reset_at;
    END IF;
    IF v_win.week_key = v_week THEN
      v_week_used := greatest(0, coalesce(v_win.tokens_week_used, 0));
    END IF;
  END IF;

  IF v_5h_limit < 0 THEN
    v_5h_rem := -1;
    v_can_5h := true;
  ELSE
    v_5h_rem := greatest(0, v_5h_limit - v_5h_used);
    v_can_5h := (v_5h_rem > 0);
  END IF;

  IF v_week_limit < 0 THEN
    v_week_rem := -1;
    v_can_week := true;
  ELSE
    v_week_rem := greatest(0, v_week_limit - v_week_used);
    v_can_week := (v_week_rem > 0);
  END IF;

  v_can_chat := v_can_5h AND v_can_week;
  IF NOT v_can_week THEN
    v_exhausted := 'week';
  ELSIF NOT v_can_5h THEN
    v_exhausted := '5h';
  END IF;

  IF v_search_limit < 0 THEN
    v_search_rem := -1;
    v_can_search := true;
  ELSE
    v_search_rem := greatest(0, v_search_limit - v_search_used);
    v_can_search := (v_search_rem > 0);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'subject_key', v_key,
    'is_guest', v_is_guest,
    'plan', v_plan,
    'is_pro', v_is_pro,
    'pro_expires_at', v_pro_exp,
    'day_key', v_day,
    'week_key', v_week,
    'window_5h_used', v_5h_used,
    'window_5h_limit', v_5h_limit,
    'window_5h_remaining', v_5h_rem,
    'window_5h_reset_at', v_5h_reset,
    'window_week_used', v_week_used,
    'window_week_limit', v_week_limit,
    'window_week_remaining', v_week_rem,
    'window_week_reset_at', v_week_reset,
    'exhausted_window', v_exhausted,
    'tokens_used', v_5h_used,
    'tokens_limit', v_5h_limit,
    'tokens_remaining', CASE
      WHEN v_5h_rem < 0 AND v_week_rem < 0 THEN -1
      WHEN v_5h_rem < 0 THEN v_week_rem
      WHEN v_week_rem < 0 THEN v_5h_rem
      ELSE least(v_5h_rem, v_week_rem)
    END,
    'tokens_unlimited', (v_5h_limit < 0 AND v_week_limit < 0),
    'search_used', v_search_used,
    'search_limit', v_search_limit,
    'search_remaining', v_search_rem,
    'search_unlimited', (v_search_limit < 0),
    'can_chat', v_can_chat,
    'can_search', v_can_search
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_ai_window_usage(
  p_subject_key text,
  p_user_name text DEFAULT NULL,
  p_tokens bigint DEFAULT 0,
  p_search_count integer DEFAULT 0,
  p_prompt_tokens integer DEFAULT 0,
  p_completion_tokens integer DEFAULT 0,
  p_reasoning_tokens integer DEFAULT 0,
  p_model text DEFAULT NULL,
  p_source text DEFAULT 'chat',
  p_conversation_id text DEFAULT NULL,
  p_free_5h_limit bigint DEFAULT 100000,
  p_free_week_limit bigint DEFAULT 1000000,
  p_pro_5h_limit bigint DEFAULT 1000000,
  p_pro_week_limit bigint DEFAULT 10000000,
  p_free_search_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text := lower(trim(coalesce(p_subject_key, '')));
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_now timestamptz := now();
  v_day date := public.ai_quota_shanghai_day();
  v_week date := public.ai_quota_shanghai_week();
  v_tokens bigint := greatest(0, coalesce(p_tokens, 0));
  v_search integer := greatest(0, coalesce(p_search_count, 0));
  v_q jsonb;
  v_5h_rem bigint;
  v_week_rem bigint;
  v_cap bigint := v_tokens;
  v_search_rem integer;
BEGIN
  IF v_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_subject');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ai_win:' || v_key));

  v_q := public.get_ai_window_quota(
    v_key, v_user, p_free_5h_limit, p_free_week_limit, p_pro_5h_limit, p_pro_week_limit, p_free_search_limit
  );

  v_5h_rem := coalesce((v_q->>'window_5h_remaining')::bigint, 0);
  v_week_rem := coalesce((v_q->>'window_week_remaining')::bigint, 0);
  IF v_5h_rem >= 0 AND v_cap > v_5h_rem THEN
    v_cap := v_5h_rem;
  END IF;
  IF v_week_rem >= 0 AND v_cap > v_week_rem THEN
    v_cap := v_week_rem;
  END IF;

  v_search_rem := coalesce((v_q->>'search_remaining')::integer, 0);
  IF v_search_rem >= 0 AND v_search > v_search_rem THEN
    v_search := v_search_rem;
  END IF;

  IF v_cap > 0 THEN
    INSERT INTO public.ai_quota_windows (subject_key, tokens_5h_used, window_5h_reset_at, tokens_week_used, week_key, updated_at)
    VALUES (v_key, v_cap, v_now + interval '5 hours', v_cap, v_week, v_now)
    ON CONFLICT (subject_key) DO UPDATE SET
      tokens_5h_used = CASE
        WHEN public.ai_quota_windows.window_5h_reset_at IS NULL OR public.ai_quota_windows.window_5h_reset_at <= v_now
        THEN EXCLUDED.tokens_5h_used
        ELSE public.ai_quota_windows.tokens_5h_used + EXCLUDED.tokens_5h_used
      END,
      window_5h_reset_at = CASE
        WHEN public.ai_quota_windows.window_5h_reset_at IS NULL OR public.ai_quota_windows.window_5h_reset_at <= v_now
        THEN v_now + interval '5 hours'
        ELSE public.ai_quota_windows.window_5h_reset_at
      END,
      tokens_week_used = CASE
        WHEN public.ai_quota_windows.week_key IS DISTINCT FROM v_week
        THEN EXCLUDED.tokens_week_used
        ELSE public.ai_quota_windows.tokens_week_used + EXCLUDED.tokens_week_used
      END,
      week_key = v_week,
      updated_at = v_now;
  END IF;

  IF v_user <> '' AND (v_cap > 0 OR v_search > 0) THEN
    INSERT INTO public.ai_user_quota_daily (user_name, day_key, tokens_used, search_used, updated_at)
    VALUES (v_user, v_day, v_cap, v_search, v_now)
    ON CONFLICT (user_name, day_key) DO UPDATE SET
      tokens_used = public.ai_user_quota_daily.tokens_used + EXCLUDED.tokens_used,
      search_used = public.ai_user_quota_daily.search_used + EXCLUDED.search_used,
      updated_at = v_now;
  END IF;

  IF v_cap > 0 OR v_search > 0 THEN
    INSERT INTO public.ai_token_usage_events (
      user_name, day_key, conversation_id, prompt_tokens, completion_tokens, reasoning_tokens, total_tokens, search_count, model, source
    ) VALUES (
      CASE WHEN v_user <> '' THEN v_user ELSE v_key END,
      v_day,
      p_conversation_id,
      greatest(0, coalesce(p_prompt_tokens, 0)),
      greatest(0, coalesce(p_completion_tokens, 0)),
      greatest(0, coalesce(p_reasoning_tokens, 0)),
      greatest(0, v_cap::integer),
      v_search,
      p_model,
      coalesce(p_source, 'chat')
    );
  END IF;

  RETURN public.get_ai_window_quota(
    v_key, v_user, p_free_5h_limit, p_free_week_limit, p_pro_5h_limit, p_pro_week_limit, p_free_search_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_quota_shanghai_week() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_quota_shanghai_week() TO service_role;
REVOKE ALL ON FUNCTION public.get_ai_window_quota(text, text, bigint, bigint, bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_window_quota(text, text, bigint, bigint, bigint, bigint, integer) TO service_role;
REVOKE ALL ON FUNCTION public.consume_ai_window_usage(text, text, bigint, integer, integer, integer, integer, text, text, text, bigint, bigint, bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_window_usage(text, text, bigint, integer, integer, integer, integer, text, text, text, bigint, bigint, bigint, bigint, integer) TO service_role;
