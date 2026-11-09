-- Group chat (user request 2026-11-09): WeChat/QQ-style groups of up to 1000
-- members. The owner has every permission (rename, announcement, invite,
-- remove, admins, mute, approval, QR reset, transfer, dissolve); admins manage
-- ordinary members; every member keeps personal settings (nickname, do not
-- disturb, pin, background, clear history, hide a message).
--
-- Only the authenticated Express API (service_role) calls these functions. All
-- permission checks live here so a check and the change it guards happen in
-- one transaction. Browser roles cannot read or write any of these tables.
BEGIN;

CREATE TABLE public.chat_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  announcement TEXT NOT NULL DEFAULT '',
  announcement_by UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  announcement_at TIMESTAMPTZ,
  mute_all BOOLEAN NOT NULL DEFAULT false,
  join_approval BOOLEAN NOT NULL DEFAULT false,
  invite_policy TEXT NOT NULL DEFAULT 'all' CHECK (invite_policy IN ('all', 'admins')),
  qr_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  member_limit INTEGER NOT NULL DEFAULT 1000 CHECK (member_limit BETWEEN 2 AND 1000),
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dissolved_at TIMESTAMPTZ,
  CONSTRAINT chat_groups_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 30),
  CONSTRAINT chat_groups_announcement_length CHECK (length(announcement) <= 2000)
);

CREATE TABLE public.chat_group_members (
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  nickname TEXT,
  muted BOOLEAN NOT NULL DEFAULT false,
  pinned_at TIMESTAMPTZ,
  background TEXT,
  banned_until TIMESTAMPTZ,
  cleared_at TIMESTAMPTZ,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT chat_group_members_nickname CHECK (nickname IS NULL OR length(btrim(nickname)) BETWEEN 1 AND 20),
  CONSTRAINT chat_group_members_background CHECK (background IS NULL OR background ~ '^[a-z0-9-]{1,24}$')
);
CREATE INDEX chat_group_members_user ON public.chat_group_members (user_id, group_id);
CREATE UNIQUE INDEX chat_group_members_one_owner ON public.chat_group_members (group_id) WHERE role = 'owner';

