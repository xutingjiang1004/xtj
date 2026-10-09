BEGIN;
-- Apply after the compatible media gateway is deployed. Objects remain in
-- place with their original bytes; browser reads go through current API checks.
CREATE POLICY uploads_private_read_boundary ON storage.objects AS RESTRICTIVE
FOR SELECT TO anon,authenticated USING(bucket_id<>'uploads');
UPDATE storage.buckets SET public=false WHERE id='uploads';
COMMIT;
