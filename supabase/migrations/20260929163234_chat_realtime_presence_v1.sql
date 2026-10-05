-- Presence is a short lease derived from the most recent heartbeat. Persisting
-- the timestamp also provides a useful last-seen value after the lease expires.
BEGIN;
ALTER TABLE public.chat_users ADD COLUMN last_seen_at timestamptz;

CREATE OR REPLACE FUNCTION public.chat_touch_presence(p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $function$
DECLARE v_id uuid; v_previous timestamptz; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT id,last_seen_at INTO v_id,v_previous FROM public.chat_users
    WHERE user_name=p_actor_name AND is_registered AND deleted_at IS NULL FOR UPDATE;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  UPDATE public.chat_users SET last_seen_at=v_now WHERE id=v_id;
  RETURN jsonb_build_object('status','ok','last_seen_at',v_now,
    'became_online',v_previous IS NULL OR v_previous<v_now-interval '80 seconds');
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_get_presence(p_actor_name text,p_peer_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $function$
  SELECT coalesce((SELECT jsonb_build_object('status','ok','last_seen_at',peer.last_seen_at,
    'online',peer.last_seen_at>clock_timestamp()-interval '80 seconds')
    FROM public.chat_users actor JOIN public.chat_users peer ON peer.user_name=p_peer_name
    JOIN public.chat_friendships friendship
      ON friendship.user_low_id=least(actor.id,peer.id)
      AND friendship.user_high_id=greatest(actor.id,peer.id)
    WHERE actor.user_name=p_actor_name AND actor.is_registered AND actor.deleted_at IS NULL
      AND peer.is_registered AND peer.deleted_at IS NULL AND actor.id<>peer.id
      AND NOT EXISTS (SELECT 1 FROM public.chat_user_blocks b
        WHERE (b.blocker_id=actor.id AND b.blocked_id=peer.id)
          OR (b.blocker_id=peer.id AND b.blocked_id=actor.id))
    LIMIT 1),'{"status":"forbidden"}'::jsonb);
$function$;

-- The legacy message renderer still reads the receipt from posts.content.
-- Mirror a bulk conversation read into those rows so all sender devices see
-- the same receipt, including messages outside the newest page.
CREATE OR REPLACE FUNCTION public.chat_sync_legacy_read_receipts(p_actor_name text,p_peer_name text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $function$
DECLARE v_conversation uuid; v_actor uuid; v_peer uuid; v_count integer;
BEGIN
  SELECT id INTO v_actor FROM public.chat_users WHERE user_name=p_actor_name AND is_registered AND deleted_at IS NULL;
  SELECT id INTO v_peer FROM public.chat_users WHERE user_name=p_peer_name AND is_registered AND deleted_at IS NULL;
  IF v_actor IS NULL OR v_peer IS NULL OR v_actor=v_peer THEN RETURN 0; END IF;
  SELECT c.id INTO v_conversation FROM public.chat_conversations c
    JOIN public.chat_conversation_members member ON member.conversation_id=c.id AND member.user_id=v_actor
    WHERE c.conversation_type='direct' AND member.left_at IS NULL
      AND c.direct_key=least(v_actor,v_peer)::text||':'||greatest(v_actor,v_peer)::text;
  IF v_conversation IS NULL THEN RETURN 0; END IF;
  UPDATE public.posts p
    SET content=jsonb_set(public.chat_safe_legacy_payload(p.content),'{read_at}',
      to_jsonb(clock_timestamp()::text),true)::text,
      views=greatest(coalesce(p.views,0),1)
    WHERE p.media_type='__dm__' AND p.media_url=p_actor_name AND p.user_name=p_peer_name
      AND nullif(public.chat_safe_legacy_payload(p.content)->>'read_at','') IS NULL
      AND EXISTS (SELECT 1 FROM public.chat_messages m
        JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=v_actor
        JOIN public.chat_conversation_members own ON own.conversation_id=m.conversation_id AND own.user_id=v_actor
        WHERE m.legacy_post_id=p.id AND m.conversation_id=v_conversation
          AND (own.cleared_before IS NULL OR m.sent_at>own.cleared_before)
          AND s.read_at IS NOT NULL AND s.hidden_at IS NULL);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_touch_presence(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chat_get_presence(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chat_sync_legacy_read_receipts(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_touch_presence(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_get_presence(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_sync_legacy_read_receipts(text,text) TO service_role;
COMMIT;
