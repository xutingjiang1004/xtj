-- 043: 邀请码激活 Pro（替代爱发电付费）。
-- - ai_user_membership 增加自定义额度列（token_limit_daily / search_limit_daily）
-- - 新增邀请码表 ai_invite_codes（管理员生成，每个码可自定义天数 + 每日 token + 每日搜索）
-- - 新增激活记录表 ai_invite_redemptions（幂等 + 审计）
-- - get_ai_user_quota 支持自定义额度（自定义 > Pro 固定 > 免费）
-- - 新增 validate_ai_invite_code / redeem_ai_invite_code

BEGIN;

-- ============ 1. ai_user_membership 增加自定义额度列 ============
-- token_limit_daily: NULL = 不覆盖，用固定 Pro 额度；>0 = 每天自定义 token 上限
-- search_limit_daily: NULL = 不覆盖（Pro 无限）；-1 = 无限；>0 = 每天固定次数
ALTER TABLE public.ai_user_membership
  ADD COLUMN IF NOT EXISTS token_limit_daily bigint,
  ADD COLUMN IF NOT EXISTS search_limit_daily integer;

-- ============ 2. 邀请码表 ============
CREATE TABLE IF NOT EXISTS public.ai_invite_codes (
  code text PRIMARY KEY,
  days integer NOT NULL DEFAULT 30 CHECK (days > 0 AND days <= 3650),
  token_limit_daily bigint,
  search_limit_daily integer CHECK (
    search_limit_daily IS NULL OR search_limit_daily = -1 OR search_limit_daily >= 0
  ),
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at timestamptz,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_invite_codes_created_idx
  ON public.ai_invite_codes (created_at DESC);

ALTER TABLE public.ai_invite_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_invite_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_invite_codes TO service_role;

-- ============ 3. 激活记录表 ============
CREATE TABLE IF NOT EXISTS public.ai_invite_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL REFERENCES public.ai_invite_codes(code),
  user_name text NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, user_name)
);

CREATE INDEX IF NOT EXISTS ai_invite_redemptions_user_idx
  ON public.ai_invite_redemptions (user_name, redeemed_at DESC);

ALTER TABLE public.ai_invite_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_invite_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.ai_invite_redemptions TO service_role;

-- ============ 4. get_ai_user_quota 支持自定义额度 ============
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
  v_token_limit := CASE
    WHEN v_is_pro AND v_custom_token IS NOT NULL AND v_custom_token > 0 THEN v_custom_token
    WHEN v_is_pro THEN p_pro_token_limit
    ELSE p_free_token_limit
  END;
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
    'search_unlimited', (v_is_pro AND (v_custom_search IS NULL OR v_custom_search < 0)),
    'can_chat', (v_tokens < v_token_limit),
    'can_search', (v_search_limit < 0 OR v_search < v_search_limit)
  );
END;
$$;

-- ============ 5. 校验邀请码 ============
CREATE OR REPLACE FUNCTION public.validate_ai_invite_code(
  p_code text,
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- 大小写不敏感匹配（生成码为大写，用户可能小写输入）
  v_code text := upper(trim(coalesce(p_code, '')));
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_row public.ai_invite_codes%ROWTYPE;
  v_used boolean := false;
BEGIN
  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_code');
  END IF;
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  SELECT * INTO v_row FROM public.ai_invite_codes WHERE upper(code) = v_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  IF v_row.used_count >= v_row.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ai_invite_redemptions r
    WHERE upper(r.code) = v_code AND r.user_name = v_user
  ) INTO v_used;
  IF v_used THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_used');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'code', v_row.code,
    'days', v_row.days,
    'token_limit_daily', v_row.token_limit_daily,
    'search_limit_daily', v_row.search_limit_daily
  );
END;
$$;

-- ============ 6. 激活邀请码 ============
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
BEGIN
  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_code');
  END IF;
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  -- 事务内原子：避免并发重复激活
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

  -- 记录激活（存库内原始 code 大小写）
  INSERT INTO public.ai_invite_redemptions (code, user_name)
  VALUES (v_row.code, v_user);

  -- 使用次数 +1
  UPDATE public.ai_invite_codes
    SET used_count = used_count + 1
  WHERE code = v_row.code;

  -- 开通 Pro：到期时间 = now + days（若已有更长有效期则保留更长）
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
    token_limit_daily = COALESCE(EXCLUDED.token_limit_daily, m.token_limit_daily),
    search_limit_daily = COALESCE(EXCLUDED.search_limit_daily, m.search_limit_daily),
    updated_at = now();

  RETURN public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit)
    || jsonb_build_object('ok', true, 'code', v_row.code, 'days', v_row.days, 'already_redeemed', false);
END;
$$;

-- ============ 7. 权限 ============
REVOKE ALL ON FUNCTION public.get_ai_user_quota(text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_ai_invite_code(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_ai_invite_code(text, text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_ai_user_quota(text, bigint, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_ai_invite_code(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_ai_invite_code(text, text, bigint, bigint, integer) TO service_role;

COMMIT;
