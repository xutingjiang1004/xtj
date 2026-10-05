-- 017: 修复 IP 属地历史数据泄漏和默认值问题
-- 1. 删除 ip_region_status 的 DEFAULT 'pending'，防止历史帖子被误标为"解析中"
-- 2. 新增 ip_lookup_started_at 字段，区分真正启动解析的新帖子和历史帖子
-- 3. 新增 ip_region_error 字段，保存解析失败原因
-- 4. 清理历史帖子：没有 ip_lookup_started_at 且没有 ip_region_text 的，状态设为 NULL

-- 步骤 1: 删除默认值
ALTER TABLE public.posts
  ALTER COLUMN ip_region_status DROP DEFAULT;

-- 步骤 2: 新增字段
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS ip_lookup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ip_region_error text;

-- 步骤 3: 清理历史帖子错误状态
-- 没有 ip_region_text、没有 ip_resolved_at、也没有 ip_lookup_started_at 的历史帖子
-- 将 ip_region_status 设为 NULL（不显示任何 IP 属地信息）
UPDATE public.posts
SET ip_region_status = NULL
WHERE ip_region_status = 'pending'
  AND (ip_region_text IS NULL OR ip_region_text = '')
  AND ip_resolved_at IS NULL
  AND ip_lookup_started_at IS NULL;