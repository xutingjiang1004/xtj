-- Authorized GPS fixes are account-bound, append-only apart from address resolution.
create table public.user_location_history (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.posts(id) on delete cascade,
 user_name text not null,
 capture_id text not null check (length(capture_id) between 1 and 160),
 latitude double precision not null check (latitude between -90 and 90),
 longitude double precision not null check (longitude between -180 and 180),
 accuracy_m double precision check (accuracy_m between 0 and 100000),
 captured_at timestamptz not null,
 received_at timestamptz not null default clock_timestamp(),
 source text not null default 'browser_geolocation',
 capture_reason text not null,
 ip text,
 resolution_status text not null default 'pending' check (resolution_status in ('pending','resolved','failed')),
 resolved_address text,
 resolve_error text,
 resolved_at timestamptz,
 unique(account_id,capture_id)
);
create index user_location_history_actor_time on public.user_location_history(user_name,received_at desc,id desc);
alter table public.user_location_history enable row level security;
revoke all on public.user_location_history from public,anon,authenticated;
grant select,insert,update,delete on public.user_location_history to service_role;
-- Preserve every usable retained legacy entry; unavailable older fixes cannot be reconstructed.
insert into public.user_location_history(account_id,user_name,capture_id,latitude,longitude,accuracy_m,captured_at,received_at,capture_reason,resolution_status,resolved_address)
select a.id,p.user_name,'legacy_'||p.id::text||'_'||e.ordinality::text,
 (e.value->>'latitude')::double precision,(e.value->>'longitude')::double precision,
 case when (e.value->>'accuracy_m') ~ '^\d+(\.\d+)?$' then least(100000,(e.value->>'accuracy_m')::double precision) end,
 case when pg_input_is_valid(e.value->>'captured_at','timestamptz') then (e.value->>'captured_at')::timestamptz else p.created_at end,case when pg_input_is_valid(e.value->>'received_at','timestamptz') then (e.value->>'received_at')::timestamptz else p.created_at end,'legacy_retained',
 case when e.value->>'resolution_status' in ('resolved','failed') then e.value->>'resolution_status' else 'pending' end,
 left(e.value->>'resolved_address',1000)
from public.posts p
join lateral (select id from public.posts where user_name=p.user_name and media_type='__auth__' order by created_at limit 1) a on true
cross join lateral jsonb_array_elements(case when jsonb_typeof((case when p.content is json then p.content::jsonb else '{}'::jsonb end)->'precise_location_history')='array' then (case when p.content is json then p.content::jsonb else '{}'::jsonb end)->'precise_location_history' else '[]'::jsonb end) with ordinality e(value,ordinality)
where p.media_type='__user_info__' and p.content is json
 and (e.value->>'latitude') ~ '^-?\d+(\.\d+)?$' and (e.value->>'longitude') ~ '^-?\d+(\.\d+)?$'
 and (e.value->>'latitude')::double precision between -90 and 90 and (e.value->>'longitude')::double precision between -180 and 180
on conflict(account_id,capture_id) do nothing;

create function public.record_browser_context(p_actor text,p_context jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if p_context is null or jsonb_typeof(p_context)<>'object' then raise exception 'invalid_context'; end if;
 if not exists(select 1 from public.posts where user_name=p_actor and media_type='__auth__') then raise exception 'missing_account'; end if;
 insert into public.posts(user_name,media_type,actor_key,content)
 values(p_actor,'__user_info__','user_info_'||md5(p_actor),jsonb_build_object('browser_context',jsonb_build_object(
 'language',p_context->'language','languages',p_context->'languages','timezone',p_context->'timezone','online',p_context->'online','network',p_context->'network','source','browser_report','received_at',clock_timestamp()))::text)
 on conflict(user_name) where media_type='__user_info__'
 do update set content=(xtj_private.safe_jsonb(public.posts.content)||excluded.content::jsonb)::text;
 return true;
end $$;
revoke all on function public.record_browser_context(text,jsonb) from public,anon,authenticated;
grant execute on function public.record_browser_context(text,jsonb) to service_role;
