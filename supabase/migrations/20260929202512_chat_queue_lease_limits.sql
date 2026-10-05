BEGIN;
CREATE OR REPLACE FUNCTION public.chat_claim_transcription(p_token uuid)
RETURNS SETOF public.chat_transcription_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
BEGIN
 UPDATE public.chat_transcription_jobs SET status='failed',lease_until=NULL,last_error='lease_expired'
 WHERE status='processing' AND lease_until<now() AND attempts>=3;
 RETURN QUERY UPDATE public.chat_transcription_jobs j SET status='processing', attempts=j.attempts+1, lease_token=p_token, lease_until=now()+interval '3 minutes'
 WHERE j.message_id=(SELECT q.message_id FROM public.chat_transcription_jobs q
 WHERE q.attempts<3 AND ((q.status='queued' AND q.available_at<=now()) OR (q.status='processing' AND q.lease_until<now()))
 ORDER BY q.available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING j.*;
END;
$function$;
CREATE POLICY chat_transcription_browser_deny ON public.chat_transcription_jobs AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY chat_reactions_browser_deny ON public.chat_message_reactions AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
COMMIT;
