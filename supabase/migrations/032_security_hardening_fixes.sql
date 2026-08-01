-- Migration 032: 安全加固与已知缺陷修复（合并批次）
-- 1. brain_nodes / ai_jobs 从未启用 RLS → 任意访客可读写 → 仅放行 service_role
-- 2. 头像 RLS 策略允许 anon 插入任意 user_name 的头像记录（身份冒充）→ 移除 anon 直写，
--    头像写入改走后端 /api/avatar（service_role，绑定登录身份）
-- 3. mark_dm_messages_read 对 TEXT 列使用 jsonb 运算符恒失败 → 重写为 TEXT 安全版本，
--    并修复幂等语义（已读消息不应出现在 failed_ids）
-- 4. 新增 delete_comment_v2（管理端删除评论，原定义缺失）
-- 5. delete_post_with_actor 对 __report__ 行使用裸 content::jsonb 转换，坏 JSON 会导致
--    帖子删除整体失败 → 改用 xtj_private.safe_jsonb
-- 6. 017 的 idx_comments_unique_ai_reply 依赖 020 才存在的列 → 迁入本迁移
--    （IF NOT EXISTS，对已手工应用的生产库为幂等空操作）
-- 7. get_user_restrictions 客户端依赖但从未定义 → 补齐（仅返回三个布尔状态）
-- 8. cleanup_expired_cat_rate_limits 缺少 SET search_path 硬化

BEGIN;

-- ============ 1. brain_nodes / ai_jobs RLS ============
ALTER TABLE public.brain_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.brain_nodes, public.ai_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brain_nodes, public.ai_jobs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.brain_nodes_id_seq, public.ai_jobs_id_seq TO service_role;

-- ============ 1b. code persistent index RLS identity ============
-- The application stores either a device/user name or an auth UUID in user_id.
-- Keep direct authenticated reads useful without weakening the service-role-only
-- write boundary established by migration 029.
DROP POLICY IF EXISTS "Users can view own workspaces" ON public.code_workspaces;
CREATE POLICY "Users can view own workspaces"
  ON public.code_workspaces
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()::text
    OR user_id = NULLIF(auth.jwt() ->> 'user_name', '')
    OR user_id = NULLIF(auth.jwt() ->> 'username', '')
    OR user_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'user_name', '')
    OR user_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'username', '')
  );

DROP POLICY IF EXISTS "Users can view own index files" ON public.code_index_files;
CREATE POLICY "Users can view own index files"
  ON public.code_index_files
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()::text
    OR user_id = NULLIF(auth.jwt() ->> 'user_name', '')
    OR user_id = NULLIF(auth.jwt() ->> 'username', '')
    OR user_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'user_name', '')
    OR user_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'username', '')
  );

DROP POLICY IF EXISTS "Users can view own index chunks" ON public.code_index_chunks;
CREATE POLICY "Users can view own index chunks"
  ON public.code_index_chunks
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()::text
    OR user_id = NULLIF(auth.jwt() ->> 'user_name', '')
    OR user_id = NULLIF(auth.jwt() ->> 'username', '')
    OR user_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'user_name', '')
    OR user_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'username', '')
  );

DROP POLICY IF EXISTS "Users can view own index builds" ON public.code_index_builds;
CREATE POLICY "Users can view own index builds"
  ON public.code_index_builds
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()::text
    OR user_id = NULLIF(auth.jwt() ->> 'user_name', '')
    OR user_id = NULLIF(auth.jwt() ->> 'username', '')
    OR user_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'user_name', '')
    OR user_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'username', '')
  );

-- ============ 2. 头像写入收口（禁止 anon 直写） ============
DROP POLICY IF EXISTS avatar_insert_own ON public.posts;
REVOKE INSERT ON public.posts FROM anon, authenticated;

