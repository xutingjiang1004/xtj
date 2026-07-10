-- Pro 活动领取唯一约束：同用户+同活动只能领取一次
-- 在 Supabase SQL Editor 中执行
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_uniq ON posts (
  (CASE WHEN media_type = '__pro_gift_claim__' THEN media_url ELSE NULL END),
  (CASE WHEN media_type = '__pro_gift_claim__' THEN user_name ELSE NULL END)
) WHERE media_type = '__pro_gift_claim__';
