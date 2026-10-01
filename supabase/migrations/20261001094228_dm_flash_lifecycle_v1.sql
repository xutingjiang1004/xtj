-- Withdrawal invalidates cryptographic access immediately, before cleanup catches up.
create function public.dm_flash_invalidate_withdrawal() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.media_type='__dm__' and public.chat_safe_legacy_payload(new.content)->>'withdrawn' in('true','1') then
  update public.dm_flash_photos set key_material=null,consumed_at=coalesce(consumed_at,now()) where message_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.dm_flash_invalidate_withdrawal() from public,anon,authenticated;
create trigger dm_flash_withdrawal after update of content on public.posts for each row execute function public.dm_flash_invalidate_withdrawal();
create function public.dm_flash_configure(p_free integer,p_pro integer,p_override_all boolean default false) returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if p_free is null or p_pro is null or p_free not between 0 and 10000 or p_pro not between 0 and 10000 then raise exception 'invalid_flash_limit';end if;
 update public.dm_flash_settings set free_daily=p_free,pro_daily=case when p_override_all then p_free else p_pro end where id=true;
 if p_override_all then delete from public.dm_flash_limits;end if;
end $$;
revoke all on function public.dm_flash_configure(integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.dm_flash_configure(integer,integer,boolean) to service_role;
