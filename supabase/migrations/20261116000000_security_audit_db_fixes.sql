-- 2026-11-16 安全审计数据库层修复（幂等，可重复执行）
--
-- 背景：Gemini 复核 2026-11-15 审计报告，确认三处数据库缺陷。本迁移只修其中
-- 两处可低风险、可验证地修复的越权/可用性问题；第三处（OSS media_url 与
-- storage_path 一致性）经评估归属已由 post_media_uploads 三重校验保证，且
-- OSS 为公开桶展示 URL、SQL 无内置与前端 encodeURIComponent 等价的函数，
-- 重写核心发帖函数的回归风险大于收益，故本迁移不改动 create_post_with_attachments。
--
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴整段 → Run。可重复执行。

BEGIN;

-- FIX 1 -------------------------------------------------------------------
-- xtj_create_comment 的 6 参签名（20261031120000_comment_replies.sql 重建）
-- 带 SECURITY DEFINER SET search_path = ''，函数体内直接调用 sha256(convert_to(...))。
-- sha256(bytea) 属于 pgcrypto，Supabase 默认装在 extensions schema；search_path 被
-- 清空后无法解析 → 所有带 p_request_id 的幂等评论报 "function sha256 does not exist"。
-- 旧修复迁移 20261028153000 只覆盖旧的 5 参 / 4 参签名，未覆盖新签名。
-- 修法：不动函数体，只反查 sha256 实际 schema 并补进函数级 search_path（同范本）。
DO $$
DECLARE crypto_schema text;
BEGIN
  SELECT n.nspname INTO crypto_schema
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'sha256'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'bytea'
  ORDER BY (n.nspname = 'extensions') DESC, (n.nspname = 'public') DESC
  LIMIT 1;
  IF crypto_schema IS NULL THEN
    RAISE EXCEPTION 'xtj_create_comment: sha256(bytea) 未找到，pgcrypto 可能未安装';
  END IF;
  IF to_regprocedure('public.xtj_create_comment(uuid,text,text,uuid,text,bigint)') IS NOT NULL THEN
    EXECUTE format(
      'ALTER FUNCTION public.xtj_create_comment(uuid,text,text,uuid,text,bigint) SET search_path = pg_catalog, %I',
      crypto_schema);
  END IF;
END $$;

-- FIX 2 -------------------------------------------------------------------
-- chat_group_detail 在 invite_policy = 'admins'（仅群主/管理员可邀请）时，
-- 仍把群邀请 token（qr_token）返回给普通成员，普通成员可直接邀请他人入群，
-- 绕过邀请策略。修法：invite_policy='admins' 且调用者非 owner/admin 时返回 NULL。
-- 其余字段与逻辑逐字保持原样（仅改 'qr_token' 一行的取值表达式）。
CREATE OR REPLACE FUNCTION public.chat_group_detail(p_actor TEXT, p_group UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me UUID := public.chat_group_user_id(p_actor); v_m public.chat_group_members; v_g public.chat_groups; v_members JSONB;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  SELECT * INTO v_m FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_me;
  IF v_m.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  SELECT * INTO v_g FROM public.chat_groups WHERE id = p_group;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_name', public.chat_group_name_of(m.user_id), 'nickname', m.nickname, 'role', m.role,
      'banned_until', CASE WHEN m.banned_until > now() THEN m.banned_until END, 'joined_at', m.joined_at,
      'active', u.is_registered AND u.deleted_at IS NULL)
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at, lower(u.user_name), m.user_id), '[]'::jsonb)
  INTO v_members FROM public.chat_group_members m JOIN public.chat_users u ON u.id = m.user_id WHERE m.group_id = p_group;
  RETURN jsonb_build_object('ok', true, 'group', jsonb_build_object(
      'id', v_g.id, 'name', v_g.name, 'owner', public.chat_group_name_of(v_g.owner_id),
      'announcement', v_g.announcement, 'announcement_by', public.chat_group_name_of(v_g.announcement_by),
      'announcement_at', v_g.announcement_at, 'mute_all', v_g.mute_all, 'join_approval', v_g.join_approval,
      'invite_policy', v_g.invite_policy,
      'qr_token', CASE WHEN v_g.invite_policy = 'admins' AND v_m.role NOT IN ('owner','admin') THEN NULL ELSE v_g.qr_token END,
      'member_limit', v_g.member_limit,
      'member_count', v_g.member_count, 'created_at', v_g.created_at, 'dissolved', v_g.dissolved_at IS NOT NULL,
      'pending_requests', CASE WHEN v_m.role IN ('owner', 'admin') THEN
        (SELECT count(*) FROM public.chat_group_join_requests r WHERE r.group_id = p_group AND r.status = 'pending') ELSE 0 END),
    'me', jsonb_build_object('role', v_m.role, 'nickname', v_m.nickname, 'muted', v_m.muted, 'pinned_at', v_m.pinned_at,
      'background', v_m.background, 'banned_until', CASE WHEN v_m.banned_until > now() THEN v_m.banned_until END,
      'joined_at', v_m.joined_at, 'cleared_at', v_m.cleared_at),
    'members', v_members);
END $$;

-- 权限保持与原迁移一致（CREATE OR REPLACE 不清除既有授权，此处显式重申以防漂移）
REVOKE ALL ON FUNCTION public.chat_group_detail(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_group_detail(text,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
