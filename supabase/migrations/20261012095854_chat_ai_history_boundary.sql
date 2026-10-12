BEGIN;

-- One authenticated server action changes the entire conversation atomically.
-- Keep all existing metadata, and escape literal underscores in the actor key.
CREATE OR REPLACE FUNCTION public.soft_delete_ai_conversation(p_user_name text, p_conversation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' OR length(p_user_name) > 64 OR
     p_conversation_id IS NULL OR p_conversation_id !~ '^[A-Za-z0-9-]{6,128}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_conversation');
  END IF;
  UPDATE public.posts AS p
  SET media_url = (
    CASE WHEN jsonb_typeof(xtj_private.safe_jsonb(p.media_url)) = 'object'
      THEN xtj_private.safe_jsonb(p.media_url)
      ELSE jsonb_build_object('role', CASE WHEN p.media_url = 'assistant' THEN 'assistant' ELSE 'user' END)
    END || jsonb_build_object('deleted', true, 'deleted_at', clock_timestamp())
  )::text
  WHERE p.user_name = p_user_name AND p.media_type = '__ai_agent_msg__'
    AND p.actor_key LIKE ('ai\_msg\_conv\_' || p_conversation_id || '\_%') ESCAPE '\'
    AND coalesce(nullif(xtj_private.safe_jsonb(p.media_url)->>'convId', ''), p_conversation_id) = p_conversation_id
    AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted', 'false') <> 'true';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.soft_delete_ai_conversation(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_ai_conversation(text, text) TO service_role;

-- Aggregate on the server: a long conversation must not consume the entire
-- browser payload window and hide all older conversations or undercount turns.
CREATE OR REPLACE FUNCTION public.list_ai_conversations(
  p_user_name text, p_mode text DEFAULT NULL, p_limit integer DEFAULT 50,
  p_before_at timestamptz DEFAULT NULL, p_before_id text DEFAULT NULL,
  p_conversation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
WITH source AS (
  SELECT p.id, p.created_at, coalesce(p.content, '') AS content,
    xtj_private.safe_jsonb(p.content) AS body,
    CASE WHEN p.media_url = 'assistant' THEN 'assistant' ELSE 'user' END AS legacy_role,
    xtj_private.safe_jsonb(p.media_url) AS meta,
    substring(p.actor_key FROM '^ai_msg_conv_([A-Za-z0-9-]{6,128})_') AS actor_conversation_id
  FROM public.posts p
  WHERE p.user_name = p_user_name AND p.media_type = '__ai_agent_msg__'
    AND (p_conversation_id IS NULL OR p.actor_key LIKE
      ('ai\_msg\_conv\_' || p_conversation_id || '\_%') ESCAPE '\')
), live AS (
  SELECT id, created_at,
    left(CASE WHEN coalesce(meta->>'role', legacy_role) = 'assistant'
      THEN coalesce(nullif(body->>'reply', ''), nullif(body->>'answer', ''), content)
      ELSE content END, 100) AS preview,
    coalesce(nullif(meta->>'convId', ''), actor_conversation_id) AS conversation_id,
    coalesce(meta->>'role', legacy_role) AS role,
    meta->>'chat_mode' = 'deep_think' OR
      (coalesce(meta->>'role', legacy_role) = 'assistant' AND meta->>'type' = 'tavily_research') AS deep
  FROM source WHERE coalesce(meta->>'deleted', 'false') <> 'true'
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, id DESC) AS last_rank,
    row_number() OVER (PARTITION BY conversation_id, role ORDER BY created_at, id) AS first_role_rank
  FROM live WHERE conversation_id ~ '^[A-Za-z0-9-]{6,128}$'
    AND (p_conversation_id IS NULL OR conversation_id = p_conversation_id)
), grouped AS (
  SELECT conversation_id, max(created_at) AS updated_at, count(*) AS message_count,
    coalesce(max(left(preview, 20)) FILTER (WHERE role = 'user' AND first_role_rank = 1), '新对话') AS title,
    max(preview) FILTER (WHERE last_rank = 1) AS last_message,
    CASE WHEN bool_or(coalesce(deep, false)) THEN 'deep_think' ELSE 'normal' END AS chat_mode
  FROM ranked GROUP BY conversation_id
), page AS (
  SELECT * FROM grouped WHERE (p_mode IS NULL OR p_mode = '' OR chat_mode = p_mode)
    AND (p_before_at IS NULL OR updated_at < p_before_at OR
      (updated_at = p_before_at AND conversation_id < p_before_id))
  ORDER BY updated_at DESC, conversation_id DESC LIMIT least(greatest(p_limit, 1), 100) + 1
), visible AS (
  SELECT * FROM page ORDER BY updated_at DESC, conversation_id DESC LIMIT least(greatest(p_limit, 1), 100)
), boundary AS (
  SELECT updated_at, conversation_id FROM visible ORDER BY updated_at, conversation_id LIMIT 1
)
SELECT jsonb_build_object('ok', true,
  'conversations', coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY updated_at DESC, conversation_id DESC) FROM visible v), '[]'::jsonb),
  'has_more', (SELECT count(*) FROM page) > least(greatest(p_limit, 1), 100),
  'next_cursor', CASE WHEN (SELECT count(*) FROM page) > least(greatest(p_limit, 1), 100)
    THEN (SELECT jsonb_build_object('at', updated_at, 'id', conversation_id)::text FROM boundary) ELSE NULL END);
$$;
REVOKE ALL ON FUNCTION public.list_ai_conversations(text, text, integer, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_ai_conversations(text, text, integer, timestamptz, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.list_ai_research_records(p_user_name text, p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
WITH page AS (
  SELECT p.id, p.created_at, xtj_private.safe_jsonb(p.content) AS body,
    coalesce(nullif(xtj_private.safe_jsonb(p.media_url)->>'convId', ''),
      substring(p.actor_key FROM '^ai_msg_conv_([A-Za-z0-9-]{6,128})_')) AS conversation_id
  FROM public.posts p WHERE p.user_name = p_user_name AND p.media_type = '__ai_agent_msg__'
    AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted', 'false') <> 'true'
    AND xtj_private.safe_jsonb(p.content)->>'type' = 'tavily_research'
  ORDER BY p.created_at DESC, p.id DESC LIMIT least(greatest(p_limit, 1), 50)
)
SELECT jsonb_build_object('ok', true, 'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id', id, 'created_at', created_at, 'conversation_id', conversation_id,
  'query', coalesce(body->>'query', ''), 'answer', coalesce(body->>'answer', ''),
  'sources', CASE WHEN jsonb_typeof(body->'sources') = 'array' THEN body->'sources' ELSE '[]'::jsonb END
) ORDER BY created_at DESC, id DESC) FROM page), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.list_ai_research_records(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_ai_research_records(text, integer) TO service_role;

COMMIT;
