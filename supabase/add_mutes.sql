-- ============================================================
-- 禁言功能 + 黑名单增强
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 1. 禁言表
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
create policy if not exists mutes_select_all on public.mutes for select using (true);
create policy if not exists mutes_insert_all on public.mutes for insert with check (true);
create policy if not exists mutes_update_all on public.mutes for update using (true);
create policy if not exists mutes_delete_all on public.mutes for delete using (true);

-- 2. 检查用户是否被禁言
create or replace function public.is_user_muted(p_user_name text)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.mutes
  where user_name = p_user_name
    and is_active = true
    and (expires_at is null or expires_at > now());
  return v_count > 0;
end;
$$;

-- 3. 自动清理过期禁言
create or replace function public.auto_expire_mutes()
returns void
language plpgsql
security definer
as $$
begin
  update public.mutes
  set is_active = false,
      lifted_at = now(),
      lifted_by = 'system'
  where is_active = true
    and expires_at is not null
    and expires_at <= now();
end;
$$;

-- 4. 获取用户当前禁言信息
create or replace function public.get_user_mute_info(p_user_name text)
returns table(
  is_muted boolean,
  reason text,
  muted_by text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
  select 
    true as is_muted,
    m.reason,
    m.muted_by,
    m.expires_at,
    m.created_at
  from public.mutes m
  where m.user_name = p_user_name
    and m.is_active = true
    and (m.expires_at is null or m.expires_at > now())
  limit 1;
  
  if not found then
    return query
    select false, ''::text, ''::text, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

-- 5. 增强黑名单：添加时限支持
do $$
begin
  if not exists (select 1 from information_schema.columns 
    where table_name = 'blacklist' and column_name = 'expires_at') then
    alter table public.blacklist add column expires_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns 
    where table_name = 'blacklist' and column_name = 'duration_hours') then
    alter table public.blacklist add column duration_hours integer default 0;
  end if;
  if not exists (select 1 from information_schema.columns 
    where table_name = 'blacklist' and column_name = 'is_active') then
    alter table public.blacklist add column is_active boolean not null default true;
  end if;
  if not exists (select 1 from information_schema.columns 
    where table_name = 'blacklist' and column_name = 'lifted_at') then
    alter table public.blacklist add column lifted_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns 
    where table_name = 'blacklist' and column_name = 'lifted_by') then
    alter table public.blacklist add column lifted_by text default '';
  end if;
end;
$$;

-- 更新 is_user_blacklisted 函数支持时限
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
  where user_name = p_user_name
    and is_active = true
    and (expires_at is null or expires_at > now());
  return v_count > 0;
end;
$$;

-- 6. 获取用户当前拉黑信息
create or replace function public.get_user_blacklist_info(p_user_name text)
returns table(
  is_blacklisted boolean,
  reason text,
  added_by text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
  select 
    true as is_blacklisted,
    b.reason,
    b.added_by,
    b.expires_at,
    b.created_at
  from public.blacklist b
  where b.user_name = p_user_name
    and b.is_active = true
    and (b.expires_at is null or b.expires_at > now())
  limit 1;
  
  if not found then
    return query
    select false, ''::text, ''::text, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

-- 7. 获取用户当前封禁信息
create or replace function public.get_user_ban_info(p_user_name text)
returns table(
  is_banned boolean,
  ban_type text,
  ban_reason text,
  banned_by text,
  expires_at timestamptz,
  banned_at timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
  select 
    true as is_banned,
    b.ban_type,
    b.ban_reason,
    b.banned_by,
    b.expires_at,
    b.banned_at
  from public.bans b
  where b.user_name = p_user_name
    and b.is_active = true
    and (b.expires_at is null or b.expires_at > now())
  limit 1;
  
  if not found then
    return query
    select false, ''::text, ''::text, ''::text, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

-- 8. 统一获取用户所有限制状态
create or replace function public.get_user_restrictions(p_user_name text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
  v_banned boolean;
  v_blacklisted boolean;
  v_muted boolean;
begin
  select into v_banned public.is_user_banned(p_user_name);
  select into v_blacklisted public.is_user_blacklisted(p_user_name);
  select into v_muted public.is_user_muted(p_user_name);
  
  v_result := jsonb_build_object(
    'is_banned', v_banned,
    'is_blacklisted', v_blacklisted,
    'is_muted', v_muted
  );
  
  return v_result;
end;
$$;

-- 9. 自动清理过期黑名单
create or replace function public.auto_expire_blacklist()
returns void
language plpgsql
security definer
as $$
begin
  update public.blacklist
  set is_active = false,
      lifted_at = now(),
      lifted_by = 'system'
  where is_active = true
    and expires_at is not null
    and expires_at <= now();
end;
$$;

grant execute on function public.is_user_muted(text) to anon;
grant execute on function public.auto_expire_mutes() to anon;
grant execute on function public.get_user_mute_info(text) to anon;
grant execute on function public.get_user_blacklist_info(text) to anon;
grant execute on function public.get_user_ban_info(text) to anon;
grant execute on function public.get_user_restrictions(text) to anon;
grant execute on function public.auto_expire_blacklist() to anon;