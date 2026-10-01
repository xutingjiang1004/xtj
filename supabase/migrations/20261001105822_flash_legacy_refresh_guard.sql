-- Never allow old servers/clients to remove ciphertext retained for sender previews.
create or replace function public.dm_flash_claim(p_actor text,p_message uuid) returns jsonb language sql set search_path=pg_catalog,public as $$select jsonb_build_object('ok',false,'code','refresh_required');$$;
