-- 修复公告发布失败：posts 表缺少 title 列
-- 在 Supabase SQL Editor 中执行

alter table if exists public.posts add column if not exists title text default '';
