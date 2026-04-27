-- UI v2 增量补丁：不重置数据
-- 1) 补齐函数与授权
create or replace function public.increment_post_views(p_post_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.posts set views = coalesce(views, 0) + 1 where id = p_post_id;
end;
$$;

create or replace function public.delete_post_with_actor(p_post_id uuid, p_actor_key text)
returns boolean language plpgsql security definer as $$
begin
  delete from public.posts where id = p_post_id and actor_key = p_actor_key;
  return found;
end;
$$;

grant execute on function public.increment_post_views(uuid) to anon;
grant execute on function public.delete_post_with_actor(uuid, text) to anon;

-- 2) uploads 存储桶策略（若你已配置，可重复执行）
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "uploads public read" on storage.objects;
create policy "uploads public read"
on storage.objects for select
to anon
using (bucket_id = 'uploads');

drop policy if exists "uploads anon insert" on storage.objects;
create policy "uploads anon insert"
on storage.objects for insert
to anon
with check (bucket_id = 'uploads');
