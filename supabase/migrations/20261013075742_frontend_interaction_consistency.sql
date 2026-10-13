BEGIN;

ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS client_request_id uuid;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS actor_key text;
ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS actor_key text;
CREATE UNIQUE INDEX IF NOT EXISTS comments_owner_request_unique ON public.comments(user_name, client_request_id);
CREATE INDEX IF NOT EXISTS comments_post_page_idx ON public.comments(post_id, created_at, id);
CREATE INDEX IF NOT EXISTS comments_parent_idx ON public.comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS likes_post_page_idx ON public.likes(post_id, created_at, id);
CREATE TABLE IF NOT EXISTS xtj_private.comment_requests (
  owner text NOT NULL, request_id uuid NOT NULL, post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  content_hash bytea NOT NULL, comment_id bigint, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner,request_id)
);
ALTER TABLE xtj_private.comment_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtj_private.comment_requests FROM PUBLIC,anon,authenticated;

-- The post lock lasts through the write. A delete/privacy change cannot slip
-- between the visibility check and the interaction being committed.
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
        'id',saved.id,'post_id',saved.post_id,'user_name',saved.user_name,'content',saved.content,'actor_key',saved.actor_key,
        'created_at',saved.created_at,'parent_comment_id',saved.parent_comment_id,'generated_by_ai',saved.generated_by_ai),
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
    'id',saved.id,'post_id',saved.post_id,'user_name',saved.user_name,'content',saved.content,
    'actor_key',saved.actor_key,'created_at',saved.created_at,'parent_comment_id',saved.parent_comment_id,'generated_by_ai',saved.generated_by_ai),
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
    'my_like',(SELECT jsonb_build_object('id',id,'post_id',post_id,'user_name',user_name,'created_at',created_at)
      FROM public.likes WHERE post_id=p_post_id AND user_name=p_owner LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.xtj_delete_comment(p_comment_id bigint,p_owner text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.comments; removed jsonb := '[]'::jsonb; next_removed jsonb; total bigint;
BEGIN
  SELECT * INTO target FROM public.comments WHERE id=p_comment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'already_deleted',true,'deleted_comment_ids',jsonb_build_array(p_comment_id)); END IF;
  IF coalesce(p_owner,'')='' OR (target.user_name IS DISTINCT FROM p_owner AND p_owner<>'xxz') THEN RETURN jsonb_build_object('ok',false,'code','forbidden'); END IF;
  LOOP
    WITH RECURSIVE descendants AS (
      SELECT id FROM public.comments WHERE id=p_comment_id
      UNION SELECT c.id FROM public.comments c JOIN descendants d ON c.parent_comment_id=d.id
    ) SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO next_removed FROM descendants;
    EXIT WHEN removed=next_removed;
    removed:=next_removed;
    PERFORM id FROM public.comments WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text(removed)) ORDER BY id FOR UPDATE;
    -- A reply inserted before its parent lock was acquired is picked up in
    -- the next snapshot; once the set is stable all parent FKs are locked.
  END LOOP;
  DELETE FROM public.comments WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text(removed));
  SELECT count(*) INTO total FROM public.comments WHERE post_id=target.post_id;
  RETURN jsonb_build_object('ok',true,'post_id',target.post_id,'deleted_comment_id',p_comment_id,
    'deleted_comment_ids',removed,'comment_count',total,'source',jsonb_build_object('generated_by_ai',target.generated_by_ai,'parent_comment_id',target.parent_comment_id));
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
 'comments',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY created_at,id) FROM previews c),'[]'::jsonb),
 'likes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'post_id',l.post_id,'user_name',l.user_name,'created_at',l.created_at))
 FROM public.likes l JOIN visible v ON v.id=l.post_id WHERE l.user_name=p_owner),'[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.xtj_create_comment(uuid,text,text,uuid,text), public.xtj_set_post_like(uuid,text,boolean,text),
 public.xtj_delete_comment(bigint,text), public.xtj_feed_engagement(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtj_create_comment(uuid,text,text,uuid,text), public.xtj_set_post_like(uuid,text,boolean,text),
 public.xtj_delete_comment(bigint,text), public.xtj_feed_engagement(uuid[],text) TO service_role;

-- Revalidate a bounded history window, including clear/hide/withdraw changes,
-- without replacing it with the latest 180 messages on every refresh.
CREATE OR REPLACE FUNCTION public.xtj_sync_dm_window(p_actor text,p_peer text,p_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'user_name',p.user_name,'content',p.content,'media_url',p.media_url,
 'media_type',p.media_type,'actor_key',p.actor_key,'views',p.views,'created_at',p.created_at) ORDER BY p.created_at,p.id),'[]'::jsonb)
FROM public.posts p JOIN public.chat_messages m ON m.legacy_post_id=p.id
JOIN public.chat_users u ON u.user_name=p_actor AND u.is_registered AND u.deleted_at IS NULL
JOIN public.chat_conversation_members c ON c.conversation_id=m.conversation_id AND c.user_id=u.id
LEFT JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=u.id
WHERE p.id=ANY(p_ids[1:500]) AND p.media_type='__dm__' AND p.is_deleted IS NOT TRUE
 AND (p.user_name=p_actor OR p.media_url=p_actor) AND (p.user_name=p_peer OR p.media_url=p_peer)
 AND m.withdrawn_at IS NULL AND s.hidden_at IS NULL AND c.left_at IS NULL
 AND (c.cleared_before IS NULL OR m.sent_at>c.cleared_before);
$$;
REVOKE ALL ON FUNCTION public.xtj_sync_dm_window(text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtj_sync_dm_window(text,text,uuid[]) TO service_role;
CREATE OR REPLACE FUNCTION public.xtj_forget_comment_requests(p_owner text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE total bigint;
BEGIN
 DELETE FROM xtj_private.comment_requests WHERE owner=p_owner;
 GET DIAGNOSTICS total=ROW_COUNT; RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.xtj_forget_comment_requests(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtj_forget_comment_requests(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
