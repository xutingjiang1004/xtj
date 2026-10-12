BEGIN;

-- A turn inserted in one statement shares a timestamp. Prefer its saved
-- sequence and role before the UUID tie-breaker when selecting the preview.
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
      (coalesce(meta->>'role', legacy_role) = 'assistant' AND meta->>'type' = 'tavily_research') AS deep,
    CASE WHEN meta->>'seq' ~ '^[0-9]{1,9}$' THEN (meta->>'seq')::integer ELSE 0 END AS message_seq
  FROM source WHERE coalesce(meta->>'deleted', 'false') <> 'true'
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, message_seq DESC,
      CASE WHEN role = 'assistant' THEN 1 ELSE 0 END DESC, id DESC) AS last_rank,
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

COMMIT;
