-- 液态朋友圈：最小可用 schema + RLS + 统计函数
create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  actor_key text not null,
  content text default '',
  media_url text default '',
  media_type text default '',
  views integer not null default 0,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.likes (
  id bigserial primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  user_name text not null,
  actor_key text not null,
  created_at timestamptz not null default now(),
  unique(post_id, actor_key)
);

create table if not exists public.comments (
  id bigserial primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  user_name text not null,
  actor_key text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_posts_created_at on public.posts(created_at desc);
create index if not exists idx_comments_post on public.comments(post_id, created_at asc);

create or replace function public.increment_post_views(p_post_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.posts set views = views + 1 where id = p_post_id;
end;
$$;

create or replace function public.bump_like_count()
returns trigger
language plpgsql
as $$
begin
  update public.posts set likes_count = likes_count + 1 where id = new.post_id;
  return new;
end;
$$;

create or replace function public.bump_comment_count()
returns trigger
language plpgsql
as $$
begin
  update public.posts set comments_count = comments_count + 1 where id = new.post_id;
  return new;
end;
$$;

drop trigger if exists trg_like_count on public.likes;
create trigger trg_like_count
after insert on public.likes
for each row execute function public.bump_like_count();

drop trigger if exists trg_comment_count on public.comments;
create trigger trg_comment_count
after insert on public.comments
for each row execute function public.bump_comment_count();

alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

-- 匿名可读
create policy if not exists posts_select_all on public.posts
for select using (true);
create policy if not exists likes_select_all on public.likes
for select using (true);
create policy if not exists comments_select_all on public.comments
for select using (true);

-- 匿名可写（前端需做基础校验）
create policy if not exists posts_insert_all on public.posts
for insert with check (
  length(user_name) between 1 and 40
  and length(actor_key) between 6 and 100
  and length(content) <= 2000
);

create policy if not exists likes_insert_all on public.likes
for insert with check (
  length(user_name) between 1 and 40
  and length(actor_key) between 6 and 100
);

create policy if not exists comments_insert_all on public.comments
for insert with check (
  length(user_name) between 1 and 40
  and length(actor_key) between 6 and 100
  and length(content) between 1 and 500
);

grant execute on function public.increment_post_views(uuid) to anon;
