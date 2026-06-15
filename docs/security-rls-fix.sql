-- ============================================================
-- XTJ Supabase RLS 安全修复（H1 + H2）
-- 在 Supabase Dashboard -> SQL Editor 中执行
-- ============================================================

-- ============================================================
-- H1: 修复 posts 表 RLS — 私密帖子泄露
-- 问题：anon_select_posts 策略只过滤 media_type，没有过滤
--       visibility='private'，导致所有用户的私密帖子全网可读。
-- 修复：在 USING 条件中增加 visibility 过滤
-- ============================================================
DROP POLICY IF EXISTS "anon_select_posts" ON posts;
CREATE POLICY "anon_select_posts" ON posts
  FOR SELECT
  USING (
    media_type NOT IN (
      '__admin_auth__', '__ann__', '__report__', '__dm__',
      '__visit__', '__attack__', '__user_visit__', '__auth__'
    )
    AND (
      visibility = 'public'
      OR visibility IS NULL
    )
  );

-- ============================================================
-- H2: 修正 bans/mutes/blacklist 表的 RLS 策略
-- 问题：bans 表的 "service_role_all_bans" FOR ALL USING(true)
--       策略错误地给了 anon key SELECT 权限（service_role 本
--       来就绕过 RLS，不需要显式策略）。删除后 anon 默认被拒。
-- ============================================================

-- 2a. bans 表：删除错误策略，RLS 自动 deny anon
DROP POLICY IF EXISTS "service_role_all_bans" ON bans;
DROP POLICY IF EXISTS "anon_modify_bans" ON bans;
ALTER TABLE bans ENABLE ROW LEVEL SECURITY;

-- 2b. mutes 表：确认 anon 全拒（已有 FOR ALL USING(false)）
DROP POLICY IF EXISTS "anon_modify_mutes" ON mutes;
CREATE POLICY "anon_modify_mutes" ON mutes
  FOR ALL
  USING (false);
ALTER TABLE mutes ENABLE ROW LEVEL SECURITY;

-- 2c. blacklist 表：确认 anon 全拒（已有 FOR ALL USING(false)）
DROP POLICY IF EXISTS "anon_modify_blacklist" ON blacklist;
CREATE POLICY "anon_modify_blacklist" ON blacklist
  FOR ALL
  USING (false);
ALTER TABLE blacklist ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 验证查询（用 anon key 执行，应返回空或 0）
-- ============================================================
-- SELECT count(*) FROM posts WHERE visibility='private';
-- SELECT count(*) FROM bans;
-- SELECT count(*) FROM mutes;
-- SELECT count(*) FROM blacklist;
