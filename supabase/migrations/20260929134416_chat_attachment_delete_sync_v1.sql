-- The dm_media_uploads FK sets chat_attachments.legacy_upload_id to NULL before
-- the AFTER DELETE trigger runs. Delete by the unique storage path as well so
-- metadata cannot be orphaned when the legacy registry row is removed.
BEGIN;

CREATE OR REPLACE FUNCTION public.chat_sync_legacy_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uploader_id UUID;
  v_message_id UUID;
  v_legacy_url TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.chat_attachments
    WHERE legacy_upload_id = OLD.id OR storage_path = OLD.storage_path;
    RETURN OLD;
  END IF;

  v_uploader_id := public.chat_ensure_user(NEW.uploader, false);
  SELECT message.id, message.payload->>'url'
    INTO v_message_id, v_legacy_url
  FROM public.chat_messages message
  WHERE message.legacy_post_id = NEW.message_id
  LIMIT 1;

  INSERT INTO public.chat_attachments AS existing_attachment (
    uploader_id, message_id, legacy_upload_id, storage_path, legacy_url,
    attachment_type, mime_type, size_bytes, status, created_at, updated_at
  ) VALUES (
    v_uploader_id, v_message_id, NEW.id, NEW.storage_path, v_legacy_url,
    NEW.kind, NEW.mime_type, NEW.size_bytes, NEW.status, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (storage_path) WHERE storage_path IS NOT NULL DO UPDATE
    SET legacy_upload_id = coalesce(existing_attachment.legacy_upload_id, EXCLUDED.legacy_upload_id),
        uploader_id = EXCLUDED.uploader_id,
        message_id = EXCLUDED.message_id,
        storage_path = EXCLUDED.storage_path,
        legacy_url = coalesce(existing_attachment.legacy_url, EXCLUDED.legacy_url),
        attachment_type = EXCLUDED.attachment_type,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$function$;

COMMIT;