CREATE TABLE public.chat_group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'system')),
  body TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  reply_to UUID REFERENCES public.chat_group_messages(id) ON DELETE SET NULL,
  client_id TEXT,
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chat_group_messages_body_length CHECK (length(body) <= 2000),
  CONSTRAINT chat_group_messages_client_id CHECK (client_id IS NULL OR client_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT chat_group_messages_meta_object CHECK (jsonb_typeof(meta) = 'object')
);
CREATE INDEX chat_group_messages_page ON public.chat_group_messages (group_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX chat_group_messages_client ON public.chat_group_messages (group_id, sender_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE public.chat_group_hidden (
  user_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.chat_group_messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE public.chat_group_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.chat_users(id) ON DELETE CASCADE,
  inviter_id UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES public.chat_users(id) ON DELETE SET NULL,
  CONSTRAINT chat_group_join_requests_note CHECK (note IS NULL OR length(note) <= 120)
);
CREATE UNIQUE INDEX chat_group_join_requests_pending ON public.chat_group_join_requests (group_id, user_id) WHERE status = 'pending';

DO $grants$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_groups', 'chat_group_members', 'chat_group_messages', 'chat_group_hidden', 'chat_group_join_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t || '_block_browser', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
  END LOOP;
END $grants$;

-- ---------------------------------------------------------------- helpers

CREATE FUNCTION public.chat_group_user_id(p_user_name TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT id FROM public.chat_users WHERE user_name = p_user_name AND is_registered AND deleted_at IS NULL LIMIT 1
$$;

CREATE FUNCTION public.chat_group_name_of(p_user UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN u.deleted_at IS NOT NULL OR NOT u.is_registered THEN '已注销用户' ELSE u.user_name END
  FROM public.chat_users u WHERE u.id = p_user
$$;

-- The display name inside a group: the member's group nickname, else the account name.
CREATE FUNCTION public.chat_group_display(p_group UUID, p_user UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((SELECT m.nickname FROM public.chat_group_members m WHERE m.group_id = p_group AND m.user_id = p_user),
                  public.chat_group_name_of(p_user), '未知用户')
$$;

CREATE FUNCTION public.chat_group_system(p_group UUID, p_actor UUID, p_event TEXT, p_body TEXT, p_extra JSONB DEFAULT '{}'::jsonb)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.chat_group_messages (group_id, sender_id, kind, body, meta)
  VALUES (p_group, p_actor, 'system', left(p_body, 2000), jsonb_build_object('event', p_event) || COALESCE(p_extra, '{}'::jsonb))
  RETURNING id INTO v_id;
  UPDATE public.chat_groups SET last_message_at = clock_timestamp(), updated_at = now() WHERE id = p_group;
  RETURN v_id;
END $$;

CREATE FUNCTION public.chat_group_recount(p_group UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.chat_group_members WHERE group_id = p_group;
  UPDATE public.chat_groups SET member_count = v_count, updated_at = now() WHERE id = p_group;
  RETURN v_count;
END $$;

CREATE FUNCTION public.chat_group_member_names(p_group UUID, p_except UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(u.user_name), '[]'::jsonb)
  FROM public.chat_group_members m JOIN public.chat_users u ON u.id = m.user_id
  WHERE m.group_id = p_group AND (p_except IS NULL OR m.user_id <> p_except) AND u.is_registered AND u.deleted_at IS NULL
$$;

-- Two users may be put in the same group by an inviter only when the inviter
-- and invitee are friends and neither has blocked the other.
CREATE FUNCTION public.chat_group_can_invite(p_inviter UUID, p_target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_inviter <> p_target
    AND EXISTS (SELECT 1 FROM public.chat_friendships f WHERE f.user_low_id = LEAST(p_inviter, p_target) AND f.user_high_id = GREATEST(p_inviter, p_target))
    AND NOT EXISTS (SELECT 1 FROM public.chat_user_blocks b WHERE (b.blocker_id = p_inviter AND b.blocked_id = p_target) OR (b.blocker_id = p_target AND b.blocked_id = p_inviter))
$$;

-- Remove one membership; when the owner leaves, hand the group to the longest
-- serving admin, else the longest serving member; an empty group dissolves.
CREATE FUNCTION public.chat_group_drop_member(p_group UUID, p_user UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role TEXT; v_next UUID; v_count INTEGER;
BEGIN
  DELETE FROM public.chat_group_members WHERE group_id = p_group AND user_id = p_user RETURNING role INTO v_role;
  IF v_role IS NULL THEN RETURN jsonb_build_object('removed', false); END IF;
  UPDATE public.chat_group_join_requests SET status = 'canceled', decided_at = now()
    WHERE group_id = p_group AND user_id = p_user AND status = 'pending';
  v_count := public.chat_group_recount(p_group);
  IF v_role = 'owner' THEN
    SELECT user_id INTO v_next FROM public.chat_group_members WHERE group_id = p_group
      ORDER BY (role = 'admin') DESC, joined_at, user_id LIMIT 1;
    IF v_next IS NULL THEN
      UPDATE public.chat_groups SET owner_id = NULL, dissolved_at = COALESCE(dissolved_at, now()), updated_at = now() WHERE id = p_group;
      RETURN jsonb_build_object('removed', true, 'dissolved', true);
    END IF;
    UPDATE public.chat_group_members SET role = 'owner' WHERE group_id = p_group AND user_id = v_next;
    UPDATE public.chat_groups SET owner_id = v_next, updated_at = now() WHERE id = p_group;
    PERFORM public.chat_group_system(p_group, v_next, 'owner_transfer', public.chat_group_name_of(v_next) || ' 已成为新群主',
      jsonb_build_object('target', public.chat_group_name_of(v_next)));
    RETURN jsonb_build_object('removed', true, 'new_owner', public.chat_group_name_of(v_next), 'member_count', v_count);
  END IF;
  RETURN jsonb_build_object('removed', true, 'member_count', v_count);
END $$;

CREATE FUNCTION public.chat_group_message_json(p_msg public.chat_group_messages, p_viewer UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_reply public.chat_group_messages; v_reply_json JSONB;
BEGIN
  IF p_msg.reply_to IS NOT NULL THEN
    SELECT * INTO v_reply FROM public.chat_group_messages WHERE id = p_msg.reply_to;
    IF v_reply.id IS NOT NULL THEN
      v_reply_json := jsonb_build_object('id', v_reply.id, 'sender_name', public.chat_group_display(v_reply.group_id, v_reply.sender_id),
        'kind', v_reply.kind, 'text', CASE WHEN v_reply.withdrawn_at IS NOT NULL THEN '消息已撤回'
          WHEN v_reply.kind = 'image' THEN '[图片]' ELSE left(v_reply.body, 120) END);
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'id', p_msg.id, 'group_id', p_msg.group_id, 'kind', p_msg.kind,
    'sender', public.chat_group_name_of(p_msg.sender_id),
    'sender_display', CASE WHEN p_msg.sender_id IS NULL THEN '' ELSE public.chat_group_display(p_msg.group_id, p_msg.sender_id) END,
    'body', CASE WHEN p_msg.withdrawn_at IS NOT NULL THEN '' ELSE p_msg.body END,
    'meta', CASE WHEN p_msg.withdrawn_at IS NOT NULL THEN '{}'::jsonb ELSE p_msg.meta - 'storage_path' END,
    'has_media', p_msg.withdrawn_at IS NULL AND p_msg.kind = 'image' AND p_msg.meta ? 'storage_path',
    'media_path', CASE WHEN p_msg.withdrawn_at IS NULL AND p_msg.kind = 'image' THEN p_msg.meta->>'storage_path' END,
    'reply_to', v_reply_json,
    'client_id', CASE WHEN p_msg.sender_id = p_viewer THEN p_msg.client_id END,
    'withdrawn', p_msg.withdrawn_at IS NOT NULL,
    'withdrawn_by', CASE WHEN p_msg.withdrawn_at IS NOT NULL THEN public.chat_group_name_of(p_msg.withdrawn_by) END,
    'created_at', p_msg.created_at);
END $$;

-- ------------------------------------------------------------------ create

CREATE FUNCTION public.chat_group_create(p_actor TEXT, p_name TEXT, p_members TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_me UUID := public.chat_group_user_id(p_actor);
  v_group UUID; v_name TEXT := btrim(COALESCE(p_name, '')); v_ids UUID[] := ARRAY[]::UUID[];
  v_rejected JSONB := '[]'::jsonb; v_names TEXT[]; v_target UUID; v_member TEXT;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  IF p_members IS NULL OR cardinality(p_members) = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'members_required'); END IF;
  IF cardinality(p_members) > 999 THEN RETURN jsonb_build_object('ok', false, 'code', 'group_full'); END IF;
  IF length(v_name) > 30 THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_name'); END IF;
  FOREACH v_member IN ARRAY p_members LOOP
    v_target := public.chat_group_user_id(btrim(v_member));
    IF v_target IS NULL OR NOT public.chat_group_can_invite(v_me, v_target) THEN
      v_rejected := v_rejected || to_jsonb(btrim(v_member));
    ELSIF NOT v_target = ANY (v_ids) THEN
      v_ids := v_ids || v_target;
    END IF;
  END LOOP;
  IF cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'friend_required', 'rejected', v_rejected); END IF;
  SELECT array_agg(public.chat_group_name_of(x) ORDER BY ord) INTO v_names FROM unnest(v_ids) WITH ORDINALITY AS t(x, ord);
  IF v_name = '' THEN
    v_name := left(array_to_string(ARRAY[public.chat_group_name_of(v_me)] || v_names[1:3], '、'), 30);
  END IF;
  INSERT INTO public.chat_groups (name, owner_id) VALUES (v_name, v_me) RETURNING id INTO v_group;
  INSERT INTO public.chat_group_members (group_id, user_id, role, last_read_at) VALUES (v_group, v_me, 'owner', now());
  INSERT INTO public.chat_group_members (group_id, user_id, role, invited_by)
    SELECT v_group, x, 'member', v_me FROM unnest(v_ids) AS x;
  PERFORM public.chat_group_recount(v_group);
  PERFORM public.chat_group_system(v_group, v_me, 'create',
    public.chat_group_name_of(v_me) || ' 创建了群聊，邀请 ' || left(array_to_string(v_names, '、'), 300) ||
      CASE WHEN cardinality(v_names) > 20 THEN ' 等 ' || cardinality(v_names) || ' 人' ELSE '' END || ' 加入了群聊',
    jsonb_build_object('targets', to_jsonb(v_names[1:20])));
  RETURN jsonb_build_object('ok', true, 'group_id', v_group, 'name', v_name, 'rejected', v_rejected,
    'notify', public.chat_group_member_names(v_group, v_me));
END $$;

-- -------------------------------------------------------------------- list

CREATE FUNCTION public.chat_group_list(p_actor TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me UUID := public.chat_group_user_id(p_actor); v_result JSONB;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'pinned_at') IS NULL, item->>'pinned_at' DESC, item->>'sort_at' DESC), '[]'::jsonb)
  INTO v_result FROM (
    SELECT jsonb_build_object(
      'id', g.id, 'name', g.name, 'member_count', g.member_count, 'role', m.role, 'muted', m.muted,
      'pinned_at', m.pinned_at, 'background', m.background, 'dissolved', g.dissolved_at IS NOT NULL,
      'sort_at', COALESCE(lm.created_at, m.joined_at),
      'last_message', CASE WHEN lm.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', lm.id, 'kind', lm.kind, 'sender', public.chat_group_name_of(lm.sender_id),
        'sender_display', CASE WHEN lm.sender_id IS NULL THEN '' ELSE public.chat_group_display(g.id, lm.sender_id) END,
        'text', CASE WHEN lm.withdrawn_at IS NOT NULL THEN '消息已撤回' WHEN lm.kind = 'image' THEN '[图片]' ELSE left(lm.body, 80) END,
        'created_at', lm.created_at) END,
      'unread', (SELECT count(*) FROM (SELECT 1 FROM public.chat_group_messages x
          WHERE x.group_id = g.id AND x.kind <> 'system' AND x.withdrawn_at IS NULL AND x.sender_id IS DISTINCT FROM v_me
            AND x.created_at > GREATEST(COALESCE(m.last_read_at, m.joined_at), COALESCE(m.cleared_at, m.joined_at), m.joined_at)
          LIMIT 100) unread_rows),
      'mentioned', EXISTS (SELECT 1 FROM public.chat_group_messages x
          WHERE x.group_id = g.id AND x.kind = 'text' AND x.withdrawn_at IS NULL AND x.sender_id IS DISTINCT FROM v_me
            AND x.created_at > GREATEST(COALESCE(m.last_read_at, m.joined_at), COALESCE(m.cleared_at, m.joined_at), m.joined_at)
            AND (x.meta->'mentions' ? p_actor OR x.meta->'mentions' ? '@all'))
    ) AS item
    FROM public.chat_group_members m
    JOIN public.chat_groups g ON g.id = m.group_id
    LEFT JOIN LATERAL (
      SELECT x.* FROM public.chat_group_messages x
      WHERE x.group_id = g.id AND x.created_at >= m.joined_at AND (m.cleared_at IS NULL OR x.created_at > m.cleared_at)
        AND NOT EXISTS (SELECT 1 FROM public.chat_group_hidden h WHERE h.user_id = v_me AND h.message_id = x.id)
      ORDER BY x.created_at DESC, x.id DESC LIMIT 1
    ) lm ON true
    WHERE m.user_id = v_me
  ) rows_;
  RETURN jsonb_build_object('ok', true, 'groups', v_result);
END $$;

-- ------------------------------------------------------------------ detail

CREATE FUNCTION public.chat_group_detail(p_actor TEXT, p_group UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me UUID := public.chat_group_user_id(p_actor); v_m public.chat_group_members; v_g public.chat_groups; v_members JSONB;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  SELECT * INTO v_m FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_me;
  IF v_m.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  SELECT * INTO v_g FROM public.chat_groups WHERE id = p_group;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_name', public.chat_group_name_of(m.user_id), 'nickname', m.nickname, 'role', m.role,
      'banned_until', CASE WHEN m.banned_until > now() THEN m.banned_until END, 'joined_at', m.joined_at,
      'active', u.is_registered AND u.deleted_at IS NULL)
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at, lower(u.user_name), m.user_id), '[]'::jsonb)
  INTO v_members FROM public.chat_group_members m JOIN public.chat_users u ON u.id = m.user_id WHERE m.group_id = p_group;
  RETURN jsonb_build_object('ok', true, 'group', jsonb_build_object(
      'id', v_g.id, 'name', v_g.name, 'owner', public.chat_group_name_of(v_g.owner_id),
      'announcement', v_g.announcement, 'announcement_by', public.chat_group_name_of(v_g.announcement_by),
      'announcement_at', v_g.announcement_at, 'mute_all', v_g.mute_all, 'join_approval', v_g.join_approval,
      'invite_policy', v_g.invite_policy, 'qr_token', v_g.qr_token, 'member_limit', v_g.member_limit,
      'member_count', v_g.member_count, 'created_at', v_g.created_at, 'dissolved', v_g.dissolved_at IS NOT NULL,
      'pending_requests', CASE WHEN v_m.role IN ('owner', 'admin') THEN
        (SELECT count(*) FROM public.chat_group_join_requests r WHERE r.group_id = p_group AND r.status = 'pending') ELSE 0 END),
    'me', jsonb_build_object('role', v_m.role, 'nickname', v_m.nickname, 'muted', v_m.muted, 'pinned_at', v_m.pinned_at,
      'background', v_m.background, 'banned_until', CASE WHEN v_m.banned_until > now() THEN v_m.banned_until END,
      'joined_at', v_m.joined_at, 'cleared_at', v_m.cleared_at),
    'members', v_members);
END $$;

-- ---------------------------------------------------------------- messages

CREATE FUNCTION public.chat_group_messages_page(p_actor TEXT, p_group UUID, p_limit INTEGER DEFAULT 50,
  p_before_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL, p_after_at TIMESTAMPTZ DEFAULT NULL, p_after_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_me UUID := public.chat_group_user_id(p_actor); v_m public.chat_group_members;
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)); v_rows JSONB; v_count INTEGER;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  SELECT * INTO v_m FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_me;
  IF v_m.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  WITH page AS (
    SELECT x.* FROM public.chat_group_messages x
    WHERE x.group_id = p_group AND x.created_at >= v_m.joined_at AND (v_m.cleared_at IS NULL OR x.created_at > v_m.cleared_at)
      AND NOT EXISTS (SELECT 1 FROM public.chat_group_hidden h WHERE h.user_id = v_me AND h.message_id = x.id)
      AND (p_before_at IS NULL OR x.created_at < p_before_at OR (x.created_at = p_before_at AND p_before_id IS NOT NULL AND x.id < p_before_id))
      AND (p_after_at IS NULL OR x.created_at > p_after_at OR (x.created_at = p_after_at AND p_after_id IS NOT NULL AND x.id > p_after_id))
    ORDER BY CASE WHEN p_after_at IS NULL THEN x.created_at END DESC, CASE WHEN p_after_at IS NULL THEN x.id END DESC,
             CASE WHEN p_after_at IS NOT NULL THEN x.created_at END ASC, CASE WHEN p_after_at IS NOT NULL THEN x.id END ASC
    LIMIT v_limit + 1
  )
  SELECT COALESCE(jsonb_agg(public.chat_group_message_json(page, v_me) ORDER BY page.created_at, page.id), '[]'::jsonb), count(*)
  INTO v_rows, v_count FROM page;
  IF v_count > v_limit THEN
    -- One extra row tells us there is more; drop it from the far end.
    IF p_after_at IS NULL THEN v_rows := v_rows - 0; ELSE v_rows := v_rows - (jsonb_array_length(v_rows) - 1); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'messages', v_rows, 'has_more', v_count > v_limit);
