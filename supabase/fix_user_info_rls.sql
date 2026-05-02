-- 确保 posts 表有 INSERT/UPDATE/DELETE 策略（包括 __user_info__ 记录）
-- 在 Supabase SQL Editor 中执行

-- 删除可能存在的旧策略再重建，避免冲突
drop policy if exists posts_update_all on public.posts;
drop policy if exists posts_delete_all on public.posts;
drop policy if exists allow_avatar_insert on public.posts;
drop policy if exists allow_avatar_update on public.posts;
drop policy if exists allow_avatar_delete on public.posts;

-- 重新创建 INSERT 策略（扩大 actor_key 限制）
drop policy if exists posts_insert_all on public.posts;
create policy posts_insert_all on public.posts for insert with check (
  length(user_name) between 2 and 20
  and length(actor_key) between 6 and 500
  and length(content) <= 5000
);

-- 添加 UPDATE 策略
create policy posts_update_all on public.posts for update using (true);

-- 添加 DELETE 策略
create policy posts_delete_all on public.posts for delete using (true);
