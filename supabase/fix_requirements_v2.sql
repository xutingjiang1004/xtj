-- ============================================================
-- 评论软删除：完全照搬 delete_post_with_actor 的写法
-- ============================================================

-- 1. 彻底删除旧函数（确保 PostgREST 重新识别）
drop function if exists public.delete_comment_v2(bigint, text);
drop function if exists public.delete_comment_v2;

-- 2. 完全照着 delete_post_with_actor 写
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

-- 3. 完全照着 delete_post_with_actor 给权限
grant execute on function public.delete_comment_v2(bigint, text) to anon;

-- 4. 彻底刷新 PostgREST
notify pgrst, 'reload schema';
notify pgrst, 'reload schema';

-- 5. 验证函数存在
select proname from pg_proc where proname = 'delete_comment_v2';
