-- ============================================================
-- 评论软删除终极方案：SECURITY DEFINER RPC 绕过 RLS
-- ============================================================

-- 1. 删除旧的 RPC 函数（避免命名冲突和缓存干扰）
drop function if exists public.soft_delete_comment(bigint, text, text);
drop function if exists public.soft_delete_comment(uuid, text, text);
drop function if exists public.delete_comment_v2(bigint, text);

-- 2. 创建 SECURITY DEFINER 函数，绕过 RLS 直接更新
create or replace function public.delete_comment_v2(
    p_comment_id bigint,
    p_deleted_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_original_content text;
    v_new_content text;
begin
    -- 查询原始内容
    select content into v_original_content
    from public.comments
    where id = p_comment_id;

    if not found then
        return jsonb_build_object('success', false, 'message', '评论不存在');
    end if;

    -- 检查是否已删除
    if v_original_content like '__DELETED_BY_%' then
        return jsonb_build_object('success', false, 'message', '评论已被删除');
    end if;

    -- 构建软删除标记
    v_new_content := '__DELETED_BY_' || p_deleted_by || '__' || v_original_content;

    -- 直接更新（security definer 绕过 RLS）
    update public.comments
    set content = v_new_content
    where id = p_comment_id;

    return jsonb_build_object('success', true, 'message', '删除成功');
end;
$$;

-- 3. 刷新 PostgREST 缓存
notify pgrst, 'reload schema';

-- 4. 验证函数已创建
select proname, prosrc from pg_proc where proname = 'delete_comment_v2';
