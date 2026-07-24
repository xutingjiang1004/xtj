-- Migration 027: Batch mark DM messages as read
-- Replaces N individual UPDATEs with a single set-based UPDATE via RPC
-- Verifies receiver matches p_receiver; only updates DM_MARKER (__dm__) rows;
-- idempotent on already-read rows (read_at preserved); handles non-JSON content
-- by wrapping as {"text": <original>, "read_at": <ts>}; returns updated/failed ids.

CREATE OR REPLACE FUNCTION public.mark_dm_messages_read(
  p_receiver TEXT,
  p_message_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_now_str TEXT;
  v_ids UUID[];
  v_updated UUID[] := ARRAY[]::UUID[];
BEGIN
  IF p_receiver IS NULL OR btrim(p_receiver) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_receiver');
  END IF;

  v_ids := ARRAY(
    SELECT DISTINCT id FROM unnest(p_message_ids) AS id WHERE id IS NOT NULL
  );

  IF array_length(v_ids, 1) IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'updated_ids', '[]'::jsonb,
      'failed_ids', '[]'::jsonb,
      'marked', 0
    );
  END IF;

  v_now_str := to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  WITH locked AS (
    SELECT id, content, media_type, media_url
    FROM public.posts
    WHERE id = ANY(v_ids)
      AND media_type = '__dm__'
      AND media_url = p_receiver
    FOR UPDATE
  ),
  do_update AS (
    UPDATE public.posts p
       SET views = GREATEST(COALESCE(p.views, 0), 1),
           content = CASE
             WHEN p.content IS NULL THEN
               ('{"read_at":"' || v_now_str || '"}')::jsonb
             WHEN jsonb_typeof(p.content) = 'object' AND COALESCE(p.content->>'read_at', '') = '' THEN
               p.content || jsonb_build_object('read_at', v_now_str)
             WHEN jsonb_typeof(p.content) = 'object' AND COALESCE(p.content->>'read_at', '') <> '' THEN
               p.content
             ELSE
               jsonb_build_object('text', p.content::text, 'read_at', v_now_str)
           END
      FROM locked l
     WHERE p.id = l.id
       AND (
            p.content IS NULL
         OR jsonb_typeof(p.content) <> 'object'
         OR COALESCE(p.content->>'read_at', '') = ''
       )
    RETURNING p.id
  )
  SELECT ARRAY(SELECT id FROM do_update) INTO v_updated;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_ids', COALESCE(to_jsonb(v_updated), '[]'::jsonb),
    'failed_ids', (
      SELECT COALESCE(jsonb_agg(id), '[]'::jsonb)
      FROM unnest(v_ids) AS id
      WHERE id <> ALL(COALESCE(v_updated, ARRAY[]::UUID[]))
    ),
    'marked', COALESCE(array_length(v_updated, 1), 0)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'internal_error', 'error', '批量更新失败');
END;
$$;

REVOKE ALL ON FUNCTION public.mark_dm_messages_read(TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_dm_messages_read(TEXT, UUID[]) TO service_role;
