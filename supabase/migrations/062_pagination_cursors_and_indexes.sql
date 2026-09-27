-- 062: 2026-09-27 分页游标与稳定排序所需的索引补全
--
-- 背景：GPT 交接报告里承诺、但未落到代码/数据库的「后端补完」三件套之一。
--       代码侧（render-api/server.js）已同步改造：
--         · GET /api/dm/messages    → (created_at, id) 复合 keyset 游标
--         · GET /api/photos/wall/:userName → created_at DESC, id DESC 稳定排序
--         · GET /api/photos/public  → created_at DESC, id DESC 稳定排序
--       本迁移补齐支撑上述查询的索引，否则复合游标在 posts 表上将退化为
--       「索引扫描 + 内存排序」，大表下翻页会明显变慢。
--
-- 全部语句幂等（IF NOT EXISTS / DO 块守卫），可安全重复执行。
--
-- ⚠ 大表注意：CREATE INDEX 默认阻塞写入。若线上 posts 行数很大，请在事务外
--   逐条改用 CREATE INDEX CONCURRENTLY（CONCURRENTLY 不能写在事务块内）。

BEGIN;

-- ===========================================================================
-- 1) 私信双向分页（GET /api/dm/messages）
--    查询形态：
--      WHERE media_type = '__dm__'
--        AND user_name = <sender> AND media_url = <recipient>
--        AND (created_at < $c OR (created_at = $c AND id < $id))
--      ORDER BY created_at DESC, id DESC LIMIT n+1
--    列顺序必须严格匹配 「等值列 → 排序键」，才能走纯索引扫描 + 提前终止。
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'posts') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_posts_dm_direction_keyset
               ON public.posts (user_name, media_url, created_at DESC, id DESC)
               WHERE media_type = ''__dm__''';
  END IF;
END $$;

-- ===========================================================================
-- 2) 照片墙稳定排序（GET /api/photos/public）
--    查询形态：
--      WHERE media_type = '__photo_wall__' AND visibility = 'public'
--        AND (is_deleted IS NULL OR is_deleted = false)
--      ORDER BY created_at DESC, id DESC
--      OFFSET ... LIMIT ...
--    部分索引把过滤条件前置，避免全表排序。
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'posts') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_posts_photo_wall_public_keyset
               ON public.posts (created_at DESC, id DESC)
               WHERE media_type = ''__photo_wall__''
                 AND visibility = ''public''
                 AND is_deleted IS NOT TRUE';
  END IF;
END $$;

-- ===========================================================================
-- 3) 个人照片墙稳定排序（GET /api/photos/wall/:userName）
--    查询形态：
--      WHERE user_name = <target> AND media_type = '__photo_wall__'
--        AND (is_deleted IS NULL OR is_deleted = false)
--        [AND visibility = 'public' -- 查看他人时追加]
--      ORDER BY created_at DESC, id DESC
--    含 visibility 列便于两条分支（本人全量 / 他人仅公开）都能用上索引。
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'posts') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_posts_photo_wall_owner_keyset
               ON public.posts (user_name, visibility, created_at DESC, id DESC)
               WHERE media_type = ''__photo_wall__''
                 AND is_deleted IS NOT TRUE';
  END IF;
END $$;

-- ===========================================================================
-- 4) 私信会话列表（GET /api/dm/list）
--    查询按 user_name + media_url 双向取 DM 行后再按时间合并，
--    与 1) 的索引职责重叠但方向相反，单独给一个 (media_url, user_name) 前缀，
--    服务「我是收件人」这一半的查询。
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'posts') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_posts_dm_inbound_keyset
               ON public.posts (media_url, user_name, created_at DESC, id DESC)
               WHERE media_type = ''__dm__''';
  END IF;
END $$;

-- ===========================================================================
-- 5) 私密媒体授权支撑（dm_media_uploads 查询加速）
--    用途：给定收件人 / 消息，判断某个 storage_path 是否属于本人可控的私聊媒体，
--    即「这条媒体有没有被合法登记过、有没有挂在真实消息上」。
--    033 已有 (uploader, status, updated_at DESC)；这里补 message_id 与 storage_path
--    的直达查询路径。
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dm_media_uploads') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dm_media_uploads_storage_path
               ON public.dm_media_uploads (storage_path)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dm_media_uploads_message_id
               ON public.dm_media_uploads (message_id)
               WHERE message_id IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dm_media_uploads_status_updated
               ON public.dm_media_uploads (status, updated_at DESC)';
  END IF;
END $$;

COMMIT;

-- ===========================================================================
-- 验收（部署后执行）
-- ===========================================================================
-- 1) 索引是否建立
--    SELECT indexname, indexdef FROM pg_indexes
--     WHERE schemaname = 'public' AND tablename = 'posts'
--       AND indexname LIKE 'idx_posts_dm%' OR indexname LIKE 'idx_posts_photo_wall%';
-- 2) 私信复合游标是否走索引（应为 Index Scan，无 Sort）
--    EXPLAIN (ANALYZE, BUFFERS)
--    SELECT id, created_at FROM public.posts
--     WHERE media_type = '__dm__' AND user_name = 'a' AND media_url = 'b'
--       AND (created_at < now() OR (created_at = now() AND id < gen_random_uuid()))
--     ORDER BY created_at DESC, id DESC LIMIT 51;
-- 3) 照片墙公开列表是否走索引
--    EXPLAIN (ANALYZE, BUFFERS)
--    SELECT id, created_at FROM public.posts
--     WHERE media_type = '__photo_wall__' AND visibility = 'public' AND is_deleted IS NOT TRUE
--     ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 60;
