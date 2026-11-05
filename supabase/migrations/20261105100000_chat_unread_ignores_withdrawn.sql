-- A withdrawn message disappears from every read path (read_visible_dm_posts), so the recipient can never
-- mark it read; counting it left a phantom unread badge. Only the unread subquery changes (adds withdrawn_at IS NULL).
-- Backward compatible: same signature and result shape; CREATE OR REPLACE keeps the existing grants.
BEGIN;
CREATE OR REPLACE FUNCTION public.chat_list_conversations(p_actor_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'conversation_id',c.id,'peer_name',peer.user_name,
    'deleted',own.left_at IS NOT NULL,'pinned_at',own.pinned_at,
    'muted_until',own.muted_until,'archived_at',own.archived_at,'cleared_before',own.cleared_before,
    'draft_text',own.draft_text,'draft_revision',own.draft_revision,
    'manual_unread_at',own.manual_unread_at,
    'last_message',CASE WHEN recent.withdrawn_at IS NOT NULL THEN '[消息已撤回]' ELSE coalesce(recent.body,'') END,
    'last_message_type',recent.message_type,
    'last_message_at',recent.sent_at,
    'unread_count',CASE WHEN own.left_at IS NOT NULL THEN 0 ELSE greatest(
      coalesce(unread.total,0),CASE WHEN own.manual_unread_at IS NOT NULL THEN 1 ELSE 0 END
    ) END
  ) ORDER BY own.pinned_at DESC NULLS LAST,recent.sent_at DESC NULLS LAST,c.created_at DESC), '[]'::jsonb)
  FROM public.chat_users actor
  JOIN public.chat_conversation_members own ON own.user_id=actor.id
  JOIN public.chat_conversations c ON c.id=own.conversation_id AND c.conversation_type='direct'
  JOIN public.chat_conversation_members other ON other.conversation_id=c.id AND other.user_id<>actor.id
  JOIN public.chat_users peer ON peer.id=other.user_id
  LEFT JOIN LATERAL (
    SELECT m.body,m.message_type,m.sent_at,m.withdrawn_at
    FROM public.chat_messages m
    LEFT JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=actor.id
    WHERE m.conversation_id=c.id AND (own.cleared_before IS NULL OR m.sent_at>own.cleared_before)
      AND s.hidden_at IS NULL AND own.left_at IS NULL
    ORDER BY m.sent_at DESC,m.id DESC LIMIT 1
  ) recent ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS total FROM public.chat_messages m
    LEFT JOIN public.chat_message_user_state s ON s.message_id=m.id AND s.user_id=actor.id
    WHERE m.conversation_id=c.id AND m.sender_id IS DISTINCT FROM actor.id AND m.withdrawn_at IS NULL
      AND (own.cleared_before IS NULL OR m.sent_at>own.cleared_before)
      AND s.read_at IS NULL AND s.hidden_at IS NULL AND own.left_at IS NULL
  ) unread ON true
  WHERE actor.user_name=p_actor_name;
$function$;
COMMIT;
