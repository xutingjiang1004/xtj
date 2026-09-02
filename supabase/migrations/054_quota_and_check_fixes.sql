-- ============================================================================
-- 054 配额语义与 CHECK 修复（2026-09）
-- ----------------------------------------------------------------------------
-- 1) 049 的 token_limit_daily CHECK 禁止 0（只允许 NULL/-1/>0），而 051/
--    SUPABASE_FIX_051 的逻辑以 "0 = 禁用" 为前提 → 语义矛盾；且若存量存在
--    0 值行，049 的 ADD CHECK 会因历史数据失败。这里 DROP 后重建允许 0。
-- 2) consume_ai_token_usage 只对 token 做了剩余额度截断，search_count 从不
--    截断（045:60-65 / 048:64-69）→ 并发下免费日搜索额度可被突破。
--    本迁移按 048 版函数为基线重定义，为 search_count 增加与 token 完全
--    对称的截断逻辑（-1 无限不截断），签名/返回结构/权限均不变。
-- ============================================================================

BEGIN;

-- 1) CHECK 语义与 051 "0=禁用" 对齐（token 允许 NULL / -1 / 0 / >0）
ALTER TABLE public.ai_invite_codes
  DROP CONSTRAINT IF EXISTS ai_invite_codes_token_limit_daily_check,
  ADD CONSTRAINT ai_invite_codes_token_limit_daily_check
    CHECK (token_limit_daily IS NULL OR token_limit_daily = -1 OR token_limit_daily = 0 OR token_limit_daily > 0);

ALTER TABLE public.ai_user_membership
  DROP CONSTRAINT IF EXISTS ai_user_membership_token_limit_daily_check,
  ADD CONSTRAINT ai_user_membership_token_limit_daily_check
    CHECK (token_limit_daily IS NULL OR token_limit_daily = -1 OR token_limit_daily = 0 OR token_limit_daily > 0);

-- 2) consume_ai_token_usage：search_count 剩余额度截断（048 版基线）
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
  v_search_remaining bigint;
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
  -- 048 修复：v_remaining < 0（046 引入的 token_limit_daily=-1 无限额度）时
  -- 跳过截断，按原始 v_tokens 累加，避免 tokens_used 被写成 -1 负向累加。
  v_q := public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit);
  v_remaining := coalesce((v_q->>'tokens_remaining')::bigint, 0);
  IF v_remaining >= 0 AND v_tokens::bigint > v_remaining THEN
    -- 进入此分支时 0 <= v_remaining < v_tokens <= int4 上限，故强转 int4 安全
    v_tokens := v_remaining::integer;
  END IF;

  -- ★ 054 修复：search_count 同样按剩余额度截断（此前只截断 token，
  -- 多实例并发下日搜索额度可被逐次累加突破）。-1（无限）不截断。
  v_search_remaining := coalesce((v_q->>'search_remaining')::bigint, 0);
  IF v_search_remaining >= 0 AND v_search::bigint > v_search_remaining THEN
    v_search := v_search_remaining::integer;
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

-- 权限与 045 一致：仅 service_role
REVOKE ALL ON FUNCTION public.consume_ai_token_usage(text, integer, integer, text, integer, integer, integer, text, text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_token_usage(text, integer, integer, text, integer, integer, integer, text, text, bigint, bigint, integer) TO service_role;

COMMIT;
