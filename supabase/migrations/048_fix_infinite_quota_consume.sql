-- ============================================================================
-- 048 修复 token_limit_daily = -1（无限额度）与 consume 截断逻辑不兼容
-- ----------------------------------------------------------------------------
-- 背景（审计 07c-infra-build.md 🟠）：046 支持 token_limit_daily = -1 表示无限
-- token 额度，get_ai_user_quota 对此返回 tokens_remaining = -1；但 045 的
-- consume_ai_token_usage 中
--     v_remaining := ... tokens_remaining ...;   -- 可能为 -1
--     IF v_tokens::bigint > v_remaining THEN v_tokens := v_remaining::integer;
-- 任何消费都会因 v_tokens(>=0) > -1 而把 v_tokens 截断为 -1，随后写入
-- ai_user_quota_daily.tokens_used，导致无限额度用户配额计数被破坏
-- （tokens_used 负向累加、tokens_percent/remaining 显示错乱），且额度从 -1
-- 改回具体值时用户会看到超大剩余量。
--
-- 修复：截断前判断 v_remaining < 0（即无限额度）时跳过截断，按原始
-- v_tokens 累加，统计与审计数据保持可信。
--
-- 本迁移用 CREATE OR REPLACE FUNCTION 重定义 consume_ai_token_usage，
-- 签名/返回结构不变（沿用 045 版本，仅改动截断判断），权限 GRANT 一并
-- 恢复为仅 service_role，无 RPC 破坏。
-- ============================================================================

BEGIN;

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
  -- 048 修复：v_remaining < 0（046 引入的 token_limit_daily=-1 无限额度）时
  -- 跳过截断，按原始 v_tokens 累加，避免 tokens_used 被写成 -1 负向累加。
  v_q := public.get_ai_user_quota(v_user, p_free_token_limit, p_pro_token_limit, p_free_search_limit);
  v_remaining := coalesce((v_q->>'tokens_remaining')::bigint, 0);
  IF v_remaining >= 0 AND v_tokens::bigint > v_remaining THEN
    -- 进入此分支时 0 <= v_remaining < v_tokens <= int4 上限，故强转 int4 安全
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

-- 权限与 045 一致：仅 service_role
REVOKE ALL ON FUNCTION public.consume_ai_token_usage(text, integer, integer, text, integer, integer, integer, text, text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_token_usage(text, integer, integer, text, integer, integer, integer, text, text, bigint, bigint, integer) TO service_role;

COMMIT;
