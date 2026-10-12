BEGIN;

-- Update only the requested fields under a row lock; notification append and
-- review changes commit together and never write a stale JSON snapshot.
CREATE OR REPLACE FUNCTION public.mutate_report_record(
  p_report_id uuid, p_patch jsonb DEFAULT '{}'::jsonb, p_notification jsonb DEFAULT NULL,
  p_reader text DEFAULT NULL, p_read_before timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_row public.posts; v_body jsonb; v_notes jsonb; v_patch jsonb; v_marked boolean := false;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR octet_length(p_patch::text)>16384
    OR (p_notification IS NOT NULL AND (jsonb_typeof(p_notification) IS DISTINCT FROM 'object' OR octet_length(p_notification::text)>8192)) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request');
  END IF;
  SELECT * INTO v_row FROM public.posts WHERE id=p_report_id AND media_type='__report__' FOR UPDATE;
  IF NOT FOUND OR (p_reader IS NOT NULL AND v_row.user_name IS DISTINCT FROM p_reader) THEN
    RETURN jsonb_build_object('ok',false,'code','not_found');
  END IF;
  v_body := coalesce(xtj_private.safe_jsonb(v_row.content),'{}'::jsonb);
  SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO v_patch FROM jsonb_each(p_patch)
    WHERE key IN ('status','admin_response','reviewed_at','reviewed_by','response_at');
  v_body := v_body || v_patch;
  v_notes := CASE WHEN jsonb_typeof(v_body->'notifications')='array' THEN v_body->'notifications' ELSE '[]'::jsonb END;
  IF p_reader IS NOT NULL AND p_read_before IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(CASE WHEN (n->>'is_read') IS DISTINCT FROM 'true'
      AND coalesce(n->>'created_at','') <= to_char(p_read_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      THEN n||jsonb_build_object('is_read',true) ELSE n END ORDER BY ord),'[]'::jsonb),
      coalesce(bool_or((n->>'is_read') IS DISTINCT FROM 'true' AND coalesce(n->>'created_at','') <= to_char(p_read_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),false)
      INTO v_notes,v_marked FROM jsonb_array_elements(v_notes) WITH ORDINALITY t(n,ord);
  END IF;
  IF p_notification IS NOT NULL THEN
    v_notes := v_notes || jsonb_build_array(p_notification||jsonb_build_object('id',gen_random_uuid(),'is_read',false));
  END IF;
  v_body := v_body || jsonb_build_object('notifications',v_notes);
  UPDATE public.posts SET content=v_body::text WHERE id=p_report_id;
  RETURN jsonb_build_object('ok',true,'marked',v_marked,'user_name',v_row.user_name);
END $$;
REVOKE ALL ON FUNCTION public.mutate_report_record(uuid,jsonb,jsonb,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_report_record(uuid,jsonb,jsonb,text,timestamptz) TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_email_daily_quota (
  quota_day date PRIMARY KEY, occupied integer NOT NULL CHECK(occupied>=0)
);
CREATE TABLE IF NOT EXISTS public.admin_email_jobs (
  id uuid PRIMARY KEY, actor text NOT NULL, fingerprint text NOT NULL,
  quota_day date NOT NULL REFERENCES public.admin_email_daily_quota(quota_day),
  subject text NOT NULL, status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','completed','uncertain')),
  ledger_record_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_email_deliveries (
  job_id uuid NOT NULL REFERENCES public.admin_email_jobs(id), email text NOT NULL,
  user_name text NOT NULL, status text NOT NULL DEFAULT 'reserved'
    CHECK(status IN ('reserved','sending','sent','failed','unknown')),
  error text, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,email)
);
ALTER TABLE public.admin_email_daily_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_email_daily_quota,public.admin_email_jobs,public.admin_email_deliveries FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.admin_email_daily_quota,public.admin_email_jobs,public.admin_email_deliveries TO service_role;
CREATE INDEX IF NOT EXISTS admin_email_jobs_created ON public.admin_email_jobs(created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_email_job_snapshot(p_job_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT coalesce((SELECT jsonb_build_object('ok',true,'id',j.id,'status',j.status,'subject',j.subject,'created_at',j.created_at,
    'deliveries',coalesce((SELECT jsonb_agg(jsonb_build_object('email',d.email,'user_name',d.user_name,'status',d.status,'error',d.error) ORDER BY d.email)
      FROM public.admin_email_deliveries d WHERE d.job_id=j.id),'[]'::jsonb))
    FROM public.admin_email_jobs j WHERE j.id=p_job_id),jsonb_build_object('ok',false,'code','not_found'));
$$;

CREATE OR REPLACE FUNCTION public.reserve_admin_email_job(
 p_job_id uuid,p_actor text,p_fingerprint text,p_recipients jsonb,p_subject text,p_daily_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_job public.admin_email_jobs; v_day date := (now() AT TIME ZONE 'UTC')::date;
  v_count integer; v_occupied integer; v_legacy integer;
BEGIN
 IF p_job_id IS NULL OR coalesce(p_actor,'')='' OR coalesce(p_fingerprint,'') !~ '^[a-f0-9]{64}$'
   OR jsonb_typeof(p_recipients) IS DISTINCT FROM 'array' OR p_daily_limit<1 THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_request');
 END IF;
 v_count:=jsonb_array_length(p_recipients);
 IF v_count<1 OR v_count>100 OR (SELECT count(DISTINCT lower(r->>'email')) FROM jsonb_array_elements(p_recipients) r)<>v_count
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_recipients) r WHERE coalesce(r->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(r->>'email')>254) THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_request');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('admin_email_job:'||p_job_id::text,0));
 SELECT * INTO v_job FROM public.admin_email_jobs WHERE id=p_job_id FOR UPDATE;
 IF FOUND THEN
   IF v_job.actor<>p_actor OR v_job.fingerprint<>p_fingerprint THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict'); END IF;
   RETURN public.admin_email_job_snapshot(p_job_id)||jsonb_build_object('created',false);
 END IF;
 -- Import existing successful sends once, before the first reservation that day.
 SELECT coalesce(sum(CASE WHEN (xtj_private.safe_jsonb(content)->>'sent_count') ~ '^[0-9]{1,7}$'
   THEN (xtj_private.safe_jsonb(content)->>'sent_count')::integer ELSE 0 END),0) INTO v_legacy
   FROM public.posts WHERE media_type='__email_sent__' AND created_at >= (v_day::timestamp AT TIME ZONE 'UTC')
     AND created_at < ((v_day+1)::timestamp AT TIME ZONE 'UTC');
 INSERT INTO public.admin_email_daily_quota(quota_day,occupied) VALUES(v_day,v_legacy) ON CONFLICT DO NOTHING;
 SELECT occupied INTO v_occupied FROM public.admin_email_daily_quota WHERE quota_day=v_day FOR UPDATE;
 IF v_occupied+v_count>p_daily_limit THEN RETURN jsonb_build_object('ok',false,'code','email_daily_limit'); END IF;
 UPDATE public.admin_email_daily_quota SET occupied=occupied+v_count WHERE quota_day=v_day;
 INSERT INTO public.admin_email_jobs(id,actor,fingerprint,quota_day,subject) VALUES(p_job_id,p_actor,p_fingerprint,v_day,left(p_subject,200));
 INSERT INTO public.admin_email_deliveries(job_id,email,user_name)
   SELECT p_job_id,lower(r->>'email'),left(coalesce(nullif(r->>'user_name',''),r->>'email'),100) FROM jsonb_array_elements(p_recipients) r;
 RETURN public.admin_email_job_snapshot(p_job_id)||jsonb_build_object('created',true);
END $$;

CREATE OR REPLACE FUNCTION public.claim_admin_email_delivery(p_job_id uuid,p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_count integer;
BEGIN
 PERFORM 1 FROM public.admin_email_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 UPDATE public.admin_email_deliveries SET status='sending',updated_at=now() WHERE job_id=p_job_id AND email=p_email AND status='reserved';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'claimed',v_count=1);
END $$;

CREATE OR REPLACE FUNCTION public.settle_admin_email_delivery(p_job_id uuid,p_email text,p_status text,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_job public.admin_email_jobs; v_delivery public.admin_email_deliveries;
BEGIN
 IF p_status NOT IN ('sent','failed','unknown') THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
 SELECT * INTO v_job FROM public.admin_email_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 SELECT * INTO v_delivery FROM public.admin_email_deliveries WHERE job_id=p_job_id AND email=p_email FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF v_delivery.status=p_status THEN RETURN jsonb_build_object('ok',true); END IF;
 IF v_delivery.status<>'sending' THEN RETURN jsonb_build_object('ok',false,'code','delivery_conflict'); END IF;
 UPDATE public.admin_email_deliveries SET status=p_status,error=left(p_error,200),updated_at=now() WHERE job_id=p_job_id AND email=p_email;
 IF p_status='failed' THEN UPDATE public.admin_email_daily_quota SET occupied=occupied-1 WHERE quota_day=v_job.quota_day; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.finish_admin_email_job(p_job_id uuid,p_from_email text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_job public.admin_email_jobs; v_sent integer; v_failed integer; v_unknown integer; v_released integer; v_record uuid; v_details jsonb;
BEGIN
 SELECT * INTO v_job FROM public.admin_email_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 -- An interrupted batch releases recipients never handed to a transport. A
 -- 'sending' recipient remains unknown/occupied, so restart cannot duplicate it.
 UPDATE public.admin_email_deliveries SET status='failed',error='未尝试发送',updated_at=now() WHERE job_id=p_job_id AND status='reserved';
 GET DIAGNOSTICS v_released=ROW_COUNT;
 IF v_released>0 THEN UPDATE public.admin_email_daily_quota SET occupied=occupied-v_released WHERE quota_day=v_job.quota_day; END IF;
 UPDATE public.admin_email_deliveries SET status='unknown',error='发送结果尚未确认',updated_at=now() WHERE job_id=p_job_id AND status='sending';
 SELECT count(*) FILTER(WHERE status='sent'),count(*) FILTER(WHERE status='failed'),count(*) FILTER(WHERE status='unknown'),
   coalesce(jsonb_agg(jsonb_build_object('email',email,'user_name',user_name,'status',status,'error',error) ORDER BY email),'[]'::jsonb)
 INTO v_sent,v_failed,v_unknown,v_details FROM public.admin_email_deliveries WHERE job_id=p_job_id;
 IF v_job.ledger_record_id IS NULL THEN
  INSERT INTO public.posts(user_name,media_type,content,actor_key,visibility)
   VALUES(v_job.actor,'__email_sent__',jsonb_build_object('request_id',p_job_id,'from_email',p_from_email,'subject',v_job.subject,
     'sent_count',v_sent,'failed_count',v_failed,'unknown_count',v_unknown,'total_recipients',v_sent+v_failed+v_unknown,'recipients_detail',v_details,'sent_at',now())::text,
     'email_job_'||p_job_id::text,'private') RETURNING id INTO v_record;
 ELSE v_record:=v_job.ledger_record_id; END IF;
 UPDATE public.admin_email_jobs SET status=CASE WHEN v_unknown>0 THEN 'uncertain' ELSE 'completed' END,ledger_record_id=v_record,updated_at=now() WHERE id=p_job_id;
 RETURN public.admin_email_job_snapshot(p_job_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_email_job_snapshot(uuid),public.reserve_admin_email_job(uuid,text,text,jsonb,text,integer),
 public.claim_admin_email_delivery(uuid,text),public.settle_admin_email_delivery(uuid,text,text,text),public.finish_admin_email_job(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_email_job_snapshot(uuid),public.reserve_admin_email_job(uuid,text,text,jsonb,text,integer),
 public.claim_admin_email_delivery(uuid,text),public.settle_admin_email_delivery(uuid,text,text,text),public.finish_admin_email_job(uuid,text) TO service_role;
COMMIT;
