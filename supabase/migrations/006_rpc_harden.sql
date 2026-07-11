-- ============================================================
-- 加固 SECURITY DEFINER RPC：search_path + REVOKE + 索引
-- ============================================================

-- 1. 重定义 save_english_state
CREATE OR REPLACE FUNCTION public.save_english_state(
  p_user_name TEXT,
  p_content TEXT,
  p_base_revision INT,
  p_actor_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id BIGINT;
  v_cur_revision INT;
  v_new_revision INT;
  v_cur_content TEXT;
  v_content_jsonb JSONB;
  v_server_content TEXT;
BEGIN
  SELECT id, content INTO v_existing_id, v_cur_content
  FROM public.posts WHERE actor_key = p_actor_key AND media_type = '__ai_english_learning__'
  LIMIT 1 FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    BEGIN
      v_cur_revision := (v_cur_content::jsonb->>'revision')::int;
    EXCEPTION WHEN OTHERS THEN
      v_cur_revision := NULL;
    END;
    IF p_base_revision IS NOT NULL AND v_cur_revision IS NOT NULL AND v_cur_revision != p_base_revision THEN
      RETURN jsonb_build_object('ok', false, 'error', '版本冲突', 'server_revision', v_cur_revision, 'server_content', v_cur_content);
    END IF;
    v_new_revision := COALESCE(v_cur_revision, 0) + 1;
    v_content_jsonb := (p_content::jsonb) || jsonb_build_object('revision', v_new_revision, 'server_updated_at', extract(epoch from now()) * 1000);
    v_server_content := v_content_jsonb::text;
    UPDATE public.posts SET content = v_server_content, media_url = 'state:v' || v_new_revision
    WHERE id = v_existing_id;
  ELSE
    v_new_revision := 1;
    v_content_jsonb := (p_content::jsonb) || jsonb_build_object('revision', v_new_revision, 'server_updated_at', extract(epoch from now()) * 1000);
    v_server_content := v_content_jsonb::text;
    INSERT INTO public.posts (user_name, content, media_type, media_url, actor_key)
    VALUES (p_user_name, v_server_content, '__ai_english_learning__', 'state:v1', p_actor_key);
  END IF;
  RETURN jsonb_build_object('ok', true, 'revision', v_new_revision, 'server_content', v_server_content);
END;
$$;

-- 2. 重定义 claim_pro_gift
CREATE OR REPLACE FUNCTION public.claim_pro_gift(
  p_user_name TEXT,
  p_gift_id TEXT,
  p_vip_content TEXT,
  p_claim_content TEXT,
  p_actor_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gift_record RECORD;
  v_claim_limit INT;
  v_claim_count INT;
  v_claim_id BIGINT;
  v_gift_content JSONB;
BEGIN
  SELECT id, content INTO v_gift_record FROM public.posts
  WHERE id = p_gift_id::bigint AND media_type = '__pro_gift__'
  LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动不存在');
  END IF;
  BEGIN
    v_gift_content := v_gift_record.content::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动数据异常');
  END;
  v_claim_limit := GREATEST(0, COALESCE((v_gift_content->>'claim_limit')::int, (v_gift_content->>'limit')::int, (v_gift_content->>'max_claims')::int, 0));
  IF EXISTS (SELECT 1 FROM public.posts WHERE actor_key = p_actor_key AND media_type = '__pro_gift_claim__' LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', '你已经领取过该活动');
  END IF;
  SELECT COUNT(*) INTO v_claim_count FROM public.posts
  WHERE media_type = '__pro_gift_claim__' AND media_url = p_gift_id;
  IF v_claim_limit > 0 AND v_claim_count >= v_claim_limit THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动名额已满');
  END IF;
  INSERT INTO public.posts (user_name, media_type, media_url, content, actor_key)
  VALUES (p_user_name, '__pro_gift_claim__', p_gift_id, p_claim_content, p_actor_key)
  RETURNING id INTO v_claim_id;
  IF p_vip_content IS NOT NULL AND p_vip_content != '' THEN
    INSERT INTO public.posts (user_name, content, media_type, actor_key)
    VALUES (p_user_name, p_vip_content, '__vip__', 'pro_vip_' || p_gift_id || '_' || p_user_name);
  END IF;
  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id);
END;
$$;

-- 3. REVOKE 权限：只允许 service_role
REVOKE EXECUTE ON FUNCTION public.save_english_state(TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pro_gift(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- 4. 必要索引
CREATE INDEX IF NOT EXISTS idx_posts_media_type_url ON public.posts(media_type, media_url);
CREATE INDEX IF NOT EXISTS idx_posts_media_type_user ON public.posts(media_type, user_name);
CREATE INDEX IF NOT EXISTS idx_posts_actor_key ON public.posts USING hash(actor_key);
