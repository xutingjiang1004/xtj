-- ============================================================================
-- 052_cat_ai_hardening.sql
-- 小猫 AI（cat-ai）健壮性加固，对应代码审计 B3 / B4 / D1 / D2：
--   B3 清理历史重复 AI 回复并确保部分唯一索引真正建成（修复 maybeSingle 多行卡死）
--   D1 清理 ON DELETE SET NULL 时代遗留的“孤儿小猫回复”（parent_comment_id 为空）
--   B4 为任务表增加 quota_refunded 幂等列，并新增配额返还 RPC（服务端失败补偿）
--   D2 consume_cat_comment_quota 的咨询锁由 hashtext(int4) 升级为
--      hashtextextended(int8)，消除不同用户名的哈希碰撞导致的无谓串行
-- 全部语句幂等，可重复执行；仅 service_role 具备数据/RPC 权限。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- B3 + D1：数据清理。必须先清理，下面的部分唯一索引才能在“历史曾产生重复”时建成功。
-- ---------------------------------------------------------------------------

-- D1：删除历史孤儿 AI 回复。
-- 020/017 时期外键为 ON DELETE SET NULL，父评论删除后 AI 子回复的
-- parent_comment_id 被置空、成为顶层“漂浮”小猫回复；021 才改为 CASCADE。
-- 小猫回复按设计永远是子回复（必有 parent），因此 parent 为空的 generated_by_ai
-- 行均为历史孤儿，安全删除。
DELETE FROM public.comments
WHERE generated_by_ai = true
  AND parent_comment_id IS NULL;

-- B3：同一父评论下若存在多条小猫回复，只保留最早一条（按 created_at、id 排序），
-- 删除其余重复行，避免 maybeSingle()/前端去重遭遇多行而永久卡死。
DELETE FROM public.comments AS c
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY parent_comment_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.comments
  WHERE generated_by_ai = true
    AND parent_comment_id IS NOT NULL
) AS d
WHERE c.id = d.id
  AND d.rn > 1;

-- 清理完成后确保部分唯一索引存在（017/032 曾尝试创建，但若当时已有重复行会创建失败；
-- 此刻重复已清空，IF NOT EXISTS 可补齐）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply
  ON public.comments (parent_comment_id)
  WHERE generated_by_ai = true;

-- ---------------------------------------------------------------------------
-- B4：任务表增加“配额是否已返还”幂等标记
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_comment_reply_jobs
  ADD COLUMN IF NOT EXISTS quota_refunded boolean NOT NULL DEFAULT false;

-- B4：返还一次触发时预占的每小时配额。
-- 删除该用户最近 1 小时内“最新一条”限流记录（即最近一次预占），返回实际删除条数。
-- 由后端在任务因服务端原因重试耗尽转 failed、且 CAS 标记 quota_refunded 成功后调用，
-- 配合任务表的 quota_refunded 列保证一个任务最多返还一次。
CREATE OR REPLACE FUNCTION public.refund_cat_comment_quota(
  p_user_name text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' THEN
    RETURN 0;
  END IF;
  WITH deleted AS (
    DELETE FROM public.ai_cat_rate_limits
    WHERE ctid IN (
      SELECT ctid
      FROM public.ai_cat_rate_limits
      WHERE user_name = p_user_name
        AND created_at >= now() - interval '1 hour'
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_cat_comment_quota(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_cat_comment_quota(text) TO service_role;

-- ---------------------------------------------------------------------------
-- D2：咨询锁升级为 hashtextextended(bigint)，消除 int4 哈希碰撞造成的跨用户串行。
-- 函数签名保持不变，后端调用无需改动。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_cat_comment_quota(
  p_user_name text,
  p_post_id uuid,
  p_user_limit integer,
  p_post_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_count integer;
  v_post_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cat:' || coalesce(p_user_name, ''), 0));
  SELECT count(*) INTO v_user_count FROM public.ai_cat_rate_limits
    WHERE user_name = p_user_name AND created_at >= now() - interval '1 hour';
  IF v_user_count >= p_user_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_limit');
  END IF;
  IF p_post_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cat-post:' || p_post_id::text, 0));
    SELECT count(*) INTO v_post_count FROM public.ai_cat_rate_limits
      WHERE post_id = p_post_id AND created_at >= now() - interval '1 hour';
    IF v_post_count >= p_post_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'post_limit');
    END IF;
  END IF;
  INSERT INTO public.ai_cat_rate_limits(user_name, post_id, trigger_type)
    VALUES (p_user_name, p_post_id, 'comment');
  RETURN jsonb_build_object('allowed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_cat_comment_quota(text, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_cat_comment_quota(text, uuid, integer, integer) TO service_role;
