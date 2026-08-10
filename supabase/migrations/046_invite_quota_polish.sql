-- 046: 邀请码/额度完善
-- 1) ai_invite_codes.token_limit_daily 确保 bigint（历史库可能被建为 integer，导致大 token 值报 out of range）
-- 2) ai_user_membership.token_limit_daily 同样确保 bigint
-- 3) get_ai_user_quota 支持 token_limit_daily = -1 表示无限 token（与 search 的 -1 语义一致）
-- 4) redeem_ai_invite_code 支持：
--    a. token_limit_daily = -1 无限
--    b. 新码激活时若码未配置 token/search（NULL），保留用户当前自定义额度（不覆盖为 NULL）
--    c. 同码同人幂等（已有）
--    d. 用户 Pro 过期后可用新码重新激活（redemptions 只拦同码同人，新码可再激活）

BEGIN;

-- ============ 1. 列类型统一 bigint ============
ALTER TABLE public.ai_invite_codes
  ALTER COLUMN token_limit_daily TYPE bigint;
ALTER TABLE public.ai_user_membership
  ALTER COLUMN token_limit_daily TYPE bigint;

-- ============ 2. get_ai_user_quota 支持 token=-1 无限 ============
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
  v_custom_token bigint;
  v_custom_search integer;
BEGIN
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  SELECT m.plan, m.pro_expires_at, m.token_limit_daily, m.search_limit_daily
    INTO v_plan, v_expires, v_custom_token, v_custom_search
  FROM public.ai_user_membership m
  WHERE m.user_name = v_user;

  IF NOT FOUND THEN
    v_plan := 'free';
    v_expires := NULL;
    v_custom_token := NULL;
    v_custom_search := NULL;
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

  -- 额度解析：自定义 > Pro 固定 > 免费
  -- token_limit_daily: -1 = 无限；>0 = 自定义上限；NULL = 用 Pro 固定
  v_token_limit := CASE
    WHEN v_is_pro AND v_custom_token IS NOT NULL AND v_custom_token = -1 THEN -1
    WHEN v_is_pro AND v_custom_token IS NOT NULL AND v_custom_token > 0 THEN v_custom_token
    WHEN v_is_pro THEN p_pro_token_limit
    ELSE p_free_token_limit
  END;
  -- search_limit_daily: -1 = 无限；>=0 = 自定义；NULL = Pro 无限 / free 固定
  v_search_limit := CASE
    WHEN v_is_pro AND v_custom_search IS NOT NULL THEN v_custom_search
    WHEN v_is_pro THEN -1
    ELSE p_free_search_limit
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'user_name', v_user,
    'day_key', v_day,
    'plan', v_plan,
    'is_pro', v_is_pro,
    'pro_expires_at', v_expires,
    'tokens_used', v_tokens,
    'tokens_limit', v_token_limit,
    'tokens_remaining', CASE WHEN v_token_limit < 0 THEN -1 ELSE greatest(0, v_token_limit - v_tokens) END,
    'tokens_percent', CASE
      WHEN v_token_limit < 0 THEN 0
      WHEN v_token_limit <= 0 THEN 100
      ELSE least(100, round((v_tokens::numeric * 100.0) / v_token_limit::numeric, 1))
    END,
    'search_used', v_search,
    'search_limit', v_search_limit,
    'search_remaining', CASE
      WHEN v_search_limit < 0 THEN -1
      ELSE greatest(0, v_search_limit - v_search)
    END,
    'search_unlimited', (v_is_pro AND (v_custom_search IS NULL OR v_custom_search < 0)),
    'can_chat', (v_token_limit < 0 OR v_tokens < v_token_limit),
    'can_search', (v_search_limit < 0 OR v_search < v_search_limit)
  );
END;
$$;

-- ============ 3. redeem_ai_invite_code 完善 ============
CREATE OR REPLACE FUNCTION public.redeem_ai_invite_code(
  p_code text,
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
  v_code text := upper(trim(coalesce(p_code, '')));
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_row public.ai_invite_codes%ROWTYPE;
  v_used boolean := false;
  v_expires_at timestamptz;
  v_quota jsonb;
  v_existing_token bigint;
  v_existing_search integer;
BEGIN
  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_code');
  END IF;
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ai_invite:' || v_code));

  SELECT * INTO v_row FROM public.ai_invite_codes WHERE upper(code) = v_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ai_invite_redemptions r
    WHERE upper(r.code) = v_code AND r.user_name = v_user
  ) INTO v_used;
  -- 同码同人：幂等成功（返回当前额度，不重复扣次数）
  IF v_used THEN
    v_quota := public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit);
    RETURN v_quota || jsonb_build_object(
      'ok', true,
      'code', v_row.code,
      'days', v_row.days,
      'already_redeemed', true
    );
  END IF;

  IF v_row.used_count >= v_row.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
  END IF;

  -- 读取当前已有自定义额度（新码未配置额度时保留现有，而不是覆盖成 NULL）
  SELECT m.token_limit_daily, m.search_limit_daily
    INTO v_existing_token, v_existing_search
  FROM public.ai_user_membership m
  WHERE m.user_name = v_user;
  IF NOT FOUND THEN
    v_existing_token := NULL;
    v_existing_search := NULL;
  END IF;

  -- 记录激活（存库内原始 code 大小写）
  INSERT INTO public.ai_invite_redemptions (code, user_name)
  VALUES (v_row.code, v_user);

  -- 使用次数 +1
  UPDATE public.ai_invite_codes
    SET used_count = used_count + 1
  WHERE code = v_row.code;

  -- 开通/续期 Pro：到期时间 = now + days（若已有更长有效期则保留更长）
  v_expires_at := now() + make_interval(days => v_row.days);
  INSERT INTO public.ai_user_membership AS m (
    user_name, plan, pro_expires_at, token_limit_daily, search_limit_daily, updated_at, created_at
  ) VALUES (
    v_user, 'pro', v_expires_at,
    v_row.token_limit_daily,
    v_row.search_limit_daily,
    now(), now()
  )
  ON CONFLICT (user_name) DO UPDATE SET
    plan = 'pro',
    pro_expires_at = CASE
      WHEN m.pro_expires_at IS NULL OR EXCLUDED.pro_expires_at > m.pro_expires_at
        THEN EXCLUDED.pro_expires_at
      ELSE m.pro_expires_at
    END,
    -- 码配置了额度 → 覆盖；码没配置（NULL）→ 保留用户现有额度
    token_limit_daily = CASE
      WHEN EXCLUDED.token_limit_daily IS NULL THEN COALESCE(m.token_limit_daily, NULL)
      ELSE EXCLUDED.token_limit_daily
    END,
    search_limit_daily = CASE
      WHEN EXCLUDED.search_limit_daily IS NULL THEN COALESCE(m.search_limit_daily, NULL)
      ELSE EXCLUDED.search_limit_daily
    END,
    updated_at = now();

  RETURN public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit)
    || jsonb_build_object('ok', true, 'code', v_row.code, 'days', v_row.days, 'already_redeemed', false);
END;
$$;

-- ============ 权限 ============
REVOKE ALL ON FUNCTION public.get_ai_user_quota(text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_ai_invite_code(text, text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_ai_user_quota(text, bigint, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_ai_invite_code(text, text, bigint, bigint, integer) TO service_role;

COMMIT;
