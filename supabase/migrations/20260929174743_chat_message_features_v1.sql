-- Per-message reactions and the restricted document types used by private chat.
BEGIN;

ALTER TABLE public.dm_media_uploads
  DROP CONSTRAINT IF EXISTS dm_media_uploads_kind_check;
ALTER TABLE public.dm_media_uploads
  ADD CONSTRAINT dm_media_uploads_kind_check
  CHECK (kind IN ('image', 'video', 'audio', 'file'));

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('❤️', '👍', '😂', '😮', '😢', '🔥')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_message_reactions_message_emoji
  ON public.chat_message_reactions (message_id, emoji);

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_message_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_message_reactions TO service_role;

-- Keep the normalized reply and edit columns in sync with the compatibility
-- JSON payload after the existing posts projection trigger has upserted it.
CREATE OR REPLACE FUNCTION public.chat_sync_legacy_message_extras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_payload jsonb;
  v_conversation_id uuid;
  v_reply_id uuid;
  v_reply_text text;
  v_edited_at timestamptz;
BEGIN
  IF NEW.media_type IS DISTINCT FROM '__dm__' THEN RETURN NEW; END IF;
  v_payload := public.chat_safe_legacy_payload(NEW.content);
  SELECT message.conversation_id INTO v_conversation_id
    FROM public.chat_messages message WHERE message.legacy_post_id = NEW.id;
  IF v_conversation_id IS NULL THEN RETURN NEW; END IF;

  v_reply_text := v_payload->'reply_to'->>'id';
  IF pg_input_is_valid(v_reply_text, 'uuid') THEN
    SELECT message.id INTO v_reply_id
      FROM public.chat_messages message
      WHERE message.id = v_reply_text::uuid
        AND message.conversation_id = v_conversation_id
        AND message.withdrawn_at IS NULL;
  END IF;
  IF pg_input_is_valid(v_payload->>'edited_at', 'timestamptz') THEN
    v_edited_at := (v_payload->>'edited_at')::timestamptz;
  END IF;

  UPDATE public.chat_messages
  SET reply_to_message_id = v_reply_id,
      edited_at = v_edited_at
  WHERE legacy_post_id = NEW.id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS chat_message_z_extras_projection ON public.posts;
CREATE TRIGGER chat_message_z_extras_projection
AFTER INSERT OR UPDATE OF content, media_type ON public.posts
FOR EACH ROW
WHEN (NEW.media_type = '__dm__')
EXECUTE FUNCTION public.chat_sync_legacy_message_extras();

REVOKE ALL ON FUNCTION public.chat_sync_legacy_message_extras() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_sync_legacy_message_extras() TO service_role;

COMMIT;

