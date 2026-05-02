-- 聊天消息表 + RPC 函数（不依赖 PostgREST 表缓存）
-- 在 Supabase SQL Editor 中执行此脚本

-- 1) 创建 messages 表（如果还没建）
create table if not exists public.messages (
  id bigserial primary key,
  sender_name text not null,
  receiver_name text not null,
  content text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) 索引
create index if not exists idx_msg_sr on public.messages(sender_name, receiver_name, created_at asc);
create index if not exists idx_msg_rs on public.messages(receiver_name, sender_name, created_at asc);
create index if not exists idx_msg_unread on public.messages(receiver_name, read) where read = false;

-- 3) 权限
grant select, insert, update on public.messages to anon;
grant usage on schema public to anon;
grant usage, select on sequence public.messages_id_seq to anon;

-- 4) RLS
alter table public.messages enable row level security;
drop policy if exists messages_select_all on public.messages;
create policy messages_select_all on public.messages for select using (true);
drop policy if exists messages_insert_all on public.messages;
create policy messages_insert_all on public.messages for insert with check (length(sender_name) between 2 and 40 and length(receiver_name) between 2 and 40 and length(content) between 1 and 1000);
drop policy if exists messages_update_read on public.messages;
create policy messages_update_read on public.messages for update using (true) with check (read = true);

-- ====== RPC 函数 ======

-- 5) 发送消息
drop function if exists public.msg_send(text, text, text) cascade;
create function public.msg_send(p_sender text, p_receiver text, p_content text) returns json as $$
declare v_id bigint;
begin
  insert into public.messages(sender_name, receiver_name, content, read)
  values(p_sender, p_receiver, p_content, false)
  returning id into v_id;
  return json_build_object('id', v_id);
end;
$$ language plpgsql security definer;
grant execute on function public.msg_send(text, text, text) to anon;

-- 6) 获取聊天记录
drop function if exists public.msg_get(text, text) cascade;
create function public.msg_get(p_me text, p_other text)
returns table(id bigint, sender_name text, receiver_name text, content text, read boolean, created_at timestamptz) as $$
begin
  return query
  select m.id, m.sender_name, m.receiver_name, m.content, m.read, m.created_at
  from public.messages m
  where (m.sender_name = p_me and m.receiver_name = p_other)
     or (m.sender_name = p_other and m.receiver_name = p_me)
  order by m.created_at asc
  limit 500;
end;
$$ language plpgsql security definer;
grant execute on function public.msg_get(text, text) to anon;

-- 7) 获取会话列表
drop function if exists public.msg_convs(text) cascade;
create function public.msg_convs(p_me text)
returns table(other_user text, last_message text, last_time timestamptz, unread integer) as $$
begin
  return query
  select t.other_user, t.last_message, t.last_time::timestamptz, coalesce(u.cnt, 0)::integer
  from (
    select
      case when m.sender_name = p_me then m.receiver_name else m.sender_name end as other_user,
      m.content as last_message,
      m.created_at as last_time,
      row_number() over (partition by
        case when m.sender_name = p_me then m.receiver_name else m.sender_name end
        order by m.created_at desc) as rn
    from public.messages m
    where m.sender_name = p_me or m.receiver_name = p_me
  ) t
  left join (
    select m.sender_name, count(*) as cnt
    from public.messages m
    where m.receiver_name = p_me and m.read = false
    group by m.sender_name
  ) u on u.sender_name = t.other_user
  where t.rn = 1
  order by t.last_time desc;
end;
$$ language plpgsql security definer;
grant execute on function public.msg_convs(text) to anon;

-- 8) 标记已读
drop function if exists public.msg_mark_read(text, text) cascade;
create function public.msg_mark_read(p_sender text, p_receiver text) returns void as $$
begin
  update public.messages set read = true
  where sender_name = p_sender and receiver_name = p_receiver and read = false;
end;
$$ language plpgsql security definer;
grant execute on function public.msg_mark_read(text, text) to anon;

-- 9) 未读消息数
drop function if exists public.msg_unread_count(text) cascade;
create function public.msg_unread_count(p_receiver text) returns integer as $$
declare v_cnt integer;
begin
  select count(*) into v_cnt from public.messages
  where receiver_name = p_receiver and read = false;
  return v_cnt;
end;
$$ language plpgsql security definer;
grant execute on function public.msg_unread_count(text) to anon;

-- 10) Realtime
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.likes;
alter publication supabase_realtime add table public.comments;