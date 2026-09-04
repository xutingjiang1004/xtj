-- ============================================================================
-- 055 审计修复（2026-09-04，对应 2026-09-03 全量代码审计报告）
-- ----------------------------------------------------------------------------
-- 覆盖项（均以"不破坏现有行为 / 最小 diff / 幂等可重跑"为前提）：
--
--  [M64] 035 posts_userinfo_self_read（__user_info__ 自读）依赖 JWT 声明匹配、
--        无任何认证会话兜底 → 补充 AND auth.uid() IS NOT NULL。
--        ※ posts 表只有 user_name（XTJ 应用身份），无 auth.users 关联列，
--          无法做到 user_id = auth.uid() 的强收敛；此处仅显式要求"必须处于
--          Supabase 已认证会话"，并注释说明深层收敛（为 __user_info__ 行冗余
--          auth uid 列）需业务窗口排期，不在本次加列。
--        032 中的 code_workspaces / code_index_files / code_index_chunks /
--        code_index_builds / ai_stream_sessions / ai_stream_events 自读策略
--        已含 user_id = auth.uid()::text 分支（uuid 兜底），不再重复重建。
--
--  [M66] 032/039 delete_comment_v2 仅校验 p_deleted_by 非空、不校验 owner，
--        任何获得该 RPC 授权的调用方都可按 id 删除任意评论。
--        依据 039 注释预留的方向（"可扩展 p_is_admin 参数"），新增第三可选
--        参数 p_is_admin BOOLEAN DEFAULT false：删除者必须是评论作者、该评论
--        所属帖子的作者、或携带 p_is_admin=true 的管理员标记。
--
--        ⚠️ 部署联动（必读）：现有唯一调用方 render-api/server.js:8785
--        （DELETE /admin/comment/:id，p_deleted_by=ADMIN_USERNAME）只传两个
--        命名参数，省略 p_is_admin → DB 取默认 false → 管理员删除【他人】评论
--        将返回 forbidden。必须在发布本迁移的同一批次把该调用改为
--            { p_comment_id, p_deleted_by, p_is_admin: true }
--        （管理员身份已由服务端 verifyToken 认证）。在 server.js 更新完成前
--        请勿先行应用本迁移，否则管理端删他人评论功能会短暂失效。
--        普通用户删除自己评论走数据 API 直删（server.js:10134 带 user_name
--        条件），不经过本 RPC，不受影响。
--
--  [M67] 014 merge_user_info 信任调用方传入任意 JSON patch 键，无字段白名单，
--        可能把 emails/phones/位置轨迹等敏感键合并进 __user_info__.content。
--        现与 render-api/server.js USER_INFO_ALLOWED_KEYS（1898-1903）保持
--        完全一致的 14 键白名单，仅允许合并服务端已知业务键。RPC 仅 service_role
--        可达、且 render-api 在调用前已绑定会话身份（p_user_name 取自登录态），
--        白名单是纵深防御，两端必须同步演进。
--
--  [L ] 005 遗留 bans_authenticated_read USING(true) 策略：039 已 ENABLE RLS +
--        REVOKE anon/authenticated，该策略目前"无表权限配合"形同虚设，但若
--        未来重新 GRANT SELECT 会立即全表放行 → 显式 DROP。
--
--  [L ] 仍带 ", pg_temp" 后缀的现役 SECURITY DEFINER 函数（claim_pro_gift_for_user
--        / set_post_pin / increment_post_views）统一收口 search_path 为
--        "pg_catalog, public"（pg_catalog 内置函数优先、public 表显式限定，
--        与本仓库最新迁移 039-054 的惯例一致）。merge_user_info / delete_comment_v2
--        在本次重建时直接采用该 search_path。
--        ※ 其余函数（039-054 等）已是 SET search_path = public，PostgreSQL 隐式
--          将 pg_catalog 置于搜索首位的语义等价于 pg_catalog, public，无需改动。
--
--  [L ] 邀请码明文主键的撞库/扫描面：043/044 以 code 明文为主键，validate/redeem
--        用 upper(code) 大小写不敏感匹配 → 无法走主键索引，逐请求全表扫。
--        本次仅补函数索引（不改列类型/不迁移存量，涉及 FK 与历史数据回放，
--        需业务窗口）；明文 PK 改造建议见文件尾注释。
--
-- 本文件可用 Supabase SQL Editor / psql 重复执行（所有 DDL 均幂等）。
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. [M64] __user_info__ 自读策略：要求已认证会话（auth.uid() IS NOT NULL）
-- ============================================================================
DROP POLICY IF EXISTS posts_userinfo_self_read ON public.posts;

CREATE POLICY posts_userinfo_self_read ON public.posts
FOR SELECT TO authenticated
USING (
  media_type = '__user_info__'
  AND user_name IS NOT NULL
  AND auth.uid() IS NOT NULL
  AND (
    user_name = NULLIF(auth.jwt() ->> 'user_name', '')
    OR user_name = NULLIF(auth.jwt() ->> 'username', '')
    OR user_name = NULLIF(auth.jwt() -> 'app_metadata' ->> 'user_name', '')
    OR user_name = NULLIF(auth.jwt() -> 'app_metadata' ->> 'username', '')
  )
);

-- ============================================================================
-- 2. [M66] delete_comment_v2：owner/admin 校验
-- ============================================================================
DROP FUNCTION IF EXISTS public.delete_comment_v2(BIGINT, TEXT);

