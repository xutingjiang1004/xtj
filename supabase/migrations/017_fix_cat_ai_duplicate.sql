-- 防止 AI小猫 对同一条评论生成重复回复
-- parent_comment_id/generated_by_ai 由 020_cat_ai_reply.sql 引入。
-- 本迁移在 comments 表存在但列缺失时先补列（与 020 的幂等定义一致），
-- 再无条件建唯一索引，避免 017 早于 020 执行时条件恒 false 而静默 no-op、
-- 去重约束只剩 032 一处兜底（H-14 修复）。
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE IF EXISTS public.comments ADD COLUMN IF NOT EXISTS parent_comment_id bigint REFERENCES public.comments(id) ON DELETE SET NULL';
    EXECUTE 'ALTER TABLE IF EXISTS public.comments ADD COLUMN IF NOT EXISTS generated_by_ai boolean NOT NULL DEFAULT false';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply ON public.comments (parent_comment_id) WHERE generated_by_ai = true';
  END IF;
END;
$$;
