-- Conversation settings belong to one member. Shared messages are never removed
-- by clear/delete; the per-member cutoff controls visibility.
BEGIN;

ALTER TABLE public.chat_conversation_members
  ADD COLUMN manual_unread_at timestamptz,
  ADD COLUMN draft_revision bigint NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  ADD COLUMN draft_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.chat_get_conversation_state(p_actor_name text, p_peer_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public
AS $function$
  SELECT coalesce((
    SELECT jsonb_build_object(
      'status','ok','conversation_id', c.id, 'peer_name',peer.user_name,
      'deleted', own.left_at IS NOT NULL, 'left_at',own.left_at,
      'cleared_before',own.cleared_before,'pinned_at',own.pinned_at,
      'muted_until',own.muted_until,'manual_unread_at',own.manual_unread_at,
      'draft_text',own.draft_text,'draft_revision',own.draft_revision
    )
    FROM public.chat_users actor
    JOIN public.chat_conversation_members own ON own.user_id=actor.id
    JOIN public.chat_conversations c ON c.id=own.conversation_id AND c.conversation_type='direct'
    JOIN public.chat_conversation_members other ON other.conversation_id=c.id AND other.user_id<>actor.id
    JOIN public.chat_users peer ON peer.id=other.user_id
    WHERE actor.user_name=p_actor_name AND peer.user_name=p_peer_name
    LIMIT 1
  ), '{"status":"not_found"}'::jsonb);
$function$;

CREATE OR REPLACE FUNCTION public.chat_list_conversations(p_actor_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'conversation_id',c.id,'peer_name',peer.user_name,
    'deleted',own.left_at IS NOT NULL,'pinned_at',own.pinned_at,
    'muted_until',own.muted_until,'cleared_before',own.cleared_before,
    'draft_text',own.draft_text,'draft_revision',own.draft_revision,
    'manual_unread_at',own.manual_unread_at,
    'last_message',CASE WHEN recent.withdrawn_at IS NOT NULL THEN '[消息已撤回]' ELSE coalesce(recent.body,'') END,
    'last_message_type',recent.message_type,
    'last_message_at',recent.sent_at,
    'unread_count',CASE WHEN own.left_at IS NOT NULL THEN 0 ELSE greatest(
      coalesce(unread.total,0),CASE WHEN own.manual_unread_at IS NOT NULL THEN 1 ELSE 0 END
    ) END
  ) ORDER BY own.pinned_at DESC NULLS LAST,recent.sent_at DESC NULLS LAST,c.created_at DESC), '[]'::jsonb)
  FROM public.chat_users actor
  JOIN public.chat_conversation_members own ON own.user_id=actor.id
  JOIN public.chat_conversations c ON c.id=own.conversation_id AND c.conversation_type='direct'
  JOIN public.chat_conversation_members other ON other.conversation_id=c.id AND other.user_id<>actor.id
  JOIN public.chat_users peer ON peer.id=other.user_id
  LEFT JOIN LATERAL (
    SELECT m.body,m.message_type,m.sent_at,m.withdrawn_at
    FROM public.chat_messages m
    LEFT JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=actor.id
    WHERE m.conversation_id=c.id AND (own.cleared_before IS NULL OR m.sent_at>own.cleared_before)
      AND s.hidden_at IS NULL AND own.left_at IS NULL
    ORDER BY m.sent_at DESC,m.id DESC LIMIT 1
  ) recent ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS total FROM public.chat_messages m
    LEFT JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=actor.id
    WHERE m.conversation_id=c.id AND m.sender_id IS DISTINCT FROM actor.id
      AND (own.cleared_before IS NULL OR m.sent_at>own.cleared_before)
      AND s.read_at IS NULL AND s.hidden_at IS NULL AND own.left_at IS NULL
  ) unread ON true
  WHERE actor.user_name=p_actor_name;
$function$;

