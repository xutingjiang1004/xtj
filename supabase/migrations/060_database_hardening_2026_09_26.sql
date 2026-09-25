-- 060: 2026-09-26 深度审计的数据库侧修复（权限 / 限流 TTL / 索引 / 完整性）
--
-- 来源：audit-reports/2026-09-26-全栈深度审计报告.md（P1-1、P2-11、P2-12、P2-13、P2-14、P2-16、P3-2、P3-3）
-- 全部语句幂等（IF EXISTS / IF NOT EXISTS / DO 块守卫），可安全重复执行。
--
-- ⚠ 大表注意：本文件里的 CREATE INDEX 是阻塞式建索引。若线上 posts/comments/likes
--   数据量很大，请改为在事务外单独执行对应的 CREATE INDEX CONCURRENTLY（本文件已把
--   语句逐条列出，直接复制执行即可，CONCURRENTLY 不能写在事务块内）。

BEGIN;

-- ===========================================================================
-- 1) P1-1：get_user_restrictions 绕过已收口的 RLS
--    032 只 REVOKE ... FROM PUBLIC；Supabase 对 public schema 新建函数默认授予
--    anon/authenticated 显式 EXECUTE，REVOKE FROM PUBLIC 收不回该显式授权。
--    结果：任何持公开 anon key 的人可 POST /rest/v1/rpc/get_user_restrictions
--    探测任意用户是否被封禁/拉黑/禁言（bans/blacklist/mutes 三表的 RLS 封锁被绕）。
-- ===========================================================================
REVOKE ALL ON FUNCTION public.get_user_restrictions(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_restrictions(TEXT) TO service_role;

-- 同类遗留：触发器函数（RETURNS trigger，PostgREST 不暴露，属纵深防御）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'mark_dm_media_cleanup_on_post_delete'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.mark_dm_media_cleanup_on_post_delete() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- ===========================================================================
-- 2) P2-12：atomic_increment_rate_limit 完全忽略 p_ttl_seconds
--    原实现只累加、永不重置，也没有任何清理任务覆盖 __rate_limit__ 行 →
--    某个限流键一旦达到阈值即永久锁死（正常用户被永久拒绝）。
--    改为滑动窗口：距上次更新超过 TTL 时从 1 重新计数。
-- ===========================================================================
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
  v_ttl INTEGER;
BEGIN
  IF p_media_url IS NULL OR btrim(p_media_url) = ''
     OR p_media_url !~ '^rl_[a-zA-Z0-9_-]{1,200}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Invalid rate limit key');
  END IF;

  -- TTL 归一化：至少 1 秒、至多 7 天，避免被调用方传入 0/负数导致永不重置
  v_ttl := LEAST(GREATEST(COALESCE(p_ttl_seconds, 3600), 1), 604800);

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
    -- ★ 滑窗：窗口已过则从 1 重新开始，否则原子 +1
    content = CASE
                WHEN public.posts.updated_at IS NULL
                  OR public.posts.updated_at < now() - make_interval(secs => v_ttl)
                THEN '1'
                ELSE (COALESCE(NULLIF(public.posts.content, ''), '0')::bigint + 1)::text
              END,
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

-- 兜底清理：__rate_limit__ 行超过 2 天未更新即可删除（滑动窗口下已无意义）
DELETE FROM public.posts
 WHERE media_type = '__rate_limit__'
   AND (updated_at IS NULL OR updated_at < now() - interval '2 days');

-- ===========================================================================
-- 3) P2-13：同名函数重载并存导致调用歧义（PostgREST 报 PGRST203）
--    refund_cat_comment_quota：052 的 1 参版 + 053 的 3 参（带默认值）版，
--      1 参调用两候选都匹配 → 退还配额静默失败（server.js 的降级分支正是 1 参调用）。
--    set_ai_user_pro：045 的 5 参版 + 049 的 10 参（带默认值）版，2-5 参调用歧义。
--    删除旧签名后，1 参/5 参调用会自动落到带默认值的新版本，行为更正确。
-- ===========================================================================
DO $$
BEGIN
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.refund_cat_comment_quota(text)';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[060] 无法删除 refund_cat_comment_quota(text)：%', SQLERRM;
  END;
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.set_ai_user_pro(text, boolean, timestamptz, text, text)';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[060] 无法删除 set_ai_user_pro(5 参旧签名)：%', SQLERRM;
  END;
END $$;

-- ===========================================================================
-- 4) P2-11：6 张表只有 RLS deny-all，缺少显式收权（纵深防御）
--    一旦新增宽松策略或 RLS 被误关，anon 立刻可读写 AI 流式会话与源码索引。
-- ===========================================================================
DO $$
DECLARE
  t TEXT;
  tbls TEXT[] := ARRAY[
    'ai_stream_sessions', 'ai_stream_events',
    'code_workspaces', 'code_index_files', 'code_index_chunks', 'code_index_builds'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- 序列收权（anon 可 nextval/setval 扰动自增）
DO $$
DECLARE
  s TEXT;
  seqs TEXT[] := ARRAY['ai_stream_events_id_seq', 'brain_nodes_id_seq', 'ai_jobs_id_seq'];
BEGIN
  FOREACH s IN ARRAY seqs LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname = s) THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated', s);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', s);
    END IF;
  END LOOP;
