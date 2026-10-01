-- Flash payloads never contain a Storage URL, key, or object path.
create table public.dm_flash_settings(id boolean primary key default true check(id),free_daily integer not null default 3 check(free_daily between 0 and 10000),pro_daily integer not null default 20 check(pro_daily between 0 and 10000));
insert into public.dm_flash_settings(id) values(true);
create table public.dm_flash_limits(account_id uuid primary key references public.posts(id) on delete cascade,user_name text not null,daily_limit integer check(daily_limit between -1 and 10000));
create table public.dm_flash_usage(account_id uuid not null references public.posts(id) on delete cascade,day date not null,used integer not null default 0 check(used>=0),primary key(account_id,day));
create table public.dm_flash_photos(id uuid primary key,message_id uuid unique references public.posts(id) on delete set null,sender_account uuid not null references public.posts(id) on delete cascade,recipient_account uuid not null references public.posts(id) on delete cascade,sender_name text not null,recipient_name text not null,client_id text not null,storage_path text not null,key_material text,iv text not null,tag text not null,mime_type text not null,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours',consumed_at timestamptz,consumed_by uuid,cleaned_at timestamptz,unique(sender_account,client_id));
create index dm_flash_cleanup on public.dm_flash_photos(created_at) where cleaned_at is null;
alter table public.dm_flash_settings enable row level security;
alter table public.dm_flash_limits enable row level security;
alter table public.dm_flash_usage enable row level security;
alter table public.dm_flash_photos enable row level security;
revoke all on public.dm_flash_settings,public.dm_flash_limits,public.dm_flash_usage,public.dm_flash_photos from public,anon,authenticated;
grant all on public.dm_flash_settings,public.dm_flash_limits,public.dm_flash_usage,public.dm_flash_photos to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('dm-flash','dm-flash',false,20971600,array['application/octet-stream']);

create function public.dm_flash_quota(p_actor text) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a uuid; lim integer; n integer; pro boolean; s public.dm_flash_settings;
begin
 select id into a from public.posts where user_name=p_actor and media_type='__auth__' order by created_at desc limit 1;
 if a is null then return jsonb_build_object('ok',false,'code','account_unavailable');end if;
 select * into s from public.dm_flash_settings where id=true;
 select exists(select 1 from public.ai_user_membership where user_name=p_actor and plan='pro' and (pro_expires_at is null or pro_expires_at>now())) into pro;
 select daily_limit into lim from public.dm_flash_limits where account_id=a;
 lim:=coalesce(lim,case when p_actor='xxz' then -1 when pro then s.pro_daily else s.free_daily end);
 select used into n from public.dm_flash_usage where account_id=a and day=(now() at time zone 'Asia/Shanghai')::date;
 return jsonb_build_object('ok',true,'limit',lim,'used',coalesce(n,0),'remaining',case when lim<0 then -1 else greatest(0,lim-coalesce(n,0)) end,'is_pro',pro,'override',(select daily_limit from public.dm_flash_limits where account_id=a),'free_daily',s.free_daily,'pro_daily',s.pro_daily);
end $$;

create function public.dm_flash_send(p_actor text,p_peer text,p_client text,p_id uuid,p_path text,p_key text,p_iv text,p_tag text,p_mime text) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a uuid; b uuid; existing public.dm_flash_photos; q jsonb; m public.posts; lim integer;
begin
 select id into a from public.posts where user_name=p_actor and media_type='__auth__' order by created_at desc limit 1;
 select id into b from public.posts where user_name=p_peer and media_type='__auth__' order by created_at desc limit 1;
 if a is null or b is null or a=b then return jsonb_build_object('ok',false,'code','invalid_account');end if;
 if length(p_client)>100 or p_client !~ '^[a-zA-Z0-9_-]{8,100}$' or p_path<>p_id::text||'.bin' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text,318));
 select * into existing from public.dm_flash_photos where sender_account=a and client_id=p_client;
 if found then
  if existing.recipient_account<>b or existing.message_id is null then return jsonb_build_object('ok',false,'code','idempotency_conflict');end if;
  select * into m from public.posts where id=existing.message_id;
  return jsonb_build_object('ok',true,'message',to_jsonb(m),'idempotent',true);
 end if;
 q:=public.dm_flash_quota(p_actor);lim:=(q->>'limit')::integer;
 if lim>=0 and (q->>'used')::integer>=lim then return jsonb_build_object('ok',false,'code','flash_quota_exceeded','quota',q);end if;
 insert into public.posts(user_name,media_type,media_url,actor_key,content)
 values(p_actor,'__dm__',p_peer,'flash_'||p_id::text,jsonb_build_object('text','[闪图 3 秒]','read_at',null,'flash',jsonb_build_object('id',p_id,'duration_ms',3000,'state','ready'))::text) returning * into m;
 insert into public.dm_flash_photos(id,message_id,sender_account,recipient_account,sender_name,recipient_name,client_id,storage_path,key_material,iv,tag,mime_type) values(p_id,m.id,a,b,p_actor,p_peer,p_client,p_path,p_key,p_iv,p_tag,p_mime);
 insert into public.dm_flash_usage(account_id,day,used) values(a,(now() at time zone 'Asia/Shanghai')::date,1) on conflict(account_id,day) do update set used=public.dm_flash_usage.used+1;
 return jsonb_build_object('ok',true,'message',to_jsonb(m),'quota',public.dm_flash_quota(p_actor));
end $$;

create function public.dm_flash_claim(p_actor text,p_message uuid) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a uuid; f public.dm_flash_photos; m public.chat_messages; c public.chat_conversation_members; u uuid; out jsonb;
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
 if f.key_material is null or f.consumed_at is not null or f.expires_at<=now() then return jsonb_build_object('ok',false,'code','flash_expired');end if;
 out:=jsonb_build_object('ok',true,'id',f.id,'path',f.storage_path,'key',f.key_material,'iv',f.iv,'tag',f.tag,'mime',f.mime_type);
 -- Erase the key BEFORE returning any image bytes; concurrent/repeated claims cannot retrieve it.
 update public.dm_flash_photos set key_material=null,consumed_at=now(),consumed_by=a where id=f.id;
 update public.posts set content=jsonb_set(content::jsonb,'{flash,state}','"expired"'::jsonb)::text where id=p_message and media_type='__dm__';
 return out;
end $$;
revoke all on function public.dm_flash_quota(text),public.dm_flash_send(text,text,text,uuid,text,text,text,text,text),public.dm_flash_claim(text,uuid) from public,anon,authenticated;
grant execute on function public.dm_flash_quota(text),public.dm_flash_send(text,text,text,uuid,text,text,text,text,text),public.dm_flash_claim(text,uuid) to service_role;
