-- 059: increment_post_views 增加 visibility 兜底校验（审计 P1-12 增量加固）
--
-- 背景与已完成的收口：
--   056 迁移把 SECURITY DEFINER 函数 public.increment_post_views(UUID) 授权给了
--   `anon, authenticated, service_role`；由于前端持有公开的 Supabase anon key，
--   任何客户端都能直连 RPC 刷浏览量、并从返回值读到私密帖的精确 views。
--   058 迁移（本迁移之前）已经把授权收口为：
--     REVOKE ALL ... FROM PUBLIC, anon, authenticated;
--     GRANT EXECUTE ... TO service_role;
--   因此「撤销 anon」这一步**已由 058 完成**，本迁移不再重复放宽权限，
--   并且在结尾重新断言 058 的最小权限集，防止 CREATE OR REPLACE 之后再被漂移。
--
-- 本迁移唯一的新增内容：把 visibility 校验下沉到函数内部（防御性加固）。
--   现状：后端 /api/post/view 与 /api/photo/view 在调用 RPC 前都已校验
--   visibility === 'public'，功能上并无漏洞。但校验只存在于应用层，
--   未来任何新增调用点一旦漏校验就会直接泄露私密帖计数。下沉到函数内
--   可以把这层保护变成数据层的硬约束。
--
-- 不会误伤现有功能的论证：
--   /api/post/view 对"作者看自己的帖"直接 return，不调用本 RPC；
--   两个端点调用前都要求 visibility 为 public。也就是说本 RPC 只会在
--   "非作者 + 公开内容"这一条路径上被触发，visibility 恒为 public，
--   新增的 AND 条件不会改变任何一行的命中结果。
--
-- visibility 语义：NULL 视为公开（历史数据中存在未显式设置的行），
-- 与后端 `(visibility && visibility !== 'public')` 的判断保持一致。

BEGIN;

CREATE OR REPLACE FUNCTION public.increment_post_views(p_post_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_views INTEGER;
BEGIN
  UPDATE public.posts
     SET views = COALESCE(views, 0) + 1
   WHERE id = p_post_id
     -- 排除系统 marker 行（__post_view__ / __admin_auth__ / __vip__ ...）。
     -- media_type IS NULL 视为普通帖，允许计数。
     AND (media_type IS NULL OR media_type NOT LIKE '\_\_%' ESCAPE '\')
     -- ★ P1-12：只统计公开内容。未设置 visibility 的历史行（NULL）按公开处理。
     AND (visibility IS NULL OR visibility = 'public')
  RETURNING views INTO v_views;

  -- 未命中（帖子不存在 / 是 marker 行 / 非公开）时返回 0，
  -- 绝不返回任何计数，避免泄露私密帖的精确浏览量。
  RETURN COALESCE(v_views, 0);
END;
$$;

-- CREATE OR REPLACE 会重置函数的 search_path，这里重新固定，
-- 避免 SECURITY DEFINER 函数被调用方会话的 search_path 劫持。
ALTER FUNCTION public.increment_post_views(uuid) SET search_path = pg_catalog, public;

-- 重新断言 058 的最小权限集：客户端角色一律不可达，仅 service_role 可调用。
REVOKE ALL ON FUNCTION public.increment_post_views(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_views(uuid) TO service_role;

COMMIT;

-- 验收（部署后执行）：
--   1) 权限未被 059 放宽：
--      SELECT proname, proacl FROM pg_proc WHERE proname = 'increment_post_views';
--        → proacl 中不应出现 anon / authenticated
--   2) 私密帖不再被计数（返回 0）：
--      SELECT public.increment_post_views('<某个 visibility <> public 的 post id>');
--        → 期望 0
--   3) 公开帖计数不受影响（返回 >0）：
--      SELECT public.increment_post_views('<某个 visibility = public 的 post id>');
--        → 期望大于 0
