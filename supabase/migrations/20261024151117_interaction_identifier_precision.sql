BEGIN;
-- bigint identifiers cross the JSON boundary as decimal strings. PostgreSQL
-- ordering, row locks and idempotency receipts continue to use bigint values.
CREATE OR REPLACE FUNCTION public.xtj_create_comment(
  p_post_id uuid, p_owner text, p_content text, p_request_id uuid DEFAULT NULL, p_kind text DEFAULT 'post'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.posts; saved public.comments; receipt xtj_private.comment_requests; created boolean := false; fresh boolean;
BEGIN
  IF coalesce(btrim(p_owner),'') = '' OR coalesce(btrim(p_content),'') = '' OR length(p_content) > 5000
     OR p_kind NOT IN ('post','photo') OR (p_kind='photo' AND length(p_content)>1000) THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
  SELECT * INTO target FROM public.posts WHERE id=p_post_id FOR SHARE;
  IF NOT FOUND OR target.is_deleted IS TRUE
     OR (p_kind='post' AND lower(btrim(coalesce(target.media_type,''))) NOT IN ('','text','image','video','audio','photo','album'))
     OR (p_kind='post' AND target.visibility='private' AND target.user_name IS DISTINCT FROM p_owner AND p_owner<>'xxz')
     OR (p_kind='photo' AND (target.media_type IS DISTINCT FROM '__photo_wall__' OR target.visibility IS DISTINCT FROM 'public'
       OR target.media_url='__deleted__' OR coalesce(xtj_private.safe_jsonb(target.content)->>'__pw_del__','false')='true'))
  THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF p_request_id IS NOT NULL THEN
    INSERT INTO xtj_private.comment_requests(owner,request_id,post_id,content_hash)
      VALUES(p_owner,p_request_id,p_post_id,sha256(convert_to(btrim(p_content),'UTF8'))) ON CONFLICT DO NOTHING;
    fresh := FOUND;
    SELECT * INTO receipt FROM xtj_private.comment_requests WHERE owner=p_owner AND request_id=p_request_id FOR UPDATE;
    IF receipt.post_id IS DISTINCT FROM p_post_id OR receipt.content_hash IS DISTINCT FROM sha256(convert_to(btrim(p_content),'UTF8'))
    THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict'); END IF;
    IF NOT fresh THEN
      SELECT * INTO saved FROM public.comments WHERE id=receipt.comment_id;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','comment_deleted'); END IF;
      RETURN jsonb_build_object('ok',true,'created',false,'comment',jsonb_build_object(
        'id',saved.id::text,'post_id',saved.post_id,'user_name',saved.user_name,'content',saved.content,'actor_key',saved.actor_key,
        'created_at',saved.created_at,'parent_comment_id',saved.parent_comment_id::text,'generated_by_ai',saved.generated_by_ai),
        'comment_count',(SELECT count(*) FROM public.comments WHERE post_id=p_post_id));
    END IF;
  END IF;
  INSERT INTO public.comments(post_id,user_name,content,actor_key,client_request_id)
    VALUES(p_post_id,p_owner,btrim(p_content),'comment_'||coalesce(p_request_id,gen_random_uuid())::text,p_request_id)
    ON CONFLICT (user_name,client_request_id) DO NOTHING RETURNING * INTO saved;
  created := FOUND;
  IF NOT created THEN
    SELECT * INTO saved FROM public.comments WHERE user_name=p_owner AND client_request_id=p_request_id;
    IF NOT FOUND OR saved.post_id IS DISTINCT FROM p_post_id OR saved.content IS DISTINCT FROM btrim(p_content)
    THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict'); END IF;
  END IF;
  IF p_request_id IS NOT NULL THEN UPDATE xtj_private.comment_requests SET comment_id=saved.id WHERE owner=p_owner AND request_id=p_request_id; END IF;
  RETURN jsonb_build_object('ok',true,'created',created,'comment',jsonb_build_object(
    'id',saved.id::text,'post_id',saved.post_id,'user_name',saved.user_name,'content',saved.content,
    'actor_key',saved.actor_key,'created_at',saved.created_at,'parent_comment_id',saved.parent_comment_id::text,'generated_by_ai',saved.generated_by_ai),
    'comment_count',(SELECT count(*) FROM public.comments WHERE post_id=p_post_id));
END $$;

CREATE OR REPLACE FUNCTION public.xtj_set_post_like(p_post_id uuid,p_owner text,p_liked boolean,p_kind text DEFAULT 'post')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.posts; total bigint;
BEGIN
  IF coalesce(btrim(p_owner),'')='' OR p_liked IS NULL OR p_kind NOT IN ('post','photo') THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
  SELECT * INTO target FROM public.posts WHERE id=p_post_id FOR SHARE;
  IF NOT FOUND OR target.is_deleted IS TRUE
    OR (p_kind='post' AND lower(btrim(coalesce(target.media_type,''))) NOT IN ('','text','image','video','audio','photo','album'))
    OR (p_kind='post' AND target.visibility='private' AND target.user_name IS DISTINCT FROM p_owner AND p_owner<>'xxz')
    OR (p_kind='photo' AND (target.media_type IS DISTINCT FROM '__photo_wall__' OR target.visibility IS DISTINCT FROM 'public'
      OR target.media_url='__deleted__' OR coalesce(xtj_private.safe_jsonb(target.content)->>'__pw_del__','false')='true'))
  THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('post_like:'||p_post_id::text||':'||p_owner,0));
  IF p_liked THEN
    INSERT INTO public.likes(post_id,user_name,actor_key) VALUES(p_post_id,p_owner,'like_'||p_post_id::text||'_'||p_owner)
      ON CONFLICT (post_id,user_name) DO NOTHING;
  ELSE DELETE FROM public.likes WHERE post_id=p_post_id AND user_name=p_owner;
  END IF;
  SELECT count(*) INTO total FROM public.likes WHERE post_id=p_post_id;
  RETURN jsonb_build_object('ok',true,'post_id',p_post_id,'liked',p_liked,'like_count',total,
    'my_like',(SELECT jsonb_build_object('id',id::text,'post_id',post_id,'user_name',user_name,'created_at',created_at)
      FROM public.likes WHERE post_id=p_post_id AND user_name=p_owner LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.xtj_delete_comment(p_comment_id bigint,p_owner text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.comments; removed jsonb := '[]'::jsonb; next_removed jsonb; total bigint;
BEGIN
  SELECT * INTO target FROM public.comments WHERE id=p_comment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'already_deleted',true,'deleted_comment_ids',jsonb_build_array(p_comment_id::text)); END IF;
  IF coalesce(p_owner,'')='' OR (target.user_name IS DISTINCT FROM p_owner AND p_owner<>'xxz') THEN RETURN jsonb_build_object('ok',false,'code','forbidden'); END IF;
  LOOP
    WITH RECURSIVE descendants AS (
      SELECT id FROM public.comments WHERE id=p_comment_id
      UNION SELECT c.id FROM public.comments c JOIN descendants d ON c.parent_comment_id=d.id
    ) SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]'::jsonb) INTO next_removed FROM descendants;
    EXIT WHEN removed=next_removed;
    removed:=next_removed;
    PERFORM id FROM public.comments WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text(removed)) ORDER BY id FOR UPDATE;
    -- A reply inserted before its parent lock was acquired is picked up in
    -- the next snapshot; once the set is stable all parent FKs are locked.
  END LOOP;
  DELETE FROM public.comments WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text(removed));
  SELECT count(*) INTO total FROM public.comments WHERE post_id=target.post_id;
  RETURN jsonb_build_object('ok',true,'post_id',target.post_id,'deleted_comment_id',p_comment_id::text,
    'deleted_comment_ids',removed,'comment_count',total,'source',jsonb_build_object('generated_by_ai',target.generated_by_ai,'parent_comment_id',target.parent_comment_id::text));
