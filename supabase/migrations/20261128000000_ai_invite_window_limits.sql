-- 2026-11-28: 邀请码支持分别设置「每 5 小时」与「每周」token 上限
--
-- 背景：双窗口额度（20261119000000）里，邀请码/会员只有一个 token_limit_daily，
--       被当作 5h 额度，每周固定 = ×10，管理员无法独立设置每周用量。
-- 本迁移：
--   1) ai_invite_codes / ai_user_membership 各加 token_limit_5h / token_limit_week 两列
--      语义统一：NULL = 不覆盖（用档位默认）、-1 = 无限、0 = 禁用、>0 = 上限
--   2) 覆盖 validate_ai_invite_code（基于 044 最终版）→ 返回新字段
--   3) 覆盖 redeem_ai_invite_code（基于 046 最终版）→ 激活时写入会员新字段
--   4) 覆盖 get_ai_window_quota（基于 20261119000000 最终版）→ 新字段独立覆盖 5h/周额度
--   5) 顺带把 get_ai_window_quota 的默认值同步为 2026-11-28 新档位
--      Free 5h 1M / 周 10M；Pro 5h 10M / 周 100M（后端始终显式传参，默认值仅作兜底）
--
-- 兼容：存量码/会员两列均为 NULL，完全沿用旧的 token_limit_daily 派生逻辑，不失效。
-- 幂等：ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE，可重复执行。
-- 三个函数签名均保持不变，原有 REVOKE/GRANT 权限不受影响（末尾再显式授予一次）。

BEGIN;

-- ============ 1. 加列 ============
ALTER TABLE public.ai_invite_codes
  ADD COLUMN IF NOT EXISTS token_limit_5h bigint
    CHECK (token_limit_5h IS NULL OR token_limit_5h = -1 OR token_limit_5h >= 0),
  ADD COLUMN IF NOT EXISTS token_limit_week bigint
    CHECK (token_limit_week IS NULL OR token_limit_week = -1 OR token_limit_week >= 0);

ALTER TABLE public.ai_user_membership
  ADD COLUMN IF NOT EXISTS token_limit_5h bigint
    CHECK (token_limit_5h IS NULL OR token_limit_5h = -1 OR token_limit_5h >= 0),
  ADD COLUMN IF NOT EXISTS token_limit_week bigint
    CHECK (token_limit_week IS NULL OR token_limit_week = -1 OR token_limit_week >= 0);

-- ============ 2. validate_ai_invite_code：返回新字段 ============
CREATE OR REPLACE FUNCTION public.validate_ai_invite_code(
  p_code text,
  p_user_name text
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
    'search_limit_daily', v_row.search_limit_daily,
    'token_limit_5h', v_row.token_limit_5h,
    'token_limit_week', v_row.token_limit_week
  );
END;
$$;

-- ============ 3. redeem_ai_invite_code：激活时把窗口额度写入会员 ============
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
      'already_redeemed', true,
      'token_limit_5h', v_row.token_limit_5h,
      'token_limit_week', v_row.token_limit_week
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

  INSERT INTO public.ai_invite_redemptions (code, user_name)
  VALUES (v_row.code, v_user);

  UPDATE public.ai_invite_codes
    SET used_count = used_count + 1
  WHERE code = v_row.code;

  -- 开通/续期 Pro：到期时间 = now + days（若已有更长有效期则保留更长）
  v_expires_at := now() + make_interval(days => v_row.days);
  INSERT INTO public.ai_user_membership AS m (
    user_name, plan, pro_expires_at, token_limit_daily, search_limit_daily,
    token_limit_5h, token_limit_week, updated_at, created_at
  ) VALUES (
    v_user, 'pro', v_expires_at,
    v_row.token_limit_daily,
    v_row.search_limit_daily,
    v_row.token_limit_5h,
    v_row.token_limit_week,
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
    token_limit_5h = CASE
      WHEN EXCLUDED.token_limit_5h IS NULL THEN m.token_limit_5h
      ELSE EXCLUDED.token_limit_5h
    END,
    token_limit_week = CASE
      WHEN EXCLUDED.token_limit_week IS NULL THEN m.token_limit_week
      ELSE EXCLUDED.token_limit_week
    END,
    updated_at = now();

  RETURN public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit)
    || jsonb_build_object(
      'ok', true, 'code', v_row.code, 'days', v_row.days, 'already_redeemed', false,
      'token_limit_5h', v_row.token_limit_5h, 'token_limit_week', v_row.token_limit_week
    );
END;
$$;

-- ============ 4. get_ai_window_quota：新字段独立覆盖 5h / 周额度 ============
CREATE OR REPLACE FUNCTION public.get_ai_window_quota(
  p_subject_key text,
  p_user_name text DEFAULT NULL,
  p_free_5h_limit bigint DEFAULT 1000000,
  p_free_week_limit bigint DEFAULT 10000000,
  p_pro_5h_limit bigint DEFAULT 10000000,
  p_pro_week_limit bigint DEFAULT 100000000,
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
  v_custom_5h bigint := NULL;
  v_custom_week bigint := NULL;
  v_5h_limit bigint := greatest(0, coalesce(p_free_5h_limit, 1000000));
  v_week_limit bigint := greatest(0, coalesce(p_free_week_limit, 10000000));
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
    SELECT plan, pro_expires_at, token_limit_daily, search_limit_daily,
           token_limit_5h, token_limit_week
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
      v_custom_5h := v_mem.token_limit_5h;
      v_custom_week := v_mem.token_limit_week;
    END IF;

    -- 旧自定义日额度派生（兼容存量邀请码）：5h = 值，周 = 值 × 10
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
      v_5h_limit := greatest(0, coalesce(p_pro_5h_limit, 10000000));
      v_week_limit := greatest(0, coalesce(p_pro_week_limit, 100000000));
    END IF;

    -- ★ 新窗口列：独立覆盖各自窗口（NULL 不覆盖，-1 无限，0 禁用，>0 上限）
    IF v_custom_5h IS NOT NULL THEN
      IF v_custom_5h < 0 THEN v_5h_limit := -1;
      ELSE v_5h_limit := greatest(0, v_custom_5h);
      END IF;
    END IF;
    IF v_custom_week IS NOT NULL THEN
      IF v_custom_week < 0 THEN v_week_limit := -1;
      ELSE v_week_limit := greatest(0, v_custom_week);
      END IF;
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

-- ============ 5. 权限（签名不变，幂等重授） ============
REVOKE ALL ON FUNCTION public.validate_ai_invite_code(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_ai_invite_code(text, text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ai_window_quota(text, text, bigint, bigint, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validate_ai_invite_code(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_ai_invite_code(text, text, bigint, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_window_quota(text, text, bigint, bigint, bigint, bigint, integer) TO service_role;

COMMIT;
