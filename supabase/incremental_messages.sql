-- 增量更新：创建私信 messages 表
-- 在 Supabase SQL Editor 中执行此脚本

-- 1) 创建 messages 表
create table if not exists public.messages (
  id bigserial primary key,
  sender_name text not null,
  receiver_name text not null,
  content text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) 创建索引：查询双方聊天记录
create index if not exists idx_messages_sender_receiver
  on public.messages(sender_name, receiver_name, created_at asc);

create index if not exists idx_messages_receiver_sender
  on public.messages(receiver_name, sender_name, created_at asc);

-- 3) 创建索引：查会话列表（某人相关的所有消息）
create index if not exists idx_messages_sender
  on public.messages(sender_name, created_at desc);
create index if not exists idx_messages_receiver
  on public.messages(receiver_name, created_at desc);

-- 4) 创建索引：快速查未读消息数
create index if not exists idx_messages_unread
  on public.messages(receiver_name, read) where read = false;

-- 5) 启用 RLS（Row Level Security）
alter table public.messages enable row level security;

-- 6) 允许任何人读取消息（两种私密但依赖前端过滤）
create policy if not exists messages_select_all on public.messages
  for select using (true);

-- 7) 允许已登录用户发送消息
create policy if not exists messages_insert_all on public.messages
  for insert with check (
    length(sender_name) between 2 and 40
    and length(receiver_name) between 2 and 40
    and length(content) between 1 and 1000
  );

-- 8) 允许接收者标记消息已读
create policy if not exists messages_update_read on public.messages
  for update using (true)
  with check (read = true);

-- 9) 重要！将表加入 Realtime 发布，否则前端订阅不到新消息
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.likes;
alter publication supabase_realtime add table public.comments;
