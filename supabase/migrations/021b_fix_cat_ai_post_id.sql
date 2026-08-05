-- 修复 ai_comment_reply_jobs.post_id 类型：从 bigint 改为 uuid
-- 020_cat_ai_reply.sql 错误地将 post_id 设为 bigint，但 posts.id 是 uuid
ALTER TABLE IF EXISTS public.ai_comment_reply_jobs
  ALTER COLUMN post_id TYPE uuid USING post_id::text::uuid;