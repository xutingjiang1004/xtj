-- =====================================================================
-- Migration 039: 安全加固（第二阶段）— 补齐审查发现的高危缺口
-- 1. likes / comments / bans 从未启用 RLS → anon 可全表读取私密帖下的
--    点赞/评论与封禁记录。启用 RLS，并通过"仅公开帖"策略保留匿名读。
-- 2. ai_stream_sessions.stream_id 缺唯一约束 → 断线重连可能命中错误会话。
-- 3. provider_registry / user_model_preferences 未 REVOKE PUBLIC（037 只
--    撤销了 anon/authenticated，历史上对 PUBLIC 的授权残留未被收回）。
-- 4. dm_media_uploads.message_id ON DELETE SET NULL → 已删私信的媒体成为
--    存储孤儿，永不进入清理队列 → 补 AFTER DELETE 触发器转 cleanup_pending。
-- 5. delete_comment_v2 完全忽略 p_deleted_by → 至少要求非空操作者身份。
-- 6. 持久化限流（036）只有索引没有原子自增 → 补原子 RPC（fail-closed）。
-- 7. 清理函数只定义无调度 → 在 pg_cron 可用时注册定时清理。
-- 8. 安全说明：posts.visibility IS NULL 视为公开（015/016b 语义）属
--    "failing open"，收紧为显式 'public' 需产品决策，本迁移不擅自改动。
-- =====================================================================

BEGIN;

