-- Harden Pro gift claiming and anon RLS policies.

CREATE OR REPLACE FUNCTION claim_pro_gift(
  p_user_name TEXT,
  p_gift_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_gift RECORD;
  v_info JSONB;
  v_allowed JSONB := '[]'::jsonb;
  v_claim_limit INT := 0;
  v_duration_days INT := 30;
  v_claim_count INT := 0;
  v_claim_id BIGINT;
  v_now TIMESTAMPTZ := now();
  v_expire_at TIMESTAMPTZ;
  v_features JSONB := '[]'::jsonb;
  v_claim_content JSONB;
  v_vip_content JSONB;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;
  IF p_gift_id IS NULL OR p_gift_id !~ '^\d+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动ID格式错误');
  END IF;

  SELECT id, content INTO v_gift
  FROM posts
  WHERE id = p_gift_id::bigint AND media_type = '__pro_gift__'
  LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动不存在');
  END IF;

  BEGIN
    v_info := COALESCE(v_gift.content, '{}')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动JSON解析失败');
  END;

  IF COALESCE((v_info->>'is_published')::boolean, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动未发布');
  END IF;
  IF COALESCE((v_info->>'is_active')::boolean, true) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动已禁用');
  END IF;
  IF v_info ? 'start_at' AND NULLIF(v_info->>'start_at','') IS NOT NULL AND (v_info->>'start_at')::timestamptz > v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动未开始');
  END IF;
  IF v_info ? 'end_at' AND NULLIF(v_info->>'end_at','') IS NOT NULL AND (v_info->>'end_at')::timestamptz < v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动已结束');
  END IF;
  IF v_info ? 'claim_expire_at' AND NULLIF(v_info->>'claim_expire_at','') IS NOT NULL AND (v_info->>'claim_expire_at')::timestamptz < v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动已过期');
  END IF;

  IF jsonb_typeof(COALESCE(v_info->'allowed_users','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(v_info->'exclusive_users','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(v_info->'target_users','[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'allowed_users 字段必须是数组');
  END IF;
  v_allowed := COALESCE(v_info->'allowed_users','[]'::jsonb) || COALESCE(v_info->'exclusive_users','[]'::jsonb) || COALESCE(v_info->'target_users','[]'::jsonb);
  IF (COALESCE((v_info->>'exclusive')::boolean, false) OR jsonb_array_length(v_allowed) > 0)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_allowed) AS u(name) WHERE btrim(u.name) = p_user_name) THEN
    RETURN jsonb_build_object('ok', false, 'error', '你不在本次活动领取名单中');
  END IF;

  BEGIN
    v_claim_limit := GREATEST(0, COALESCE(NULLIF(v_info->>'claim_limit','')::int, NULLIF(v_info->>'limit','')::int, NULLIF(v_info->>'max_claims','')::int, 0));
    v_duration_days := GREATEST(1, COALESCE(NULLIF(v_info->>'duration_days','')::int, 30));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_limit 或 duration_days 字段必须是数字');
  END;
  IF v_info ? 'features' AND jsonb_typeof(v_info->'features') <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'features 字段必须是数组');
  END IF;
  v_features := COALESCE(v_info->'features', '[]'::jsonb);

  PERFORM pg_advisory_xact_lock(hashtextextended('pro_claim_' || p_gift_id, 0));
  IF EXISTS (SELECT 1 FROM posts WHERE actor_key = 'pro_claim_' || p_gift_id || '_' || p_user_name AND media_type = '__pro_gift_claim__') THEN
    RETURN jsonb_build_object('ok', false, 'error', '你已经领取过该活动');
  END IF;
  SELECT COUNT(*) INTO v_claim_count FROM posts WHERE media_type = '__pro_gift_claim__' AND media_url = p_gift_id;
  IF v_claim_limit > 0 AND v_claim_count >= v_claim_limit THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动名额已满');
  END IF;

  v_expire_at := v_now + make_interval(days => v_duration_days);
  v_claim_content := jsonb_build_object('campaign_id', p_gift_id, 'campaign_title', COALESCE(v_info->>'title',''), 'user_name', p_user_name, 'claimed_at', v_now, 'vip_expire_at', v_expire_at, 'features', v_features, 'duration_days', v_duration_days);
  v_vip_content := jsonb_build_object('plan_id', 'pro_gift_' || p_gift_id, 'plan_name', 'XTJ Pro (' || COALESCE(v_info->>'title','赠送') || ')', 'price', 0, 'is_active', true, 'order_no', 'GIFT_' || floor(extract(epoch from v_now) * 1000)::text, 'start_at', v_now, 'expire_at', v_expire_at, 'features', v_features, 'activated_at', v_now, 'source', 'pro_gift');

  INSERT INTO posts (user_name, media_type, media_url, content, actor_key)
  VALUES (p_user_name, '__pro_gift_claim__', p_gift_id, v_claim_content::text, 'pro_claim_' || p_gift_id || '_' || p_user_name)
  RETURNING id INTO v_claim_id;
  INSERT INTO posts (user_name, media_type, media_url, content, actor_key)
  VALUES (p_user_name, '__vip__', 'pro_monthly', v_vip_content::text, 'pro_vip_' || p_gift_id || '_' || p_user_name);

  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'plan_name', v_vip_content->>'plan_name', 'expire_at', v_expire_at, 'features', v_features);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', '你已经领取过该活动');
WHEN invalid_datetime_format THEN
  RETURN jsonb_build_object('ok', false, 'error', '活动时间字段格式错误');
END;
$$;

REVOKE ALL ON posts FROM anon;
GRANT SELECT ON posts TO anon;

DROP POLICY IF EXISTS anon_posts_select ON posts;
DROP POLICY IF EXISTS anon_posts_insert ON posts;
DROP POLICY IF EXISTS anon_posts_update ON posts;
DROP POLICY IF EXISTS anon_posts_delete ON posts;
CREATE POLICY anon_posts_public_read ON posts FOR SELECT TO anon
USING (media_type IS NULL OR media_type IN ('image','video','text','photo','album'));

DROP POLICY IF EXISTS bans_service_all ON bans;
DROP POLICY IF EXISTS bans_open_all ON bans;
CREATE POLICY bans_authenticated_read ON bans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS anon_likes_insert ON likes;
CREATE POLICY anon_likes_insert ON likes FOR INSERT TO anon
WITH CHECK (user_name IS NOT NULL AND btrim(user_name) <> '' AND post_id IS NOT NULL);
DROP POLICY IF EXISTS anon_comments_insert ON comments;
CREATE POLICY anon_comments_insert ON comments FOR INSERT TO anon
WITH CHECK (user_name IS NOT NULL AND btrim(user_name) <> '' AND post_id IS NOT NULL AND content IS NOT NULL AND btrim(content) <> '');
