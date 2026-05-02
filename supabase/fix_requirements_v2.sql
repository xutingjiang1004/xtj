-- 需求 3：评论永久保留，显示删除人
alter table public.comments add column if not exists deleted_at timestamptz;
alter table public.comments add column if not exists deleted_by text;

-- 新增软删除评论的函数（不真删，保留记录）
create or replace function public.soft_delete_comment(p_comment_id bigint, p_actor_key text, p_deleted_by text)
returns boolean
language plpgsql
security definer
as $$
declare
    v_found boolean;
begin
    update public.comments
    set deleted_at = now(),
        deleted_by = p_deleted_by
    where id = p_comment_id
      and (actor_key = p_actor_key or p_deleted_by = 'xxz')
      and deleted_at is null;
    get diagnostics v_found = found;
    return v_found;
end;
$$;

grant execute on function public.soft_delete_comment(bigint, text, text) to anon;

-- 修改 posts 表也加软删字段，以备后续扩展
alter table public.posts add column if not exists deleted_at timestamptz;
alter table public.posts add column if not exists deleted_by text;
