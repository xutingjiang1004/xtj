BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('dm-private','dm-private',false,52428800) ON CONFLICT(id) DO UPDATE SET public=false;
CREATE POLICY private_dm_browser_deny ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id<>'dm-private') WITH CHECK(bucket_id<>'dm-private');
COMMIT;
