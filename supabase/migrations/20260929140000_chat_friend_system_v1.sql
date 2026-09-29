-- Phase 2: explicit friend relationships, requests, notes, and blocking.
-- All operations are called by the authenticated Express API using service_role.
-- Browser roles remain unable to read or mutate these tables directly.
BEGIN;

CREATE TABLE public.chat_friend_notes (
  owner_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  peer_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, peer_id),
  CONSTRAINT chat_friend_notes_not_self CHECK (owner_id <> peer_id),
  CONSTRAINT chat_friend_notes_length CHECK (length(note) BETWEEN 1 AND 80)
);

CREATE INDEX chat_friend_notes_peer_lookup ON public.chat_friend_notes (peer_id, owner_id);
ALTER TABLE public.chat_friend_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_friend_notes_block_browser
  ON public.chat_friend_notes FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.chat_friend_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_friend_notes TO service_role;

-- Serialize operations for a direct pair. Send inserts take the same lock in
-- the posts trigger, so a successful block prevents later messages even when
-- an older client or another server route attempts a direct DM insert.
CREATE OR REPLACE FUNCTION public.chat_lock_pair(p_left UUID, p_right UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_pair_key TEXT;
BEGIN
  IF p_left IS NULL OR p_right IS NULL OR p_left = p_right THEN
    RETURN;
  END IF;
  v_pair_key := CASE WHEN p_left < p_right
    THEN p_left::TEXT || ':' || p_right::TEXT
    ELSE p_right::TEXT || ':' || p_left::TEXT END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_pair_key, 948271));
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_get_relationship(p_user_name TEXT, p_peer_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id UUID;
  v_peer_id UUID;
  v_outgoing_id UUID;
  v_incoming_id UUID;
  v_blocked_by_me BOOLEAN := false;
  v_blocked_by_peer BOOLEAN := false;
  v_is_friend BOOLEAN := false;
  v_status TEXT := 'none';
BEGIN
  SELECT id INTO v_user_id FROM public.chat_users
    WHERE user_name = p_user_name AND is_registered AND deleted_at IS NULL;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'account_unavailable', 'is_friend', false, 'can_message', false);
  END IF;
  SELECT id INTO v_peer_id FROM public.chat_users
    WHERE user_name = p_peer_name AND is_registered AND deleted_at IS NULL;
  IF v_peer_id IS NULL THEN
    RETURN jsonb_build_object('status', 'user_not_found', 'is_friend', false, 'can_message', false);
  END IF;
  IF v_user_id = v_peer_id THEN
    RETURN jsonb_build_object('status', 'self', 'is_friend', false, 'can_message', false);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.chat_user_blocks b
    WHERE b.blocker_id = v_user_id AND b.blocked_id = v_peer_id
  ) INTO v_blocked_by_me;
  SELECT EXISTS (
    SELECT 1 FROM public.chat_user_blocks b
    WHERE b.blocker_id = v_peer_id AND b.blocked_id = v_user_id
  ) INTO v_blocked_by_peer;
  IF v_blocked_by_me THEN
    v_status := 'blocked_by_me';
  ELSIF v_blocked_by_peer THEN
    v_status := 'blocked_by_peer';
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.chat_friendships f
      WHERE f.user_low_id = LEAST(v_user_id, v_peer_id)
        AND f.user_high_id = GREATEST(v_user_id, v_peer_id)
    ) INTO v_is_friend;
    IF v_is_friend THEN
      v_status := 'friends';
    ELSE
      SELECT id INTO v_outgoing_id FROM public.chat_friend_requests
        WHERE requester_id = v_user_id AND target_id = v_peer_id AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1;
      SELECT id INTO v_incoming_id FROM public.chat_friend_requests
        WHERE requester_id = v_peer_id AND target_id = v_user_id AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1;
      IF v_outgoing_id IS NOT NULL THEN
        v_status := 'request_sent';
      ELSIF v_incoming_id IS NOT NULL THEN
        v_status := 'request_received';
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'status', v_status,
    'is_friend', v_is_friend,
    'can_message', v_is_friend AND NOT v_blocked_by_me AND NOT v_blocked_by_peer,
    'blocked_by_me', v_blocked_by_me,
    'blocked_by_peer', v_blocked_by_peer,
    'outgoing_request_id', v_outgoing_id,
    'incoming_request_id', v_incoming_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_search_users(p_user_name TEXT, p_query TEXT, p_limit INTEGER DEFAULT 20)
