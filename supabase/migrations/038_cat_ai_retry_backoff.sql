-- 添加退避状态字段到 ai_comment_reply_jobs
ALTER TABLE public.ai_comment_reply_jobs
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS retry_delay_ms INTEGER;

-- 索引：worker 只领取到期任务
CREATE INDEX IF NOT EXISTS idx_cat_jobs_pending_retry
  ON public.ai_comment_reply_jobs(status, next_retry_at)
  WHERE status = 'pending';