-- ============ 3. mark_dm_messages_read 重写（TEXT 安全 + 幂等） ============
CREATE OR REPLACE FUNCTION public.mark_dm_messages_read(
  p_receiver TEXT,
  p_message_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, xtj_private
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_now_str TEXT;
  v_ids UUID[];
  v_updated UUID[] := ARRAY[]::UUID[];
  v_already_read UUID[] := ARRAY[]::UUID[];
  v_failed UUID[] := ARRAY[]::UUID[];
BEGIN
  IF p_receiver IS NULL OR btrim(p_receiver) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_receiver');
  END IF;

  v_ids := ARRAY(
    SELECT DISTINCT id FROM unnest(p_message_ids) AS id WHERE id IS NOT NULL
  );

  IF array_length(v_ids, 1) IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'updated_ids', '[]'::jsonb,
      'failed_ids', '[]'::jsonb,
      'marked', 0
    );
  END IF;

  v_now_str := to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  -- posts.content 是 TEXT 列：先用 xtj_private.safe_jsonb 尝试解析，
  -- 是 JSON 对象则合并 read_at，否则包装为 {"text": <原文>, "read_at": <ts>}
  WITH locked AS (
    SELECT id, content, media_type, media_url
    FROM public.posts
    WHERE id = ANY(v_ids)
      AND media_type = '__dm__'
      AND media_url = p_receiver
    FOR UPDATE
  ),
  do_update AS (
    UPDATE public.posts p
       SET views = GREATEST(COALESCE(p.views, 0), 1),
           content = CASE
             WHEN p.content IS NULL OR btrim(p.content) = '' THEN
               jsonb_build_object('read_at', v_now_str)::text
             WHEN jsonb_typeof(xtj_private.safe_jsonb(p.content)) = 'object'
                  AND COALESCE(xtj_private.safe_jsonb(p.content)->>'read_at', '') = '' THEN
               (xtj_private.safe_jsonb(p.content) || jsonb_build_object('read_at', v_now_str))::text
             WHEN jsonb_typeof(xtj_private.safe_jsonb(p.content)) = 'object' THEN
               p.content
             ELSE
               jsonb_build_object('text', p.content, 'read_at', v_now_str)::text
           END
      FROM locked l
     WHERE p.id = l.id
       AND (
            p.content IS NULL
         OR btrim(p.content) = ''
         OR jsonb_typeof(xtj_private.safe_jsonb(p.content)) <> 'object'
         OR COALESCE(xtj_private.safe_jsonb(p.content)->>'read_at', '') = ''
       )
    RETURNING p.id
  )
  SELECT ARRAY(SELECT id FROM do_update) INTO v_updated;

  -- 已读消息（匹配到但无需再标记）不算失败
  SELECT ARRAY(
    SELECT id FROM unnest(v_ids) AS id
    WHERE id <> ALL(COALESCE(v_updated, ARRAY[]::UUID[]))
      AND EXISTS (
        SELECT 1 FROM public.posts p2
        WHERE p2.id = id
          AND p2.media_type = '__dm__'
          AND p2.media_url = p_receiver
          AND jsonb_typeof(xtj_private.safe_jsonb(p2.content)) = 'object'
          AND COALESCE(xtj_private.safe_jsonb(p2.content)->>'read_at', '') <> ''
      )
  ) INTO v_already_read;

  -- 失败：既未更新也不是已读（不存在 / 接收方不匹配 / 类型不符）
  SELECT ARRAY(
    SELECT id FROM unnest(v_ids) AS id
    WHERE id <> ALL(COALESCE(v_updated, ARRAY[]::UUID[]))
      AND id <> ALL(COALESCE(v_already_read, ARRAY[]::UUID[]))
  ) INTO v_failed;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_ids', COALESCE(to_jsonb(v_updated), '[]'::jsonb),
    'already_read_ids', COALESCE(to_jsonb(v_already_read), '[]'::jsonb),
    'failed_ids', COALESCE(to_jsonb(v_failed), '[]'::jsonb),
    'marked', COALESCE(array_length(v_updated, 1), 0)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'internal_error', 'error', '批量更新失败');
END;
$$;