CREATE OR REPLACE FUNCTION public.chat_manage_conversation(
  p_actor_name text, p_peer_name text, p_action text,
  p_draft_text text DEFAULT NULL, p_draft_revision bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $function$
DECLARE
  v_actor uuid; v_peer uuid; v_conversation uuid; v_member public.chat_conversation_members%ROWTYPE;
  v_now timestamptz := clock_timestamp(); v_latest uuid;
BEGIN
  IF p_action NOT IN ('pin','unpin','mute','unmute','mark_read','mark_unread','clear','delete','draft')
    THEN RETURN jsonb_build_object('status','invalid_action'); END IF;
  SELECT id INTO v_actor FROM public.chat_users WHERE user_name=p_actor_name AND is_registered AND deleted_at IS NULL;
  SELECT id INTO v_peer FROM public.chat_users WHERE user_name=p_peer_name AND is_registered AND deleted_at IS NULL;
  IF v_actor IS NULL OR v_peer IS NULL OR v_actor=v_peer THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT c.id INTO v_conversation FROM public.chat_conversations c
    WHERE c.direct_key=least(v_actor,v_peer)::text||':'||greatest(v_actor,v_peer)::text
      AND c.conversation_type='direct';
  IF v_conversation IS NULL AND p_action='draft' THEN
    PERFORM public.chat_lock_pair(v_actor,v_peer);
    IF NOT EXISTS (SELECT 1 FROM public.chat_friendships f
      WHERE f.user_low_id=least(v_actor,v_peer) AND f.user_high_id=greatest(v_actor,v_peer))
      AND p_actor_name<>'xxz' AND p_peer_name<>'xxz' THEN
      RETURN jsonb_build_object('status','not_found');
    END IF;
    IF EXISTS (SELECT 1 FROM public.chat_user_blocks b WHERE
      (b.blocker_id=v_actor AND b.blocked_id=v_peer) OR
      (b.blocker_id=v_peer AND b.blocked_id=v_actor)) THEN
      RETURN jsonb_build_object('status','not_found');
    END IF;
    INSERT INTO public.chat_conversations(conversation_type,direct_key,created_by)
      VALUES ('direct',least(v_actor,v_peer)::text||':'||greatest(v_actor,v_peer)::text,v_actor)
      ON CONFLICT (direct_key) DO NOTHING;
    SELECT id INTO v_conversation FROM public.chat_conversations
      WHERE direct_key=least(v_actor,v_peer)::text||':'||greatest(v_actor,v_peer)::text;
    INSERT INTO public.chat_conversation_members(conversation_id,user_id)
      VALUES(v_conversation,v_actor),(v_conversation,v_peer)
      ON CONFLICT DO NOTHING;
  END IF;
  IF v_conversation IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT * INTO v_member FROM public.chat_conversation_members
    WHERE conversation_id=v_conversation AND user_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF v_member.left_at IS NOT NULL AND p_action NOT IN ('draft') THEN
    RETURN jsonb_build_object('status','deleted');
  END IF;
  IF p_action='draft' THEN
    IF v_member.left_at IS NOT NULL THEN RETURN jsonb_build_object('status','deleted'); END IF;
    IF length(coalesce(p_draft_text,''))>500 THEN RETURN jsonb_build_object('status','draft_too_long'); END IF;
    IF p_draft_revision IS DISTINCT FROM v_member.draft_revision THEN
      RETURN jsonb_build_object('status','revision_conflict','draft_revision',v_member.draft_revision);
    END IF;
    UPDATE public.chat_conversation_members SET draft_text=nullif(p_draft_text,''),
      draft_revision=draft_revision+1,draft_updated_at=v_now,updated_at=v_now
      WHERE conversation_id=v_conversation AND user_id=v_actor;
  ELSIF p_action='mark_read' THEN
    INSERT INTO public.chat_message_user_state(message_id,user_id,read_at,updated_at)
      SELECT m.id,v_actor,v_now,v_now FROM public.chat_messages m
      LEFT JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=v_actor
      WHERE m.conversation_id=v_conversation AND m.sender_id IS DISTINCT FROM v_actor
        AND (v_member.cleared_before IS NULL OR m.sent_at>v_member.cleared_before)
        AND s.hidden_at IS NULL AND s.read_at IS NULL
      ON CONFLICT (message_id,user_id) DO UPDATE SET read_at=excluded.read_at,updated_at=v_now;
    SELECT m.id INTO v_latest FROM public.chat_messages m
      WHERE m.conversation_id=v_conversation ORDER BY m.sent_at DESC,m.id DESC LIMIT 1;
    UPDATE public.chat_conversation_members SET manual_unread_at=NULL,last_read_at=v_now,
      last_read_message_id=v_latest,updated_at=v_now WHERE conversation_id=v_conversation AND user_id=v_actor;
  ELSE
    UPDATE public.chat_conversation_members SET
      pinned_at=CASE WHEN p_action='pin' THEN v_now WHEN p_action IN ('unpin','delete') THEN NULL ELSE pinned_at END,
      muted_until=CASE WHEN p_action='mute' THEN 'infinity'::timestamptz WHEN p_action IN ('unmute','delete') THEN NULL ELSE muted_until END,
      manual_unread_at=CASE WHEN p_action='mark_unread' THEN v_now WHEN p_action IN ('clear','delete') THEN NULL ELSE manual_unread_at END,
      cleared_before=CASE WHEN p_action IN ('clear','delete') THEN v_now ELSE cleared_before END,
      left_at=CASE WHEN p_action='delete' THEN v_now ELSE left_at END,
      draft_text=CASE WHEN p_action='delete' THEN NULL ELSE draft_text END,
      draft_revision=CASE WHEN p_action='delete' THEN draft_revision+1 ELSE draft_revision END,
      updated_at=v_now
      WHERE conversation_id=v_conversation AND user_id=v_actor;
  END IF;
  RETURN public.chat_get_conversation_state(p_actor_name,p_peer_name);
END;
$function$;

-- A genuinely new message resurrects a conversation deleted by either member.
-- Backfills and message updates do not affect visibility or clear cutoffs.
CREATE OR REPLACE FUNCTION public.chat_reopen_on_new_message()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id=NEW.conversation_id AND c.conversation_type='direct') THEN
    UPDATE public.chat_conversation_members SET left_at=NULL,updated_at=clock_timestamp()
      WHERE conversation_id=NEW.conversation_id AND left_at IS NOT NULL AND NEW.sent_at>left_at;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER chat_reopen_new_message AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_reopen_on_new_message();

REVOKE ALL ON FUNCTION public.chat_get_conversation_state(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chat_list_conversations(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chat_manage_conversation(text,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chat_reopen_on_new_message() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_get_conversation_state(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_list_conversations(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_manage_conversation(text,text,text,text,bigint) TO service_role;
COMMIT;
