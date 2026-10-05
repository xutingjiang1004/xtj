-- AI token quota + Pro membership (service-role only).
-- Free: 100_000 tokens/day + 100 web searches/day
-- Pro:  1_000_000 tokens/day + unlimited searches
-- Day boundary: Asia/Shanghai calendar day.

BEGIN;

-- Daily aggregate counters (fast read path for UI + enforcement)
CREATE TABLE IF NOT EXISTS public.ai_user_quota_daily (
  user_name text NOT NULL,
  day_key date NOT NULL,
  tokens_used bigint NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  search_used integer NOT NULL DEFAULT 0 CHECK (search_used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_name, day_key)
);

CREATE INDEX IF NOT EXISTS ai_user_quota_daily_day_idx
  ON public.ai_user_quota_daily (day_key);

ALTER TABLE public.ai_user_quota_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_user_quota_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_user_quota_daily TO service_role;

-- Membership / Pro (Stripe fields reserved for later wiring)
CREATE TABLE IF NOT EXISTS public.ai_user_membership (
  user_name text PRIMARY KEY,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  pro_expires_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_user_membership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_user_membership FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_user_membership TO service_role;

-- Optional audit trail of each billed turn (kept lean for free-tier Supabase)
CREATE TABLE IF NOT EXISTS public.ai_token_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name text NOT NULL,
  day_key date NOT NULL,
  conversation_id text,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  reasoning_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  search_count integer NOT NULL DEFAULT 0,
  model text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_token_usage_events_user_day_idx
  ON public.ai_token_usage_events (user_name, day_key, created_at DESC);

ALTER TABLE public.ai_token_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_token_usage_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.ai_token_usage_events TO service_role;

CREATE OR REPLACE FUNCTION public.ai_quota_shanghai_day()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (timezone('Asia/Shanghai', now()))::date;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_user_quota(
  p_user_name text,
  p_free_token_limit bigint DEFAULT 100000,
  p_pro_token_limit bigint DEFAULT 1000000,
  p_free_search_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_day date := public.ai_quota_shanghai_day();
  v_plan text := 'free';
  v_expires timestamptz;
  v_is_pro boolean := false;
  v_tokens bigint := 0;
  v_search integer := 0;
  v_token_limit bigint;
  v_search_limit integer;
BEGIN
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  SELECT m.plan, m.pro_expires_at
    INTO v_plan, v_expires
  FROM public.ai_user_membership m
  WHERE m.user_name = v_user;

  IF NOT FOUND THEN
    v_plan := 'free';
    v_expires := NULL;
  END IF;

  v_is_pro := (
    v_plan = 'pro'
    AND (v_expires IS NULL OR v_expires > now())
  );
  IF NOT v_is_pro THEN
    v_plan := 'free';
  END IF;

  SELECT d.tokens_used, d.search_used
    INTO v_tokens, v_search
  FROM public.ai_user_quota_daily d
  WHERE d.user_name = v_user AND d.day_key = v_day;

  IF NOT FOUND THEN
    v_tokens := 0;
    v_search := 0;
  END IF;

  v_token_limit := CASE WHEN v_is_pro THEN p_pro_token_limit ELSE p_free_token_limit END;
  v_search_limit := CASE WHEN v_is_pro THEN -1 ELSE p_free_search_limit END;

  RETURN jsonb_build_object(
    'ok', true,
    'user_name', v_user,
    'day_key', v_day,
    'plan', v_plan,
    'is_pro', v_is_pro,
    'pro_expires_at', v_expires,
    'tokens_used', v_tokens,
    'tokens_limit', v_token_limit,
    'tokens_remaining', greatest(0, v_token_limit - v_tokens),
    'tokens_percent', CASE
      WHEN v_token_limit <= 0 THEN 100
      ELSE least(100, round((v_tokens::numeric * 100.0) / v_token_limit::numeric, 1))
    END,
    'search_used', v_search,
    'search_limit', v_search_limit,
    'search_remaining', CASE
      WHEN v_search_limit < 0 THEN -1
      ELSE greatest(0, v_search_limit - v_search)
    END,
    'search_unlimited', v_is_pro,
    'can_chat', (v_tokens < v_token_limit),
    'can_search', (v_is_pro OR v_search < v_search_limit)
  );
END;
$$;

-- Soft gate before starting a chat (does NOT insert usage)
CREATE OR REPLACE FUNCTION public.check_ai_token_quota(
  p_user_name text,
  p_need_search boolean DEFAULT false,
  p_free_token_limit bigint DEFAULT 100000,
  p_pro_token_limit bigint DEFAULT 1000000,
  p_free_search_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q jsonb;
BEGIN
  v_q := public.get_ai_user_quota(
    p_user_name, p_free_token_limit, p_pro_token_limit, p_free_search_limit
  );
  IF coalesce((v_q->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reason', coalesce(v_q->>'reason', 'no_user'), 'quota', v_q);
  END IF;
  IF coalesce((v_q->>'can_chat')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'token_limit', 'quota', v_q);
  END IF;
  IF p_need_search AND coalesce((v_q->>'can_search')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'search_limit', 'quota', v_q);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'reason', null, 'quota', v_q);
END;
$$;

-- Atomic consume after a completed turn
CREATE OR REPLACE FUNCTION public.consume_ai_token_usage(
  p_user_name text,
  p_tokens integer,
  p_search_count integer DEFAULT 0,
  p_conversation_id text DEFAULT NULL,
  p_prompt_tokens integer DEFAULT 0,
  p_completion_tokens integer DEFAULT 0,
  p_reasoning_tokens integer DEFAULT 0,
  p_model text DEFAULT NULL,
  p_source text DEFAULT 'chat',
  p_free_token_limit bigint DEFAULT 100000,
  p_pro_token_limit bigint DEFAULT 1000000,
  p_free_search_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_day date := public.ai_quota_shanghai_day();
  v_tokens integer := greatest(0, coalesce(p_tokens, 0));
  v_search integer := greatest(0, coalesce(p_search_count, 0));
  v_row public.ai_user_quota_daily%ROWTYPE;
  v_q jsonb;
BEGIN
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;
  IF v_tokens = 0 AND v_search = 0 THEN
    RETURN public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit)
      || jsonb_build_object('ok', true, 'consumed_tokens', 0, 'consumed_search', 0);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ai_token:' || v_user));

  INSERT INTO public.ai_user_quota_daily (user_name, day_key, tokens_used, search_used, updated_at)
  VALUES (v_user, v_day, v_tokens, v_search, now())
  ON CONFLICT (user_name, day_key) DO UPDATE
    SET tokens_used = public.ai_user_quota_daily.tokens_used + EXCLUDED.tokens_used,
        search_used = public.ai_user_quota_daily.search_used + EXCLUDED.search_used,
        updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.ai_token_usage_events (
    user_name, day_key, conversation_id,
    prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
    search_count, model, source
  ) VALUES (
    v_user, v_day, nullif(trim(coalesce(p_conversation_id, '')), ''),
    greatest(0, coalesce(p_prompt_tokens, 0)),
    greatest(0, coalesce(p_completion_tokens, 0)),
    greatest(0, coalesce(p_reasoning_tokens, 0)),
    v_tokens,
    v_search,
    nullif(trim(coalesce(p_model, '')), ''),
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'chat')
  );

  v_q := public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit);
  RETURN v_q || jsonb_build_object(
    'ok', true,
    'consumed_tokens', v_tokens,
    'consumed_search', v_search
  );
END;
$$;

-- Service helper for Stripe webhook / admin grant (not exposed to clients)
CREATE OR REPLACE FUNCTION public.set_ai_user_pro(
  p_user_name text,
  p_active boolean,
  p_expires_at timestamptz DEFAULT NULL,
  p_stripe_customer_id text DEFAULT NULL,
  p_stripe_subscription_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_plan text;
BEGIN
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;
  v_plan := CASE WHEN p_active THEN 'pro' ELSE 'free' END;
  INSERT INTO public.ai_user_membership AS m (
    user_name, plan, pro_expires_at, stripe_customer_id, stripe_subscription_id, updated_at, created_at
  ) VALUES (
    v_user, v_plan, CASE WHEN p_active THEN p_expires_at ELSE NULL END,
    nullif(trim(coalesce(p_stripe_customer_id, '')), ''),
    nullif(trim(coalesce(p_stripe_subscription_id, '')), ''),
    now(), now()
  )
  ON CONFLICT (user_name) DO UPDATE SET
    plan = EXCLUDED.plan,
    pro_expires_at = EXCLUDED.pro_expires_at,
    stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, m.stripe_customer_id),
    stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, m.stripe_subscription_id),
    updated_at = now();

  RETURN public.get_ai_user_quota(v_user);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_quota_shanghai_day() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ai_user_quota(text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_ai_token_quota(text, boolean, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_token_usage(text, integer, integer, text, integer, integer, integer, text, text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_ai_user_pro(text, boolean, timestamptz, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_quota_shanghai_day() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_user_quota(text, bigint, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_ai_token_quota(text, boolean, bigint, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_token_usage(text, integer, integer, text, integer, integer, integer, text, text, bigint, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_ai_user_pro(text, boolean, timestamptz, text, text) TO service_role;

COMMIT;
