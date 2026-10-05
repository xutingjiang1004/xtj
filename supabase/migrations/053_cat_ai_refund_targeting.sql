-- ============================================================================
-- 053_cat_ai_refund_targeting.sql
-- 修复 3e：refund_cat_comment_quota 之前只按 user_name 删"1 小时内最新一条"限流记录，
-- 连发多条 @小猫 时可能退错（把成功那次的配额退掉）。
-- 本迁移给 refund 增加可选的 p_post_id / p_source_comment_id，优先精确匹配本次触发对应记录，
-- 缺省时回退到按 post 匹配，再回退到旧行为(按 user 删最新)。与旧签名重载共存，向后兼容。
-- 注意：本文件需到 Supabase SQL Editor 手动执行（代码 push 不会自动跑 SQL）。
-- ============================================================================

-- 给限流记录预留 per-comment 关联列（供精确退还；旧数据为空时会回退到 post/user 匹配）。
ALTER TABLE public.ai_cat_rate_limits
  ADD COLUMN IF NOT EXISTS source_comment_id bigint;

-- CREATE OR REPLACE 仅当签名完全一致时才替换；这里是新签名(text, uuid DEFAULT, bigint DEFAULT)，
-- 会与旧签名(text)重载共存，旧式 1 参数调用仍可用。
CREATE OR REPLACE FUNCTION public.refund_cat_comment_quota(
  p_user_name text,
  p_post_id uuid DEFAULT NULL,
  p_source_comment_id bigint DEFAULT NULL
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
      ORDER BY
        -- 越精确的匹配越优先：comment 级 > post 级 > 最新一条
        (source_comment_id IS NOT DISTINCT FROM p_source_comment_id) DESC,
        (post_id IS NOT DISTINCT FROM p_post_id) DESC,
        created_at DESC
      LIMIT 1
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_cat_comment_quota(text, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_cat_comment_quota(text, uuid, bigint) TO service_role;