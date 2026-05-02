-- 需求 2+3：给 comments 表加 UPDATE 策略（允许前端做软删除）
-- 删除标记直接编码在 content 字段里，格式：__DELETED_BY_用户名__原始内容
-- 这样不需要新增任何列，彻底绕过 PostgREST 缓存问题

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
for update using (true)
with check (true);
