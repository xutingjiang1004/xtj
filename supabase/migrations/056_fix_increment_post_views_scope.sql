-- 修复 increment_post_views 的 media_type 硬编码过滤（S 级 bug）
--
-- 症状：所有普通帖（text / image / NULL）的浏览数永远停留在初值。
--
-- 根因：migration 031 是为「照片墙浏览量」这一单一场景写的，函数体里硬编码了
--         AND media_type = '__photo_wall__'
--       但应用层有两个调用方：
--         1) render-api/server.js:13601  POST /api/post/view   —— 服务端浏览上报（所有帖子）
--         2) js/photo-wall/data.js:609    window.sb.rpc(...)   —— 照片墙前端直接调用
--       对普通帖，UPDATE 命中 0 行，views 不增长；前端却把这个「旧值」当作
--       权威值覆盖显示（04-posts-interactions.js:1458-1462），把已经乐观 +1
--       的正确数字又改回旧值，表现为「浏览量永远是 1」。
--
-- 修法：去掉媒体类型白名单，改为「排除全部系统 marker 行」。
--   posts 表同时承载两类非内容行：
--     - 浏览事件行：media_type = '__post_view__'（server.js:13593 插入）
--     - 其它系统标记：__admin_auth__ / __vip__ / __refresh_token__ 等
--   这些行的 media_type 都以双下划线包裹。若只简单删掉过滤条件，浏览计数会
--   加到事件行本身，造成数据污染。故黑名单写法换成前缀排除，且用 ESCAPE
--   显式转义下划线，避免被当作 LIKE 通配符。
--
-- 兼容性：保留 RETURNS INTEGER 与参数签名不变，CREATE OR REPLACE 可直接覆盖，
--   无需先 DROP（031 已处理过返回类型变更，此后无签名变化）。
--
-- 历史数据：views 未增长期间的浏览数已丢失，无法自动回补。
--   如需核账，可依据 posts 表中 media_type='__post_view__' 的事件行按
--   content->>'post_id' 聚合离线还原（不作自动回填，避免出错）。

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
  RETURNING views INTO v_views;
  RETURN COALESCE(v_views, 0);
END;
$$;

-- 与 migration 055 的收口保持一致：显式锁定 search_path，避免SECURITY DEFINER
-- 函数被调用方会话的 search_path 劫持。
ALTER FUNCTION public.increment_post_views(uuid) SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.increment_post_views(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_post_views(UUID) TO anon, authenticated, service_role;

COMMIT;
