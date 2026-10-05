BEGIN;

CREATE TABLE public.post_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position >= 0),
 media_type text NOT NULL CHECK(media_type = 'image'),
 media_url text NOT NULL CHECK(length(media_url) BETWEEN 1 AND 2048),
 storage_path text NOT NULL UNIQUE,
 width integer CHECK(width BETWEEN 1 AND 20000),
 height integer CHECK(height BETWEEN 1 AND 20000),
 file_size bigint NOT NULL CHECK(file_size BETWEEN 1 AND 52428800),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(post_id, position),
 CHECK((width IS NULL) = (height IS NULL))
);
-- The unique (post_id,position) index also serves lookups by post_id.
ALTER TABLE public.post_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_attachments TO service_role;
CREATE POLICY post_attachments_block_browser ON public.post_attachments AS RESTRICTIVE FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);

CREATE FUNCTION public.create_post_with_attachments(p_actor text, p_payload jsonb, p_attachments jsonb, p_max_images integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_item jsonb; v_upload public.post_media_uploads; v_post public.posts; v_input public.posts;
 v_count integer; v_attached_id uuid; v_all_attached boolean := true; v_rows jsonb;
BEGIN
 IF p_actor IS NULL OR p_payload->>'user_name' IS DISTINCT FROM p_actor OR jsonb_typeof(p_attachments) IS DISTINCT FROM 'array'
 OR p_max_images IS NULL OR p_max_images < 1 THEN RETURN jsonb_build_object('ok',false,'code','invalid_attachments'); END IF;
 v_count := jsonb_array_length(p_attachments);
 IF v_count < 1 OR v_count > p_max_images OR
 (SELECT count(DISTINCT x->>'storage_path') FROM jsonb_array_elements(p_attachments) x) <> v_count OR
 (SELECT count(DISTINCT x->>'upload_id') FROM jsonb_array_elements(p_attachments) x) <> v_count OR
 EXISTS(SELECT 1 FROM jsonb_array_elements(p_attachments) WITH ORDINALITY AS a(x,n)
 WHERE x->>'media_type' IS DISTINCT FROM 'image' OR (x->>'position')::integer IS DISTINCT FROM n-1
 OR x->>'storage_path' IS NULL OR x->>'storage_path' !~ '^posts/[a-zA-Z0-9_一-鿿.-]{1,200}$'
 OR x->>'storage_path' LIKE '%..%' OR x->>'upload_id' IS NULL OR x->>'upload_id' !~ '^[a-zA-Z0-9_-]{8,128}$'
 OR coalesce(x->>'media_url','') !~ '^https://' OR length(x->>'media_url') > 2048
 OR coalesce((x->>'file_size')::bigint,0) NOT BETWEEN 1 AND 52428800
 OR ((x->>'width') IS NULL) <> ((x->>'height') IS NULL)
 OR (x->>'width')::integer NOT BETWEEN 1 AND 20000 OR (x->>'height')::integer NOT BETWEEN 1 AND 20000)
 THEN RETURN jsonb_build_object('ok',false,'code','invalid_attachments'); END IF;
 -- Deterministic lock order shared across concurrent retries. Cleanup and attach
 -- lock the same registration rows, so an object cannot be both deleted and used.
 FOR v_item IN SELECT x FROM jsonb_array_elements(p_attachments) x ORDER BY x->>'storage_path' LOOP
  SELECT * INTO v_upload FROM public.post_media_uploads WHERE storage_path=v_item->>'storage_path' FOR UPDATE;
  IF NOT FOUND OR v_upload.user_name IS DISTINCT FROM p_actor OR v_upload.upload_id IS DISTINCT FROM v_item->>'upload_id'
  THEN RETURN jsonb_build_object('ok',false,'code','media_ownership'); END IF;
  IF v_upload.status='cleanup' THEN RETURN jsonb_build_object('ok',false,'code','media_cleanup'); END IF;
  IF v_upload.status='attached' THEN
   IF v_attached_id IS NOT NULL AND v_attached_id IS DISTINCT FROM v_upload.attached_post_id
   THEN RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
   v_attached_id := v_upload.attached_post_id;
   IF v_attached_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
  ELSE v_all_attached := false; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='uploads' AND o.name=v_item->>'storage_path'
   AND lower(coalesce(o.metadata->>'mimetype','')) LIKE 'image/%'
   AND lower(coalesce(o.metadata->>'mimetype','')) NOT IN ('image/svg+xml','image/svg')
   AND (o.metadata->>'size')::bigint=(v_item->>'file_size')::bigint)
  THEN RETURN jsonb_build_object('ok',false,'code','media_not_uploaded'); END IF;
 END LOOP;
 IF v_attached_id IS NOT NULL THEN
  IF NOT v_all_attached THEN RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
  SELECT * INTO v_post FROM public.posts WHERE id=v_attached_id;
  IF NOT FOUND OR v_post.user_name IS DISTINCT FROM p_actor OR v_post.is_deleted IS TRUE
   OR (SELECT count(*) FROM public.post_attachments WHERE post_id=v_attached_id)<>v_count
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_attachments) x WHERE NOT EXISTS(
    SELECT 1 FROM public.post_attachments a WHERE a.post_id=v_attached_id AND a.storage_path=x->>'storage_path'
     AND a.media_url=x->>'media_url' AND a.position=(x->>'position')::integer))
  THEN RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
 ELSE
  SELECT * INTO v_input FROM jsonb_populate_record(NULL::public.posts,p_payload);
  INSERT INTO public.posts(user_name,content,media_url,media_type,actor_key,visibility,is_pinned,pinned_at,updated_at,
   location_name,location_province,location_city,location_district,location_level,ip_province,ip_city,ip_region_text,ip_region_status,ip_resolved_at,ip_lookup_started_at,ip_region_error)
  VALUES(p_actor,v_input.content,p_attachments->0->>'media_url',CASE WHEN v_count=1 THEN 'image' ELSE 'album' END,
   v_input.actor_key,coalesce(v_input.visibility,'public'),false,NULL,NULL,
   v_input.location_name,v_input.location_province,v_input.location_city,v_input.location_district,v_input.location_level,
   v_input.ip_province,v_input.ip_city,v_input.ip_region_text,v_input.ip_region_status,v_input.ip_resolved_at,v_input.ip_lookup_started_at,v_input.ip_region_error)
  RETURNING * INTO v_post;
  INSERT INTO public.post_attachments(post_id,position,media_type,media_url,storage_path,width,height,file_size)
  SELECT v_post.id,(x->>'position')::integer,'image',x->>'media_url',x->>'storage_path',
   (x->>'width')::integer,(x->>'height')::integer,(x->>'file_size')::bigint FROM jsonb_array_elements(p_attachments) x;
  UPDATE public.post_media_uploads u SET status='attached',media_url=x->>'media_url',attached_post_id=v_post.id,updated_at=now()
  FROM jsonb_array_elements(p_attachments) x WHERE u.storage_path=x->>'storage_path';
 END IF;
 SELECT jsonb_agg(to_jsonb(a)-'storage_path' ORDER BY a.position) INTO v_rows FROM public.post_attachments a WHERE a.post_id=v_post.id;
 RETURN jsonb_build_object('ok',true,'post',to_jsonb(v_post),'attachments',v_rows,'duplicate',v_attached_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.create_post_with_attachments(text,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_post_with_attachments(text,jsonb,jsonb,integer) TO service_role;

-- Every deletion route (user/admin/account) queues all registered/attached media
-- in the database transaction, before cascade removes the attachment records.
-- A failed delete rolls back both the queue and cleanup status changes.
CREATE FUNCTION public.queue_deleted_post_attachments() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_paths text[];
BEGIN
 IF OLD.media_type NOT IN ('image','photo','album','video','audio') THEN RETURN OLD; END IF;
 SELECT array_agg(DISTINCT path) INTO v_paths FROM (
  SELECT storage_path path FROM public.post_attachments WHERE post_id=OLD.id
  UNION SELECT storage_path FROM public.post_media_uploads WHERE attached_post_id=OLD.id AND user_name=OLD.user_name
 ) d WHERE NOT EXISTS(SELECT 1 FROM public.post_attachments a WHERE a.storage_path=d.path AND a.post_id<>OLD.id)
 AND NOT EXISTS(SELECT 1 FROM public.posts p JOIN public.post_media_uploads u ON p.media_url=u.media_url
  WHERE u.storage_path=d.path AND p.id<>OLD.id AND p.is_deleted IS NOT TRUE);
 IF cardinality(v_paths)>0 THEN
  PERFORM public.enqueue_storage_cleanup(OLD.id,'uploads',v_paths,'post_deleted');
  UPDATE public.post_media_uploads SET status='cleanup',updated_at=now() WHERE storage_path=ANY(v_paths);
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.queue_deleted_post_attachments() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_deleted_post_attachments() TO service_role;
CREATE TRIGGER posts_queue_attachment_cleanup BEFORE DELETE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.queue_deleted_post_attachments();

CREATE OR REPLACE FUNCTION public.hard_delete_content(
  p_post_id UUID,
  p_actor_user TEXT,
  p_is_admin BOOLEAN,
  p_expect_photo BOOLEAN DEFAULT false,
  p_actor_key TEXT DEFAULT NULL,
  p_storage_paths JSONB DEFAULT '[]'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, xtj_private, pg_temp
AS $$
DECLARE
  v_post public.posts%ROWTYPE;
  v_cleanup_job_id BIGINT;
BEGIN
  IF p_post_id IS NULL OR p_actor_user IS NULL OR btrim(p_actor_user) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Invalid delete request');
  END IF;

  SELECT * INTO v_post FROM public.posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'deleted', false, 'already_deleted', true);
  END IF;

  IF NOT COALESCE(p_is_admin, false) AND v_post.user_name IS DISTINCT FROM p_actor_user THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Not allowed to delete this content');
  END IF;
  IF COALESCE(p_expect_photo, false) AND v_post.media_type IS DISTINCT FROM '__photo_wall__' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_photo', 'error', 'Content is not a photo');
  END IF;
  IF NOT COALESCE(p_expect_photo, false) AND v_post.media_type = '__photo_wall__' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'use_photo_delete', 'error', 'Use the photo delete endpoint');
  END IF;

  IF (v_post.media_type = '__photo_wall__' OR (v_post.media_type IN ('image','photo','album','video','audio')
      AND NOT EXISTS(SELECT 1 FROM public.posts p WHERE p.id<>p_post_id AND p.media_url=v_post.media_url AND p.is_deleted IS NOT TRUE)))
     AND jsonb_typeof(COALESCE(p_storage_paths, '[]'::JSONB)) = 'array'
     AND jsonb_array_length(COALESCE(p_storage_paths, '[]'::JSONB)) > 0 THEN
    INSERT INTO public.storage_cleanup_jobs (photo_id, paths)
    VALUES (p_post_id, p_storage_paths)
    ON CONFLICT (photo_id) DO UPDATE
      SET paths = EXCLUDED.paths, status = 'pending', updated_at = now(), completed_at = NULL
    RETURNING id INTO v_cleanup_job_id;
  END IF;

  DELETE FROM public.likes WHERE post_id = p_post_id;
  DELETE FROM public.comments WHERE post_id = p_post_id;

  -- Reports contain their notifications in the same JSON record. View events
  -- keep the target UUID in media_url and are removed at the same time.
  DELETE FROM public.posts
  WHERE id <> p_post_id
    AND (
      (media_type = '__post_view__' AND media_url = p_post_id::TEXT)
      OR (media_type = '__report__' AND COALESCE(xtj_private.safe_jsonb(content)->>'target_id', '') = p_post_id::TEXT)
    );

  DELETE FROM public.posts WHERE id = p_post_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'deleted', true,
      'already_deleted', false,
      'cleanup_job_id', v_cleanup_job_id
    );
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'delete_not_applied', 'error', 'Delete did not remove the content');
END;
$$;

REVOKE ALL ON FUNCTION public.hard_delete_content(UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_content(UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB) TO service_role;


NOTIFY pgrst, 'reload schema';
COMMIT;
