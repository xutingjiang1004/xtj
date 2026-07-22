-- Speed up the two queries behind /api/agent/chat/history without exposing AI data.
-- The route remains service-side and still applies authenticateUser before querying.
CREATE INDEX IF NOT EXISTS posts_ai_agent_history_user_created_idx
  ON public.posts (user_name, created_at DESC, id DESC)
  WHERE media_type = '__ai_agent_msg__';

CREATE INDEX IF NOT EXISTS posts_ai_agent_history_user_actor_prefix_idx
  ON public.posts (user_name, actor_key text_pattern_ops, created_at DESC, id DESC)
  WHERE media_type = '__ai_agent_msg__';
