-- 修复RLS：增大actor_key长度限制（聊天图片URL会超过100字符）
-- 在 Supabase SQL Editor 中执行

drop policy if exists posts_insert_all on public.posts;
create policy posts_insert_all on public.posts for insert with check (
  length(user_name) between 2 and 20
  and length(actor_key) between 6 and 500
  and length(content) <= 2000
);

drop policy if exists likes_insert_all on public.likes;
create policy likes_insert_all on public.likes for insert with check (
  length(user_name) between 2 and 20
  and length(actor_key) between 6 and 500
);

drop policy if exists comments_insert_all on public.comments;
create policy comments_insert_all on public.comments for insert with check (
  length(user_name) between 2 and 20
  and length(actor_key) between 6 and 500
  and length(content) between 1 and 500
);
