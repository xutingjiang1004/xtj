-- ============================================================
-- 功能模块扩展：举报 / 封禁 / 黑名单 / 照片墙增强
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 1. 举报表
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_name text not null,
  target_type text not null check (target_type in ('post', 'comment', 'user', 'photo')),
  target_id text not null,
  target_user text not null default '',
  report_category text not null check (report_category in (
    'spam', 'harassment', 'inappropriate', 'fake', 'violence',
    'hate_speech', 'copyright', 'other'
  )),
  report_reason text not null default '',
  evidence_url text default '',
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed', 'actioned')),
  admin_note text default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text default ''
);

create index if not exists idx_reports_status on public.reports(status);
create index if not exists idx_reports_created on public.reports(created_at desc);
alter table public.reports enable row level security;
create policy if not exists reports_insert_all on public.reports for insert with check (true);
create policy if not exists reports_select_all on public.reports for select using (true);
create policy if not exists reports_update_all on public.reports for update using (true);

-- 2. 用户封禁表
create table if not exists public.bans (
  id uuid primary key default gen_random_uuid(),
  user_name text not null unique,
  ban_type text not null check (ban_type in ('temporary', 'permanent')),
  ban_reason text not null default '',
  ban_duration_hours integer default 0,
  banned_by text not null default '',
  banned_at timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  lifted_at timestamptz,
  lifted_by text default ''
);

create index if not exists idx_bans_active on public.bans(is_active, expires_at);
create index if not exists idx_bans_user on public.bans(user_name);
alter table public.bans enable row level security;
create policy if not exists bans_select_all on public.bans for select using (true);
create policy if not exists bans_insert_all on public.bans for insert with check (true);
create policy if not exists bans_update_all on public.bans for update using (true);

-- 3. 黑名单表
create table if not exists public.blacklist (
  id uuid primary key default gen_random_uuid(),
  user_name text not null unique,
  reason text not null default '',
  added_by text not null default '',
  created_at timestamptz not null default now()
);

alter table public.blacklist enable row level security;
create policy if not exists blacklist_select_all on public.blacklist for select using (true);
create policy if not exists blacklist_insert_all on public.blacklist for insert with check (true);
create policy if not exists blacklist_delete_all on public.blacklist for delete using (true);

-- 4. 照片墙元数据扩展表（支持相册/封面/批量上传）
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  storage_path text not null,
  public_url text not null default '',
  original_name text default '',
  file_size bigint default 0,
  mime_type text default 'image/jpeg',
  width integer default 0,
  height integer default 0,
  album_date text default '',
  is_cover boolean not null default false,
  sort_order integer not null default 0,
  views integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_photos_user on public.photos(user_name);
create index if not exists idx_photos_album on public.photos(album_date);
create index if not exists idx_photos_created on public.photos(created_at desc);
alter table public.photos enable row level security;
create policy if not exists photos_select_all on public.photos for select using (true);
create policy if not exists photos_insert_all on public.photos for insert with check (true);
create policy if not exists photos_update_all on public.photos for update using (true);
create policy if not exists photos_delete_all on public.photos for delete using (true);

-- 5. 实用函数：检查用户是否被封禁
create or replace function public.is_user_banned(p_user_name text)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.bans
  where user_name = p_user_name
    and is_active = true
    and (expires_at is null or expires_at > now());
  return v_count > 0;
end;
$$;

-- 6. 实用函数：检查用户是否在黑名单中
create or replace function public.is_user_blacklisted(p_user_name text)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.blacklist
  where user_name = p_user_name;
  return v_count > 0;
end;
$$;

-- 7. 自动清理过期封禁
create or replace function public.auto_expire_bans()
returns void
language plpgsql
security definer
as $$
begin
  update public.bans
  set is_active = false,
      lifted_at = now(),
      lifted_by = 'system'
  where is_active = true
    and expires_at is not null
    and expires_at <= now();
end;
$$;

grant execute on function public.is_user_banned(text) to anon;
grant execute on function public.is_user_blacklisted(text) to anon;
grant execute on function public.auto_expire_bans() to anon;