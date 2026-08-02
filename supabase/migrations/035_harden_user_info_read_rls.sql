-- 035: 收紧 __user_info__ 公开读取（安全修复）
-- ============================================================
-- 背景：016 的 posts_public_feed_read 策略把 __user_info__ 纳入公开白名单
-- 且无视 visibility。__user_info__ 的 content JSON 包含 last_precise_location、
-- precise_location_history（GPS 轨迹）、emails、phones 等敏感信息，
-- 任何拿到 anon key 的访客均可枚举全站用户敏感数据。
--
-- 修复：
--   1. 公开 feed 读策略显式排除 __user_info__（保留 __avatar__，头像无敏感信息）。
--   2. 新增 authenticated 自读策略：用户仍可读取自己的 __user_info__ 行
--      （前端 saveUserInfo / loadCurrentUserInfoSnapshot 依赖此能力）。
-- ============================================================

-- 1. 重建公开 feed 读策略：显式排除 __user_info__
DROP POLICY IF EXISTS posts_public_feed_read ON public.posts;

CREATE POLICY posts_public_feed_read ON public.posts
FOR SELECT TO anon, authenticated
USING (
  is_deleted IS NOT TRUE
  AND media_type IS DISTINCT FROM '__user_info__'
  AND (
    media_type IS NULL
    OR media_type = ''
    OR media_type IN ('image', 'video', 'text', 'photo', 'album', 'audio', '__avatar__')
  )
  AND (
    visibility IS NULL
    OR visibility = 'public'
    OR media_type = '__avatar__'
  )
);

-- 2. 用户读取自己的 __user_info__（JWT 身份匹配，复用 032 的字段模式）
DROP POLICY IF EXISTS posts_userinfo_self_read ON public.posts;

CREATE POLICY posts_userinfo_self_read ON public.posts
FOR SELECT TO authenticated
USING (
  media_type = '__user_info__'
  AND user_name IS NOT NULL
  AND (
    user_name = NULLIF(auth.jwt() ->> 'user_name', '')
    OR user_name = NULLIF(auth.jwt() ->> 'username', '')
    OR user_name = NULLIF(auth.jwt() -> 'app_metadata' ->> 'user_name', '')
    OR user_name = NULLIF(auth.jwt() -> 'app_metadata' ->> 'username', '')
  )
);
