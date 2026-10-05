-- Also deny reads/writes if future permissive Storage policies become broader.
create policy flash_browser_deny on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'dm-flash') with check(bucket_id<>'dm-flash');