END $$;

CREATE FUNCTION public.chat_group_search(p_actor TEXT, p_group UUID, p_query TEXT, p_limit INTEGER DEFAULT 30, p_before_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me UUID := public.chat_group_user_id(p_actor); v_m public.chat_group_members; v_q TEXT := btrim(COALESCE(p_query, ''));
  v_rows JSONB;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  SELECT * INTO v_m FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_me;
  IF v_m.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  IF length(v_q) < 1 OR length(v_q) > 60 THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_query'); END IF;
  SELECT COALESCE(jsonb_agg(public.chat_group_message_json(s, v_me) ORDER BY s.created_at DESC, s.id DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT x.* FROM public.chat_group_messages x
    WHERE x.group_id = p_group AND x.kind = 'text' AND x.withdrawn_at IS NULL
      AND x.created_at >= v_m.joined_at AND (v_m.cleared_at IS NULL OR x.created_at > v_m.cleared_at)
      AND (p_before_at IS NULL OR x.created_at < p_before_at)
      AND NOT EXISTS (SELECT 1 FROM public.chat_group_hidden h WHERE h.user_id = v_me AND h.message_id = x.id)
      AND strpos(lower(x.body), lower(v_q)) > 0
    ORDER BY x.created_at DESC, x.id DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 50))) s;
  RETURN jsonb_build_object('ok', true, 'messages', v_rows);
