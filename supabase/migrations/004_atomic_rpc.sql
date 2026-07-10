-- ============================================================
-- 1. 英语状态原子保存（compare-and-swap revision）
-- ============================================================
CREATE OR REPLACE FUNCTION save_english_state(
  p_user_name TEXT,
  p_content TEXT,
  p_base_revision INT,
  p_actor_key TEXT
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_existing_id BIGINT;
  v_cur_revision INT;
  v_new_revision INT;
  v_cur_content TEXT;
BEGIN
  SELECT id, content INTO v_existing_id, v_cur_content
  FROM posts WHERE actor_key = p_actor_key AND media_type = '__ai_english_learning__'
  LIMIT 1 FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    BEGIN
      v_cur_revision := (v_cur_content::jsonb->>'revision')::int;
    EXCEPTION WHEN OTHERS THEN
      v_cur_revision := NULL;
    END;
    IF p_base_revision IS NOT NULL AND v_cur_revision IS NOT NULL AND v_cur_revision != p_base_revision THEN
      RETURN jsonb_build_object('ok', false, 'error', '版本冲突', 'server_revision', v_cur_revision);
    END IF;
    v_new_revision := COALESCE(v_cur_revision, 0) + 1;
    UPDATE posts SET content = p_content, media_url = 'state:v' || v_new_revision
    WHERE id = v_existing_id;
  ELSE
    v_new_revision := 1;
    INSERT INTO posts (user_name, content, media_type, media_url, actor_key)
    VALUES (p_user_name, p_content, '__ai_english_learning__', 'state:v1', p_actor_key);
  END IF;
  RETURN jsonb_build_object('ok', true, 'revision', v_new_revision);
END;
$$;

-- ============================================================
-- 2. Pro 活动原子领取（含总名额检查）
-- ============================================================
CREATE OR REPLACE FUNCTION claim_pro_gift(
  p_user_name TEXT,
  p_gift_id TEXT,
  p_claim_limit INT,
  p_vip_content TEXT,
  p_claim_content TEXT,
  p_actor_key TEXT
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_claim_count INT;
  v_existing_id BIGINT;
  v_claim_id BIGINT;
BEGIN
  -- 检查重复领取
  SELECT id INTO v_existing_id FROM posts
  WHERE actor_key = p_actor_key AND media_type = '__pro_gift_claim__'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '你已经领取过该活动');
  END IF;

  -- 检查总名额（原子 count）
  SELECT COUNT(*) INTO v_claim_count FROM posts
  WHERE media_type = '__pro_gift_claim__' AND media_url = p_gift_id;

  IF p_claim_limit > 0 AND v_claim_count >= p_claim_limit THEN
    RETURN jsonb_build_object('ok', false, 'error', '活动名额已满');
  END IF;

  -- 插入领取记录
  INSERT INTO posts (user_name, media_type, media_url, content, actor_key)
  VALUES (p_user_name, '__pro_gift_claim__', p_gift_id, p_claim_content, p_actor_key)
  RETURNING id INTO v_claim_id;

  -- 插入 VIP 激活记录
  IF p_vip_content IS NOT NULL AND p_vip_content != '' THEN
    INSERT INTO posts (user_name, content, media_type, actor_key)
    VALUES (p_user_name, p_vip_content, '__pro_vip_active__', 'pro_vip_' || p_gift_id || '_' || p_user_name);
  END IF;

  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id);
END;
$$;
