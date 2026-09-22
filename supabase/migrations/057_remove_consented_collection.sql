-- ============================================================================
-- 057_remove_consented_collection.sql
-- 2026-09-22 合规整改：通讯录 / 剪贴板采集功能【整体移除】
-- ============================================================================
-- 背景：DATA_COLLECTION_COMPLIANCE.js 明确规定
--   ① 通讯录 → 「不采集（禁止）：任何代码路径均不得发起联系人权限请求」
--   ② 剪贴板 → 「读取后不缓存」
-- 而实现曾把两者持久化进 __user_info__.content（各保留 20 份历史）并供管理后台
-- 明文查看，与声明直接冲突。
--
-- 配套代码改动（同一批提交）：
--   · render-api/server.js：删除 POST /api/user/consented-data、
--     GET/DELETE /admin/clipboard-data，并从 USER_INFO_ALLOWED_KEYS 与
--     /admin/user-data 聚合中移除相关字段
--   · js/admin/admin.js + admin.html：移除「用户剪贴板」标签页与用户详情区块
--   · js/login-device.js：移除 window.xtjImportContacts / xtjUploadClipboard
--   · tests：把相关契约测试改为「不得回归」断言
--
-- 本迁移负责服务端数据面的两件事：
--   1) 物理清除历史库中已存在的这两类数据（用户撤回授权后不应继续留存）；
--   2) 从 merge_user_info 的字段白名单中剔除这 4 个键，使任何调用路径都无法再写入
--      （纵深防御：应用层已同步收口，此处为数据库侧兜底）。
--
-- 幂等设计：可重复执行；无数据时只输出 NOTICE。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 清除已存的通讯录 / 剪贴板数据
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_keys CONSTANT text[] := ARRAY[
    'consented_contacts', 'consented_contacts_history',
    'consented_clipboard', 'consented_clipboard_history'
  ];
  v_row RECORD;
  v_content JSONB;
  v_next JSONB;
  v_hit INTEGER := 0;
  v_key TEXT;
BEGIN
  IF to_regclass('public.posts') IS NULL THEN
    RAISE NOTICE '[057] posts 表不存在，跳过数据清除';
    RETURN;
  END IF;

  -- 用 LIKE 预筛，避免对非 JSON 的历史脏数据直接做 ::jsonb 转换
  FOR v_row IN
    SELECT id, content FROM public.posts
    WHERE media_type = '__user_info__'
      AND content IS NOT NULL
      AND (content LIKE '%consented_contacts%' OR content LIKE '%consented_clipboard%')
  LOOP
    BEGIN
      v_content := v_row.content::jsonb;
    EXCEPTION WHEN others THEN
      RAISE NOTICE '[057] 跳过无法解析为 JSON 的行 id=%', v_row.id;
      CONTINUE;
    END;

    IF jsonb_typeof(v_content) <> 'object' THEN
      CONTINUE;
    END IF;

    v_next := v_content;
    FOREACH v_key IN ARRAY v_keys LOOP
      v_next := v_next - v_key;
    END LOOP;

    IF v_next IS DISTINCT FROM v_content THEN
      UPDATE public.posts SET content = v_next::text WHERE id = v_row.id;
      v_hit := v_hit + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[057] 已清除 % 行 __user_info__ 中的通讯录/剪贴板数据', v_hit;
END $$;

-- ----------------------------------------------------------------------------
-- 2. merge_user_info：从白名单中剔除这 4 个键
--    （函数体与 055 相同，仅 v_allowed_keys 收窄）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_user_info(
  p_user_name TEXT,
  p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- ★ 057：白名单已剔除 consented_contacts / consented_clipboard 及其 history。
  --   与 render-api/server.js 的 USER_INFO_ALLOWED_KEYS 保持一致。
  v_allowed_keys CONSTANT text[] := ARRAY[
    'email', 'last_visit', 'last_login', 'last_device', 'last_device_id', 'last_ip',
    'last_ip_location', 'precise_location_history', 'last_precise_location'
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

  -- 仅放行白名单内的键（纵深防御；render-api 调用前已做过同一过滤）。
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

-- ----------------------------------------------------------------------------
-- 3. 自检：白名单应不再包含这两个采集字段
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'merge_user_info'
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE NOTICE '[057] 未找到 merge_user_info，跳过自检';
  ELSIF v_def LIKE '%consented_contacts%' OR v_def LIKE '%consented_clipboard%' THEN
    RAISE WARNING '[057] merge_user_info 白名单中仍含 consented_* 字段，请检查';
  ELSE
    RAISE NOTICE '[057] 自检通过：merge_user_info 白名单已不含 consented_contacts / consented_clipboard';
  END IF;
END $$;
