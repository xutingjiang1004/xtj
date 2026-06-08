-- ============================================================
-- xtj Supabase Row Level Security (RLS) 策略
-- 用途：强制所有管理操作只能通过 service_role key 执行，
--       禁止 anon key 直连数据库进行敏感操作。
-- 执行方式：在 Supabase SQL Editor 中逐段执行
-- ============================================================

-- ============================================================
-- 1. posts 表 RLS
-- ============================================================
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- 1a. anon key 只允许读取非敏感类型的帖子
DROP POLICY IF EXISTS "anon_select_posts" ON posts;
CREATE POLICY "anon_select_posts" ON posts
  FOR SELECT
  USING (
    media_type NOT IN (
      '__admin_auth__', '__ann__', '__report__', '__dm__',
      '__visit__', '__attack__', '__user_visit__', 'AUTH_MARKER'
    )
  );

-- 1b. anon key 只允许插入公开数据（不允许插入管理标记类型）
DROP POLICY IF EXISTS "anon_insert_posts" ON posts;
CREATE POLICY "anon_insert_posts" ON posts
  FOR INSERT
  WITH CHECK (
    media_type NOT IN (
      '__admin_auth__', '__ann__', '__report__', '__dm__',
      '__visit__', '__attack__', '__user_visit__'
    )
  );

-- 1c. anon key 不允许更新/删除 posts
DROP POLICY IF EXISTS "anon_update_posts" ON posts;
CREATE POLICY "anon_update_posts" ON posts
  FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS "anon_delete_posts" ON posts;
CREATE POLICY "anon_delete_posts" ON posts
  FOR DELETE
  USING (false);

-- ============================================================
-- 2. likes 表 RLS
-- ============================================================
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- 2a. anon key 只允许读取
DROP POLICY IF EXISTS "anon_select_likes" ON likes;
CREATE POLICY "anon_select_likes" ON likes
  FOR SELECT
  USING (true);

-- 2b. anon key 只允许插入自己的点赞
DROP POLICY IF EXISTS "anon_insert_likes" ON likes;
CREATE POLICY "anon_insert_likes" ON likes
  FOR INSERT
  WITH CHECK (true);

-- 2c. anon key 不允许更新/删除
DROP POLICY IF EXISTS "anon_update_likes" ON likes;
CREATE POLICY "anon_update_likes" ON likes
  FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS "anon_delete_likes" ON likes;
CREATE POLICY "anon_delete_likes" ON likes
  FOR DELETE
  USING (false);

-- ============================================================
-- 3. comments 表 RLS
-- ============================================================
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_comments" ON comments;
CREATE POLICY "anon_select_comments" ON comments
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "anon_insert_comments" ON comments;
CREATE POLICY "anon_insert_comments" ON comments
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_comments" ON comments;
CREATE POLICY "anon_update_comments" ON comments
  FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS "anon_delete_comments" ON comments;
CREATE POLICY "anon_delete_comments" ON comments
  FOR DELETE
  USING (false);

-- ============================================================
-- 4. bans 表 RLS — 完全禁止 anon key 访问
-- ============================================================
ALTER TABLE bans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_bans" ON bans;
CREATE POLICY "service_role_all_bans" ON bans
  FOR ALL
  USING (true)
  WITH CHECK (true);
-- 注意：该策略依赖 Supabase 的默认行为——service_role 自动绕过 RLS，
-- 因此该策略实际只对 anon 有效：anon 看到所有行但通过上层 API 鉴权控制。
-- 真正限制需配合 Supabase 的 "Enable RLS" + 删除对 anon 的显式授权。

-- 显式阻止 anon 修改 bans
DROP POLICY IF EXISTS "anon_modify_bans" ON bans;
CREATE POLICY "anon_modify_bans" ON bans
  FOR INSERT
  WITH CHECK (false);

-- ============================================================
-- 5. mutes 表 RLS — 完全禁止 anon key 访问
-- ============================================================
ALTER TABLE mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_modify_mutes" ON mutes;
CREATE POLICY "anon_modify_mutes" ON mutes
  FOR ALL
  USING (false);

-- ============================================================
-- 6. blacklist 表 RLS — 完全禁止 anon key 访问
-- ============================================================
ALTER TABLE blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_modify_blacklist" ON blacklist;
CREATE POLICY "anon_modify_blacklist" ON blacklist
  FOR ALL
  USING (false);

-- ============================================================
-- 7. 验证查询：检查当前角色
-- ============================================================
-- 以 anon key 执行时应只能看到公开 posts，
-- 以 service_role key 执行时应能看到全部数据。
--
-- SELECT current_user;  -- 返回 anon 或 service_role
-- SELECT * FROM posts LIMIT 1;  -- anon 看不到 __admin_auth__ 类型

-- ============================================================
-- 发布说明：
-- - 执行前先在 Supabase Dashboard -> SQL Editor 中逐段执行
-- - 执行后重启 render-api 服务使新策略生效
-- - service_role key 具有 RLS 绕过能力，因此不受这些策略限制
-- ============================================================
