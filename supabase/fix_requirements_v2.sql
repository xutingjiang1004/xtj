-- 需求 2+3：给 comments 表加 UPDATE 策略 + 清理旧函数/旧列

-- 1. 删除旧的 RPC 函数（避免缓存干扰）
drop function if exists public.soft_delete_comment(bigint, text, text);
drop function if exists public.soft_delete_comment(uuid, text, text);

-- 2. 创建 UPDATE 策略（允许前端直调 .update() 做软删除）
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
for update
using (true)
with check (true);

-- 3. 确认策略已生效（执行后查看结果）
select policyname, cmd from pg_policies where tablename = 'comments';
