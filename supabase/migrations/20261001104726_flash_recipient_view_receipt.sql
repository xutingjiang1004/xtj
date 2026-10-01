-- Sender previews never consume the recipient's one successful view.
alter table public.dm_flash_photos add column view_token uuid, add column view_reserved_at timestamptz;
alter table public.dm_flash_photos alter column expires_at set default 'infinity'::timestamptz;
update public.dm_flash_photos set expires_at='infinity' where key_material is not null;
create function public.dm_flash_prepare(p_actor text,p_message uuid,p_view uuid) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a uuid; f public.dm_flash_photos; m public.chat_messages; c public.chat_conversation_members; u uuid;
begin
 select id into a from public.posts where user_name=p_actor and media_type='__auth__' order by created_at desc limit 1;
 select id into u from public.chat_users where user_name=p_actor and is_registered and deleted_at is null;
 if a is null or u is null then return jsonb_build_object('ok',false,'code','not_found');end if;
 select * into f from public.dm_flash_photos where message_id=p_message for update;
 if not found or a not in(f.sender_account,f.recipient_account) then return jsonb_build_object('ok',false,'code','not_found');end if;
 select * into m from public.chat_messages where legacy_post_id=p_message and withdrawn_at is null;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 select * into c from public.chat_conversation_members where conversation_id=m.conversation_id and user_id=u;
 if not found or c.left_at is not null or (c.cleared_before is not null and m.sent_at<=c.cleared_before) or exists(select 1 from public.chat_message_user_state where user_id=u and message_id=m.id and hidden_at is not null) then return jsonb_build_object('ok',false,'code','not_found');end if;
 if f.key_material is null then return jsonb_build_object('ok',false,'code','flash_expired');end if;
 if a=f.recipient_account then
  if f.consumed_at is not null then return jsonb_build_object('ok',false,'code','flash_expired');end if;
  if p_view is null then return jsonb_build_object('ok',false,'code','refresh_required');end if;
  if f.view_token is not null and f.view_token<>p_view and f.view_reserved_at>now()-interval '60 seconds' then return jsonb_build_object('ok',false,'code','flash_busy');end if;
  update public.dm_flash_photos set view_token=p_view,view_reserved_at=now() where id=f.id;
 end if;
 return jsonb_build_object('ok',true,'id',f.id,'path',f.storage_path,'key',f.key_material,'iv',f.iv,'tag',f.tag,'mime',f.mime_type,'role',case when a=f.sender_account then 'sender' else 'recipient' end);
end $$;
create function public.dm_flash_viewed(p_actor text,p_message uuid,p_view uuid) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a uuid; f public.dm_flash_photos; result jsonb;
begin
 select id into a from public.posts where user_name=p_actor and media_type='__auth__' order by created_at desc limit 1;
 select * into f from public.dm_flash_photos where message_id=p_message for update;
 if a is null or not found or a<>f.recipient_account or p_view is null or f.view_token is distinct from p_view or f.key_material is null then return jsonb_build_object('ok',false,'code','not_found');end if;
 if f.consumed_at is not null then return jsonb_build_object('ok',true,'idempotent',true);end if;
 if f.view_reserved_at<=now()-interval '60 seconds' then return jsonb_build_object('ok',false,'code','flash_retry');end if;
 result:=public.dm_flash_prepare(p_actor,p_message,p_view);
 if not (result->>'ok')::boolean then return result-'key'-'path';end if;
 update public.dm_flash_photos set consumed_at=now(),consumed_by=a where id=f.id;
 update public.posts set content=jsonb_set(content::jsonb,'{flash,state}','"expired"'::jsonb)::text where id=p_message and media_type='__dm__';
 return jsonb_build_object('ok',true);
end $$;
create function public.dm_flash_release(p_actor text,p_message uuid,p_view uuid) returns void language sql set search_path=pg_catalog,public as $$
 update public.dm_flash_photos set view_token=null,view_reserved_at=null where message_id=p_message and view_token=p_view and consumed_at is null and recipient_account=(select id from public.posts where user_name=p_actor and media_type='__auth__' order by created_at desc limit 1);
$$;
-- Older clients must refresh; never let their old shared claim destroy retained sender access.
create or replace function public.dm_flash_claim(p_actor text,p_message uuid) returns jsonb language sql set search_path=pg_catalog,public as $$select public.dm_flash_prepare(p_actor,p_message,null);$$;
revoke all on function public.dm_flash_prepare(text,uuid,uuid),public.dm_flash_viewed(text,uuid,uuid),public.dm_flash_release(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.dm_flash_prepare(text,uuid,uuid),public.dm_flash_viewed(text,uuid,uuid),public.dm_flash_release(text,uuid,uuid) to service_role;
