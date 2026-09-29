-- XTJ chat foundation v1
--
-- The live client still reads/writes legacy DM rows in public.posts. This
-- migration introduces the normalized chat model, backfills existing history,
-- and keeps the model transactionally mirrored while the API is migrated in
-- later stages. No legacy rows are removed or rewritten.
--
-- XTJ uses its own signed access tokens (user_name claim), not Supabase Auth.
-- Therefore chat tables are deliberately inaccessible to anon/authenticated;
-- the authenticated Render API is the only application boundary and uses the
-- server-only service_role key. RLS remains enabled as defense in depth.

BEGIN;

-- Hold out writes while history is backfilled and compatibility triggers are
-- installed, so a send cannot slip between the snapshot and its mirror.
LOCK TABLE public.posts IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.dm_media_uploads IN SHARE ROW EXCLUSIVE MODE;

-- A stable chat identity projection of XTJ accounts. user_name remains the
-- compatibility key until the application adopts a first-party account UUID.
CREATE TABLE public.chat_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name TEXT NOT NULL UNIQUE,
  is_registered BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_users_name_nonempty CHECK (length(btrim(user_name)) BETWEEN 1 AND 64)
);

-- Friend requests and accepted friendships are separate records. A friendship
-- is represented once using a canonical ordered pair.
CREATE TABLE public.chat_friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled')),
  request_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT chat_friend_requests_not_self CHECK (requester_id <> target_id),
  CONSTRAINT chat_friend_requests_note_length CHECK (request_note IS NULL OR length(request_note) <= 240)
);

CREATE UNIQUE INDEX chat_friend_requests_one_pending_direction
  ON public.chat_friend_requests (requester_id, target_id)
  WHERE status = 'pending';
CREATE INDEX chat_friend_requests_incoming_pending
  ON public.chat_friend_requests (target_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX chat_friend_requests_outgoing_pending
  ON public.chat_friend_requests (requester_id, created_at DESC)
  WHERE status = 'pending';

CREATE TABLE public.chat_friendships (
  user_low_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  user_high_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low_id, user_high_id),
  CONSTRAINT chat_friendships_canonical_pair CHECK (user_low_id < user_high_id)
);
CREATE INDEX chat_friendships_high_user ON public.chat_friendships (user_high_id, created_at DESC);

CREATE TABLE public.chat_user_blocks (
  blocker_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT chat_user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX chat_user_blocks_reverse_lookup ON public.chat_user_blocks (blocked_id, blocker_id);

-- Direct conversations use a stable key derived from the two immutable chat
-- identity UUIDs. group is reserved for a later phase; no group UI is added.
CREATE TABLE public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_type TEXT NOT NULL DEFAULT 'direct'
    CHECK (conversation_type IN ('direct', 'group')),
  direct_key TEXT UNIQUE,
  title TEXT,
  created_by UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  last_message_id UUID,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversations_direct_key_shape CHECK (
    (conversation_type = 'direct' AND direct_key IS NOT NULL)
    OR (conversation_type = 'group' AND direct_key IS NULL)
  )
);

