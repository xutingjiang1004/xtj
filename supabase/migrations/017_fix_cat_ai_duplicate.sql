-- 防止 AI小猫 对同一条评论生成重复回复
-- parent_comment_id/generated_by_ai 由 020_cat_ai_reply.sql 引入。
-- 本迁移在 comments 表存在但列缺失时先补列（与 020 的幂等定义一致），
-- 按 052 的 deterministic survivor rule 清理重复后再建唯一索引。
-- 017 早于 020 执行时也能生效；032 不再提前建索引。
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE IF EXISTS public.comments ADD COLUMN IF NOT EXISTS parent_comment_id bigint REFERENCES public.comments(id) ON DELETE SET NULL';
    EXECUTE 'ALTER TABLE IF EXISTS public.comments ADD COLUMN IF NOT EXISTS generated_by_ai boolean NOT NULL DEFAULT false';
    -- Apply the same deterministic survivor rule as 052 before installing the
    -- index: migrations run in filename order, so 052 cannot protect this step.
    EXECUTE $dedupe$
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
      WHERE c.id = d.id AND d.rn > 1
    $dedupe$;
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply ON public.comments (parent_comment_id) WHERE generated_by_ai = true';
  END IF;
END;
$$;
