-- Cover all newly introduced chat foreign keys and the existing upload-to-DM
-- foreign key. This keeps deletes, joins, and future conversation operations
-- from scanning whole tables as message history grows.
BEGIN;

CREATE INDEX IF NOT EXISTS chat_conversation_members_last_read_message_idx
  ON public.chat_conversation_members (last_read_message_id);
CREATE INDEX IF NOT EXISTS chat_conversations_created_by_idx
  ON public.chat_conversations (created_by);
CREATE INDEX IF NOT EXISTS chat_conversations_last_message_idx
  ON public.chat_conversations (last_message_id);
CREATE INDEX IF NOT EXISTS chat_messages_reply_to_message_idx
  ON public.chat_messages (reply_to_message_id);
CREATE INDEX IF NOT EXISTS dm_media_uploads_message_id_idx
  ON public.dm_media_uploads (message_id);

COMMIT;
