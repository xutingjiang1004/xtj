-- 051: 修复自定义额度仅对 pro 用户生效的漏洞
-- 背景：管理后台给用户设置"每日 N 次第三方搜索 / N token"，但 046 的
--       get_ai_user_quota 中，自定义额度 search_limit_daily / token_limit_daily
--       仅在 v_is_pro=true 时才生效（046 的 79-90 行）。
--       free 用户（或 pro 过期被降级）会被静默回退到 p_free_search_limit
--       （默认 100 次/日），导致"设 2 次实际 100 次"，用户用完额度仍可搜索。
-- 修复：自定义额度（token_limit_daily / search_limit_daily）无论 pro/free
--       一律优先生效；仅当未设置自定义值时，才回退 pro/free 默认额度。
--       search_unlimited 同步：自定义 search < 0，或未设置自定义且为 pro。
-- 生效：本文件覆盖 046（及其后无 get_ai_user_quota 定义，041/043/046 为定义链，
--       本 051 为最终生效版本）。函数签名与 046 完全一致，后端按命名参数调用。

BEGIN;

-- ============ get_ai_user_quota：自定义额度优先于 pro/free 回退 ============
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

  -- 额度解析：自定义额度（无论 pro/free）优先生效，未设置时回退 pro/free 默认
  -- token_limit_daily: -1 = 无限；>=0 = 自定义上限（0 表示禁用）；NULL = 回退 pro/free 默认
  v_token_limit := CASE
    WHEN v_custom_token IS NOT NULL AND v_custom_token = -1 THEN -1
    WHEN v_custom_token IS NOT NULL AND v_custom_token >= 0 THEN v_custom_token
    WHEN v_is_pro THEN p_pro_token_limit
    ELSE p_free_token_limit
  END;
  -- search_limit_daily: -1 = 无限；>=0 = 自定义上限；NULL = pro 无限(-1) / free 用默认
  v_search_limit := CASE
    WHEN v_custom_search IS NOT NULL THEN v_custom_search
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
    'search_unlimited', ((v_custom_search IS NOT NULL AND v_custom_search < 0) OR (v_custom_search IS NULL AND v_is_pro)),
    'can_chat', (v_token_limit < 0 OR v_tokens < v_token_limit),
    'can_search', (v_search_limit < 0 OR v_search < v_search_limit)
  );
END;
$$;

-- ============ 权限 ============
REVOKE ALL ON FUNCTION public.get_ai_user_quota(text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_user_quota(text, bigint, bigint, integer) TO service_role;

COMMIT;
