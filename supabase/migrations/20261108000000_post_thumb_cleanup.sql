-- 2026-11-08 帖子缩略图（posts/thumb_*）纳入上传登记表后的清理判定补丁
--
-- 背景：帖子图片的 480px 缩略图以前不登记，发布失败或帖子被删后留下孤儿文件。
-- 现在前端会像登记原图一样先登记缩略图（POST /api/post/media/prepare）。缩略图不是附件，
-- 它的地址只写在帖子 content 的元数据（meta.thumbs）里，所以清理判定
-- public.claim_post_media_cleanup 必须认得「被某条未删除帖子的内容引用」，
-- 否则一天后的废弃上传清扫会把线上帖子正在用的缩略图当成无主文件删掉。
--
-- 改动（只放宽「是否仍被引用」，其余逻辑原样保留）：
--   1. 对 posts/thumb_<32位十六进制>.jpg 这种路径，若同一用户有未删除的帖子，
--      其 content 含这个文件名，则视为被引用，并把登记行挂到该帖子（attached_post_id），
--      以后删帖时 queue_deleted_post_attachments 会把它一起排入清理。
--   2. 其它路径的判定与原函数逐字相同。
--
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴整段 → Run。可重复执行；必须先于前端发布执行。

CREATE OR REPLACE FUNCTION public.claim_post_media_cleanup(p_actor text,p_path text,p_upload_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_upload public.post_media_uploads; v_thumb_post uuid;
BEGIN
 SELECT * INTO v_upload FROM public.post_media_uploads WHERE storage_path=p_path FOR UPDATE;
 IF NOT FOUND OR v_upload.user_name IS DISTINCT FROM p_actor OR v_upload.upload_id IS DISTINCT FROM p_upload_id THEN RETURN jsonb_build_object('ok',false,'code','media_ownership'); END IF;
 IF EXISTS(SELECT 1 FROM public.posts WHERE (id=v_upload.attached_post_id OR (v_upload.media_url IS NOT NULL AND media_url=v_upload.media_url)) AND is_deleted IS NOT TRUE) THEN
  UPDATE public.post_media_uploads SET status='attached',updated_at=now() WHERE storage_path=p_path;
  RETURN jsonb_build_object('ok',true,'referenced',true);
 END IF;
 IF v_upload.storage_path ~ '^posts/thumb_[0-9a-f]{32}\.jpg$' THEN
  SELECT id INTO v_thumb_post FROM public.posts
   WHERE user_name=v_upload.user_name AND is_deleted IS NOT TRUE AND strpos(content,substr(v_upload.storage_path,7))>0 LIMIT 1;
  IF v_thumb_post IS NOT NULL THEN
   UPDATE public.post_media_uploads SET status='attached',attached_post_id=v_thumb_post,updated_at=now() WHERE storage_path=p_path;
   RETURN jsonb_build_object('ok',true,'referenced',true);
  END IF;
 END IF;
 UPDATE public.post_media_uploads SET status='cleanup',updated_at=now() WHERE storage_path=p_path;
 RETURN jsonb_build_object('ok',true,'referenced',false);
END $$;
REVOKE ALL ON FUNCTION public.claim_post_media_cleanup(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_post_media_cleanup(text,text,text) TO service_role;