END $$;

-- ------------------------------------------------------------------- send

CREATE FUNCTION public.chat_group_send(p_actor TEXT, p_group UUID, p_kind TEXT, p_body TEXT, p_meta JSONB, p_reply_to UUID, p_client_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_me UUID := public.chat_group_user_id(p_actor); v_m public.chat_group_members; v_g public.chat_groups;
  v_msg public.chat_group_messages; v_body TEXT := COALESCE(p_body, ''); v_meta JSONB := '{}'::jsonb; v_mentions JSONB := '[]'::jsonb;
  v_item TEXT;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  IF p_kind NOT IN ('text', 'image') THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_kind'); END IF;
  IF p_kind = 'text' AND length(btrim(v_body)) = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'empty_content'); END IF;
  IF length(v_body) > 2000 THEN RETURN jsonb_build_object('ok', false, 'code', 'content_too_long'); END IF;
  SELECT * INTO v_g FROM public.chat_groups WHERE id = p_group FOR SHARE;
  IF v_g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  SELECT * INTO v_m FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_me;
  IF v_m.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  IF v_g.dissolved_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'dissolved'); END IF;
  IF p_client_id IS NOT NULL THEN
    SELECT * INTO v_msg FROM public.chat_group_messages WHERE group_id = p_group AND sender_id = v_me AND client_id = p_client_id;
    IF v_msg.id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', public.chat_group_message_json(v_msg, v_me));
    END IF;
  END IF;
  IF v_m.role = 'member' AND v_g.mute_all THEN RETURN jsonb_build_object('ok', false, 'code', 'muted_all'); END IF;
  IF v_m.banned_until > now() THEN RETURN jsonb_build_object('ok', false, 'code', 'banned', 'banned_until', v_m.banned_until); END IF;
  IF p_reply_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.chat_group_messages r WHERE r.id = p_reply_to AND r.group_id = p_group
      AND r.kind <> 'system' AND r.withdrawn_at IS NULL AND r.created_at >= v_m.joined_at) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reply');
  END IF;
  IF p_kind = 'image' THEN
    IF NOT (COALESCE(p_meta, '{}'::jsonb) ? 'storage_path') THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_media'); END IF;
    v_meta := jsonb_strip_nulls(jsonb_build_object('storage_path', p_meta->>'storage_path', 'mime_type', p_meta->>'mime_type',
      'width', p_meta->'width', 'height', p_meta->'height', 'size', p_meta->'size'));
  END IF;
  IF jsonb_typeof(p_meta->'mentions') = 'array' THEN
    FOR v_item IN SELECT DISTINCT jsonb_array_elements_text(p_meta->'mentions') LIMIT 50 LOOP
      IF v_item = '@all' THEN
        IF v_m.role IN ('owner', 'admin') THEN v_mentions := v_mentions || to_jsonb(v_item); END IF;
      ELSIF EXISTS (SELECT 1 FROM public.chat_group_members gm JOIN public.chat_users u ON u.id = gm.user_id
                    WHERE gm.group_id = p_group AND u.user_name = v_item AND u.is_registered AND u.deleted_at IS NULL) THEN
        v_mentions := v_mentions || to_jsonb(v_item);
      END IF;
    END LOOP;
    IF jsonb_array_length(v_mentions) > 0 THEN v_meta := v_meta || jsonb_build_object('mentions', v_mentions); END IF;
  END IF;
  INSERT INTO public.chat_group_messages (group_id, sender_id, kind, body, meta, reply_to, client_id)
  VALUES (p_group, v_me, p_kind, v_body, v_meta, p_reply_to, p_client_id) RETURNING * INTO v_msg;
  UPDATE public.chat_groups SET last_message_at = v_msg.created_at WHERE id = p_group;
  UPDATE public.chat_group_members SET last_read_at = GREATEST(COALESCE(last_read_at, v_msg.created_at), v_msg.created_at)
    WHERE group_id = p_group AND user_id = v_me;
  RETURN jsonb_build_object('ok', true, 'message', public.chat_group_message_json(v_msg, v_me),
    'notify', public.chat_group_member_names(p_group, v_me));
END $$;

-- ------------------------------------------------------------------ action

