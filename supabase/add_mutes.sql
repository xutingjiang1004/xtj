-- ============================================================
-- 禁言功能 + 黑名单增强（完整版）
-- 在 Supabase SQL Editor 中执行，一次性运行
-- ============================================================

-- 1️⃣ 黑名单表
create table if not exists public.blacklist (
  id uuid primary key default gen_random_uuid(),
  user_name text not null unique,
  reason text not null default '',
  added_by text not null default '',
  duration_hours integer not null default 0,
  expires_at timestamptz,
  is_active boolean not null default true,
  lifted_at timestamptz,
  lifted_by text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_blacklist_active on public.blacklist(is_active, expires_at);
create index if not exists idx_blacklist_user on public.blacklist(user_name);
alter table public.blacklist enable row level security;

-- 2️⃣ 禁言表
create table if not exists public.mutes (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  reason text not null default '',
  muted_by text not null default '',
  duration_hours integer default 0,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by text default ''
);

create index if not exists idx_mutes_active on public.mutes(is_active, expires_at);
create index if not exists idx_mutes_user on public.mutes(user_name);
alter table public.mutes enable row level security;

-- 3️⃣ 禁言相关函数
create or replace function public.is_user_muted(p_user_name text)
returns boolean language plpgsql security definer
as $$ begin return exists (select 1 from public.mutes where user_name = p_user_name and is_active = true and (expires_at is null or expires_at > now())); end; $$;

create or replace function public.auto_expire_mutes()
returns void language plpgsql security definer
as $$ begin update public.mutes set is_active = false, lifted_at = now(), lifted_by = 'system' where is_active = true and expires_at is not null and expires_at <= now(); end; $$;

-- 4️⃣ 黑名单相关函数
create or replace function public.is_user_blacklisted(p_user_name text)
returns boolean language plpgsql security definer
as $$ begin return exists (select 1 from public.blacklist where user_name = p_user_name and is_active = true and (expires_at is null or expires_at > now())); end; $$;

create or replace function public.auto_expire_blacklist()
returns void language plpgsql security definer
as $$ begin update public.blacklist set is_active = false, lifted_at = now(), lifted_by = 'system' where is_active = true and expires_at is not null and expires_at <= now(); end; $$;

-- 5️⃣ 统一获取用户所有限制状态（前端轮询使用）
create or replace function public.get_user_restrictions(p_user_name text)
returns jsonb language plpgsql security definer
as $$
declare v jsonb; begin
  select jsonb_build_object('is_banned', public.is_user_banned(p_user_name), 'is_blacklisted', public.is_user_blacklisted(p_user_name), 'is_muted', public.is_user_muted(p_user_name)) into v;
  return v;
end;
$$;

-- 6️⃣ 授权
grant execute on function public.is_user_muted(text) to anon;
grant execute on function public.auto_expire_mutes() to anon;
grant execute on function public.is_user_blacklisted(text) to anon;
grant execute on function public.get_user_restrictions(text) to anon;
grant execute on function public.auto_expire_blacklist() to anon;