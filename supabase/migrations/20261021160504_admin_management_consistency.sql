BEGIN;

-- JSON metadata is stored as text for compatibility with historical records.
-- Page and independent counts share one snapshot; equal timestamps use UUIDs.
CREATE INDEX IF NOT EXISTS posts_admin_report_page_idx ON public.posts(created_at DESC, id DESC)
  WHERE media_type='__report__';

CREATE OR REPLACE FUNCTION public.admin_report_page(
  p_status text DEFAULT 'all', p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, xtj_private AS $$
DECLARE result jsonb;
BEGIN
  IF p_status NOT IN ('all','pending','reviewed','actioned','dismissed') OR p_status IS NULL
     OR (p_before_at IS NULL) <> (p_before_id IS NULL) OR p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request');
  END IF;
  WITH reports AS MATERIALIZED (
    SELECT p.*, coalesce(nullif(btrim(xtj_private.safe_jsonb(p.content)->>'status'),''),
      nullif(btrim(xtj_private.safe_jsonb(p.content)->>'review_status'),''),'pending') AS report_status
    FROM public.posts p WHERE p.media_type='__report__'
  ), page AS MATERIALIZED (
    SELECT * FROM reports
    WHERE (p_status='all' OR report_status=p_status)
      AND (p_before_at IS NULL OR (created_at,id)<(p_before_at,p_before_id))
    ORDER BY created_at DESC,id DESC LIMIT p_limit+1
  ), visible AS (
    SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT p_limit
  )
  SELECT jsonb_build_object('ok',true,
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(v)-'report_status' ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
    'total',(SELECT count(*) FROM reports),
    'filtered_total',(SELECT count(*) FROM reports WHERE p_status='all' OR report_status=p_status),
    'pending_count',(SELECT count(*) FROM reports WHERE report_status='pending'),
    'actioned_count',(SELECT count(*) FROM reports WHERE report_status='actioned'),
    'has_more',(SELECT count(*)>p_limit FROM page),
    'next_cursor',CASE WHEN (SELECT count(*)>p_limit FROM page) THEN
      (SELECT jsonb_build_object('before_at',created_at,'before_id',id) FROM visible ORDER BY created_at,id LIMIT 1)
      ELSE NULL END) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_report_page(text,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_page(text,timestamptz,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.review_security_alert(p_id uuid,p_operator text,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, xtj_private AS $$
DECLARE row_data public.posts; info jsonb;
BEGIN
  IF p_operator IS NULL OR btrim(p_operator)='' OR p_status IS NULL OR p_status NOT IN ('read','ignored','false_positive') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request');
  END IF;
  SELECT * INTO row_data FROM public.posts WHERE id=p_id AND media_type='__security_alert__' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  BEGIN
    info:=row_data.content::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_record');
  END;
  IF info IS NULL OR jsonb_typeof(info)<>'object' THEN RETURN jsonb_build_object('ok',false,'code','invalid_record'); END IF;
  info:=info||jsonb_build_object('is_read',true);
  -- A read never removes review flags or changes the review author/time.
  IF p_status IN ('ignored','false_positive') THEN
    info:=info||jsonb_build_object('ignored',true,'reviewed_at',clock_timestamp(),'reviewed_by',p_operator);
  END IF;
  IF p_status='false_positive' THEN info:=info||jsonb_build_object('false_positive',true); END IF;
  UPDATE public.posts SET content=info::text WHERE id=p_id AND media_type='__security_alert__';
  RETURN jsonb_build_object('ok',true,'id',p_id,'status',p_status);
END $$;
REVOKE ALL ON FUNCTION public.review_security_alert(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_security_alert(uuid,text,text) TO service_role;

COMMIT;