CREATE FUNCTION public.chat_group_action(p_actor TEXT, p_group UUID, p_action TEXT, p_args JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_me UUID := public.chat_group_user_id(p_actor); v_me_name TEXT; v_m public.chat_group_members; v_g public.chat_groups;
  v_args JSONB := COALESCE(p_args, '{}'::jsonb); v_text TEXT; v_target UUID; v_tm public.chat_group_members;
  v_names TEXT[] := ARRAY[]::TEXT[]; v_pending TEXT[] := ARRAY[]::TEXT[]; v_rejected JSONB := '[]'::jsonb; v_item TEXT;
  v_count INTEGER; v_minutes INTEGER; v_msg public.chat_group_messages; v_result JSONB; v_req public.chat_group_join_requests;
  v_admin BOOLEAN; v_owner BOOLEAN; v_notify_all BOOLEAN := true; v_extra JSONB := '{}'::jsonb;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  v_me_name := public.chat_group_name_of(v_me);
  -- Serialise every structural change on one group (member cap, owner, roles).
  SELECT * INTO v_g FROM public.chat_groups WHERE id = p_group FOR UPDATE;
  IF v_g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  SELECT * INTO v_m FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_me;
  IF v_m.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  v_owner := v_m.role = 'owner'; v_admin := v_m.role IN ('owner', 'admin');

  -- Personal settings never notify other members and still work in a dissolved group.
  IF p_action IN ('set_nickname', 'set_muted', 'set_pinned', 'set_background', 'clear_history', 'mark_read', 'hide_message') THEN
    IF p_action = 'set_nickname' THEN
      v_text := NULLIF(btrim(COALESCE(v_args->>'nickname', '')), '');
      IF v_text IS NOT NULL AND length(v_text) > 20 THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_nickname'); END IF;
      UPDATE public.chat_group_members SET nickname = v_text WHERE group_id = p_group AND user_id = v_me;
      RETURN jsonb_build_object('ok', true, 'nickname', v_text, 'notify', public.chat_group_member_names(p_group, v_me));
    ELSIF p_action = 'set_muted' THEN
      UPDATE public.chat_group_members SET muted = COALESCE((v_args->>'muted')::boolean, false) WHERE group_id = p_group AND user_id = v_me;
    ELSIF p_action = 'set_pinned' THEN
      UPDATE public.chat_group_members SET pinned_at = CASE WHEN COALESCE((v_args->>'pinned')::boolean, false) THEN now() END
        WHERE group_id = p_group AND user_id = v_me;
    ELSIF p_action = 'set_background' THEN
      v_text := NULLIF(btrim(COALESCE(v_args->>'background', '')), '');
      IF v_text IS NOT NULL AND v_text !~ '^[a-z0-9-]{1,24}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_background'); END IF;
      UPDATE public.chat_group_members SET background = v_text WHERE group_id = p_group AND user_id = v_me;
    ELSIF p_action = 'clear_history' THEN
      UPDATE public.chat_group_members SET cleared_at = clock_timestamp(), last_read_at = clock_timestamp() WHERE group_id = p_group AND user_id = v_me;
    ELSIF p_action = 'mark_read' THEN
      UPDATE public.chat_group_members SET last_read_at = GREATEST(COALESCE(last_read_at, '-infinity'), clock_timestamp())
        WHERE group_id = p_group AND user_id = v_me;
    ELSIF p_action = 'hide_message' THEN
      IF NOT EXISTS (SELECT 1 FROM public.chat_group_messages WHERE id = (v_args->>'message_id')::uuid AND group_id = p_group) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'message_not_found');
      END IF;
      INSERT INTO public.chat_group_hidden (user_id, message_id) VALUES (v_me, (v_args->>'message_id')::uuid) ON CONFLICT DO NOTHING;
    END IF;
    RETURN jsonb_build_object('ok', true, 'notify', '[]'::jsonb);
  END IF;

  IF p_action = 'leave' THEN
    v_names := ARRAY(SELECT jsonb_array_elements_text(public.chat_group_member_names(p_group, v_me)));
    IF v_g.dissolved_at IS NULL THEN
      v_result := public.chat_group_drop_member(p_group, v_me);
      IF NOT COALESCE((v_result->>'dissolved')::boolean, false) THEN
        PERFORM public.chat_group_system(p_group, v_me, 'leave', v_me_name || ' 退出了群聊');
      END IF;
    ELSE
      DELETE FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_me;
      PERFORM public.chat_group_recount(p_group);
    END IF;
    RETURN jsonb_build_object('ok', true, 'left', true, 'notify', to_jsonb(v_names));
  END IF;

  IF v_g.dissolved_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'dissolved'); END IF;

  IF p_action = 'withdraw' THEN
    SELECT * INTO v_msg FROM public.chat_group_messages WHERE id = (v_args->>'message_id')::uuid AND group_id = p_group FOR UPDATE;
    IF v_msg.id IS NULL OR v_msg.kind = 'system' THEN RETURN jsonb_build_object('ok', false, 'code', 'message_not_found'); END IF;
    IF v_msg.withdrawn_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'message', public.chat_group_message_json(v_msg, v_me), 'notify', '[]'::jsonb);
    END IF;
    IF v_msg.sender_id = v_me THEN
      IF v_msg.created_at < now() - interval '2 minutes' AND NOT v_admin THEN
        RETURN jsonb_build_object('ok', false, 'code', 'withdraw_expired');
      END IF;
    ELSE
      SELECT * INTO v_tm FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_msg.sender_id;
      IF NOT v_admin OR (NOT v_owner AND COALESCE(v_tm.role, 'member') <> 'member') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
      END IF;
    END IF;
    v_text := v_msg.meta->>'storage_path';
    UPDATE public.chat_group_messages SET withdrawn_at = clock_timestamp(), withdrawn_by = v_me WHERE id = v_msg.id RETURNING * INTO v_msg;
    RETURN jsonb_build_object('ok', true, 'message', public.chat_group_message_json(v_msg, v_me), 'storage_path', v_text,
      'notify', public.chat_group_member_names(p_group, v_me));
  END IF;

  IF p_action = 'invite' THEN
    IF v_g.invite_policy = 'admins' AND NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    IF jsonb_typeof(v_args->'members') <> 'array' OR jsonb_array_length(v_args->'members') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'members_required');
    END IF;
    IF jsonb_array_length(v_args->'members') > 999 THEN RETURN jsonb_build_object('ok', false, 'code', 'group_full'); END IF;
    FOR v_item IN SELECT DISTINCT btrim(jsonb_array_elements_text(v_args->'members')) LOOP
      v_target := public.chat_group_user_id(v_item);
      IF v_target IS NULL OR NOT public.chat_group_can_invite(v_me, v_target) THEN v_rejected := v_rejected || to_jsonb(v_item); CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_target) THEN CONTINUE; END IF;
      IF v_g.join_approval AND NOT v_admin THEN
        INSERT INTO public.chat_group_join_requests (group_id, user_id, inviter_id) VALUES (p_group, v_target, v_me) ON CONFLICT DO NOTHING;
        v_pending := v_pending || v_item;
        CONTINUE;
      END IF;
      SELECT count(*) INTO v_count FROM public.chat_group_members WHERE group_id = p_group;
      IF v_count >= v_g.member_limit THEN
        IF cardinality(v_names) = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'group_full'); END IF;
        v_rejected := v_rejected || to_jsonb(v_item); CONTINUE;
      END IF;
      INSERT INTO public.chat_group_members (group_id, user_id, role, invited_by) VALUES (p_group, v_target, 'member', v_me);
      UPDATE public.chat_group_join_requests SET status = 'approved', decided_at = now(), decided_by = v_me
        WHERE group_id = p_group AND user_id = v_target AND status = 'pending';
      v_names := v_names || v_item;
    END LOOP;
    PERFORM public.chat_group_recount(p_group);
    IF cardinality(v_names) > 0 THEN
      PERFORM public.chat_group_system(p_group, v_me, 'invite', v_me_name || ' 邀请 ' || left(array_to_string(v_names, '、'), 300) ||
        CASE WHEN cardinality(v_names) > 20 THEN ' 等 ' || cardinality(v_names) || ' 人' ELSE '' END || ' 加入了群聊',
        jsonb_build_object('targets', to_jsonb(v_names[1:20])));
    END IF;
    IF cardinality(v_names) = 0 AND cardinality(v_pending) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', CASE WHEN jsonb_array_length(v_rejected) > 0 THEN 'friend_required' ELSE 'already_member' END, 'rejected', v_rejected);
    END IF;
    RETURN jsonb_build_object('ok', true, 'added', to_jsonb(v_names), 'pending', to_jsonb(v_pending), 'rejected', v_rejected,
      'notify', public.chat_group_member_names(p_group, v_me));
  END IF;

  IF p_action IN ('approve_request', 'reject_request') THEN
    IF NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    SELECT * INTO v_req FROM public.chat_group_join_requests WHERE id = (v_args->>'request_id')::uuid AND group_id = p_group FOR UPDATE;
    IF v_req.id IS NULL OR v_req.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'code', 'request_not_found'); END IF;
    IF p_action = 'reject_request' THEN
      UPDATE public.chat_group_join_requests SET status = 'rejected', decided_at = now(), decided_by = v_me WHERE id = v_req.id;
      RETURN jsonb_build_object('ok', true, 'notify', jsonb_build_array(public.chat_group_name_of(v_req.user_id)));
    END IF;
    IF public.chat_group_user_id(public.chat_group_name_of(v_req.user_id)) IS NULL THEN
      UPDATE public.chat_group_join_requests SET status = 'canceled', decided_at = now(), decided_by = v_me WHERE id = v_req.id;
      RETURN jsonb_build_object('ok', false, 'code', 'user_not_found');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_req.user_id) THEN
      SELECT count(*) INTO v_count FROM public.chat_group_members WHERE group_id = p_group;
      IF v_count >= v_g.member_limit THEN RETURN jsonb_build_object('ok', false, 'code', 'group_full'); END IF;
      INSERT INTO public.chat_group_members (group_id, user_id, role, invited_by) VALUES (p_group, v_req.user_id, 'member', COALESCE(v_req.inviter_id, v_me));
      PERFORM public.chat_group_recount(p_group);
      PERFORM public.chat_group_system(p_group, v_me, 'join',
        CASE WHEN v_req.inviter_id IS NOT NULL THEN public.chat_group_name_of(v_req.inviter_id) || ' 邀请 ' ELSE '' END ||
        public.chat_group_name_of(v_req.user_id) || CASE WHEN v_req.inviter_id IS NOT NULL THEN ' 加入了群聊' ELSE ' 通过二维码加入了群聊' END,
        jsonb_build_object('targets', jsonb_build_array(public.chat_group_name_of(v_req.user_id))));
    END IF;
    UPDATE public.chat_group_join_requests SET status = 'approved', decided_at = now(), decided_by = v_me WHERE id = v_req.id;
    RETURN jsonb_build_object('ok', true, 'notify', public.chat_group_member_names(p_group, v_me));
  END IF;

  IF p_action = 'list_requests' THEN
    IF NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'user_name', public.chat_group_name_of(r.user_id),
        'inviter', public.chat_group_name_of(r.inviter_id), 'note', r.note, 'created_at', r.created_at) ORDER BY r.created_at), '[]'::jsonb)
      INTO v_result FROM public.chat_group_join_requests r WHERE r.group_id = p_group AND r.status = 'pending';
    RETURN jsonb_build_object('ok', true, 'requests', v_result, 'notify', '[]'::jsonb);
  END IF;

  -- Everything below changes group-wide state.
  IF p_action = 'rename' THEN
    IF NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    v_text := btrim(COALESCE(v_args->>'name', ''));
    IF length(v_text) NOT BETWEEN 1 AND 30 THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_name'); END IF;
    IF v_text = v_g.name THEN RETURN jsonb_build_object('ok', true, 'notify', '[]'::jsonb); END IF;
    UPDATE public.chat_groups SET name = v_text, updated_at = now() WHERE id = p_group;
    PERFORM public.chat_group_system(p_group, v_me, 'rename', v_me_name || ' 修改群名为「' || v_text || '」', jsonb_build_object('name', v_text));
  ELSIF p_action = 'announce' THEN
    IF NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    v_text := btrim(COALESCE(v_args->>'announcement', ''));
    IF length(v_text) > 2000 THEN RETURN jsonb_build_object('ok', false, 'code', 'announcement_too_long'); END IF;
    UPDATE public.chat_groups SET announcement = v_text, announcement_by = CASE WHEN v_text = '' THEN NULL ELSE v_me END,
      announcement_at = CASE WHEN v_text = '' THEN NULL ELSE now() END, updated_at = now() WHERE id = p_group;
    IF v_text <> '' THEN
      PERFORM public.chat_group_system(p_group, v_me, 'announcement', '群公告：' || left(v_text, 300), jsonb_build_object('mentions', jsonb_build_array('@all')));
    END IF;
  ELSIF p_action IN ('remove_member', 'set_admin', 'unset_admin', 'ban', 'unban', 'transfer') THEN
    v_item := btrim(COALESCE(v_args->>'user_name', ''));
    v_target := public.chat_group_user_id(v_item);
    IF v_target IS NULL THEN
      -- Accounts deactivated after joining can still be removed by name of their tombstone row.
      SELECT m.user_id INTO v_target FROM public.chat_group_members m JOIN public.chat_users u ON u.id = m.user_id
        WHERE m.group_id = p_group AND u.user_name = v_item;
    END IF;
    SELECT * INTO v_tm FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_target;
    IF v_tm.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'member_not_found'); END IF;
    IF v_target = v_me THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_target'); END IF;
    -- The owner may act on anyone; an admin only on ordinary members.
    IF NOT v_admin OR (NOT v_owner AND v_tm.role <> 'member') THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    IF p_action IN ('set_admin', 'unset_admin', 'transfer') AND NOT v_owner THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    v_item := public.chat_group_display(p_group, v_target);
    IF p_action = 'remove_member' THEN
      v_extra := jsonb_build_object('removed', public.chat_group_name_of(v_target));
      PERFORM public.chat_group_drop_member(p_group, v_target);
      PERFORM public.chat_group_system(p_group, v_me, 'remove', v_me_name || ' 将 ' || v_item || ' 移出了群聊',
        jsonb_build_object('targets', jsonb_build_array(public.chat_group_name_of(v_target))));
    ELSIF p_action = 'set_admin' THEN
      IF (SELECT count(*) FROM public.chat_group_members WHERE group_id = p_group AND role = 'admin') >= 15 AND v_tm.role <> 'admin' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'admin_limit');
      END IF;
      UPDATE public.chat_group_members SET role = 'admin' WHERE group_id = p_group AND user_id = v_target;
      PERFORM public.chat_group_system(p_group, v_me, 'admin', v_item || ' 被设为管理员', jsonb_build_object('targets', jsonb_build_array(public.chat_group_name_of(v_target))));
    ELSIF p_action = 'unset_admin' THEN
      UPDATE public.chat_group_members SET role = 'member' WHERE group_id = p_group AND user_id = v_target;
      PERFORM public.chat_group_system(p_group, v_me, 'admin', v_item || ' 不再是管理员', jsonb_build_object('targets', jsonb_build_array(public.chat_group_name_of(v_target))));
    ELSIF p_action = 'ban' THEN
      v_minutes := GREATEST(1, LEAST(COALESCE((v_args->>'minutes')::integer, 10), 43200));
      UPDATE public.chat_group_members SET banned_until = now() + make_interval(mins => v_minutes) WHERE group_id = p_group AND user_id = v_target;
      PERFORM public.chat_group_system(p_group, v_me, 'ban', v_item || ' 被禁言' ||
        CASE WHEN v_minutes >= 1440 THEN (v_minutes / 1440) || ' 天' WHEN v_minutes >= 60 THEN (v_minutes / 60) || ' 小时' ELSE v_minutes || ' 分钟' END,
        jsonb_build_object('targets', jsonb_build_array(public.chat_group_name_of(v_target))));
    ELSIF p_action = 'unban' THEN
      UPDATE public.chat_group_members SET banned_until = NULL WHERE group_id = p_group AND user_id = v_target;
      PERFORM public.chat_group_system(p_group, v_me, 'ban', v_item || ' 已被解除禁言', jsonb_build_object('targets', jsonb_build_array(public.chat_group_name_of(v_target))));
    ELSIF p_action = 'transfer' THEN
      IF public.chat_group_user_id(public.chat_group_name_of(v_target)) IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'user_not_found'); END IF;
      UPDATE public.chat_group_members SET role = 'admin' WHERE group_id = p_group AND user_id = v_me;
      UPDATE public.chat_group_members SET role = 'owner', banned_until = NULL WHERE group_id = p_group AND user_id = v_target;
      UPDATE public.chat_groups SET owner_id = v_target, updated_at = now() WHERE id = p_group;
      PERFORM public.chat_group_system(p_group, v_me, 'owner_transfer', v_me_name || ' 已将群主转让给 ' || v_item,
        jsonb_build_object('targets', jsonb_build_array(public.chat_group_name_of(v_target))));
    END IF;
  ELSIF p_action = 'set_mute_all' THEN
    IF NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    UPDATE public.chat_groups SET mute_all = COALESCE((v_args->>'enabled')::boolean, false), updated_at = now() WHERE id = p_group;
    PERFORM public.chat_group_system(p_group, v_me, 'mute_all', CASE WHEN COALESCE((v_args->>'enabled')::boolean, false)
      THEN v_me_name || ' 开启了全员禁言' ELSE v_me_name || ' 关闭了全员禁言' END);
  ELSIF p_action = 'set_join_approval' THEN
    IF NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    UPDATE public.chat_groups SET join_approval = COALESCE((v_args->>'enabled')::boolean, false), updated_at = now() WHERE id = p_group;
    PERFORM public.chat_group_system(p_group, v_me, 'join_approval', CASE WHEN COALESCE((v_args->>'enabled')::boolean, false)
      THEN v_me_name || ' 开启了进群审批' ELSE v_me_name || ' 关闭了进群审批' END);
  ELSIF p_action = 'set_invite_policy' THEN
    IF NOT v_owner THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    v_text := CASE WHEN v_args->>'policy' = 'admins' THEN 'admins' ELSE 'all' END;
    UPDATE public.chat_groups SET invite_policy = v_text, updated_at = now() WHERE id = p_group;
    PERFORM public.chat_group_system(p_group, v_me, 'invite_policy', CASE WHEN v_text = 'admins'
      THEN '现在只有群主和管理员可以邀请成员' ELSE '现在所有成员都可以邀请好友入群' END);
  ELSIF p_action = 'reset_qr' THEN
    IF NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    UPDATE public.chat_groups SET qr_token = replace(gen_random_uuid()::text, '-', ''), updated_at = now() WHERE id = p_group;
    v_notify_all := false;
  ELSIF p_action = 'dissolve' THEN
    IF NOT v_owner THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
    PERFORM public.chat_group_system(p_group, v_me, 'dissolve', '群主已解散该群聊');
    UPDATE public.chat_groups SET dissolved_at = now(), mute_all = true, updated_at = now() WHERE id = p_group;
    UPDATE public.chat_group_join_requests SET status = 'canceled', decided_at = now() WHERE group_id = p_group AND status = 'pending';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_action');
  END IF;
  RETURN jsonb_build_object('ok', true, 'notify', CASE WHEN v_notify_all THEN public.chat_group_member_names(p_group, v_me) ELSE '[]'::jsonb END
    || CASE WHEN v_extra ? 'removed' THEN jsonb_build_array(v_extra->>'removed') ELSE '[]'::jsonb END);
