BEGIN;
-- No signed token or plaintext client nonce is persisted. Recovery needs both
-- the signed predecessor Cookie and the original random request nonce.
CREATE TABLE xtj_private.refresh_rotation_receipts (
 old_jti text PRIMARY KEY, user_name text NOT NULL, account_id text NOT NULL,
 auth_record_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
 successor_record_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 successor jsonb NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX refresh_rotation_receipts_expiry_idx ON xtj_private.refresh_rotation_receipts(expires_at);
ALTER TABLE xtj_private.refresh_rotation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtj_private.refresh_rotation_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON xtj_private.refresh_rotation_receipts TO service_role;
CREATE FUNCTION public.rotate_user_refresh_token_v2(p_user_name text,p_account_id text,p_old_jti text,p_request_hash text,p_successor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE account public.posts; receipt xtj_private.refresh_rotation_receipts; successor_id uuid; rotated jsonb; candidate jsonb; expiry timestamptz;
BEGIN
 IF p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid request hash' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('xtj:refresh:'||p_old_jti,0));
 SELECT * INTO account FROM public.posts WHERE user_name=p_user_name AND media_type IN ('__auth__','__admin_auth__')
   ORDER BY (media_type='__auth__') DESC,created_at DESC LIMIT 1 FOR KEY SHARE;
 IF (account.id IS NULL AND p_account_id IS DISTINCT FROM 'admin:'||p_user_name)
   OR (account.id IS NOT NULL AND account.id::text IS DISTINCT FROM p_account_id)
 THEN RETURN jsonb_build_object('ok',false,'code','account_changed'); END IF;
 DELETE FROM xtj_private.refresh_rotation_receipts WHERE expires_at<=now();
 SELECT * INTO receipt FROM xtj_private.refresh_rotation_receipts WHERE old_jti=p_old_jti;
 IF FOUND THEN
  IF receipt.user_name IS DISTINCT FROM p_user_name OR receipt.account_id IS DISTINCT FROM p_account_id
    OR receipt.request_hash IS DISTINCT FROM p_request_hash OR receipt.expires_at<=now()
  THEN RETURN jsonb_build_object('ok',false,'code','token_reused'); END IF;
  PERFORM id FROM public.posts WHERE id=receipt.successor_record_id AND user_name=p_user_name
    AND media_type='__refresh_token__' AND media_url=receipt.successor->>'jti' FOR KEY SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','token_reused'); END IF;
  RETURN jsonb_build_object('ok',true,'recovered',true,'successor',receipt.successor);
 END IF;
 IF jsonb_typeof(p_successor) IS DISTINCT FROM 'object' OR p_successor->>'type' IS DISTINCT FROM 'user_refresh'
   OR p_successor->>'user_name' IS DISTINCT FROM p_user_name OR p_successor->>'account_id' IS DISTINCT FROM p_account_id
   OR coalesce(p_successor->>'jti','') !~ '^[a-f0-9-]{36}$' OR jsonb_typeof(p_successor->'exp') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'invalid successor' USING ERRCODE='22023'; END IF;
 expiry:=to_timestamp((p_successor->>'exp')::double precision/1000);
 IF expiry<=now() OR expiry>now()+interval '91 days' THEN RAISE EXCEPTION 'invalid successor expiry' USING ERRCODE='22023'; END IF;
 candidate:=jsonb_build_object('type','user_refresh','user_name',p_user_name,'account_id',p_account_id,'jti',p_successor->>'jti','exp',p_successor->'exp');
 IF p_successor ? 'did' THEN
  IF coalesce(p_successor->>'did','') !~ '^[a-zA-Z0-9_-]{22}$' THEN RAISE EXCEPTION 'invalid device hash' USING ERRCODE='22023'; END IF;
  candidate:=candidate||jsonb_build_object('did',p_successor->>'did');
 END IF;
 rotated:=public.rotate_user_refresh_token(p_user_name,p_account_id,p_old_jti,candidate->>'jti',expiry);
 IF rotated->>'ok' IS DISTINCT FROM 'true' THEN RETURN rotated; END IF;
 SELECT id INTO STRICT successor_id FROM public.posts WHERE media_type='__refresh_token__' AND user_name=p_user_name AND media_url=candidate->>'jti';
 INSERT INTO xtj_private.refresh_rotation_receipts(old_jti,user_name,account_id,auth_record_id,successor_record_id,request_hash,successor,expires_at)
 VALUES(p_old_jti,p_user_name,p_account_id,account.id,successor_id,p_request_hash,candidate,least(expiry,now()+interval '10 minutes'));
 RETURN jsonb_build_object('ok',true,'recovered',false,'successor',candidate);
END $$;
-- A logout carrying an unacknowledged predecessor must also revoke its live
-- successor. Rotation and logout take the same predecessor lock.
CREATE FUNCTION public.revoke_user_refresh_session(p_user_name text,p_account_id text,p_jti text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE ids text[]; scope_account text:=p_account_id;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('xtj:refresh:'||p_jti,0));
 -- Accountless legacy Cookies still prove ownership of their random signed JTI.
 -- Bind their receipt lineage to its captured account before revoking it.
 IF scope_account IS NULL THEN
  SELECT r.account_id INTO scope_account FROM xtj_private.refresh_rotation_receipts r WHERE r.old_jti=p_jti AND r.user_name=p_user_name;
 END IF;
 WITH RECURSIVE chain(jti) AS (
  SELECT p_jti UNION SELECT r.successor->>'jti' FROM xtj_private.refresh_rotation_receipts r JOIN chain c ON r.old_jti=c.jti
  WHERE r.user_name=p_user_name AND (scope_account IS NULL OR r.account_id=scope_account)
 ) SELECT array_agg(jti) INTO ids FROM chain;
 DELETE FROM public.posts WHERE media_type='__refresh_token__' AND user_name=p_user_name AND media_url=ANY(ids)
  AND (scope_account IS NULL OR coalesce(xtj_private.safe_jsonb(content)->>'account_id',scope_account)=scope_account);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.rotate_user_refresh_token_v2(text,text,text,text,jsonb),public.revoke_user_refresh_session(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_user_refresh_token_v2(text,text,text,text,jsonb),public.revoke_user_refresh_session(text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
