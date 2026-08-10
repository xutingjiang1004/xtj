-- 044: 修复邀请码大小写匹配 + 同码同人幂等成功
-- 若你已执行过 043，请再执行本文件（只替换函数，安全可重复跑）

BEGIN;

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
    'search_limit_daily', v_row.search_limit_daily
  );
END;
$$;

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

  -- 同码同人：幂等成功（不重复扣次数）
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

  INSERT INTO public.ai_invite_redemptions (code, user_name)
  VALUES (v_row.code, v_user);

  UPDATE public.ai_invite_codes
    SET used_count = used_count + 1
  WHERE code = v_row.code;

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

COMMIT;
