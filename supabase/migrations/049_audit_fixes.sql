-- 049: 审计修复（2026-08-11）
-- 1) ai_invite_codes / ai_user_membership 的 limit 列加 CHECK 约束（拒绝非法负值）
-- 2) 新增 cancel_ai_user_pro(p_user_name) 事务 RPC：原子地取消 Pro + 清零当日用量
-- 3) set_ai_user_pro 增加 limits 参数，返回值与 env 配置一致

BEGIN;

-- ============ 1. limit 列 CHECK 约束 ============
-- token: NULL | -1(无限) | >0(自定义上限)
-- search: NULL | -1(无限) | >=0(自定义次数；0 = 禁用搜索，允许但需文档说明)
ALTER TABLE public.ai_invite_codes
  DROP CONSTRAINT IF EXISTS ai_invite_codes_token_limit_daily_check,
  ADD CONSTRAINT ai_invite_codes_token_limit_daily_check
    CHECK (token_limit_daily IS NULL OR token_limit_daily = -1 OR token_limit_daily > 0);

ALTER TABLE public.ai_user_membership
  DROP CONSTRAINT IF EXISTS ai_user_membership_token_limit_daily_check,
  ADD CONSTRAINT ai_user_membership_token_limit_daily_check
    CHECK (token_limit_daily IS NULL OR token_limit_daily = -1 OR token_limit_daily > 0),
  DROP CONSTRAINT IF EXISTS ai_user_membership_search_limit_daily_check,
  ADD CONSTRAINT ai_user_membership_search_limit_daily_check
    CHECK (search_limit_daily IS NULL OR search_limit_daily = -1 OR search_limit_daily >= 0);

-- ============ 2. cancel_ai_user_pro 事务 RPC ============
-- 原取消逻辑（server.js 两条 SQL）非事务：UPDATE 成功但 DELETE 失败会导致
-- 用户 plan=free 却保留当日已用 token，被 free 限额锁死到次日。
-- 本 RPC 在一个事务内完成：取消会员 + 清零当日用量。
CREATE OR REPLACE FUNCTION public.cancel_ai_user_pro(
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_day date := public.ai_quota_shanghai_day();
BEGIN
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  -- 取消 Pro（plan=free，清空有效期与自定义额度）
  UPDATE public.ai_user_membership
    SET plan = 'free',
        pro_expires_at = NULL,
        token_limit_daily = NULL,
        search_limit_daily = NULL,
        updated_at = now()
  WHERE user_name = v_user;

  -- 清零当日用量（避免 free 限额被残留的 Pro 用量锁死）
  DELETE FROM public.ai_user_quota_daily
  WHERE user_name = v_user AND day_key = v_day;

  RETURN jsonb_build_object('ok', true, 'user_name', v_user, 'daily_reset', true);
END;
$$;

-- ============ 3. set_ai_user_pro 支持 limits 参数 ============
-- 原函数（045）返回时用 get_ai_user_quota(v_user) 零参调用，使用硬编码默认
-- 100k/1M/100，与后端 env 配置（AI_FREE_TOKEN_DAILY 等）不一致。
-- 现增加三个可选 limit 参数并透传给 get_ai_user_quota，同时支持自定义额度列。
CREATE OR REPLACE FUNCTION public.set_ai_user_pro(
  p_user_name text,
  p_active boolean,
  p_expires_at timestamptz DEFAULT NULL,
  p_stripe_customer_id text DEFAULT NULL,
  p_stripe_subscription_id text DEFAULT NULL,
  p_free_token_limit bigint DEFAULT 100000,
  p_pro_token_limit bigint DEFAULT 1000000,
  p_free_search_limit integer DEFAULT 100,
  p_token_limit_daily bigint DEFAULT NULL,
  p_search_limit_daily integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := lower(trim(coalesce(p_user_name, '')));
  v_plan text;
  v_expires timestamptz;
BEGIN
  IF v_user = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  v_plan := CASE WHEN p_active THEN 'pro' ELSE 'free' END;
  v_expires := CASE WHEN p_active THEN p_expires_at ELSE NULL END;

  INSERT INTO public.ai_user_membership AS m (
    user_name, plan, pro_expires_at, stripe_customer_id, stripe_subscription_id,
    token_limit_daily, search_limit_daily, updated_at, created_at
  ) VALUES (
    v_user, v_plan, v_expires,
    nullif(trim(coalesce(p_stripe_customer_id, '')), ''),
    nullif(trim(coalesce(p_stripe_subscription_id, '')), ''),
    CASE WHEN p_active THEN p_token_limit_daily ELSE NULL END,
    CASE WHEN p_active THEN p_search_limit_daily ELSE NULL END,
    now(), now()
  )
  ON CONFLICT (user_name) DO UPDATE SET
    plan = EXCLUDED.plan,
    pro_expires_at = CASE
      WHEN EXCLUDED.plan = 'free' THEN NULL
      WHEN m.pro_expires_at IS NULL OR EXCLUDED.pro_expires_at > m.pro_expires_at
        THEN EXCLUDED.pro_expires_at
      ELSE m.pro_expires_at
    END,
    stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, m.stripe_customer_id),
    stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, m.stripe_subscription_id),
    -- p_active=true 且调用方显式传了自定义额度 → 覆盖；否则保留现有
    token_limit_daily = CASE
      WHEN EXCLUDED.plan = 'free' THEN NULL
      WHEN p_token_limit_daily IS NOT NULL THEN p_token_limit_daily
      ELSE m.token_limit_daily
    END,
    search_limit_daily = CASE
      WHEN EXCLUDED.plan = 'free' THEN NULL
      WHEN p_search_limit_daily IS NOT NULL THEN p_search_limit_daily
      ELSE m.search_limit_daily
    END,
    updated_at = now();

  RETURN public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit);
END;
$$;

-- ============ 权限 ============
REVOKE ALL ON FUNCTION public.cancel_ai_user_pro(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_ai_user_pro(text, boolean, timestamptz, text, text, bigint, bigint, integer, bigint, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cancel_ai_user_pro(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_ai_user_pro(text, boolean, timestamptz, text, text, bigint, bigint, integer, bigint, integer) TO service_role;

COMMIT;
