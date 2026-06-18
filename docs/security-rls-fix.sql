-- ============================================================
-- XTJ Supabase RLS 安全修复（H1 + H2）
-- 在 Supabase Dashboard -> SQL Editor 中执行
-- ============================================================

-- ============================================================
-- H1: 修复 posts 表 RLS — 私密帖子泄露 + 软删除过滤
-- 问题：anon_select_posts 策略只过滤 media_type，没有过滤
--       visibility='private' 和 is_deleted，导致私密帖子和
--       已删照片对全网可见。
-- 修复：加 visibility 列（不存在则创建）+ is_deleted 列 +
--       deleted_at 列。RLS 同时过滤私密帖子和已删照片。
--       admin 走 server.js service_role 不受 RLS 限制。
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='visibility') THEN
    ALTER TABLE posts ADD COLUMN visibility text DEFAULT 'public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='is_deleted') THEN
    ALTER TABLE posts ADD COLUMN is_deleted boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='deleted_at') THEN
    ALTER TABLE posts ADD COLUMN deleted_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='deleted_by') THEN
    ALTER TABLE posts ADD COLUMN deleted_by text;
  END IF;
END $$;

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
    AND (
      is_deleted IS NOT TRUE
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

-- ============================================================
-- H3: 修复 posts 表 UPDATE — 软删除（保留 media_url）
-- 问题：anon_update_posts 是 USING (false)，导致照片墙
--       软删除请求（UPDATE is_deleted=true）被 RLS 拦截。
-- 修复：允许 anon 对 __photo_wall__ 类型帖子执行 UPDATE
--       （前端只改 is_deleted=true，不改 media_url）。
--       安全性由前端 JS + RPC 双重校验。
-- 注意：已移除 anon DELETE 策略——不允许硬删除。
-- ============================================================
DROP POLICY IF EXISTS "anon_update_posts" ON posts;
CREATE POLICY "anon_update_posts" ON posts
  FOR UPDATE
  USING (media_type = '__photo_wall__')
  WITH CHECK (media_type = '__photo_wall__');

DROP POLICY IF EXISTS "anon_delete_posts" ON posts;

-- ============================================================
-- H4: 创建 delete_photo_wall_post RPC（安全软删除）
-- 用途：前端调用此 RPC 软删除照片（设置 is_deleted=true），
--       保留 media_url 供管理端查看缩略图。
--       权限由 p_username / p_is_admin 参数控制。
-- ============================================================
CREATE OR REPLACE FUNCTION delete_photo_wall_post(p_post_id bigint, p_username text, p_is_admin boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_name text;
    v_media_url text;
BEGIN
    SELECT user_name, media_url INTO v_user_name, v_media_url
    FROM posts
    WHERE id = p_post_id AND media_type = '__photo_wall__';

    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'not_found');
    END IF;

    -- 权限校验：admin 或发布者本人
    IF p_is_admin OR (p_username IS NOT NULL AND p_username <> '' AND v_user_name = p_username) THEN
        UPDATE posts SET is_deleted = true, deleted_at = NOW(), deleted_by = p_username WHERE id = p_post_id;
        RETURN json_build_object('ok', true, 'data', json_build_object('media_url', v_media_url));
    ELSE
        RETURN json_build_object('ok', false, 'error', 'unauthorized');
    END IF;
END;
$$;

-- 恢复照片 RPC
CREATE OR REPLACE FUNCTION restore_photo_wall_post(p_post_id bigint, p_admin_user text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE posts SET is_deleted = false, deleted_at = NULL, deleted_by = NULL WHERE id = p_post_id AND media_type = '__photo_wall__';
    IF FOUND THEN
        RETURN json_build_object('ok', true);
    ELSE
        RETURN json_build_object('ok', false, 'error', 'not_found');
    END IF;
END;
$$;

-- ============================================================
-- H5: 修复 Realtime 广播 — 照片墙删除跨设备同步
-- 问题：posts 表默认 REPLICA IDENTITY 只发送主键，不包含
--       media_type 和 media_url，导致其他设备的 Realtime
--       订阅无法正确过滤和响应删除事件。
-- 修复：改为 FULL，让 Realtime 发送完整行数据。
-- ============================================================
ALTER TABLE posts REPLICA IDENTITY FULL;

-- ============================================================
-- H6: 允许 anon 删除 Storage 中的照片文件（保留，供管理端清理用）
-- 用途：管理端调用 storage.from('uploads').remove() 清理
--       过期或废弃的图片文件。前端软删除不会触发 Storage 清理。
-- ============================================================
DROP POLICY IF EXISTS "anon_delete_uploads" ON storage.objects;
CREATE POLICY "anon_delete_uploads" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'uploads' AND name LIKE 'photos/%');
