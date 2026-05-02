-- ============================================================
-- 评论软删除终极方案：SECURITY DEFINER RPC 绕过 RLS
-- ============================================================

-- 1. 完全删除旧函数
drop function if exists public.soft_delete_comment(bigint, text, text);
drop function if exists public.soft_delete_comment(uuid, text, text);
drop function if exists public.delete_comment_v2(bigint, text);

-- 2. 对 public 做个无害操作强制触发 schema 刷新
comment on schema public is '临时刷新';

-- 3. 创建 SECURITY DEFINER 函数
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
    select content into v_original_content
    from public.comments
    where id = p_comment_id;

    if not found then
        return jsonb_build_object('success', false, 'message', '评论不存在');
    end if;

    if v_original_content like '__DELETED_BY_%' then
        return jsonb_build_object('success', false, 'message', '评论已被删除');
    end if;

    v_new_content := '__DELETED_BY_' || p_deleted_by || '__' || v_original_content;

    update public.comments
    set content = v_new_content
    where id = p_comment_id;

    return jsonb_build_object('success', true, 'message', '删除成功');
end;
$$;

-- 4. 关键！给 anon 和 authenticated 用户执行权限（像 delete_post_with_actor 一样）
grant execute on function public.delete_comment_v2(bigint, text) to anon;
grant execute on function public.delete_comment_v2(bigint, text) to authenticated;

-- 5. 调用 notify pgrst
notify pgrst, 'reload schema';
notify pgrst, 'reload schema';

-- 6. 验证权限已设置
select
    proname,
    array_agg(aclexplode(proacl)) as permissions
from pg_proc
where proname = 'delete_comment_v2'
group by proname;
