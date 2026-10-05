-- Serialize model edits across devices and Render instances. Deleted UIDs are
-- permanent; re-adding a model creates a new UID rather than reviving old caches.
create or replace function public.save_ai_custom_models_snapshot(
  p_user_name text, p_models jsonb, p_deleted_uids jsonb,
  p_ai_prefs jsonb default '{}'::jsonb, p_replace boolean default false
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  previous_text text;
  previous jsonb := '{}'::jsonb;
  old_models jsonb;
  model_map jsonb := '{}'::jsonb;
  deleted jsonb;
  saved_models jsonb;
  snapshot jsonb;
  item jsonb;
  new_id public.posts.id%type;
begin
  if p_user_name is null or btrim(p_user_name) = '' or length(p_user_name) > 64 then
    raise exception 'invalid model owner';
  end if;
  if jsonb_typeof(p_models) is distinct from 'array' or jsonb_array_length(p_models) > 20
    or jsonb_typeof(p_deleted_uids) is distinct from 'array'
    or jsonb_typeof(p_ai_prefs) is distinct from 'object' then
    raise exception 'invalid model snapshot';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xtj:custom-models:' || p_user_name, 0));
  select content into previous_text from public.posts
    where user_name = p_user_name and media_type = '__custom_ai_models__'
    order by created_at desc, id desc limit 1;
  if previous_text is not null then previous := previous_text::jsonb; end if;
  old_models := coalesce(previous->'models', '[]'::jsonb);

  select coalesce(jsonb_agg(uid order by uid), '[]'::jsonb) into deleted from (
    select distinct value #>> '{}' as uid from jsonb_array_elements(
      coalesce(previous->'deleted_uids', '[]'::jsonb) || p_deleted_uids
    ) where jsonb_typeof(value) = 'string' and length(value #>> '{}') between 1 and 64
    union
    select old->>'uid' from jsonb_array_elements(old_models) old
      where p_replace and not exists (
        select 1 from jsonb_array_elements(p_models) incoming where incoming->>'uid' = old->>'uid'
      )
  ) tombstones where uid is not null;

  if not p_replace then
    for item in select value from jsonb_array_elements(old_models) loop
      if item->>'uid' is not null then model_map := model_map || jsonb_build_object(item->>'uid', item); end if;
    end loop;
  end if;
  for item in select value from jsonb_array_elements(p_models) loop
    if item->>'uid' is not null then model_map := model_map || jsonb_build_object(item->>'uid', item); end if;
  end loop;
  select coalesce(jsonb_agg(value order by key), '[]'::jsonb) into saved_models
    from jsonb_each(model_map) where not (deleted ? key);
  if jsonb_array_length(saved_models) > 20 then raise exception 'too many custom models'; end if;
  snapshot := jsonb_build_object('models', saved_models, 'deleted_uids', deleted,
    'ai_prefs', coalesce(previous->'ai_prefs', '{}'::jsonb) || p_ai_prefs,
    'updated_at', clock_timestamp());
  insert into public.posts(user_name, media_type, content, actor_key)
    values (p_user_name, '__custom_ai_models__', snapshot::text, 'ai_models_' || gen_random_uuid()) returning id into new_id;
  delete from public.posts where user_name = p_user_name and media_type = '__custom_ai_models__' and id <> new_id;
  return snapshot || jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.save_ai_custom_models_snapshot(text,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.save_ai_custom_models_snapshot(text,jsonb,jsonb,jsonb,boolean) to service_role;