END $$;

-- -------------------------------------------------------------- QR joining

CREATE FUNCTION public.chat_group_token_preview(p_actor TEXT, p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me UUID := public.chat_group_user_id(p_actor); v_g public.chat_groups;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{32}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_token'); END IF;
  SELECT * INTO v_g FROM public.chat_groups WHERE qr_token = p_token AND dissolved_at IS NULL;
  IF v_g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_token'); END IF;
  RETURN jsonb_build_object('ok', true, 'group', jsonb_build_object('id', v_g.id, 'name', v_g.name, 'member_count', v_g.member_count,
    'member_limit', v_g.member_limit, 'owner', public.chat_group_name_of(v_g.owner_id), 'join_approval', v_g.join_approval,
    'is_member', EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = v_g.id AND user_id = v_me),
    'pending', EXISTS (SELECT 1 FROM public.chat_group_join_requests WHERE group_id = v_g.id AND user_id = v_me AND status = 'pending')));
END $$;

CREATE FUNCTION public.chat_group_token_join(p_actor TEXT, p_token TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me UUID := public.chat_group_user_id(p_actor); v_g public.chat_groups; v_count INTEGER; v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'account_unavailable'); END IF;
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{32}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_token'); END IF;
  SELECT * INTO v_g FROM public.chat_groups WHERE qr_token = p_token AND dissolved_at IS NULL FOR UPDATE;
  IF v_g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_token'); END IF;
  IF EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = v_g.id AND user_id = v_me) THEN
    RETURN jsonb_build_object('ok', true, 'joined', true, 'group_id', v_g.id, 'notify', '[]'::jsonb);
  END IF;
  IF length(COALESCE(v_note, '')) > 120 THEN RETURN jsonb_build_object('ok', false, 'code', 'note_too_long'); END IF;
  SELECT count(*) INTO v_count FROM public.chat_group_members WHERE group_id = v_g.id;
  IF v_count >= v_g.member_limit THEN RETURN jsonb_build_object('ok', false, 'code', 'group_full'); END IF;
  IF v_g.join_approval THEN
    INSERT INTO public.chat_group_join_requests (group_id, user_id, note) VALUES (v_g.id, v_me, v_note) ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('ok', true, 'joined', false, 'pending', true, 'group_id', v_g.id,
      'notify', (SELECT COALESCE(jsonb_agg(u.user_name), '[]'::jsonb) FROM public.chat_group_members m JOIN public.chat_users u ON u.id = m.user_id
                 WHERE m.group_id = v_g.id AND m.role IN ('owner', 'admin')));
  END IF;
  INSERT INTO public.chat_group_members (group_id, user_id, role) VALUES (v_g.id, v_me, 'member');
  PERFORM public.chat_group_recount(v_g.id);
  PERFORM public.chat_group_system(v_g.id, v_me, 'join', public.chat_group_name_of(v_me) || ' 通过二维码加入了群聊',
    jsonb_build_object('targets', jsonb_build_array(public.chat_group_name_of(v_me))));
  RETURN jsonb_build_object('ok', true, 'joined', true, 'group_id', v_g.id, 'notify', public.chat_group_member_names(v_g.id, v_me));
