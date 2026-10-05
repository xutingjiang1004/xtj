BEGIN;
CREATE TABLE public.chat_transcription_jobs (
 message_id uuid PRIMARY KEY REFERENCES public.chat_messages(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, transcript text, last_error text,
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_transcription_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_transcription_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.chat_transcription_jobs TO service_role;
CREATE INDEX chat_transcription_jobs_pending ON public.chat_transcription_jobs(available_at) WHERE status IN ('queued','processing');
CREATE FUNCTION public.chat_claim_transcription(p_token uuid)
RETURNS SETOF public.chat_transcription_jobs LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
 UPDATE public.chat_transcription_jobs SET status='processing', attempts=attempts+1, lease_token=p_token, lease_until=now()+interval '3 minutes'
 WHERE message_id=(SELECT message_id FROM public.chat_transcription_jobs
 WHERE (status='queued' AND available_at<=now()) OR (status='processing' AND lease_until<now())
 ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *;
$function$;
REVOKE ALL ON FUNCTION public.chat_claim_transcription(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_claim_transcription(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.chat_get_conversation_state(p_actor_name text, p_peer_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public
AS $function$
  SELECT coalesce((
    SELECT jsonb_build_object(
      'status','ok','conversation_id', c.id, 'peer_name',peer.user_name,
      'deleted', own.left_at IS NOT NULL, 'left_at',own.left_at,
      'archived_at',own.archived_at,'cleared_before',own.cleared_before,'pinned_at',own.pinned_at,
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
    'muted_until',own.muted_until,'archived_at',own.archived_at,'cleared_before',own.cleared_before,
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
  IF p_action NOT IN ('pin','unpin','mute','unmute','mark_read','mark_unread','clear','delete','draft','archive','unarchive')
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
      archived_at=CASE WHEN p_action='archive' THEN v_now WHEN p_action IN ('unarchive','delete') THEN NULL ELSE archived_at END,
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

CREATE FUNCTION public.chat_mutual_friends(p_actor_name text,p_peer_name text,p_before text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
WITH actor AS (SELECT id FROM public.chat_users WHERE user_name=p_actor_name AND is_registered AND deleted_at IS NULL),
peer AS (SELECT id FROM public.chat_users WHERE user_name=p_peer_name AND is_registered AND deleted_at IS NULL),
allowed AS (SELECT a.id actor_id,p.id peer_id FROM actor a,peer p
 WHERE EXISTS (SELECT 1 FROM public.chat_friendships f WHERE f.user_low_id=least(a.id,p.id) AND f.user_high_id=greatest(a.id,p.id))
 AND NOT EXISTS (SELECT 1 FROM public.chat_user_blocks b WHERE (b.blocker_id=a.id AND b.blocked_id=p.id) OR (b.blocker_id=p.id AND b.blocked_id=a.id))),
candidates AS (
 SELECT u.user_name FROM allowed x JOIN public.chat_users u ON u.is_registered AND u.deleted_at IS NULL AND u.id NOT IN (x.actor_id,x.peer_id)
 WHERE EXISTS (SELECT 1 FROM public.chat_friendships f WHERE f.user_low_id=least(x.actor_id,u.id) AND f.user_high_id=greatest(x.actor_id,u.id))
 AND EXISTS (SELECT 1 FROM public.chat_friendships f WHERE f.user_low_id=least(x.peer_id,u.id) AND f.user_high_id=greatest(x.peer_id,u.id))
 AND NOT EXISTS (SELECT 1 FROM public.chat_user_blocks b WHERE
 (b.blocker_id IN (x.actor_id,x.peer_id) AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id IN (x.actor_id,x.peer_id)))
 AND (p_before IS NULL OR u.user_name>p_before) ORDER BY u.user_name LIMIT 51),
page AS (SELECT user_name FROM candidates ORDER BY user_name LIMIT 50)
SELECT jsonb_build_object('status',CASE WHEN EXISTS(SELECT 1 FROM allowed) THEN 'ok' ELSE 'not_found' END,
 'items',coalesce((SELECT jsonb_agg(user_name ORDER BY user_name) FROM page),'[]'::jsonb),
 'has_more',(SELECT count(*)>50 FROM candidates),'cursor',(SELECT max(user_name) FROM page));
$function$;
REVOKE ALL ON FUNCTION public.chat_mutual_friends(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_mutual_friends(text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.chat_search_messages(p_actor_name text, p_peer_name text DEFAULT NULL::text, p_query text DEFAULT ''::text, p_kind text DEFAULT 'all'::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_actor_id uuid;
  v_query text := btrim(coalesce(p_query, ''));
  v_pattern text;
  v_kind text := lower(coalesce(nullif(btrim(p_kind), ''), 'all'));
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_items jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
BEGIN
  IF p_actor_name IS NULL OR length(p_actor_name) > 64
     OR length(v_query) > 120
     OR v_kind NOT IN ('all', 'media', 'image', 'video', 'audio', 'file', 'link')
     OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'items', '[]'::jsonb,
      'has_more', false, 'next_cursor_at', NULL, 'next_cursor_id', NULL);
  END IF;

  SELECT u.id INTO v_actor_id
  FROM public.chat_users u
  WHERE u.user_name = p_actor_name AND u.is_registered AND u.deleted_at IS NULL;
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'items', '[]'::jsonb,
      'has_more', false, 'next_cursor_at', NULL, 'next_cursor_id', NULL);
  END IF;

  -- Treat %, _ and backslash as literal characters supplied by the user.
  v_pattern := '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';

  WITH visible AS MATERIALIZED (
    SELECT
      m.id,
      m.conversation_id,
      peer.user_name AS peer_name,
      m.sender_name_snapshot AS sender_name,
      m.body,
      m.message_type,
      m.payload,
      m.sent_at,
      coalesce(attachments.items, '[]'::jsonb) AS attachments
    FROM public.chat_conversation_members own
    JOIN public.chat_conversations c
      ON c.id = own.conversation_id AND c.conversation_type = 'direct'
    JOIN public.chat_conversation_members other
      ON other.conversation_id = c.id AND other.user_id <> own.user_id
    JOIN public.chat_users peer
      ON peer.id = other.user_id AND peer.is_registered AND peer.deleted_at IS NULL
    JOIN public.chat_messages m ON m.conversation_id = c.id
    LEFT JOIN public.chat_message_user_state message_state
      ON message_state.message_id = m.id AND message_state.user_id = v_actor_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'attachment_type', a.attachment_type,
        'legacy_url', a.legacy_url,
        'mime_type', a.mime_type,
        'size_bytes', a.size_bytes,
        'metadata', a.metadata,
        'created_at', a.created_at
      ) ORDER BY a.created_at, a.id) AS items
      FROM public.chat_attachments a
      WHERE a.message_id = m.id AND a.status IN ('attached', 'legacy')
    ) attachments ON true
    WHERE own.user_id = v_actor_id
      AND own.left_at IS NULL
      AND (own.cleared_before IS NULL OR m.sent_at > own.cleared_before)
      AND (message_state.hidden_at IS NULL)
      AND m.withdrawn_at IS NULL
      AND (p_peer_name IS NULL OR peer.user_name = p_peer_name)
      AND (p_from IS NULL OR m.sent_at >= p_from)
      AND (p_to IS NULL OR m.sent_at <= p_to)
      AND (p_before_at IS NULL OR m.sent_at < p_before_at
        OR (m.sent_at = p_before_at AND (p_before_id IS NULL OR m.id < p_before_id)))
      AND (
        v_query = ''
        OR m.body ILIKE v_pattern ESCAPE E'\\'
        OR m.payload::text ILIKE v_pattern ESCAPE E'\\'
        OR EXISTS (
          SELECT 1 FROM public.chat_attachments search_attachment
          WHERE search_attachment.message_id = m.id
            AND search_attachment.status IN ('attached', 'legacy')
            AND (coalesce(search_attachment.legacy_url, '') ILIKE v_pattern ESCAPE E'\\'
              OR search_attachment.metadata::text ILIKE v_pattern ESCAPE E'\\')
        )
      )
      AND CASE v_kind
        WHEN 'all' THEN true
        WHEN 'media' THEN m.message_type IN ('image', 'video', 'audio', 'file')
          OR EXISTS (SELECT 1 FROM public.chat_attachments a
            WHERE a.message_id = m.id AND a.status IN ('attached', 'legacy'))
          OR m.body ~* 'https?://'
          OR coalesce(m.payload->>'text','') ~* 'https?://'
        WHEN 'image' THEN m.message_type = 'image' OR EXISTS (SELECT 1 FROM public.chat_attachments a
          WHERE a.message_id = m.id AND a.attachment_type = 'image' AND a.status IN ('attached', 'legacy'))
        WHEN 'video' THEN m.message_type = 'video' OR EXISTS (SELECT 1 FROM public.chat_attachments a
          WHERE a.message_id = m.id AND a.attachment_type = 'video' AND a.status IN ('attached', 'legacy'))
        WHEN 'audio' THEN m.message_type = 'audio' OR EXISTS (SELECT 1 FROM public.chat_attachments a
          WHERE a.message_id = m.id AND a.attachment_type = 'audio' AND a.status IN ('attached', 'legacy'))
        WHEN 'file' THEN m.message_type = 'file' OR EXISTS (SELECT 1 FROM public.chat_attachments a
          WHERE a.message_id = m.id AND a.attachment_type = 'file' AND a.status IN ('attached', 'legacy'))
        WHEN 'link' THEN m.body ~* 'https?://'
          OR coalesce(m.payload->>'text','') ~* 'https?://'

        ELSE false
      END
    ORDER BY m.sent_at DESC, m.id DESC
    LIMIT v_limit + 1
  ), page AS (
    SELECT * FROM visible ORDER BY sent_at DESC, id DESC LIMIT v_limit
  ), page_result AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'message_id', id,
      'conversation_id', conversation_id,
      'peer_name', peer_name,
      'sender_name', sender_name,
      'body', body,
      'message_type', message_type,
      'payload', payload,
      'attachments', attachments,
      'sent_at', sent_at
    ) ORDER BY sent_at DESC, id DESC), '[]'::jsonb) AS items
    FROM page
  ), page_cursor AS (
    SELECT sent_at, id FROM page ORDER BY sent_at ASC, id ASC LIMIT 1
  ), page_meta AS (
    SELECT count(*) > v_limit AS has_more FROM visible
  )
  SELECT page_result.items, page_meta.has_more, page_cursor.sent_at, page_cursor.id
    INTO v_items, v_has_more, v_cursor_at, v_cursor_id
  FROM page_result CROSS JOIN page_meta LEFT JOIN page_cursor ON true;

  RETURN jsonb_build_object(
    'status', 'ok',
    'items', v_items,
    'has_more', v_has_more,
    'next_cursor_at', v_cursor_at,
    'next_cursor_id', v_cursor_id
  );
END;
$function$;

CREATE INDEX IF NOT EXISTS chat_messages_payload_trgm_idx ON public.chat_messages USING gin ((payload::text) extensions.gin_trgm_ops);
COMMIT;
