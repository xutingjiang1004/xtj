-- 防止 AI小猫 对同一条评论生成重复回复
-- parent_comment_id/generated_by_ai are introduced by 020_cat_ai_reply.sql.
-- Keep this historical migration safe for a fresh database; 032 repeats the
-- idempotent index creation after the columns are guaranteed to exist.
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'parent_comment_id'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'generated_by_ai'
     ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply ON public.comments (parent_comment_id) WHERE generated_by_ai = true';
  END IF;
END;
$$;