CREATE TABLE public.chat_conversation_members (
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  last_read_message_id UUID,
  last_read_at TIMESTAMPTZ,
  pinned_at TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  cleared_before TIMESTAMPTZ,
  draft_text TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX chat_conversation_members_user_recent
  ON public.chat_conversation_members (user_id, conversation_id)
  WHERE left_at IS NULL;
CREATE INDEX chat_conversation_members_pinned
  ON public.chat_conversation_members (user_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL AND left_at IS NULL;

-- Normalized messages retain the exact legacy payload during migration. New
-- clients can use body/payload/message_type without depending on posts markers.
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  sender_name_snapshot TEXT NOT NULL,
  client_message_id TEXT,
  reply_to_message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'video', 'audio', 'file', 'system')),
  body TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  legacy_content TEXT,
  legacy_actor_key TEXT,
  legacy_post_id UUID UNIQUE REFERENCES public.posts(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX chat_messages_sender_client_id_unique
  ON public.chat_messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX chat_messages_conversation_keyset
  ON public.chat_messages (conversation_id, sent_at DESC, id DESC);
CREATE INDEX chat_messages_sender_recent
  ON public.chat_messages (sender_id, sent_at DESC);

ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_conversations_last_message_fk
  FOREIGN KEY (last_message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;
ALTER TABLE public.chat_conversation_members
  ADD CONSTRAINT chat_conversation_members_last_read_fk
  FOREIGN KEY (last_read_message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;

-- Per-user receipt and visibility state supports read/delivered receipts,
-- delete-for-me, and multi-device state without mutating the sender's message.
CREATE TABLE public.chat_message_user_state (
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  hidden_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX chat_message_user_state_unread
  ON public.chat_message_user_state (user_id, message_id)
  WHERE read_at IS NULL AND hidden_at IS NULL;

-- Legacy upload registry rows are linked by legacy_upload_id. The nullable
-- message_id permits the existing upload-before-send flow.
CREATE TABLE public.chat_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  uploader_id UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  legacy_upload_id UUID UNIQUE REFERENCES public.dm_media_uploads(id) ON DELETE SET NULL,
  storage_path TEXT,
  legacy_url TEXT,
  attachment_type TEXT NOT NULL
    CHECK (attachment_type IN ('image', 'video', 'audio', 'file')),
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  status TEXT NOT NULL DEFAULT 'attached'
    CHECK (status IN ('uploaded', 'sending', 'attached', 'cleanup_pending', 'deleted', 'legacy')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX chat_attachments_storage_path_unique
  ON public.chat_attachments (storage_path)
  WHERE storage_path IS NOT NULL;
CREATE INDEX chat_attachments_message_order
  ON public.chat_attachments (message_id, created_at, id)
  WHERE message_id IS NOT NULL;
CREATE INDEX chat_attachments_uploader_recent
  ON public.chat_attachments (uploader_id, created_at DESC);

-- Ensure account projections exist for current users, including the separate
-- admin-auth marker. DM-only participants are retained but not searchable as
-- registered users until a real account row exists.
INSERT INTO public.chat_users (user_name, is_registered)
SELECT DISTINCT p.user_name, true
FROM public.posts p
WHERE p.media_type IN ('__auth__', '__admin_auth__')
  AND p.user_name IS NOT NULL AND btrim(p.user_name) <> ''
ON CONFLICT (user_name) DO UPDATE
SET is_registered = true, deleted_at = NULL, updated_at = now();

INSERT INTO public.chat_users (user_name, is_registered)
SELECT participants.user_name, false
FROM (
  SELECT p.user_name FROM public.posts p WHERE p.media_type = '__dm__'
  UNION
  SELECT p.media_url FROM public.posts p WHERE p.media_type = '__dm__'
) AS participants(user_name)
WHERE participants.user_name IS NOT NULL AND btrim(participants.user_name) <> ''
ON CONFLICT (user_name) DO NOTHING;

INSERT INTO public.chat_users (user_name, is_registered)
SELECT DISTINCT upload.uploader, false
FROM public.dm_media_uploads upload
WHERE upload.uploader IS NOT NULL AND btrim(upload.uploader) <> ''
ON CONFLICT (user_name) DO NOTHING;

-- One direct conversation per historical participant pair.
WITH pairs AS (
  SELECT DISTINCT
    LEAST(sender.id, recipient.id) AS low_id,
    GREATEST(sender.id, recipient.id) AS high_id,
    p.created_at
  FROM public.posts p
  JOIN public.chat_users sender ON sender.user_name = p.user_name
  JOIN public.chat_users recipient ON recipient.user_name = p.media_url
  WHERE p.media_type = '__dm__'
    AND p.user_name IS NOT NULL AND p.media_url IS NOT NULL
    AND btrim(p.user_name) <> '' AND btrim(p.media_url) <> ''
    AND p.user_name <> p.media_url
), grouped AS (
  SELECT low_id, high_id, min(created_at) AS first_message_at, max(created_at) AS last_message_at
  FROM pairs
  GROUP BY low_id, high_id
)
INSERT INTO public.chat_conversations AS existing_conversation (
  conversation_type, direct_key, created_at, updated_at, last_message_at
)
SELECT 'direct', low_id::text || ':' || high_id::text, first_message_at, last_message_at, last_message_at
FROM grouped
ON CONFLICT (direct_key) DO UPDATE
SET created_at = LEAST(existing_conversation.created_at, EXCLUDED.created_at),
    updated_at = GREATEST(existing_conversation.updated_at, EXCLUDED.updated_at),
    last_message_at = GREATEST(existing_conversation.last_message_at, EXCLUDED.last_message_at);

WITH participants AS (
  SELECT DISTINCT
    c.id AS conversation_id,
    u.id AS user_id,
    min(p.created_at) AS joined_at
  FROM public.posts p
  JOIN public.chat_users sender ON sender.user_name = p.user_name
  JOIN public.chat_users recipient ON recipient.user_name = p.media_url
  JOIN public.chat_users u ON u.id IN (sender.id, recipient.id)
  JOIN public.chat_conversations c
    ON c.direct_key = LEAST(sender.id, recipient.id)::text || ':' || GREATEST(sender.id, recipient.id)::text
  WHERE p.media_type = '__dm__'
    AND p.user_name IS NOT NULL AND p.media_url IS NOT NULL
    AND btrim(p.user_name) <> '' AND btrim(p.media_url) <> ''
    AND p.user_name <> p.media_url
  GROUP BY c.id, u.id
)
INSERT INTO public.chat_conversation_members (conversation_id, user_id, joined_at)
SELECT conversation_id, user_id, joined_at FROM participants
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- Preserve every legacy row byte-for-byte in legacy_content; invalid JSON rows
-- are retained as raw text and receive a safe normalized fallback payload.
CREATE OR REPLACE FUNCTION public.chat_safe_legacy_payload(p_content TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_payload JSONB;
BEGIN
  BEGIN
    v_payload := p_content::jsonb;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('legacy_raw_content', coalesce(p_content, ''));
  END;
  IF jsonb_typeof(v_payload) = 'object' THEN
    RETURN v_payload;
  END IF;
  RETURN jsonb_build_object('legacy_raw_content', coalesce(p_content, ''));
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_safe_legacy_payload(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_safe_legacy_payload(TEXT) TO service_role;

WITH raw AS (
  SELECT p.*, public.chat_safe_legacy_payload(p.content) AS normalized_payload
  FROM public.posts p
  WHERE p.media_type = '__dm__'
    AND p.user_name IS NOT NULL AND p.media_url IS NOT NULL
    AND btrim(p.user_name) <> '' AND btrim(p.media_url) <> ''
    AND p.user_name <> p.media_url
), typed AS (
  SELECT raw.*,
    CASE
      WHEN normalized_payload->>'kind' IN ('image', 'video', 'audio', 'file')
        THEN normalized_payload->>'kind'
      WHEN left(coalesce(actor_key, ''), 10) = '__dm_img__' THEN 'image'
      WHEN left(coalesce(actor_key, ''), 10) = '__dm_vid__' THEN 'video'
      WHEN left(coalesce(actor_key, ''), 10) = '__dm_aud__' THEN 'audio'
      ELSE 'text'
    END AS normalized_type,
    CASE
      WHEN pg_input_is_valid(normalized_payload->>'withdrawn_at', 'timestamptz')
        THEN (normalized_payload->>'withdrawn_at')::timestamptz
      WHEN normalized_payload->>'withdrawn' IN ('true', '1') THEN coalesce(updated_at, created_at, now())
      ELSE NULL
    END AS normalized_withdrawn_at
  FROM raw
)
INSERT INTO public.chat_messages (
  id, conversation_id, sender_id, sender_name_snapshot, message_type, body,
  payload, legacy_content, legacy_actor_key, legacy_post_id, sent_at,
  withdrawn_at, created_at, updated_at
)
SELECT p.id,
  c.id,
  sender.id,
  p.user_name,
  p.normalized_type,
  coalesce(p.normalized_payload->>'text', p.normalized_payload->>'caption',
    CASE WHEN p.normalized_payload ? 'legacy_raw_content' THEN p.content ELSE '' END, ''),
  p.normalized_payload,
  p.content,
  p.actor_key,
  p.id,
  p.created_at,
  p.normalized_withdrawn_at,
  p.created_at,
  coalesce(p.updated_at, p.created_at)
FROM typed p
JOIN public.chat_users sender ON sender.user_name = p.user_name
JOIN public.chat_users recipient ON recipient.user_name = p.media_url
JOIN public.chat_conversations c
  ON c.direct_key = LEAST(sender.id, recipient.id)::text || ':' || GREATEST(sender.id, recipient.id)::text
ON CONFLICT (legacy_post_id) DO UPDATE
SET conversation_id = EXCLUDED.conversation_id,
    sender_id = EXCLUDED.sender_id,
    sender_name_snapshot = EXCLUDED.sender_name_snapshot,
    message_type = EXCLUDED.message_type,
    body = EXCLUDED.body,
    payload = EXCLUDED.payload,
    legacy_content = EXCLUDED.legacy_content,
    legacy_actor_key = EXCLUDED.legacy_actor_key,
    sent_at = EXCLUDED.sent_at,
    withdrawn_at = EXCLUDED.withdrawn_at,
    updated_at = EXCLUDED.updated_at;

-- Backfill per-message read receipts from legacy JSON content.
WITH raw AS (
  SELECT p.id, p.media_url, public.chat_safe_legacy_payload(p.content) AS payload
  FROM public.posts p
  WHERE p.media_type = '__dm__'
), receipts AS (
  SELECT m.id AS message_id, recipient.id AS user_id,
    CASE WHEN pg_input_is_valid(raw.payload->>'read_at', 'timestamptz')
      THEN (raw.payload->>'read_at')::timestamptz ELSE NULL END AS read_at
  FROM raw
  JOIN public.chat_messages m ON m.legacy_post_id = raw.id
  JOIN public.chat_users recipient ON recipient.user_name = raw.media_url
)
INSERT INTO public.chat_message_user_state AS existing_state (message_id, user_id, read_at)
SELECT message_id, user_id, read_at FROM receipts
ON CONFLICT (message_id, user_id) DO UPDATE
SET read_at = coalesce(EXCLUDED.read_at, existing_state.read_at),
    updated_at = now();

-- Move the existing per-account hide snapshots into per-message user state.
-- Keep the old snapshot rows in posts during the compatibility period.
WITH snapshots AS (
  SELECT p.user_name, p.created_at,
    public.chat_safe_legacy_payload(p.content) AS payload
  FROM public.posts p
  WHERE p.media_type = '__dm_deleted__'
), hidden AS (
  SELECT snapshots.user_name, snapshots.created_at, value.message_id_text
  FROM snapshots
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(snapshots.payload->'ids') = 'array'
      THEN snapshots.payload->'ids' ELSE '[]'::jsonb END
  ) AS value(message_id_text)
)
INSERT INTO public.chat_message_user_state AS existing_state (message_id, user_id, hidden_at)
SELECT m.id, u.id, hidden.created_at
FROM hidden
JOIN public.chat_users u ON u.user_name = hidden.user_name
JOIN public.chat_messages m ON m.legacy_post_id::text = hidden.message_id_text
ON CONFLICT (message_id, user_id) DO UPDATE
SET hidden_at = coalesce(existing_state.hidden_at, EXCLUDED.hidden_at),
    updated_at = now();

-- Import upload registry rows first, then recover older media messages which
-- predate the registry. Public URLs are preserved as legacy_url, but never
-- exposed by these tables to browser roles.
INSERT INTO public.chat_attachments AS existing_attachment (
  message_id, uploader_id, legacy_upload_id, storage_path, attachment_type,
  mime_type, size_bytes, status, created_at, updated_at
)
SELECT m.id, uploader.id, upload.id, upload.storage_path, upload.kind,
  upload.mime_type, upload.size_bytes, upload.status, upload.created_at, upload.updated_at
FROM public.dm_media_uploads upload
JOIN public.chat_users uploader ON uploader.user_name = upload.uploader
LEFT JOIN public.chat_messages m ON m.legacy_post_id = upload.message_id
ON CONFLICT (legacy_upload_id) DO UPDATE
SET message_id = EXCLUDED.message_id,
    uploader_id = EXCLUDED.uploader_id,
    storage_path = EXCLUDED.storage_path,
    attachment_type = EXCLUDED.attachment_type,
    mime_type = EXCLUDED.mime_type,
    size_bytes = EXCLUDED.size_bytes,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;

WITH media AS (
  SELECT m.id AS message_id, m.sender_id, m.message_type, m.legacy_actor_key,
    m.payload, m.sent_at,
    CASE
      WHEN left(m.legacy_actor_key, 10) = '__dm_img__' THEN substring(m.legacy_actor_key FROM 11)
      WHEN left(m.legacy_actor_key, 10) = '__dm_vid__' THEN substring(m.legacy_actor_key FROM 11)
      WHEN left(m.legacy_actor_key, 10) = '__dm_aud__' THEN substring(m.legacy_actor_key FROM 11)
      ELSE NULL
    END AS storage_path
  FROM public.chat_messages m
  WHERE m.message_type IN ('image', 'video', 'audio', 'file')
)
INSERT INTO public.chat_attachments (
  message_id, uploader_id, storage_path, legacy_url, attachment_type,
  mime_type, status, metadata, created_at, updated_at
)
SELECT media.message_id, media.sender_id, media.storage_path,
  media.payload->>'url', media.message_type,
  coalesce(media.payload->>'mimeType', media.payload->>'mime_type'),
  'attached', media.payload, media.sent_at, media.sent_at
FROM media
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_attachments existing
  WHERE existing.message_id = media.message_id
     OR (media.storage_path IS NOT NULL AND existing.storage_path = media.storage_path)
);

-- Populate latest-message and last-read pointers after importing history.
WITH latest AS (
  SELECT DISTINCT ON (conversation_id) conversation_id, id, sent_at
  FROM public.chat_messages
  ORDER BY conversation_id, sent_at DESC, id DESC
)
UPDATE public.chat_conversations c
SET last_message_id = latest.id,
    last_message_at = latest.sent_at,
    updated_at = GREATEST(c.updated_at, latest.sent_at)
FROM latest
WHERE c.id = latest.conversation_id;

WITH latest_read AS (
  SELECT DISTINCT ON (m.conversation_id, state.user_id)
    m.conversation_id, state.user_id, m.id AS message_id, state.read_at, m.sent_at
  FROM public.chat_message_user_state state
  JOIN public.chat_messages m ON m.id = state.message_id
  WHERE state.read_at IS NOT NULL
  ORDER BY m.conversation_id, state.user_id, m.sent_at DESC, m.id DESC
)
UPDATE public.chat_conversation_members member
SET last_read_message_id = latest_read.message_id,
    last_read_at = latest_read.read_at,
    updated_at = now()
FROM latest_read
WHERE member.conversation_id = latest_read.conversation_id
  AND member.user_id = latest_read.user_id;

-- Helper used only by service-side compatibility triggers. It does not expose
-- the account table to browser roles and never promotes DM-only names to users.
CREATE OR REPLACE FUNCTION public.chat_ensure_user(p_user_name TEXT, p_registered BOOLEAN DEFAULT false)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' OR length(p_user_name) > 64 THEN
    RAISE EXCEPTION 'invalid chat user name';
  END IF;

  INSERT INTO public.chat_users AS existing_user (user_name, is_registered)
  VALUES (p_user_name, coalesce(p_registered, false))
  ON CONFLICT (user_name) DO UPDATE
    SET is_registered = true, deleted_at = NULL, updated_at = now()
    WHERE EXCLUDED.is_registered
      AND (NOT existing_user.is_registered OR existing_user.deleted_at IS NOT NULL)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.chat_users WHERE user_name = p_user_name;
  END IF;
  RETURN v_id;
END;
$function$;

-- Sync custom-token account projection (the application does not use auth.uid()).
CREATE OR REPLACE FUNCTION public.chat_sync_legacy_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.media_type IN ('__auth__', '__admin_auth__') THEN
      UPDATE public.chat_users user_row
      SET is_registered = false, deleted_at = now(), updated_at = now()
      WHERE user_row.user_name = OLD.user_name
        AND NOT EXISTS (
          SELECT 1 FROM public.posts auth_row
          WHERE auth_row.user_name = OLD.user_name
            AND auth_row.media_type IN ('__auth__', '__admin_auth__')
        );
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.media_type IN ('__auth__', '__admin_auth__')
     AND (OLD.user_name IS DISTINCT FROM NEW.user_name
       OR NEW.media_type IS NULL
       OR NEW.media_type NOT IN ('__auth__', '__admin_auth__')) THEN
    UPDATE public.chat_users user_row
    SET is_registered = false, deleted_at = now(), updated_at = now()
    WHERE user_row.user_name = OLD.user_name
      AND NOT EXISTS (
        SELECT 1 FROM public.posts auth_row
        WHERE auth_row.user_name = OLD.user_name
          AND auth_row.media_type IN ('__auth__', '__admin_auth__')
      );
  END IF;

  IF NEW.media_type IN ('__auth__', '__admin_auth__')
     AND NEW.user_name IS NOT NULL AND btrim(NEW.user_name) <> '' THEN
    PERFORM public.chat_ensure_user(NEW.user_name, true);
  END IF;
  RETURN NEW;
END;
$function$;

-- Transactional mirror from legacy posts DM rows into the normalized model.
CREATE OR REPLACE FUNCTION public.chat_sync_legacy_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_sender_id UUID;
  v_recipient_id UUID;
  v_low_id UUID;
  v_high_id UUID;
  v_conversation_id UUID;
  v_direct_key TEXT;
  v_payload JSONB;
  v_message_type TEXT;
  v_body TEXT;
  v_read_text TEXT;
  v_read_at TIMESTAMPTZ;
  v_withdrawn_at TIMESTAMPTZ;
  v_sent_at TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.chat_messages WHERE legacy_post_id = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.media_type = '__dm__'
     AND (NEW.media_type IS DISTINCT FROM OLD.media_type
       OR NEW.user_name IS DISTINCT FROM OLD.user_name
       OR NEW.media_url IS DISTINCT FROM OLD.media_url) THEN
    DELETE FROM public.chat_messages WHERE legacy_post_id = OLD.id;
  END IF;

  IF NEW.media_type IS DISTINCT FROM '__dm__' THEN
    RETURN NEW;
  END IF;

  IF NEW.user_name IS NULL OR NEW.media_url IS NULL
     OR btrim(NEW.user_name) = '' OR btrim(NEW.media_url) = ''
     OR NEW.user_name = NEW.media_url THEN
    DELETE FROM public.chat_messages WHERE legacy_post_id = NEW.id;
    RETURN NEW;
  END IF;

  v_sender_id := public.chat_ensure_user(NEW.user_name, false);
  v_recipient_id := public.chat_ensure_user(NEW.media_url, false);
  v_low_id := LEAST(v_sender_id, v_recipient_id);
  v_high_id := GREATEST(v_sender_id, v_recipient_id);
  v_direct_key := v_low_id::text || ':' || v_high_id::text;
  v_sent_at := coalesce(NEW.created_at, now());

  INSERT INTO public.chat_conversations AS existing_conversation (
    conversation_type, direct_key, created_at, updated_at
  ) VALUES ('direct', v_direct_key, v_sent_at, v_sent_at)
  ON CONFLICT (direct_key) DO UPDATE
    SET created_at = LEAST(existing_conversation.created_at, EXCLUDED.created_at),
        updated_at = GREATEST(existing_conversation.updated_at, EXCLUDED.updated_at)
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.chat_conversation_members (conversation_id, user_id, joined_at)
  VALUES (v_conversation_id, v_sender_id, v_sent_at),
         (v_conversation_id, v_recipient_id, v_sent_at)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  v_payload := public.chat_safe_legacy_payload(NEW.content);

  v_body := coalesce(v_payload->>'text', v_payload->>'caption',
    CASE WHEN v_payload ? 'legacy_raw_content' THEN NEW.content ELSE '' END, '');
  v_message_type := lower(coalesce(v_payload->>'kind', ''));
  IF v_message_type NOT IN ('text', 'image', 'video', 'audio', 'file', 'system') THEN
    IF left(coalesce(NEW.actor_key, ''), 10) = '__dm_img__' THEN v_message_type := 'image';
    ELSIF left(coalesce(NEW.actor_key, ''), 10) = '__dm_vid__' THEN v_message_type := 'video';
    ELSIF left(coalesce(NEW.actor_key, ''), 10) = '__dm_aud__' THEN v_message_type := 'audio';
    ELSE v_message_type := 'text';
    END IF;
  END IF;

  v_read_text := v_payload->>'read_at';
  IF pg_input_is_valid(v_read_text, 'timestamptz') THEN
    v_read_at := v_read_text::timestamptz;
  ELSE
    v_read_at := NULL;
  END IF;
  IF pg_input_is_valid(v_payload->>'withdrawn_at', 'timestamptz') THEN
    v_withdrawn_at := (v_payload->>'withdrawn_at')::timestamptz;
  ELSIF v_payload->>'withdrawn' IN ('true', '1') THEN
    v_withdrawn_at := coalesce(NEW.updated_at, NEW.created_at, now());
  ELSE
    v_withdrawn_at := NULL;
  END IF;

  INSERT INTO public.chat_messages (
    id, conversation_id, sender_id, sender_name_snapshot, message_type, body,
    payload, legacy_content, legacy_actor_key, legacy_post_id, sent_at,
    withdrawn_at, updated_at
  ) VALUES (
    NEW.id, v_conversation_id, v_sender_id, NEW.user_name, v_message_type, v_body,
    v_payload, NEW.content, NEW.actor_key, NEW.id, v_sent_at,
    v_withdrawn_at, coalesce(NEW.updated_at, v_sent_at)
  )
  ON CONFLICT (legacy_post_id) DO UPDATE
    SET conversation_id = EXCLUDED.conversation_id,
        sender_id = EXCLUDED.sender_id,
        sender_name_snapshot = EXCLUDED.sender_name_snapshot,
        message_type = EXCLUDED.message_type,
        body = EXCLUDED.body,
        payload = EXCLUDED.payload,
        legacy_content = EXCLUDED.legacy_content,
        legacy_actor_key = EXCLUDED.legacy_actor_key,
        sent_at = EXCLUDED.sent_at,
        withdrawn_at = EXCLUDED.withdrawn_at,
        updated_at = EXCLUDED.updated_at;

  INSERT INTO public.chat_message_user_state AS existing_state (message_id, user_id, read_at)
  VALUES (NEW.id, v_recipient_id, v_read_at)
  ON CONFLICT (message_id, user_id) DO UPDATE
    SET read_at = coalesce(EXCLUDED.read_at, existing_state.read_at),
        updated_at = now();

  IF v_read_at IS NOT NULL THEN
    UPDATE public.chat_conversation_members member
    SET last_read_at = CASE WHEN member.last_read_at IS NULL
      THEN v_read_at ELSE GREATEST(member.last_read_at, v_read_at) END,
        last_read_message_id = CASE
          WHEN member.last_read_message_id IS NULL THEN NEW.id
          WHEN (SELECT (previous.sent_at, previous.id) FROM public.chat_messages previous
                WHERE previous.id = member.last_read_message_id) <= (v_sent_at, NEW.id) THEN NEW.id
          ELSE member.last_read_message_id
        END,
        updated_at = now()
    WHERE member.conversation_id = v_conversation_id
      AND member.user_id = v_recipient_id;
  END IF;

  UPDATE public.chat_conversations conversation
  SET last_message_id = NEW.id,
      last_message_at = v_sent_at,
      updated_at = GREATEST(conversation.updated_at, v_sent_at)
  WHERE conversation.id = v_conversation_id
    AND (conversation.last_message_at IS NULL
      OR v_sent_at > conversation.last_message_at
      OR (v_sent_at = conversation.last_message_at AND NEW.id > conversation.last_message_id));

  RETURN NEW;
END;
$function$;

-- Keep the normalized attachment index in step with the upload reservation
-- lifecycle. The exact storage object path remains service-side metadata.
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
    DELETE FROM public.chat_attachments WHERE legacy_upload_id = OLD.id;
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

-- Keep the legacy per-account delete snapshot reflected in message user state.
-- The old endpoint inserts a replacement snapshot before deleting the prior
-- row, so state is recomputed from the latest remaining snapshot each time.
CREATE OR REPLACE FUNCTION public.chat_rebuild_hidden_state(p_user_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id UUID;
  v_content TEXT;
  v_created_at TIMESTAMPTZ;
  v_payload JSONB;
BEGIN
  IF p_user_name IS NULL OR btrim(p_user_name) = '' THEN
    RETURN;
  END IF;

  v_user_id := public.chat_ensure_user(p_user_name, false);
  UPDATE public.chat_message_user_state
  SET hidden_at = NULL, updated_at = now()
  WHERE user_id = v_user_id AND hidden_at IS NOT NULL;
  DELETE FROM public.chat_message_user_state
  WHERE user_id = v_user_id
    AND hidden_at IS NULL AND read_at IS NULL AND delivered_at IS NULL;

  SELECT snapshot.content, snapshot.created_at
    INTO v_content, v_created_at
  FROM public.posts snapshot
  WHERE snapshot.user_name = p_user_name
    AND snapshot.media_type = '__dm_deleted__'
  ORDER BY snapshot.created_at DESC, snapshot.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_payload := public.chat_safe_legacy_payload(v_content);
  INSERT INTO public.chat_message_user_state (message_id, user_id, hidden_at)
  SELECT message.id, v_user_id, v_created_at
  FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(v_payload->'ids') = 'array'
      THEN v_payload->'ids' ELSE '[]'::jsonb END
  ) AS hidden(message_id_text)
  JOIN public.chat_messages message ON message.legacy_post_id::text = hidden.message_id_text
  ON CONFLICT (message_id, user_id) DO UPDATE
    SET hidden_at = EXCLUDED.hidden_at, updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_sync_legacy_deleted_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.media_type = '__dm_deleted__' THEN
      PERFORM public.chat_rebuild_hidden_state(OLD.user_name);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.media_type = '__dm_deleted__'
     AND OLD.user_name IS DISTINCT FROM NEW.user_name THEN
    PERFORM public.chat_rebuild_hidden_state(OLD.user_name);
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.media_type = '__dm_deleted__'
     AND NEW.media_type IS DISTINCT FROM '__dm_deleted__' THEN
    PERFORM public.chat_rebuild_hidden_state(OLD.user_name);
    RETURN NEW;
  END IF;

  IF NEW.media_type = '__dm_deleted__' THEN
    PERFORM public.chat_rebuild_hidden_state(NEW.user_name);
  END IF;
  RETURN NEW;
END;
$function$;

-- The app uses a custom HMAC access token rather than Supabase Auth, so only
-- Render's server-side service_role can reach these tables through the Data API.
DO $block$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'chat_users', 'chat_friend_requests', 'chat_friendships', 'chat_user_blocks',
    'chat_conversations', 'chat_conversation_members', 'chat_messages',
    'chat_message_user_state', 'chat_attachments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$block$;

REVOKE ALL ON FUNCTION public.chat_ensure_user(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_safe_legacy_payload(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_sync_legacy_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_sync_legacy_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_sync_legacy_attachment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_rebuild_hidden_state(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_sync_legacy_deleted_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_ensure_user(TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_safe_legacy_payload(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_sync_legacy_auth_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_sync_legacy_message() TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_sync_legacy_attachment() TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_rebuild_hidden_state(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_sync_legacy_deleted_snapshot() TO service_role;

DROP TRIGGER IF EXISTS chat_auth_projection_insert ON public.posts;
CREATE TRIGGER chat_auth_projection_insert
AFTER INSERT ON public.posts
FOR EACH ROW
WHEN (NEW.media_type IN ('__auth__', '__admin_auth__'))
EXECUTE FUNCTION public.chat_sync_legacy_auth_user();

DROP TRIGGER IF EXISTS chat_auth_projection_update ON public.posts;
CREATE TRIGGER chat_auth_projection_update
AFTER UPDATE OF user_name, media_type ON public.posts
FOR EACH ROW
WHEN (NEW.media_type IN ('__auth__', '__admin_auth__') OR OLD.media_type IN ('__auth__', '__admin_auth__'))
EXECUTE FUNCTION public.chat_sync_legacy_auth_user();

DROP TRIGGER IF EXISTS chat_auth_projection_delete ON public.posts;
CREATE TRIGGER chat_auth_projection_delete
AFTER DELETE ON public.posts
FOR EACH ROW
WHEN (OLD.media_type IN ('__auth__', '__admin_auth__'))
EXECUTE FUNCTION public.chat_sync_legacy_auth_user();

DROP TRIGGER IF EXISTS chat_message_projection_insert ON public.posts;
CREATE TRIGGER chat_message_projection_insert
AFTER INSERT ON public.posts
FOR EACH ROW
WHEN (NEW.media_type = '__dm__')
EXECUTE FUNCTION public.chat_sync_legacy_message();

DROP TRIGGER IF EXISTS chat_message_projection_update ON public.posts;
CREATE TRIGGER chat_message_projection_update
AFTER UPDATE OF media_type, user_name, media_url, content, actor_key, created_at ON public.posts
FOR EACH ROW
WHEN (NEW.media_type = '__dm__' OR OLD.media_type = '__dm__')
EXECUTE FUNCTION public.chat_sync_legacy_message();

DROP TRIGGER IF EXISTS chat_message_projection_delete ON public.posts;
CREATE TRIGGER chat_message_projection_delete
AFTER DELETE ON public.posts
FOR EACH ROW
WHEN (OLD.media_type = '__dm__')
EXECUTE FUNCTION public.chat_sync_legacy_message();

DROP TRIGGER IF EXISTS chat_attachment_projection_insert ON public.dm_media_uploads;
CREATE TRIGGER chat_attachment_projection_insert
AFTER INSERT ON public.dm_media_uploads
FOR EACH ROW
EXECUTE FUNCTION public.chat_sync_legacy_attachment();

DROP TRIGGER IF EXISTS chat_attachment_projection_update ON public.dm_media_uploads;
CREATE TRIGGER chat_attachment_projection_update
AFTER UPDATE OF storage_path, uploader, kind, mime_type, size_bytes, status, message_id ON public.dm_media_uploads
FOR EACH ROW
EXECUTE FUNCTION public.chat_sync_legacy_attachment();

DROP TRIGGER IF EXISTS chat_attachment_projection_delete ON public.dm_media_uploads;
CREATE TRIGGER chat_attachment_projection_delete
AFTER DELETE ON public.dm_media_uploads
FOR EACH ROW
EXECUTE FUNCTION public.chat_sync_legacy_attachment();

DROP TRIGGER IF EXISTS chat_deleted_state_projection_insert ON public.posts;
CREATE TRIGGER chat_deleted_state_projection_insert
AFTER INSERT ON public.posts
FOR EACH ROW
WHEN (NEW.media_type = '__dm_deleted__')
EXECUTE FUNCTION public.chat_sync_legacy_deleted_snapshot();

DROP TRIGGER IF EXISTS chat_deleted_state_projection_update ON public.posts;
CREATE TRIGGER chat_deleted_state_projection_update
AFTER UPDATE OF media_type, user_name, content, created_at ON public.posts
FOR EACH ROW
WHEN (NEW.media_type = '__dm_deleted__' OR OLD.media_type = '__dm_deleted__')
EXECUTE FUNCTION public.chat_sync_legacy_deleted_snapshot();

DROP TRIGGER IF EXISTS chat_deleted_state_projection_delete ON public.posts;
CREATE TRIGGER chat_deleted_state_projection_delete
AFTER DELETE ON public.posts
FOR EACH ROW
WHEN (OLD.media_type = '__dm_deleted__')
EXECUTE FUNCTION public.chat_sync_legacy_deleted_snapshot();

-- Migration guardrails: every valid DM row has a normalized copy, both
-- participants belong to its conversation, and browser roles have no table grants.
DO $verify$
DECLARE
  v_legacy_count BIGINT;
  v_normalized_count BIGINT;
  v_table TEXT;
  v_rls_enabled BOOLEAN;
BEGIN
  SELECT count(*) INTO v_legacy_count
  FROM public.posts
  WHERE media_type = '__dm__'
    AND user_name IS NOT NULL AND media_url IS NOT NULL
    AND btrim(user_name) <> '' AND btrim(media_url) <> ''
    AND user_name <> media_url;

  SELECT count(*) INTO v_normalized_count
  FROM public.chat_messages
  WHERE legacy_post_id IN (
    SELECT id FROM public.posts WHERE media_type = '__dm__'
      AND user_name IS NOT NULL AND media_url IS NOT NULL
      AND btrim(user_name) <> '' AND btrim(media_url) <> ''
      AND user_name <> media_url
  );

  IF v_legacy_count <> v_normalized_count THEN
    RAISE EXCEPTION 'chat migration mismatch: legacy %, normalized %', v_legacy_count, v_normalized_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.posts p
    JOIN public.chat_messages message ON message.legacy_post_id = p.id
    WHERE p.media_type = '__dm__'
      AND NOT pg_input_is_valid(p.content, 'jsonb')
      AND NOT (message.payload ? 'legacy_raw_content')
  ) THEN
    RAISE EXCEPTION 'chat migration did not preserve malformed legacy message payloads';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.posts p
    JOIN public.chat_messages message ON message.legacy_post_id = p.id
    JOIN public.chat_users sender ON sender.user_name = p.user_name
    JOIN public.chat_users recipient ON recipient.user_name = p.media_url
    JOIN public.chat_conversations conversation
      ON conversation.direct_key = LEAST(sender.id, recipient.id)::text || ':' || GREATEST(sender.id, recipient.id)::text
    WHERE p.media_type = '__dm__'
      AND (NOT EXISTS (SELECT 1 FROM public.chat_conversation_members member
                       WHERE member.conversation_id = conversation.id AND member.user_id = sender.id)
        OR NOT EXISTS (SELECT 1 FROM public.chat_conversation_members member
                       WHERE member.conversation_id = conversation.id AND member.user_id = recipient.id))
  ) THEN
    RAISE EXCEPTION 'chat migration created a message without both conversation members';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'chat_users', 'chat_friend_requests', 'chat_friendships', 'chat_user_blocks',
    'chat_conversations', 'chat_conversation_members', 'chat_messages',
    'chat_message_user_state', 'chat_attachments'
  ] LOOP
    SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_table;
    IF NOT coalesce(v_rls_enabled, false) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', v_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'chat table grants are not restricted correctly for public.%', v_table;
    END IF;
  END LOOP;
END;
$verify$;

COMMIT;
