-- ============================================================
-- comments.id 是 UUID 类型！！！全部改 uuid
-- ============================================================

-- 1. 清除旧函数
drop function if exists public.delete_comment_v2(bigint, text);
drop function if exists public.delete_comment_v2;

-- 2. 创建函数 p_comment_id 用 uuid
create or replace function public.delete_comment_v2(p_comment_id uuid, p_deleted_by text)
returns boolean
language plpgsql
security definer as $$
declare
    v_original_content text;
    v_new_content text;
begin
    select content into v_original_content
    from public.comments
    where id = p_comment_id;

    if not found then
        return false;
    end if;

    if v_original_content like '__DELETED_BY_%' then
        return false;
    end if;

    v_new_content := '__DELETED_BY_' || p_deleted_by || '__' || v_original_content;

    update public.comments
    set content = v_new_content
    where id = p_comment_id;

    return true;
end;
$$;

-- 3. 给权限（注意参数类型是 uuid, text）
grant execute on function public.delete_comment_v2(uuid, text) to anon;

-- 4. 刷新 PostgREST
notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

-- 5. 验证
select proname, pronargs, pg_get_function_arguments(oid)
from pg_proc
where proname = 'delete_comment_v2';
