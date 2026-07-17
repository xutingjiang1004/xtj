-- 帖子定位与 IP 属地字段（全部可空，兼容历史数据）
alter table public.posts
  add column if not exists location_name text,
  add column if not exists location_province text,
  add column if not exists location_city text,
  add column if not exists location_district text,
  add column if not exists location_level text,
  add column if not exists ip_province text,
  add column if not exists ip_city text,
  add column if not exists ip_region_text text,
  add column if not exists ip_region_status text default 'pending',
  add column if not exists ip_resolved_at timestamptz;