-- Research history pages. The previous function always returned the newest
-- 50 rows and had no cursor, so the panel could not open anything older.
-- Existing two-argument calls keep working: the new arguments default to NULL.

DROP FUNCTION IF EXISTS public.list_ai_research_records(text, integer, text);

CREATE OR REPLACE FUNCTION public.list_ai_research_records(
  p_user_name text,
  p_limit integer DEFAULT 10,
  p_account_id text DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
WITH bounds AS (
  SELECT least(greatest(coalesce(p_limit, 10), 1), 50) AS lim
),
matched AS (
  SELECT p.id, p.created_at, xtj_private.safe_jsonb(p.content) AS body,
    coalesce(nullif(xtj_private.safe_jsonb(p.media_url)->>'convId', ''),
      substring(p.actor_key FROM '^ai_msg_conv_([A-Za-z0-9-]{6,128})_')) AS conversation_id
  FROM public.posts p
  WHERE p.user_name = p_user_name
    AND p.media_type = '__ai_agent_msg__'
    AND p.ai_account_id = p_account_id
    AND xtj_private.ai_owner_current(p_user_name, p_account_id)
    AND coalesce(xtj_private.safe_jsonb(p.media_url)->>'deleted', 'false') <> 'true'
    AND xtj_private.safe_jsonb(p.content)->>'type' = 'tavily_research'
    AND (
      p_before IS NULL
      OR p.created_at < p_before
      OR (p.created_at = p_before AND p_before_id IS NOT NULL AND p.id < p_before_id)
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT (SELECT lim + 1 FROM bounds)
),
visible AS (
  SELECT * FROM matched
  ORDER BY created_at DESC, id DESC
  LIMIT (SELECT lim FROM bounds)
),
boundary AS (
  SELECT created_at, id FROM visible
  ORDER BY created_at ASC, id ASC
  LIMIT 1
)
SELECT jsonb_build_object(
  'ok', true,
  'has_more', (SELECT count(*) FROM matched) > (SELECT count(*) FROM visible),
  'next_cursor', CASE
    WHEN (SELECT count(*) FROM matched) > (SELECT count(*) FROM visible)
    THEN (SELECT jsonb_build_object('at', created_at, 'id', id)::text FROM boundary)
    ELSE NULL
  END,
  'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'created_at', created_at,
    'conversation_id', conversation_id,
    'query', coalesce(body->>'query', ''),
    'answer', coalesce(body->>'answer', ''),
    'sources', CASE WHEN jsonb_typeof(body->'sources') = 'array' THEN body->'sources' ELSE '[]'::jsonb END
  ) ORDER BY created_at DESC, id DESC) FROM visible), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.list_ai_research_records(text, integer, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_ai_research_records(text, integer, text, timestamptz, uuid) TO service_role;
