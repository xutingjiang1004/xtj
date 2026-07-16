BEGIN;

-- Remove every legacy Pro-claim overload. The two-argument version trusted a
-- caller supplied username, while the five-argument version trusted complete
-- VIP/claim payloads. Neither is safe to expose through PostgREST.
DROP FUNCTION IF EXISTS public.claim_pro_gift(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.claim_pro_gift(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.claim_pro_gift_for_user(
  p_user_name TEXT,
  p_gift_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gift public.posts%ROWTYPE;
  v_info JSONB;
  v_allowed JSONB := '[]'::jsonb;
  v_claim_limit INT := 0;
  v_duration_days INT := 30;
  v_claim_count INT := 0;
  v_claim_id public.posts.id%TYPE;
  v_now TIMESTAMPTZ := now();
  v_expire_at TIMESTAMPTZ;
  v_features JSONB := '[]'::jsonb;
  v_claim_content JSONB;
  v_vip_content JSONB;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' OR p_gift_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Invalid claim request');
  END IF;

  -- Serialize all claims for one campaign so its quota cannot be oversold.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_gift_id::text, 0));
  SELECT * INTO v_gift
  FROM public.posts
  WHERE id = p_gift_id AND media_type = '__pro_gift__'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Campaign not found');
  END IF;

  BEGIN
    v_info := COALESCE(v_gift.content, '{}')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_campaign', 'error', 'Campaign data is invalid');
  END;

  IF COALESCE((v_info->>'is_published')::boolean, false) IS DISTINCT FROM true
     OR COALESCE((v_info->>'is_active')::boolean, true) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_available', 'error', 'Campaign is not available');
  END IF;
  IF NULLIF(v_info->>'start_at', '') IS NOT NULL AND (v_info->>'start_at')::timestamptz > v_now THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_started', 'error', 'Campaign has not started');
  END IF;
  IF NULLIF(v_info->>'end_at', '') IS NOT NULL AND (v_info->>'end_at')::timestamptz < v_now THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired', 'error', 'Campaign has ended');
  END IF;
  IF NULLIF(v_info->>'claim_expire_at', '') IS NOT NULL AND (v_info->>'claim_expire_at')::timestamptz < v_now THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired', 'error', 'Campaign has ended');
  END IF;

  IF jsonb_typeof(COALESCE(v_info->'allowed_users', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(v_info->'exclusive_users', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(v_info->'target_users', '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_campaign', 'error', 'Campaign allowlist is invalid');
  END IF;
  v_allowed := COALESCE(v_info->'allowed_users', '[]'::jsonb)
    || COALESCE(v_info->'exclusive_users', '[]'::jsonb)
    || COALESCE(v_info->'target_users', '[]'::jsonb);
  IF (COALESCE((v_info->>'exclusive')::boolean, false) OR jsonb_array_length(v_allowed) > 0)
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(v_allowed) AS allowed(name)
       WHERE btrim(allowed.name) = p_user_name
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'User is not eligible for this campaign');
  END IF;

  BEGIN
    v_claim_limit := GREATEST(0, COALESCE(
      NULLIF(v_info->>'claim_limit', '')::int,
      NULLIF(v_info->>'limit', '')::int,
      NULLIF(v_info->>'max_claims', '')::int,
      0
    ));
    v_duration_days := GREATEST(1, LEAST(3650, COALESCE(NULLIF(v_info->>'duration_days', '')::int, 30)));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_campaign', 'error', 'Campaign limits are invalid');
  END;
  IF v_info ? 'features' AND jsonb_typeof(v_info->'features') <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_campaign', 'error', 'Campaign features are invalid');
  END IF;
  v_features := COALESCE(v_info->'features', '[]'::jsonb);

  IF EXISTS (
    SELECT 1 FROM public.posts
    WHERE media_type = '__pro_gift_claim__'
      AND media_url = p_gift_id::text
      AND user_name = p_user_name
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_claimed', 'error', 'Campaign already claimed');
  END IF;
  SELECT count(*) INTO v_claim_count
  FROM public.posts
  WHERE media_type = '__pro_gift_claim__' AND media_url = p_gift_id::text;
  IF v_claim_limit > 0 AND v_claim_count >= v_claim_limit THEN
    RETURN jsonb_build_object('ok', false, 'code', 'quota_full', 'error', 'Campaign quota is full');
  END IF;

  v_expire_at := v_now + make_interval(days => v_duration_days);
  v_claim_content := jsonb_build_object(
    'campaign_id', p_gift_id, 'campaign_title', COALESCE(v_info->>'title', ''),
    'user_name', p_user_name, 'claimed_at', v_now, 'vip_expire_at', v_expire_at,
    'features', v_features, 'duration_days', v_duration_days
  );
  v_vip_content := jsonb_build_object(
    'plan_id', 'pro_gift_' || p_gift_id::text,
    'plan_name', 'XTJ Pro (' || COALESCE(v_info->>'title', 'Gift') || ')',
    'price', 0, 'is_active', true,
    'order_no', 'GIFT_' || floor(extract(epoch from v_now) * 1000)::text,
    'start_at', v_now, 'expire_at', v_expire_at, 'features', v_features,
    'activated_at', v_now, 'source', 'pro_gift'
  );

  INSERT INTO public.posts (user_name, media_type, media_url, content, actor_key)
  VALUES (
    p_user_name, '__pro_gift_claim__', p_gift_id::text, v_claim_content::text,
    'pro_claim_' || p_gift_id::text || '_' || p_user_name
  ) RETURNING id INTO v_claim_id;
  INSERT INTO public.posts (user_name, media_type, media_url, content, actor_key)
  VALUES (
    p_user_name, '__vip__', 'pro_monthly', v_vip_content::text,
    'pro_vip_' || p_gift_id::text || '_' || p_user_name
  );

  RETURN jsonb_build_object(
    'ok', true, 'claim_id', v_claim_id, 'plan_name', v_vip_content->>'plan_name',
    'expire_at', v_expire_at, 'features', v_features
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_claimed', 'error', 'Campaign already claimed');
  WHEN invalid_datetime_format THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_campaign', 'error', 'Campaign dates are invalid');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_campaign', 'error', 'Campaign data is invalid');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pro_gift_for_user(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pro_gift_for_user(TEXT, UUID) TO service_role;

-- The browser uses the public anon key, while XTJ identity is established by
-- the application server. Direct Data API writes could therefore impersonate
-- any username and must be closed; authenticated mutations go through the API.
DROP POLICY IF EXISTS anon_likes_insert ON public.likes;
DROP POLICY IF EXISTS anon_comments_insert ON public.comments;
REVOKE INSERT, UPDATE, DELETE ON public.likes FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comments FROM PUBLIC, anon, authenticated;

COMMIT;
