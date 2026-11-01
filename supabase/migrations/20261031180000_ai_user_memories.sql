-- Long-term memory for the cat AI: short facts and preferences a user asked it to remember.
-- Additive and backward compatible: a new table only. Rows belong to one account, are removed with the account
-- (ON DELETE CASCADE, same account model as ai_conversation_preferences) and are reachable only through the server.
CREATE TABLE IF NOT EXISTS public.ai_user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  auth_record_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 300),
  kind text NOT NULL DEFAULT 'fact' CHECK (kind IN ('preference', 'fact', 'instruction')),
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, content_hash),
  CHECK ((auth_record_id IS NOT NULL AND auth_record_id::text = account_id) OR
    (auth_record_id IS NULL AND account_id LIKE 'admin:%'))
);

CREATE INDEX IF NOT EXISTS ai_user_memories_account_updated_idx ON public.ai_user_memories (account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_user_memories_auth_idx ON public.ai_user_memories (auth_record_id) WHERE auth_record_id IS NOT NULL;

ALTER TABLE public.ai_user_memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_user_memories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_user_memories TO service_role;
