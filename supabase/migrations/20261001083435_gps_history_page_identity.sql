-- Link retained legacy GPS samples to their original page identity so existing jobs can settle them.
alter table public.user_location_history add column page_load_id text;
create index user_location_history_legacy_page on public.user_location_history(user_name,page_load_id) where capture_reason='legacy_retained';
update public.user_location_history l set page_load_id=e.value->>'page_load_id'
from public.posts p
cross join lateral jsonb_array_elements(case when jsonb_typeof((case when p.content is json then p.content::jsonb else '{}'::jsonb end)->'precise_location_history')='array' then (case when p.content is json then p.content::jsonb else '{}'::jsonb end)->'precise_location_history' else '[]'::jsonb end) with ordinality e(value,ordinality)
where p.media_type='__user_info__' and l.user_name=p.user_name and l.capture_reason='legacy_retained'
 and l.capture_id='legacy_'||p.id::text||'_'||e.ordinality::text
 and (e.value->>'page_load_id') ~ '^page_[a-zA-Z0-9_]{8,80}$';
