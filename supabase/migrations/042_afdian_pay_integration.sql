-- 042: 爱发电支付接入 — ai_user_membership 增加支付渠道标识。
-- 复用 stripe_customer_id / stripe_subscription_id 字段存爱发电订单信息：
--   stripe_customer_id     = 'afdian:' + 爱发电赞助者 user_id
--   stripe_subscription_id = 爱发电订单号 out_trade_no（幂等去重用）
-- 新增 provider 列仅用于标记渠道，不影响现有 set_ai_user_pro RPC。

BEGIN;

ALTER TABLE public.ai_user_membership
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'free'
  CHECK (provider IN ('free', 'manual', 'afdian', 'stripe'));

-- 幂等查询加速：按订单号反查是否已开通
CREATE INDEX IF NOT EXISTS ai_user_membership_out_trade_no_idx
  ON public.ai_user_membership (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

COMMIT;
