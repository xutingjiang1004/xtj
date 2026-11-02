-- 2026-11-02 帖子图片改走阿里云 OSS 直传后的落库补丁
--
-- 背景：图片帖走 public.create_post_with_attachments 落库，该函数原本要求
-- 附件对应的对象必须真实存在于 Supabase 存储（storage.objects，bucket=uploads），
-- 并且 mimetype 是 image/*、size 与客户端上报一致。媒体迁到阿里云 OSS 之后，
-- 文件不在 Supabase 存储里，这条校验必然失败，函数返回 media_not_uploaded，
-- 接口转成 503，前端表现就是「发布结果未确认，请重试；不会重复发布」。
--
-- 改动：只放宽「存在性校验」这一处——当附件地址属于本站 OSS 桶时跳过 storage.objects 查询。
-- 其余校验（路径格式、upload_id、registry 行的归属与状态、尺寸/大小范围、幂等冲突）
-- 全部保留，未做任何削弱。
--
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴整段 → Run。可重复执行。

CREATE OR REPLACE FUNCTION public.create_post_with_attachments(p_actor text, p_payload jsonb, p_attachments jsonb, p_max_images integer)
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
  -- 2026-11-02：本站 OSS 桶的附件不在 storage.objects 里，跳过存在性校验；
  -- 其余来源仍然按原来的 mimetype + 字节数严格比对。
  IF coalesce(v_item->>'media_url','') NOT LIKE 'https://xtj-media-2026.oss-cn-hangzhou.aliyuncs.com/%'
   AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='uploads' AND o.name=v_item->>'storage_path'
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