RETURNS TABLE(user_name TEXT, relationship TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id UUID;
  v_prefix TEXT := lower(btrim(COALESCE(p_query, '')));
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 20), 20));
BEGIN
  SELECT id INTO v_user_id FROM public.chat_users
    WHERE chat_users.user_name = p_user_name AND is_registered AND deleted_at IS NULL;
  IF v_user_id IS NULL OR length(v_prefix) < 2 OR length(v_prefix) > 64 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT u.user_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.chat_friendships f
        WHERE f.user_low_id = LEAST(v_user_id, u.id)
          AND f.user_high_id = GREATEST(v_user_id, u.id)
      ) THEN 'friends'
      WHEN EXISTS (
        SELECT 1 FROM public.chat_friend_requests r
        WHERE r.requester_id = v_user_id AND r.target_id = u.id AND r.status = 'pending'
      ) THEN 'request_sent'
      WHEN EXISTS (
        SELECT 1 FROM public.chat_friend_requests r
        WHERE r.requester_id = u.id AND r.target_id = v_user_id AND r.status = 'pending'
      ) THEN 'request_received'
      ELSE 'none'
    END::TEXT AS relationship
  FROM public.chat_users u
  WHERE u.is_registered AND u.deleted_at IS NULL AND u.id <> v_user_id
    AND left(lower(u.user_name), length(v_prefix)) = v_prefix
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_user_blocks b
      WHERE (b.blocker_id = v_user_id AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = v_user_id)
    )
  ORDER BY lower(u.user_name), u.user_name
  LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_request_friend(p_requester_name TEXT, p_target_name TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_requester UUID;
  v_target UUID;
  v_request_id UUID;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  SELECT id INTO v_requester FROM public.chat_users
    WHERE user_name = p_requester_name AND is_registered AND deleted_at IS NULL;
  IF v_requester IS NULL THEN
    RETURN jsonb_build_object('status', 'account_unavailable');
  END IF;
  SELECT id INTO v_target FROM public.chat_users
    WHERE user_name = p_target_name AND is_registered AND deleted_at IS NULL;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;
  IF v_requester = v_target THEN
    RETURN jsonb_build_object('status', 'self');
  END IF;
  IF length(COALESCE(v_note, '')) > 240 THEN
    RETURN jsonb_build_object('status', 'note_too_long');
  END IF;
  PERFORM public.chat_lock_pair(v_requester, v_target);

  IF EXISTS (
    SELECT 1 FROM public.chat_user_blocks b
    WHERE (b.blocker_id = v_requester AND b.blocked_id = v_target)
       OR (b.blocker_id = v_target AND b.blocked_id = v_requester)
  ) THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.chat_friendships f
    WHERE f.user_low_id = LEAST(v_requester, v_target)
      AND f.user_high_id = GREATEST(v_requester, v_target)
  ) THEN
    RETURN jsonb_build_object('status', 'already_friends');
  END IF;

  SELECT id INTO v_request_id FROM public.chat_friend_requests
    WHERE requester_id = v_target AND target_id = v_requester AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;
  IF v_request_id IS NOT NULL THEN
    UPDATE public.chat_friend_requests
      SET status = 'accepted', updated_at = now(), responded_at = now()
      WHERE status = 'pending'
        AND ((requester_id = v_requester AND target_id = v_target)
          OR (requester_id = v_target AND target_id = v_requester));
    INSERT INTO public.chat_friendships (user_low_id, user_high_id)
      VALUES (LEAST(v_requester, v_target), GREATEST(v_requester, v_target))
      ON CONFLICT (user_low_id, user_high_id) DO NOTHING;
    RETURN jsonb_build_object('status', 'accepted', 'request_id', v_request_id);
  END IF;

  SELECT id INTO v_request_id FROM public.chat_friend_requests
    WHERE requester_id = v_requester AND target_id = v_target AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;
  IF v_request_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'request_pending', 'request_id', v_request_id);
  END IF;

  INSERT INTO public.chat_friend_requests (requester_id, target_id, request_note)
  VALUES (v_requester, v_target, v_note)
  RETURNING id INTO v_request_id;
  RETURN jsonb_build_object('status', 'request_sent', 'request_id', v_request_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_finish_friend_request(p_actor_name TEXT, p_request_id UUID, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor UUID;
  v_requester UUID;
  v_target UUID;
  v_status TEXT;
BEGIN
  IF p_action NOT IN ('accept', 'reject', 'cancel') THEN
    RETURN jsonb_build_object('status', 'invalid_action');
  END IF;
  SELECT id INTO v_actor FROM public.chat_users
    WHERE user_name = p_actor_name AND is_registered AND deleted_at IS NULL;
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('status', 'account_unavailable');
  END IF;
  SELECT requester_id, target_id, status
    INTO v_requester, v_target, v_status
    FROM public.chat_friend_requests WHERE id = p_request_id;
  IF v_requester IS NULL THEN
    RETURN jsonb_build_object('status', 'request_not_found');
  END IF;
  IF (p_action IN ('accept', 'reject') AND v_target <> v_actor)
     OR (p_action = 'cancel' AND v_requester <> v_actor) THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;
  PERFORM public.chat_lock_pair(v_requester, v_target);
  SELECT status INTO v_status FROM public.chat_friend_requests WHERE id = p_request_id;
  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('status', 'request_not_pending');
  END IF;

  IF p_action = 'accept' THEN
    IF EXISTS (
      SELECT 1 FROM public.chat_user_blocks b
      WHERE (b.blocker_id = v_requester AND b.blocked_id = v_target)
         OR (b.blocker_id = v_target AND b.blocked_id = v_requester)
    ) THEN
      UPDATE public.chat_friend_requests
        SET status = 'rejected', updated_at = now(), responded_at = now()
        WHERE id = p_request_id AND status = 'pending';
      RETURN jsonb_build_object('status', 'blocked');
    END IF;
    UPDATE public.chat_friend_requests
      SET status = 'accepted', updated_at = now(), responded_at = now()
      WHERE id = p_request_id AND status = 'pending';
    UPDATE public.chat_friend_requests
      SET status = 'accepted', updated_at = now(), responded_at = now()
      WHERE status = 'pending'
        AND ((requester_id = v_requester AND target_id = v_target)
          OR (requester_id = v_target AND target_id = v_requester));
    INSERT INTO public.chat_friendships (user_low_id, user_high_id)
      VALUES (LEAST(v_requester, v_target), GREATEST(v_requester, v_target))
      ON CONFLICT (user_low_id, user_high_id) DO NOTHING;
    RETURN jsonb_build_object('status', 'accepted', 'request_id', p_request_id);
  END IF;

  UPDATE public.chat_friend_requests
    SET status = CASE WHEN p_action = 'reject' THEN 'rejected' ELSE 'canceled' END,
        updated_at = now(), responded_at = now()
    WHERE id = p_request_id AND status = 'pending';
  RETURN jsonb_build_object('status', CASE WHEN p_action = 'reject' THEN 'rejected' ELSE 'canceled' END,
    'request_id', p_request_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_remove_friend(p_actor_name TEXT, p_peer_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor UUID;
  v_peer UUID;
  v_deleted INTEGER;
BEGIN
  SELECT id INTO v_actor FROM public.chat_users
    WHERE user_name = p_actor_name AND is_registered AND deleted_at IS NULL;
  SELECT id INTO v_peer FROM public.chat_users
    WHERE user_name = p_peer_name AND is_registered AND deleted_at IS NULL;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('status', 'account_unavailable'); END IF;
  IF v_peer IS NULL THEN RETURN jsonb_build_object('status', 'user_not_found'); END IF;
  IF v_actor = v_peer THEN RETURN jsonb_build_object('status', 'self'); END IF;
  PERFORM public.chat_lock_pair(v_actor, v_peer);
  DELETE FROM public.chat_friendships
    WHERE user_low_id = LEAST(v_actor, v_peer) AND user_high_id = GREATEST(v_actor, v_peer);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  UPDATE public.chat_friend_requests
    SET status = 'canceled', updated_at = now(), responded_at = now()
    WHERE status = 'pending'
      AND ((requester_id = v_actor AND target_id = v_peer)
        OR (requester_id = v_peer AND target_id = v_actor));
  DELETE FROM public.chat_friend_notes
    WHERE (owner_id = v_actor AND peer_id = v_peer)
       OR (owner_id = v_peer AND peer_id = v_actor);
  RETURN jsonb_build_object('status', CASE WHEN v_deleted > 0 THEN 'removed' ELSE 'not_friends' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_block_user(p_actor_name TEXT, p_peer_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor UUID;
  v_peer UUID;
  v_inserted INTEGER;
BEGIN
  SELECT id INTO v_actor FROM public.chat_users
    WHERE user_name = p_actor_name AND is_registered AND deleted_at IS NULL;
  SELECT id INTO v_peer FROM public.chat_users
    WHERE user_name = p_peer_name AND is_registered AND deleted_at IS NULL;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('status', 'account_unavailable'); END IF;
  IF v_peer IS NULL THEN RETURN jsonb_build_object('status', 'user_not_found'); END IF;
  IF v_actor = v_peer THEN RETURN jsonb_build_object('status', 'self'); END IF;
  PERFORM public.chat_lock_pair(v_actor, v_peer);
  INSERT INTO public.chat_user_blocks (blocker_id, blocked_id)
    VALUES (v_actor, v_peer) ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  DELETE FROM public.chat_friendships
    WHERE user_low_id = LEAST(v_actor, v_peer) AND user_high_id = GREATEST(v_actor, v_peer);
  UPDATE public.chat_friend_requests
    SET status = 'rejected', updated_at = now(), responded_at = now()
    WHERE status = 'pending'
      AND ((requester_id = v_actor AND target_id = v_peer)
        OR (requester_id = v_peer AND target_id = v_actor));
  DELETE FROM public.chat_friend_notes
    WHERE (owner_id = v_actor AND peer_id = v_peer)
       OR (owner_id = v_peer AND peer_id = v_actor);
  RETURN jsonb_build_object('status', CASE WHEN v_inserted > 0 THEN 'blocked' ELSE 'already_blocked' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_unblock_user(p_actor_name TEXT, p_peer_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor UUID;
  v_peer UUID;
  v_deleted INTEGER;
BEGIN
  SELECT id INTO v_actor FROM public.chat_users
    WHERE user_name = p_actor_name AND is_registered AND deleted_at IS NULL;
  SELECT id INTO v_peer FROM public.chat_users
    WHERE user_name = p_peer_name AND is_registered AND deleted_at IS NULL;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('status', 'account_unavailable'); END IF;
  IF v_peer IS NULL THEN RETURN jsonb_build_object('status', 'user_not_found'); END IF;
  IF v_actor = v_peer THEN RETURN jsonb_build_object('status', 'self'); END IF;
  PERFORM public.chat_lock_pair(v_actor, v_peer);
  DELETE FROM public.chat_user_blocks WHERE blocker_id = v_actor AND blocked_id = v_peer;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('status', CASE WHEN v_deleted > 0 THEN 'unblocked' ELSE 'not_blocked' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_set_friend_note(p_owner_name TEXT, p_peer_name TEXT, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_owner UUID;
  v_peer UUID;
  v_note TEXT := btrim(COALESCE(p_note, ''));
BEGIN
  SELECT id INTO v_owner FROM public.chat_users
    WHERE user_name = p_owner_name AND is_registered AND deleted_at IS NULL;
  SELECT id INTO v_peer FROM public.chat_users
    WHERE user_name = p_peer_name AND is_registered AND deleted_at IS NULL;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('status', 'account_unavailable'); END IF;
  IF v_peer IS NULL THEN RETURN jsonb_build_object('status', 'user_not_found'); END IF;
  IF v_owner = v_peer THEN RETURN jsonb_build_object('status', 'self'); END IF;
  IF length(v_note) > 80 THEN RETURN jsonb_build_object('status', 'note_too_long'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_friendships f
    WHERE f.user_low_id = LEAST(v_owner, v_peer)
      AND f.user_high_id = GREATEST(v_owner, v_peer)
  ) THEN RETURN jsonb_build_object('status', 'not_friends'); END IF;
  IF v_note = '' THEN
    DELETE FROM public.chat_friend_notes WHERE owner_id = v_owner AND peer_id = v_peer;
  ELSE
    INSERT INTO public.chat_friend_notes (owner_id, peer_id, note)
      VALUES (v_owner, v_peer, v_note)
      ON CONFLICT (owner_id, peer_id)
      DO UPDATE SET note = EXCLUDED.note, updated_at = now();
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'note', NULLIF(v_note, ''));
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_list_friends(p_user_name TEXT)
RETURNS TABLE(peer_name TEXT, note TEXT, friend_since TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT peer.user_name, n.note, f.created_at
  FROM public.chat_users self_user
  JOIN public.chat_friendships f
    ON f.user_low_id = self_user.id OR f.user_high_id = self_user.id
  JOIN public.chat_users peer
    ON peer.id = CASE WHEN f.user_low_id = self_user.id THEN f.user_high_id ELSE f.user_low_id END
  LEFT JOIN public.chat_friend_notes n ON n.owner_id = self_user.id AND n.peer_id = peer.id
  WHERE self_user.user_name = p_user_name AND self_user.is_registered AND self_user.deleted_at IS NULL
    AND peer.is_registered AND peer.deleted_at IS NULL
  ORDER BY f.updated_at DESC, lower(peer.user_name), peer.user_name;
$function$;

CREATE OR REPLACE FUNCTION public.chat_list_requests(p_user_name TEXT, p_direction TEXT DEFAULT 'incoming')
RETURNS TABLE(request_id UUID, requester_name TEXT, target_name TEXT, request_note TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT r.id, requester.user_name, target.user_name, r.request_note, r.created_at
  FROM public.chat_users self_user
  JOIN public.chat_friend_requests r ON r.status = 'pending'
    AND ((p_direction = 'incoming' AND r.target_id = self_user.id)
      OR (p_direction = 'outgoing' AND r.requester_id = self_user.id))
  JOIN public.chat_users requester ON requester.id = r.requester_id
  JOIN public.chat_users target ON target.id = r.target_id
  WHERE self_user.user_name = p_user_name AND self_user.is_registered AND self_user.deleted_at IS NULL
    AND requester.is_registered AND requester.deleted_at IS NULL
    AND target.is_registered AND target.deleted_at IS NULL
    AND p_direction IN ('incoming', 'outgoing')
  ORDER BY r.created_at DESC
  LIMIT 100;
$function$;

CREATE OR REPLACE FUNCTION public.chat_list_blocks(p_user_name TEXT)
RETURNS TABLE(peer_name TEXT, blocked_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT peer.user_name, b.created_at
  FROM public.chat_users self_user
  JOIN public.chat_user_blocks b ON b.blocker_id = self_user.id
  JOIN public.chat_users peer ON peer.id = b.blocked_id
  WHERE self_user.user_name = p_user_name AND self_user.is_registered AND self_user.deleted_at IS NULL
  ORDER BY b.created_at DESC
  LIMIT 200;
$function$;

-- Defensive storage-layer check. It is independent of UI state and serializes
-- against block requests using chat_lock_pair. Old history remains readable;
-- only a newly inserted/retargeted message is denied.
CREATE OR REPLACE FUNCTION public.chat_reject_blocked_dm_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_sender UUID;
  v_recipient UUID;
BEGIN
  IF NEW.media_type IS DISTINCT FROM '__dm__' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.media_type IS NOT DISTINCT FROM OLD.media_type
       AND NEW.user_name IS NOT DISTINCT FROM OLD.user_name
       AND NEW.media_url IS NOT DISTINCT FROM OLD.media_url THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT id INTO v_sender FROM public.chat_users
    WHERE user_name = NEW.user_name AND is_registered AND deleted_at IS NULL;
  SELECT id INTO v_recipient FROM public.chat_users
    WHERE user_name = NEW.media_url AND is_registered AND deleted_at IS NULL;
  IF v_sender IS NULL OR v_recipient IS NULL OR v_sender = v_recipient THEN
    RETURN NEW;
  END IF;
  PERFORM public.chat_lock_pair(v_sender, v_recipient);
  IF EXISTS (
    SELECT 1 FROM public.chat_user_blocks b
    WHERE (b.blocker_id = v_sender AND b.blocked_id = v_recipient)
       OR (b.blocker_id = v_recipient AND b.blocked_id = v_sender)
  ) THEN
    RAISE EXCEPTION 'chat_blocked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS chat_blocked_dm_guard ON public.posts;
CREATE TRIGGER chat_blocked_dm_guard
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.chat_reject_blocked_dm_write();

REVOKE ALL ON FUNCTION public.chat_lock_pair(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_get_relationship(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_search_users(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_request_friend(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_finish_friend_request(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_remove_friend(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_block_user(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_unblock_user(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_set_friend_note(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_list_friends(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_list_requests(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_list_blocks(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_reject_blocked_dm_write() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.chat_lock_pair(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_get_relationship(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_search_users(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_request_friend(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_finish_friend_request(TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_remove_friend(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_block_user(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_unblock_user(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_set_friend_note(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_list_friends(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_list_requests(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_list_blocks(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_reject_blocked_dm_write() TO service_role;

COMMIT;