END $$;

-- A single JSON snapshot bypasses PostgREST's row-result cap without exporting
-- every like/comment. Counts and the current user's like are computed in SQL.
CREATE OR REPLACE FUNCTION public.xtj_feed_engagement(p_post_ids uuid[],p_owner text DEFAULT '')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
WITH visible AS (
 SELECT p.id FROM public.posts p WHERE p.id=ANY(p_post_ids[1:100]) AND p.is_deleted IS NOT TRUE
 AND lower(btrim(coalesce(p.media_type,''))) IN ('','text','image','video','audio','photo','album')
 AND (coalesce(p.visibility,'public')='public' OR p.user_name=p_owner)
), stats AS (
 SELECT v.id,(SELECT count(*) FROM public.likes l WHERE l.post_id=v.id) AS like_count,
 (SELECT count(*) FROM public.comments c WHERE c.post_id=v.id) AS comment_count,
 EXISTS(SELECT 1 FROM public.likes l WHERE l.post_id=v.id AND l.user_name=p_owner) AS liked_by_me FROM visible v
), previews AS (
 SELECT c.* FROM visible v CROSS JOIN LATERAL (
  SELECT id,post_id,user_name,content,parent_comment_id,generated_by_ai,created_at FROM public.comments
  WHERE post_id=v.id ORDER BY created_at,id LIMIT 3
 ) c
)
SELECT jsonb_build_object('posts',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM stats s),'[]'::jsonb),
 'comments',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('id',c.id::text,'parent_comment_id',c.parent_comment_id::text) ORDER BY created_at,id) FROM previews c),'[]'::jsonb),
 'likes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id::text,'post_id',l.post_id,'user_name',l.user_name,'created_at',l.created_at))
 FROM public.likes l JOIN visible v ON v.id=l.post_id WHERE l.user_name=p_owner),'[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.xtj_create_comment(uuid,text,text,uuid,text), public.xtj_set_post_like(uuid,text,boolean,text),
 public.xtj_delete_comment(bigint,text), public.xtj_feed_engagement(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtj_create_comment(uuid,text,text,uuid,text), public.xtj_set_post_like(uuid,text,boolean,text),
 public.xtj_delete_comment(bigint,text), public.xtj_feed_engagement(uuid[],text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
