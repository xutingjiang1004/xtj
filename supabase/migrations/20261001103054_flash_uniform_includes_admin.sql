-- Explicit "all accounts" overrides include the unique administrator too.
create or replace function public.dm_flash_configure(p_free integer,p_pro integer,p_override_all boolean default false) returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if p_free is null or p_pro is null or p_free not between 0 and 10000 or p_pro not between 0 and 10000 then raise exception 'invalid_flash_limit';end if;
 update public.dm_flash_settings set free_daily=p_free,pro_daily=case when p_override_all then p_free else p_pro end where id=true;
 if p_override_all then
  delete from public.dm_flash_limits;
  insert into public.dm_flash_limits(account_id,user_name,daily_limit)
   select id,user_name,p_free from public.posts where media_type='__auth__' and user_name='xxz' order by created_at desc limit 1;
 end if;
end $$;
