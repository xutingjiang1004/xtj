-- Browser clients use the public anon SDK, not the application's signed user
-- access token. Storage cannot infer the post owner from that SDK identity.
-- Authorized deletion and cleanup therefore go through the service backend.
-- Bind new photo paths before Storage is written, including the pending window
-- before a photo record exists. Public filenames are not ownership credentials.
CREATE TABLE IF NOT EXISTS public.photo_upload_registry (
  storage_path text PRIMARY KEY,
  user_name text NOT NULL,
  upload_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photo_upload_registry_actor_upload_idx ON public.photo_upload_registry(user_name, upload_id);
ALTER TABLE public.photo_upload_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_upload_registry FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_upload_registry TO service_role;
DROP POLICY IF EXISTS photo_upload_registry_browser_deny ON public.photo_upload_registry;
CREATE POLICY photo_upload_registry_browser_deny ON public.photo_upload_registry AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);

-- RESTRICTIVE policies also block accidental future permissive policy grants.
DROP POLICY IF EXISTS uploads_browser_delete_deny ON storage.objects;
CREATE POLICY uploads_browser_delete_deny ON storage.objects AS RESTRICTIVE
  FOR DELETE TO anon, authenticated USING (bucket_id <> 'uploads');
DROP POLICY IF EXISTS uploads_browser_update_deny ON storage.objects;
CREATE POLICY uploads_browser_update_deny ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated USING (bucket_id <> 'uploads') WITH CHECK (bucket_id <> 'uploads');

DROP POLICY IF EXISTS "public delete uploads" ON storage.objects;
DROP POLICY IF EXISTS "xxz 1va6avm_0" ON storage.objects;
DROP POLICY IF EXISTS "anon_delete_uploads" ON storage.objects;
DROP POLICY IF EXISTS "public update uploads" ON storage.objects;
DROP POLICY IF EXISTS "xxz 1va6avm_2" ON storage.objects;
REVOKE UPDATE, DELETE ON public.posts FROM anon, authenticated;

-- Retired live-only functions trust a caller-supplied actor/admin flag. Their
-- signatures vary from the current service-only UUID API; do not expose either.
DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.delete_photo_wall_post(bigint,text,boolean)', 'public.restore_photo_wall_post(bigint,text)'] LOOP
    IF to_regprocedure(signature) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || signature || ' FROM PUBLIC, anon, authenticated';
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || signature || ' TO service_role';
    END IF;
  END LOOP;
END $$;
