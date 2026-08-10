-- 045: Fix quota overspend + pro-expiry overwrite + chat-quota day boundary.
--
-- Bug 1: consume_ai_token_usage could bill past the daily limit (tokens_used
--        went negative), locking the user out until the next Shanghai day.
--        Now the consumption is truncated to the remaining budget *before* the
--        upsert: only the affordable part is charged and recorded.
-- Bug 2: set_ai_user_pro unconditionally overwrote pro_expires_at, so granting a
--        shorter extension to an existing pro user shortened their expiry. Now the
--        longer of (existing, new) expiry wins, matching redeem_ai_invite_code's
--        GREATEST semantics; deactivating (active=false) still clears pro_expires_at.
-- Bug 3: consume_ai_chat_quota counted the daily window from UTC midnight while the
--        token quota uses the Asia/Shanghai calendar day. Both now share
--        public.ai_quota_shanghai_day().
--
-- All functions keep identical signatures/returns (CREATE OR REPLACE, no RPC break).

BEGIN;

-- ============ Bug 1: truncate token consumption to the remaining budget ============
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
  v_remaining bigint;
BEGIN
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;
  IF v_tokens = 0 AND v_search = 0 THEN
    RETURN public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit)
      || jsonb_build_object('ok', true, 'consumed_tokens', 0, 'consumed_search', 0);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ai_token:' || v_user));

  -- 在插入/累加前基于当前额度计算剩余 token；超额部分截断，绝不扣成负数。
  -- get_ai_user_quota 已兼容 043 的自定义额度（token_limit_daily），因此自定义
  -- 额度用户同样得到正确的剩余值。
  v_q := public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit);
  v_remaining := coalesce((v_q->>'tokens_remaining')::bigint, 0);
  IF v_tokens::bigint > v_remaining THEN
    -- 进入此分支时 v_remaining < v_tokens <= int4 上限，故强转 int4 安全
    v_tokens := v_remaining::integer;
  END IF;

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

-- ============ Bug 2: pro expiry keeps the longer of existing / new ============
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
    pro_expires_at = CASE
      -- active=false（plan='free'）仍清空到期时间，避免残留旧有效期
      WHEN EXCLUDED.plan = 'free' THEN NULL
      -- 续期：保留更长有效期（与 043 redeem_ai_invite_code 的 GREATEST 语义一致）
      WHEN m.pro_expires_at IS NULL OR EXCLUDED.pro_expires_at > m.pro_expires_at
        THEN EXCLUDED.pro_expires_at
      ELSE m.pro_expires_at
    END,
    stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, m.stripe_customer_id),
    stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, m.stripe_subscription_id),
    updated_at = now();

  RETURN public.get_ai_user_quota(v_user);
END;
$$;

-- ============ Bug 3: chat-quota daily window uses the Shanghai day ============
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
  -- 日界与 token 额度一致：Asia/Shanghai 日历日的 00:00（转为 UTC 比较，
  -- 不依赖会话 TimeZone，避免 UTC 会话下差 8 小时）
  SELECT count(*) INTO v_day FROM public.ai_chat_quota_events
    WHERE user_name = p_user_name
      AND created_at >= (public.ai_quota_shanghai_day()::timestamp AT TIME ZONE 'Asia/Shanghai');
  IF v_day >= p_daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'daily_limit');
  END IF;
  INSERT INTO public.ai_chat_quota_events(user_name) VALUES (p_user_name);
  RETURN jsonb_build_object('allowed', true,
    'remainingHour', greatest(0, p_hourly_limit - v_hour - 1),
    'remainingDay', greatest(0, p_daily_limit - v_day - 1));
END;
$$;

-- ============ 权限（与 041/030 一致） ============
REVOKE ALL ON FUNCTION public.consume_ai_token_usage(text, integer, integer, text, integer, integer, integer, text, text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_ai_user_pro(text, boolean, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_chat_quota(text, integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_ai_token_usage(text, integer, integer, text, integer, integer, integer, text, text, bigint, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_ai_user_pro(text, boolean, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_chat_quota(text, integer, integer) TO service_role;

COMMIT;
