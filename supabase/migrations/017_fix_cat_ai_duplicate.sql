-- 防止 AI小猫 对同一条评论生成重复回复
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply
ON comments (parent_comment_id) WHERE generated_by_ai = true;
