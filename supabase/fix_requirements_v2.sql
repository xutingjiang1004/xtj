-- ============================================================
-- 终极方案：DDL 修改强制 PostgREST 刷新缓存
-- ============================================================

-- 1. 从根上清除旧函数
drop function if exists public.delete_comment_v2;

-- 2. 对 comments 表做无害 DDL 修改（PostgREST 检测到 DDL 会自动刷新）
comment on table public.comments is 'pgrst_reload';
comment on column public.comments.content is 'pgrst_reload';

-- 3. 创建函数
create or replace function public.delete_comment_v2(p_comment_id bigint, p_deleted_by text)
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

-- 4. 给权限
grant execute on function public.delete_comment_v2(bigint, text) to anon;

-- 5. 多重通知刷新 PostgREST
notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

-- 6. 再改一次表注释以确保 DDL 变更被检测到
comment on table public.comments is 'pgrst_reload2';
comment on column public.comments.content is 'pgrst_reload2';

-- 7. 验证函数
select proname from pg_proc where proname = 'delete_comment_v2';

-- 8. 直接测试函数是否可调用
select public.delete_comment_v2(0::bigint, 'test');