REVOKE ALL ON FUNCTION public.mark_dm_messages_read(TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_dm_messages_read(TEXT, UUID[]) TO service_role;

-- ============ 4. delete_comment_v2（管理端删除评论，含 AI 子回复） ============
CREATE OR REPLACE FUNCTION public.delete_comment_v2(
  p_comment_id BIGINT,
  p_deleted_by TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted BIGINT[] := ARRAY[]::BIGINT[];
  v_exists BOOLEAN;
BEGIN
  IF p_comment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Comment id required');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.comments WHERE id = p_comment_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Comment not found');
  END IF;

  WITH deleted AS (
    DELETE FROM public.comments
    WHERE id = p_comment_id OR parent_comment_id = p_comment_id
    RETURNING id
  )
  SELECT ARRAY(SELECT id FROM deleted) INTO v_deleted;

  RETURN jsonb_build_object(
    'ok', true,
    'comment_id', p_comment_id,
    'deleted_ids', COALESCE(to_jsonb(v_deleted), '[]'::jsonb)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'internal_error', 'error', 'Delete failed');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_comment_v2(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_comment_v2(BIGINT, TEXT) TO service_role;

-- ============ 5. delete_post_with_actor：坏 JSON 报告行不再阻塞帖子删除 ============
CREATE OR REPLACE FUNCTION public.delete_post_with_actor(
  p_post_id UUID,
  p_actor_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, xtj_private
AS $$
DECLARE
  v_post RECORD;
  v_expected_actor_key TEXT;
BEGIN
  IF p_post_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Post ID is required');
  END IF;

  IF p_actor_key IS NULL OR btrim(p_actor_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Actor key is required');
  END IF;

  SELECT id, actor_key, user_name INTO v_post
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Post not found');
  END IF;

  v_expected_actor_key := COALESCE(v_post.actor_key, '');
  IF v_expected_actor_key <> btrim(p_actor_key) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Actor key mismatch');
  END IF;

  DELETE FROM public.likes WHERE post_id = p_post_id;
  DELETE FROM public.comments WHERE post_id = p_post_id;

  DELETE FROM public.posts
  WHERE id <> p_post_id
    AND (
      (media_type = '__post_view__' AND media_url = p_post_id::TEXT)
      OR (media_type = '__report__' AND COALESCE(xtj_private.safe_jsonb(content)->>'target_id', '') = p_post_id::TEXT)
    );

  DELETE FROM public.posts WHERE id = p_post_id;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'deleted', true, 'post_id', p_post_id);
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Post not found');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'internal_error', 'error', 'Delete failed');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_post_with_actor(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_post_with_actor(UUID, TEXT) TO service_role;

-- ============ 6. 017 唯一索引迁入（020 之后列才存在） ============
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply
ON public.comments (parent_comment_id) WHERE generated_by_ai = true;

-- ============ 7. get_user_restrictions（客户端轮询依赖） ============
CREATE OR REPLACE FUNCTION public.get_user_restrictions(p_user_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_banned BOOLEAN;
  v_blacklisted BOOLEAN;
  v_muted BOOLEAN;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' OR length(p_user_name) > 128 THEN
    RETURN jsonb_build_object('is_banned', false, 'is_blacklisted', false, 'is_muted', false);
  END IF;

  SELECT COALESCE(bool_or(is_active AND (expires_at IS NULL OR expires_at > now())), false) INTO v_banned
  FROM public.bans
  WHERE user_name = p_user_name AND is_active = true;

  SELECT COALESCE(bool_or(is_active), false) INTO v_blacklisted
  FROM public.blacklist
  WHERE user_name = p_user_name AND is_active = true;

  SELECT COALESCE(bool_or(is_active AND (expires_at IS NULL OR expires_at > now())), false) INTO v_muted
  FROM public.mutes
  WHERE user_name = p_user_name AND is_active = true;

  RETURN jsonb_build_object(
    'is_banned', COALESCE(v_banned, false),
    'is_blacklisted', COALESCE(v_blacklisted, false),
    'is_muted', COALESCE(v_muted, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_restrictions(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_restrictions(TEXT) TO service_role;

-- ============ 8. cleanup_expired_cat_rate_limits search_path 硬化 ============
CREATE OR REPLACE FUNCTION public.cleanup_expired_cat_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.ai_cat_rate_limits WHERE created_at < now() - interval '1 hour';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_cat_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_cat_rate_limits() TO service_role;

COMMIT;
