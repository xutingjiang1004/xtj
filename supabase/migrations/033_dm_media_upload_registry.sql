-- Register private-message media before /api/dm/send attaches it to a row.
-- The service-role API is the only writer; clients cannot claim another
-- user's storage path or reuse an already-attached object.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dm_media_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path TEXT NOT NULL UNIQUE,
  uploader TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  mime_type TEXT NOT NULL,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 52428800)),
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'sending', 'attached', 'cleanup_pending', 'deleted')),
  message_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep reruns safe if an earlier local copy created the table with the
-- pre-reservation status constraint.  The sending state is a short-lived CAS
-- lease used to prevent duplicate private-message rows.
ALTER TABLE public.dm_media_uploads
  DROP CONSTRAINT IF EXISTS dm_media_uploads_status_check;
ALTER TABLE public.dm_media_uploads
  ADD CONSTRAINT dm_media_uploads_status_check
  CHECK (status IN ('uploaded', 'sending', 'attached', 'cleanup_pending', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_dm_media_uploads_uploader_status
  ON public.dm_media_uploads (uploader, status, updated_at DESC);

ALTER TABLE public.dm_media_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dm_media_uploads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dm_media_uploads TO service_role;

COMMIT;
