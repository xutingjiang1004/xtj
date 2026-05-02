-- 全量重置（会清空旧数据）
drop table if exists public.likes cascade;
drop table if exists public.comments cascade;
drop table if exists public.posts cascade;

create extension if not exists pgcrypto;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  actor_key text not null,
  content text default '',
  media_url text default '',
  media_type text default '',
  views integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.likes (
  id bigserial primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  user_name text not null,
  actor_key text not null,
  created_at timestamptz not null default now(),
  unique(post_id, actor_key)
);

create table public.comments (
  id bigserial primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  user_name text not null,
  actor_key text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_posts_created_at on public.posts(created_at desc);
create index idx_comments_post on public.comments(post_id, created_at asc);

create or replace function public.increment_post_views(p_post_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.posts set views = views + 1 where id = p_post_id;
end;
$$;

create or replace function public.delete_post_with_actor(p_post_id uuid, p_actor_key text)
returns boolean language plpgsql security definer as $$
begin
  delete from public.posts where id = p_post_id and actor_key = p_actor_key;
  return found;
end;
$$;

alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

drop policy if exists posts_select_all on public.posts;
create policy posts_select_all on public.posts for select using (true);
drop policy if exists posts_insert_all on public.posts;
create policy posts_insert_all on public.posts for insert with check (length(user_name) between 2 and 20 and length(actor_key) between 6 and 100 and length(content) <= 2000);
drop policy if exists likes_select_all on public.likes;
create policy likes_select_all on public.likes for select using (true);
drop policy if exists likes_insert_all on public.likes;
create policy likes_insert_all on public.likes for insert with check (length(user_name) between 2 and 20 and length(actor_key) between 6 and 100);

drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments for select using (true);
drop policy if exists comments_insert_all on public.comments;
create policy comments_insert_all on public.comments for insert with check (length(user_name) between 2 and 20 and length(actor_key) between 6 and 100 and length(content) between 1 and 500);

grant execute on function public.increment_post_views(uuid) to anon;
grant execute on function public.delete_post_with_actor(uuid, text) to anon;