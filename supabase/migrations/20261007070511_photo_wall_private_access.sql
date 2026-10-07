-- Originals remain byte-for-byte unchanged; only the storage access model changes.
INSERT INTO storage.buckets(id,name,public,file_size_limit)
VALUES ('photo-wall','photo-wall',false,52428800)
ON CONFLICT(id) DO UPDATE SET public=false;

CREATE POLICY photo_wall_browser_deny ON storage.objects AS RESTRICTIVE
FOR ALL TO anon,authenticated
USING (bucket_id <> 'photo-wall') WITH CHECK (bucket_id <> 'photo-wall');

-- Browser roles cannot create new public copies or sign/list wall originals.
-- Public delivery bypasses RLS, so the server also moves historical files and
-- their thumbnails out of uploads through the Storage API before reporting success.
CREATE POLICY photo_wall_legacy_browser_read_deny ON storage.objects AS RESTRICTIVE
FOR SELECT TO anon,authenticated
USING (bucket_id <> 'uploads' OR (name NOT LIKE 'photos/%' AND name NOT LIKE 'thumbs/%'));
CREATE POLICY photo_wall_legacy_browser_upload_deny ON storage.objects AS RESTRICTIVE
FOR INSERT TO anon,authenticated
WITH CHECK (bucket_id <> 'uploads' OR (name NOT LIKE 'photos/%' AND name NOT LIKE 'thumbs/%'));