END $$;

-- Media lookups (signing happens in the API after this membership check).
CREATE FUNCTION public.chat_group_media_path(p_actor TEXT, p_group UUID, p_message UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT x.meta->>'storage_path' FROM public.chat_group_messages x
  JOIN public.chat_group_members m ON m.group_id = x.group_id AND m.user_id = public.chat_group_user_id(p_actor)
  WHERE x.id = p_message AND x.group_id = p_group AND x.kind = 'image' AND x.withdrawn_at IS NULL
    AND x.created_at >= m.joined_at AND (m.cleared_at IS NULL OR x.created_at > m.cleared_at)
$$;

-- Permission probe used before an upload, so a non-member cannot store objects.
CREATE FUNCTION public.chat_group_can_send(p_actor TEXT, p_group UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me UUID := public.chat_group_user_id(p_actor); v_m public.chat_group_members; v_g public.chat_groups;
BEGIN
  SELECT * INTO v_m FROM public.chat_group_members WHERE group_id = p_group AND user_id = v_me;
  IF v_me IS NULL OR v_m.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_member'); END IF;
  SELECT * INTO v_g FROM public.chat_groups WHERE id = p_group;
  IF v_g.dissolved_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'dissolved'); END IF;
  IF v_m.role = 'member' AND v_g.mute_all THEN RETURN jsonb_build_object('ok', false, 'code', 'muted_all'); END IF;
  IF v_m.banned_until > now() THEN RETURN jsonb_build_object('ok', false, 'code', 'banned', 'banned_until', v_m.banned_until); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- A deactivated account leaves every group (its messages stay, like DMs).
CREATE FUNCTION public.chat_group_on_user_retired()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_group UUID;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    FOR v_group IN SELECT group_id FROM public.chat_group_members WHERE user_id = NEW.id LOOP
      PERFORM 1 FROM public.chat_groups WHERE id = v_group FOR UPDATE;
      PERFORM public.chat_group_drop_member(v_group, NEW.id);
    END LOOP;
    UPDATE public.chat_group_join_requests SET status = 'canceled', decided_at = now() WHERE user_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chat_group_user_retired AFTER UPDATE OF deleted_at ON public.chat_users
  FOR EACH ROW EXECUTE FUNCTION public.chat_group_on_user_retired();

DO $fn$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'chat_group_user_id(text)', 'chat_group_name_of(uuid)', 'chat_group_display(uuid,uuid)',
    'chat_group_system(uuid,uuid,text,text,jsonb)', 'chat_group_recount(uuid)', 'chat_group_member_names(uuid,uuid)',
    'chat_group_can_invite(uuid,uuid)', 'chat_group_drop_member(uuid,uuid)', 'chat_group_message_json(public.chat_group_messages,uuid)',
    'chat_group_create(text,text,text[])', 'chat_group_list(text)', 'chat_group_detail(text,uuid)',
    'chat_group_messages_page(text,uuid,integer,timestamptz,uuid,timestamptz,uuid)', 'chat_group_search(text,uuid,text,integer,timestamptz)',
    'chat_group_send(text,uuid,text,text,jsonb,uuid,text)', 'chat_group_action(text,uuid,text,jsonb)',
    'chat_group_token_preview(text,text)', 'chat_group_token_join(text,text,text)', 'chat_group_media_path(text,uuid,uuid)',
    'chat_group_can_send(text,uuid)', 'chat_group_on_user_retired()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $fn$;

COMMIT;
