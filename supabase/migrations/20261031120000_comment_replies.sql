BEGIN;
-- 评论回复：xtj_create_comment 增加可选的 p_parent_comment_id。
--
-- 背景：comments.parent_comment_id 早已存在（小猫 AI 回复在用），但用户评论入口
-- 不接收“回复的是哪条”。这里只加一个带默认值的末位参数，原先 5 个参数的调用
-- （含 photo-social 的 p_kind='photo'）行为不变。
--
-- 规则：
--   * 只有帖子评论可以回复；照片墙评论仍是单层。
--   * 被回复的评论必须存在且属于同一个帖子，否则返回 parent_not_found，不静默变成顶层评论。
--   * 被回复的评论加 FOR SHARE 锁：删除评论会 FOR UPDATE 同一行，二者串行，
--     不会出现“刚回复完父评论就被删、回复变孤儿”的竞态。
--   * 幂等重放必须带同一个 parent，否则按 idempotency_conflict 处理，不会因为换了父评论而
--     把旧回复当成这次提交的结果。
--
-- 签名变化：参数列表变了，必须先 DROP 旧签名；否则两个重载会让 PostgREST 命名参数调用
-- 报“function is not unique”。DROP 与 CREATE 在同一事务内，调用方看不到缺失窗口。
DROP FUNCTION IF EXISTS public.xtj_create_comment(uuid,text,text,uuid,text);

CREATE FUNCTION public.xtj_create_comment(
  p_post_id uuid, p_owner text, p_content text, p_request_id uuid DEFAULT NULL,
  p_kind text DEFAULT 'post', p_parent_comment_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.posts; saved public.comments; receipt xtj_private.comment_requests; created boolean := false; fresh boolean; parent public.comments;
BEGIN
  IF coalesce(btrim(p_owner),'') = '' OR coalesce(btrim(p_content),'') = '' OR length(p_content) > 5000
     OR p_kind NOT IN ('post','photo') OR (p_kind='photo' AND length(p_content)>1000)
     OR (p_parent_comment_id IS NOT NULL AND p_kind<>'post') THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
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
      IF saved.parent_comment_id IS DISTINCT FROM p_parent_comment_id THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict'); END IF;
      RETURN jsonb_build_object('ok',true,'created',false,'comment',jsonb_build_object(
        'id',saved.id::text,'post_id',saved.post_id,'user_name',saved.user_name,'content',saved.content,'actor_key',saved.actor_key,
        'created_at',saved.created_at,'parent_comment_id',saved.parent_comment_id::text,'generated_by_ai',saved.generated_by_ai),
        'comment_count',(SELECT count(*) FROM public.comments WHERE post_id=p_post_id));
    END IF;
  END IF;
  IF p_parent_comment_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.comments WHERE id=p_parent_comment_id AND post_id=p_post_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','parent_not_found'); END IF;
  END IF;
  INSERT INTO public.comments(post_id,user_name,content,actor_key,client_request_id,parent_comment_id)
    VALUES(p_post_id,p_owner,btrim(p_content),'comment_'||coalesce(p_request_id,gen_random_uuid())::text,p_request_id,p_parent_comment_id)
    ON CONFLICT (user_name,client_request_id) DO NOTHING RETURNING * INTO saved;
  created := FOUND;
  IF NOT created THEN
    SELECT * INTO saved FROM public.comments WHERE user_name=p_owner AND client_request_id=p_request_id;
    IF NOT FOUND OR saved.post_id IS DISTINCT FROM p_post_id OR saved.content IS DISTINCT FROM btrim(p_content)
       OR saved.parent_comment_id IS DISTINCT FROM p_parent_comment_id
    THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict'); END IF;
  END IF;
  IF p_request_id IS NOT NULL THEN UPDATE xtj_private.comment_requests SET comment_id=saved.id WHERE owner=p_owner AND request_id=p_request_id; END IF;
  RETURN jsonb_build_object('ok',true,'created',created,'comment',jsonb_build_object(
    'id',saved.id::text,'post_id',saved.post_id,'user_name',saved.user_name,'content',saved.content,
    'actor_key',saved.actor_key,'created_at',saved.created_at,'parent_comment_id',saved.parent_comment_id::text,'generated_by_ai',saved.generated_by_ai),
    'comment_count',(SELECT count(*) FROM public.comments WHERE post_id=p_post_id));
END $$;

-- 与旧签名一致：仅 service_role（Render 后端）可调用，浏览器角色不可。
REVOKE ALL ON FUNCTION public.xtj_create_comment(uuid,text,text,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtj_create_comment(uuid,text,text,uuid,text,bigint) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