END $$;

-- ===========================================================================
-- 5) P2-16：热点查询缺索引
--    信息流、评论、点赞、封禁查询目前都会顺序扫描/排序。
--    （大表请在事务外改用 CREATE INDEX CONCURRENTLY）
-- ===========================================================================
CREATE INDEX IF NOT EXISTS idx_posts_created_at_id       ON public.posts (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_feed_created        ON public.posts (created_at DESC)
  WHERE is_deleted IS NOT TRUE AND (visibility IS NULL OR visibility = 'public');
CREATE INDEX IF NOT EXISTS idx_comments_post_created     ON public.comments (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_user_created     ON public.comments (user_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_user_created        ON public.likes (user_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bans_user_active          ON public.bans (user_name) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_blacklist_user_active     ON public.blacklist (user_name) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_mutes_user_active         ON public.mutes (user_name) WHERE is_active;

-- ===========================================================================
-- 6) P3-3：increment_post_views 返回 INTEGER 而 posts.views 是 BIGINT，
--    浏览量超 21 亿会抛 numeric value out of range。改返回类型必须 DROP + CREATE。
--    （逻辑与 059 完全一致，仅返回类型改为 BIGINT，并保持同一最小权限集）
-- ===========================================================================
DROP FUNCTION IF EXISTS public.increment_post_views(uuid);
CREATE FUNCTION public.increment_post_views(p_post_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_views BIGINT;
BEGIN
  UPDATE public.posts
     SET views = COALESCE(views, 0) + 1
   WHERE id = p_post_id
     AND (media_type IS NULL OR media_type NOT LIKE '\_\_%' ESCAPE '\')
     AND (visibility IS NULL OR visibility = 'public')
  RETURNING views INTO v_views;

  RETURN COALESCE(v_views, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.increment_post_views(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_views(uuid) TO service_role;

-- ===========================================================================
-- 7) P2-14：完整性约束（全部用 NOT VALID，只约束新写入，不阻塞迁移）
-- ===========================================================================
DO $$
BEGIN
  -- posts.visibility 枚举收敛（拼写错误会让内容既读不到也解释不清）
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_visibility_check') THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_visibility_check
      CHECK (visibility IS NULL OR visibility IN ('public', 'private', 'unlisted')) NOT VALID;
  END IF;

  -- posts.views 非负
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_views_nonneg_check') THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_views_nonneg_check CHECK (views IS NULL OR views >= 0) NOT VALID;
  END IF;

  -- likes / comments 缺外键，删帖不级联只能靠应用层手工 DELETE（孤儿点赞/评论）
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'likes_post_id_fkey') THEN
    ALTER TABLE public.likes
      ADD CONSTRAINT likes_post_id_fkey FOREIGN KEY (post_id)
      REFERENCES public.posts(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_post_id_fkey') THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id)
      REFERENCES public.posts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- ===========================================================================
-- 8) P2-14：邀请码大小写变体可绕 max_uses（查找用 upper(code)，主键却是大小写敏感）
--    先探测重复，存在重复只告警不建索引，避免迁移失败。
-- ===========================================================================
DO $$
DECLARE
  v_dup INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_invite_codes') THEN
    SELECT count(*) INTO v_dup FROM (
      SELECT upper(code) FROM public.ai_invite_codes GROUP BY upper(code) HAVING count(*) > 1
    ) d;
    IF v_dup = 0 THEN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ai_invite_codes_upper_uniq ON public.ai_invite_codes (upper(code))';
    ELSE
      RAISE WARNING '[060] ai_invite_codes 存在 % 组大小写重复码，未创建 upper(code) 唯一索引；请先人工去重', v_dup;
    END IF;
  END IF;
END $$;

-- ===========================================================================
-- 9) P2-14：cron 清理 __rate_limit__ 行（pg_cron 可用时注册，每小时一次）
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xtj-cleanup-rate-limit-rows') THEN
      PERFORM cron.schedule('xtj-cleanup-rate-limit-rows', '17 * * * *',
        $cron$DELETE FROM public.posts WHERE media_type = '__rate_limit__' AND updated_at < now() - interval '2 days'$cron$);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[060] 注册 rate_limit 清理任务失败（不影响其他修复）：%', SQLERRM;
END $$;

COMMIT;

-- ===========================================================================
-- 验收（部署后执行）
-- ===========================================================================
-- 1) 函数权限：proacl 中不得出现 anon / authenticated
--    SELECT proname, proacl FROM pg_proc
--     WHERE proname IN ('get_user_restrictions','atomic_increment_rate_limit','increment_post_views');
-- 2) 重载是否已收敛为单签名
--    SELECT p.proname, pg_get_function_identity_arguments(p.oid) FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname='public' AND p.proname IN ('set_ai_user_pro','refund_cat_comment_quota');
-- 3) 限流窗口是否生效
--    SELECT public.atomic_increment_rate_limit('rl_test_window', 'system', 60);
--    -- 立即重复调用 count 递增；>60 秒后再调用应回到 1
-- 4) 索引是否建立
--    SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('posts','comments','likes','bans','mutes','blacklist');
