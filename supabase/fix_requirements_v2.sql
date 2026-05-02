-- 需求 3：评论永久保留，显示删除人

-- 1. 给 comments 表加软删除字段
alter table public.comments add column if not exists deleted_at timestamptz;
alter table public.comments add column if not exists deleted_by text;

-- 2. 给 comments 表加 UPDATE 策略（允许前端直调 .update() 做软删除，绕过 RPC 缓存问题）
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
for update using (true)
with check (true);

-- 3. 给 posts 表也加软删字段，以备后续扩展
alter table public.posts add column if not exists deleted_at timestamptz;
alter table public.posts add column if not exists deleted_by text;
