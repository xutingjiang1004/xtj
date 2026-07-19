-- 小猫 AI 评论区自动回复系统
-- 为现有 comments 表增加子评论和 AI 生成标记字段
ALTER TABLE IF EXISTS public.comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid REFERENCES public.comments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generated_by_ai boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS comments_parent_idx ON public.comments (parent_comment_id);
CREATE INDEX IF NOT EXISTS comments_generated_by_ai_idx ON public.comments (generated_by_ai);

-- AI 评论回复任务表
CREATE TABLE IF NOT EXISTS public.ai_comment_reply_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  request_user_id text NOT NULL,
  bot_user_id text NOT NULL DEFAULT 'cat_ai',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'blocked')),
  attempts integer NOT NULL DEFAULT 0,
  model text NOT NULL DEFAULT '',
  generated_reply text,
  error_message text,
  risk_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 唯一约束：同一条评论最多一个小猫回复任务
CREATE UNIQUE INDEX IF NOT EXISTS ai_comment_reply_jobs_source_idx ON public.ai_comment_reply_jobs (source_comment_id);

-- 索引优化
CREATE INDEX IF NOT EXISTS ai_comment_reply_jobs_status_idx ON public.ai_comment_reply_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS ai_comment_reply_jobs_post_idx ON public.ai_comment_reply_jobs (post_id);
CREATE INDEX IF NOT EXISTS ai_comment_reply_jobs_request_user_idx ON public.ai_comment_reply_jobs (request_user_id);

-- 小猫机器人系统账号（通过 Supabase auth 或直接插入 posts 表）
-- 在 posts 表中插入小猫账号记录（使用 AUTH_MARKER 作为 media_type 表示用户）
-- 注意：如果 cat_ai 用户已存在则跳过
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE user_name = 'cat_ai' AND media_type = '__auth__') THEN
    INSERT INTO public.posts (user_name, content, media_type, media_url, actor_key, visibility)
    VALUES (
      'cat_ai',
      '{"text":"徐旭泽的犀利毒舌 AI 分身","is_bot":true,"account_type":"ai_bot","is_system":true}',
      '__auth__',
      'cat_ai',
      'sys_cat_ai_' || extract(epoch from now())::text,
      'public'
    );
  END IF;
END $$;

-- 小猫评论限流表（每小时每用户触发次数）
CREATE TABLE IF NOT EXISTS public.ai_cat_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name text NOT NULL,
  post_id uuid,
  trigger_type text NOT NULL DEFAULT 'comment',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_cat_rate_limits_user_hour_idx ON public.ai_cat_rate_limits (user_name, created_at);
CREATE INDEX IF NOT EXISTS ai_cat_rate_limits_post_hour_idx ON public.ai_cat_rate_limits (post_id, created_at);

-- RLS 保护
ALTER TABLE public.ai_comment_reply_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cat_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_comment_reply_jobs, public.ai_cat_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_comment_reply_jobs, public.ai_cat_rate_limits TO service_role;

-- 定期清理过期限流记录的函数
CREATE OR REPLACE FUNCTION public.cleanup_expired_cat_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM public.ai_cat_rate_limits WHERE created_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;