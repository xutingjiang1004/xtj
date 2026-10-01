CREATE TABLE public.user_behavior_consents (
 user_name text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_behavior_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_behavior_consents FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_behavior_consents TO service_role;

-- Service route always supplies the authenticated actor, never a query username.
CREATE OR REPLACE FUNCTION public.export_personal_chat(p_actor text,p_kind text,p_after text,p_snapshot timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
WITH actor AS (SELECT id FROM public.chat_users WHERE user_name=p_actor AND deleted_at IS NULL),
records AS (
 SELECT m.id::text AS id,jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,'sender',m.sender_name_snapshot,
  'message_type',m.message_type,'created_at',m.sent_at,'reply_to',m.reply_to_message_id,'withdrawn_at',m.withdrawn_at,
  'content',CASE WHEN m.withdrawn_at IS NULL THEN m.body ELSE '[消息已撤回]' END,
  'payload',CASE WHEN m.withdrawn_at IS NULL THEN m.payload ELSE '{}'::jsonb END) AS body
 FROM public.chat_messages m JOIN public.chat_conversation_members own ON own.conversation_id=m.conversation_id
 JOIN actor a ON own.user_id=a.id LEFT JOIN public.chat_message_user_state state ON state.message_id=m.id AND state.user_id=a.id
 WHERE p_kind='messages' AND own.left_at IS NULL AND state.hidden_at IS NULL
  AND (own.cleared_before IS NULL OR m.sent_at>own.cleared_before) AND m.sent_at<=p_snapshot
 UNION ALL
 SELECT 'member:'||own.conversation_id::text,to_jsonb(own) || jsonb_build_object('id','member:'||own.conversation_id::text)
 FROM public.chat_conversation_members own JOIN actor a ON own.user_id=a.id WHERE p_kind='chat_preferences' AND own.joined_at<=p_snapshot
 UNION ALL
 SELECT 'friend:'||f.user_low_id::text||':'||f.user_high_id::text,to_jsonb(f)||jsonb_build_object('id','friend:'||f.user_low_id::text||':'||f.user_high_id::text,'kind','friendship')
 FROM public.chat_friendships f JOIN actor a ON a.id IN (f.user_low_id,f.user_high_id) WHERE p_kind='chat_contacts' AND f.created_at<=p_snapshot
 UNION ALL
 SELECT 'request:'||r.id::text,to_jsonb(r)||jsonb_build_object('id','request:'||r.id::text,'kind','friend_request')
 FROM public.chat_friend_requests r JOIN actor a ON a.id IN (r.requester_id,r.target_id) WHERE p_kind='chat_contacts' AND r.created_at<=p_snapshot
 UNION ALL
 SELECT 'note:'||n.peer_id::text,to_jsonb(n)||jsonb_build_object('id','note:'||n.peer_id::text,'kind','friend_note')
 FROM public.chat_friend_notes n JOIN actor a ON n.owner_id=a.id WHERE p_kind='chat_contacts' AND n.created_at<=p_snapshot
 UNION ALL
 SELECT 'block:'||b.blocked_id::text,to_jsonb(b)||jsonb_build_object('id','block:'||b.blocked_id::text,'kind','block')
 FROM public.chat_user_blocks b JOIN actor a ON b.blocker_id=a.id WHERE p_kind='chat_contacts' AND b.created_at<=p_snapshot
), page AS (SELECT id,body FROM records WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT 201)
SELECT coalesce(jsonb_agg(body ORDER BY id),'[]'::jsonb) FROM page;
$$;
REVOKE ALL ON FUNCTION public.export_personal_chat(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.export_personal_chat(text,text,text,timestamptz) TO service_role;