-- ============ 1. likes / comments / bans RLS 补齐 ============
-- 用守卫包裹：任一表缺失时跳过该项而非回滚整个迁移
DO $$
BEGIN
  IF to_regclass('public.likes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE public.likes FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.likes TO service_role';
    EXECUTE 'DROP POLICY IF EXISTS likes_read_public ON public.likes';
    EXECUTE 'CREATE POLICY likes_read_public ON public.likes FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = likes.post_id AND p.is_deleted IS NOT TRUE AND (p.visibility IS NULL OR p.visibility = ''public'')))';
  END IF;

  IF to_regclass('public.comments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE public.comments FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.comments TO service_role';
    EXECUTE 'DROP POLICY IF EXISTS comments_read_public ON public.comments';
    EXECUTE 'CREATE POLICY comments_read_public ON public.comments FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = comments.post_id AND p.is_deleted IS NOT TRUE AND (p.visibility IS NULL OR p.visibility = ''public'')))';
  END IF;

  IF to_regclass('public.bans') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.bans ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.bans FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.bans TO service_role';
  END IF;
END $$;

-- 序列（comments.id / likes.id 若为 serial 需要）
DO $$
DECLARE
  v_seq TEXT;
BEGIN
  FOREACH v_seq IN ARRAY ARRAY['comments_id_seq','likes_id_seq','bans_id_seq'] LOOP
    IF to_regclass('public.' || v_seq) IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', v_seq);
    END IF;
  END LOOP;
END $$;

-- ============ 2. ai_stream_sessions.stream_id 唯一约束 ============
DO $$
BEGIN
  IF to_regclass('public.ai_stream_sessions') IS NOT NULL THEN
    -- 先去重（保留每个 stream_id 最新一条），再建唯一索引
    EXECUTE 'DELETE FROM public.ai_stream_sessions a USING public.ai_stream_sessions b WHERE a.stream_id = b.stream_id AND a.created_at < b.created_at';
    EXECUTE 'DELETE FROM public.ai_stream_sessions a USING public.ai_stream_sessions b WHERE a.stream_id = b.stream_id AND a.created_at = b.created_at AND a.id < b.id';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_sessions_stream_id_unique ON public.ai_stream_sessions (stream_id)';
  END IF;
END $$;

-- ============ 3. provider_registry 系列补 REVOKE PUBLIC ============
REVOKE ALL ON TABLE public.provider_registry FROM PUBLIC;
REVOKE ALL ON TABLE public.user_model_preferences FROM PUBLIC;

-- ============ 4. dm_media_uploads 清理触发器（已删私信媒体入队） ============
DO $$
BEGIN
  IF to_regclass('public.dm_media_uploads') IS NOT NULL AND to_regclass('public.posts') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.mark_dm_media_cleanup_on_post_delete()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $b$
      BEGIN
        IF OLD.media_type = '__dm__' THEN
          UPDATE public.dm_media_uploads
             SET status = 'cleanup_pending', updated_at = now()
           WHERE message_id = OLD.id
             AND status IN ('uploaded', 'sending', 'attached');
        END IF;
        RETURN OLD;
      END;
      $b$;
    $fn$;
    EXECUTE 'DROP TRIGGER IF EXISTS trg_dm_media_cleanup_on_post_delete ON public.posts';
    EXECUTE 'CREATE TRIGGER trg_dm_media_cleanup_on_post_delete AFTER DELETE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.mark_dm_media_cleanup_on_post_delete()';
  END IF;
END $$;

-- ============ 5. delete_comment_v2：要求非空操作者身份 ============
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.delete_comment_v2(
        p_comment_id BIGINT,
        p_deleted_by TEXT
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $b$
      DECLARE
        v_deleted BIGINT[] := ARRAY[]::BIGINT[];
        v_exists BOOLEAN;
      BEGIN
        IF p_comment_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Comment id required');
        END IF;
        -- ★ 加固：操作者身份必填，禁止"无身份"调用按 id 删除任意评论。
        -- 本 RPC 仅 service_role 可达（032 已 REVOKE），服务端管理路由
        -- 必须透传已认证的管理员用户名；"管理员删他人评论"属后续演进
        -- （可扩展 p_is_admin 参数）。
        IF p_deleted_by IS NULL OR btrim(p_deleted_by) = '' THEN
          RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Operator identity is required');
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
      $b$;
    $fn$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.delete_comment_v2(BIGINT, TEXT) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.delete_comment_v2(BIGINT, TEXT) TO service_role';
  END IF;
END $$;

-- ============ 6. 原子限流自增 RPC（fail-closed） ============
-- 036 只建了部分唯一索引，真正的计数仍是应用层读-改-写 CAS（重试耗尽即放行）。
-- 本 RPC 用单条 INSERT ... ON CONFLICT ... DO UPDATE 完成原子递增；
-- 调用方（server.js checkPersistentRateLimit）应迁移到本 RPC，重试不再 fail-open。
CREATE OR REPLACE FUNCTION public.atomic_increment_rate_limit(
  p_media_url TEXT,
  p_user_name TEXT DEFAULT '',
  p_ttl_seconds INTEGER DEFAULT 3600
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count BIGINT;
BEGIN
  IF p_media_url IS NULL OR btrim(p_media_url) = ''
     OR p_media_url !~ '^rl_[a-zA-Z0-9_-]{1,200}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Invalid rate limit key');
  END IF;

  INSERT INTO public.posts (user_name, content, media_type, media_url, actor_key, visibility, is_deleted)
  VALUES (
    COALESCE(NULLIF(p_user_name, ''), '__system__'),
    '1',
    '__rate_limit__',
    p_media_url,
    'rl',
    'private',
    false
  )
  ON CONFLICT (media_url) WHERE media_type = '__rate_limit__'
    AND media_url IS NOT NULL
    AND media_url ~ '^rl_[a-zA-Z0-9_-]{1,200}$'
  DO UPDATE SET
    content = (COALESCE(NULLIF(public.posts.content, ''), '0')::bigint + 1)::text,
    updated_at = now()
  RETURNING content INTO v_new_count;

  RETURN jsonb_build_object('ok', true, 'count', v_new_count);
EXCEPTION
  WHEN OTHERS THEN
    -- fail-closed：计数失败时让调用方按"已超限"处理而非放行
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limit_error', 'count', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_increment_rate_limit(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_increment_rate_limit(TEXT, TEXT, INTEGER) TO service_role;

-- ============ 7. 清理调度（pg_cron 可用时注册，每小时清理过期数据） ============
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- 幂等：已存在同名 job 先删再建（PERFORM 不支持 WHERE，用 IF EXISTS 包裹）
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xtj-cleanup-expired-rate-limits') THEN
      PERFORM cron.unschedule('xtj-cleanup-expired-rate-limits');
    END IF;
    -- ★ 内层用 $job$ 定界符：与外层 DO $$ 区分，避免美元引号提前闭合导致语法错误
    PERFORM cron.schedule('xtj-cleanup-expired-rate-limits', '0 * * * *',
      $job$SELECT public.cleanup_expired_cat_rate_limits()$job$);

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xtj-expire-stream-sessions') THEN
      PERFORM cron.unschedule('xtj-expire-stream-sessions');
    END IF;
    PERFORM cron.schedule('xtj-expire-stream-sessions', '*/5 * * * *',
      $job$SELECT public.expire_stream_sessions()$job$);
  END IF;
END $$;

-- ============ 8. 一致性说明（不修改，仅记录） ============
-- posts.visibility IS NULL 视为公开的语义保留（历史数据迁移属产品决策）。
-- 头像写权限已在 032 收口（anon 直写移除，改走 /api/avatar service_role），
-- 016b 遗留的空壳策略 avatar_insert_own 已由 032 DROP。

COMMIT;