CREATE OR REPLACE FUNCTION public.delete_comment_v2(
  p_comment_id BIGINT,
  p_deleted_by TEXT,
  p_is_admin BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_comment RECORD;
  v_post_owner TEXT;
  v_deleted BIGINT[] := ARRAY[]::BIGINT[];
BEGIN
  IF p_comment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Comment id required');
  END IF;
  -- 加固（保留 039 语义）：操作者身份必填，禁止"无身份"调用按 id 删除任意评论。
  IF p_deleted_by IS NULL OR btrim(p_deleted_by) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Operator identity is required');
  END IF;

  SELECT c.id, c.user_name, c.post_id
    INTO v_comment
  FROM public.comments c
  WHERE c.id = p_comment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Comment not found');
  END IF;

  -- ★ 055 加固：删除者必须是「评论作者」或「评论所属帖子的作者」，
  --   或携带 p_is_admin=true 的管理员标记（管理员身份由服务端 verifyToken 认证后透传）。
  --   子回复删除沿用原语义：WHERE id = p_comment_id OR parent_comment_id = p_comment_id，
  --   授权以被删目标主评论的归属为准，不会误删其它评论。
  SELECT p.user_name INTO v_post_owner
  FROM public.posts p
  WHERE p.id = v_comment.post_id;

  IF NOT (COALESCE(p_is_admin, false)
          OR btrim(p_deleted_by) = COALESCE(v_comment.user_name, '')
          OR btrim(p_deleted_by) = COALESCE(v_post_owner, '')) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'forbidden', 'error',
      'Deleter must be the comment author, the post author, or an admin'
    );
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

REVOKE ALL ON FUNCTION public.delete_comment_v2(BIGINT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_comment_v2(BIGINT, TEXT, BOOLEAN) TO service_role;

-- ============================================================================
-- 3. [M67] merge_user_info：字段白名单（与 render-api server.js 完全一致）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.merge_user_info(
  p_user_name TEXT,
  p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- 白名单与 render-api/server.js USER_INFO_ALLOWED_KEYS（约 1898-1903 行）保持一致。
  -- 白名单之外的键一律拒绝合并（含 emails / phones / GPS 轨迹等敏感键——
  -- 它们本就不该被业务写入 __user_info__.content）。
  v_allowed_keys CONSTANT text[] := ARRAY[
    'email', 'last_visit', 'last_login', 'last_device', 'last_device_id', 'last_ip',
    'last_ip_location', 'precise_location_history', 'last_precise_location',
    'consented_contacts', 'consented_contacts_history',
    'consented_clipboard', 'consented_clipboard_history'
  ];
  v_patch JSONB := '{}'::jsonb;
  v_content JSONB;
  v_key TEXT;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' OR length(p_user_name) > 100 THEN
    RAISE EXCEPTION 'invalid user name';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid user info patch';
  END IF;

  -- ★ 055 加固：仅放行白名单内的键（纵深防御；render-api 调用前已做过同一过滤）。
  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF v_key = ANY (v_allowed_keys) THEN
      v_patch := v_patch || jsonb_build_object(v_key, p_patch->v_key);
    END IF;
  END LOOP;

  INSERT INTO public.posts (user_name, media_type, content, actor_key)
  VALUES (p_user_name, '__user_info__', v_patch::TEXT, 'user_info_' || md5(p_user_name))
  ON CONFLICT (user_name) WHERE media_type = '__user_info__'
  DO UPDATE SET content = (xtj_private.safe_jsonb(public.posts.content) || v_patch)::TEXT
  RETURNING content::JSONB INTO v_content;

  -- patch 被白名单全部滤掉时 v_patch = '{}'，合并结果与原值一致（幂等，不新增敏感键）。
  RETURN v_content;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_user_info(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_user_info(TEXT, JSONB) TO service_role;

-- ============================================================================
-- 4. [L] 清理 005 遗留的 bans USING(true) 策略（039 已收权限，策略本身作废）
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.bans') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS bans_authenticated_read ON public.bans';
  END IF;
END $$;

-- ============================================================================
-- 5. [L] 现役 SECURITY DEFINER 函数 search_path 统一收口（去掉 ", pg_temp"）
--       使用 ALTER FUNCTION 只改属性、不重写函数体，幂等可重跑。
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'claim_pro_gift_for_user'
      AND pg_get_function_identity_arguments(p.oid) = 'text, uuid'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.claim_pro_gift_for_user(text, uuid) SET search_path = pg_catalog, public';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_post_pin'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, text, boolean, boolean'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.set_post_pin(uuid, text, boolean, boolean) SET search_path = pg_catalog, public';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'increment_post_views'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.increment_post_views(uuid) SET search_path = pg_catalog, public';
  END IF;
END $$;

-- ============================================================================
-- 6. [L] 邀请码大小写不敏感查询的索引支持（043/044 的 upper(code) 无法走主键）
--       仅补索引，不迁移存量。表缺失（如尚未应用 043）时跳过。
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.ai_invite_codes') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_invite_codes_code_upper_idx ON public.ai_invite_codes (upper(code))';
  END IF;
  IF to_regclass('public.ai_invite_redemptions') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_invite_redemptions_code_upper_user_idx ON public.ai_invite_redemptions (upper(code), user_name)';
  END IF;
END $$;

-- ============================================================================
-- 备注（不执行）：邀请码改造建议（需业务窗口）
--   * ai_invite_codes.code / ai_invite_redemptions.code 现为明文 text PK/FK，
--     若存量激活码可被撞库枚举（尤其 043 时代 code_length 低时），建议后续
--     迁移：改为 hash 存储（如 sha256(upper(code)) 列）或引入随机高熵前缀，
--     同时配合服务端将生成码最小长度提升到 >= 8（对应审计 M28）。
--   * 涉及存量数据回放与 ai_invite_redemptions 外键，须由业务排期执行，
--     本次只写索引与建议，不强行改类型。
-- ============================================================================

COMMIT;
