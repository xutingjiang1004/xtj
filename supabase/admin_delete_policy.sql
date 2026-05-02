-- 管理后台删除权限：security definer 函数绕过 RLS
-- 在 Supabase SQL Editor 中执行此脚本

create or replace function public.admin_delete_post(p_post_id uuid)
returns boolean language plpgsql security definer as $$
begin
  delete from public.posts where id = p_post_id;
  return found;
end;
$$;

grant execute on function public.admin_delete_post(uuid) to anon;
