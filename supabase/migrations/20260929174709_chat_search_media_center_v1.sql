-- Search message text and attachment metadata without downloading chat history
-- to the browser. pg_trgm supports substring matching for Chinese and English.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS chat_messages_body_trgm_idx
  ON public.chat_messages USING gin (body extensions.gin_trgm_ops);

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
          OR m.payload::text ~* 'https?://'
        WHEN 'image' THEN m.message_type = 'image' OR EXISTS (SELECT 1 FROM public.chat_attachments a
          WHERE a.message_id = m.id AND a.attachment_type = 'image' AND a.status IN ('attached', 'legacy'))
        WHEN 'video' THEN m.message_type = 'video' OR EXISTS (SELECT 1 FROM public.chat_attachments a
          WHERE a.message_id = m.id AND a.attachment_type = 'video' AND a.status IN ('attached', 'legacy'))
        WHEN 'audio' THEN m.message_type = 'audio' OR EXISTS (SELECT 1 FROM public.chat_attachments a
          WHERE a.message_id = m.id AND a.attachment_type = 'audio' AND a.status IN ('attached', 'legacy'))
        WHEN 'file' THEN m.message_type = 'file' OR EXISTS (SELECT 1 FROM public.chat_attachments a
          WHERE a.message_id = m.id AND a.attachment_type = 'file' AND a.status IN ('attached', 'legacy'))
        WHEN 'link' THEN m.body ~* 'https?://'
          OR m.payload::text ~* 'https?://'
          OR EXISTS (SELECT 1 FROM public.chat_attachments a
            WHERE a.message_id = m.id AND a.status IN ('attached', 'legacy')
              AND coalesce(a.legacy_url, '') ~* 'https?://')
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

REVOKE ALL ON FUNCTION public.chat_search_messages(
  text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_search_messages(
  text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer
) TO service_role;

COMMIT;
