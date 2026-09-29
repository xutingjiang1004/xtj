-- Explicit deny policies provide a second barrier if table grants are ever
-- widened by mistake. service_role bypasses RLS and remains the only API role.
BEGIN;

CREATE POLICY chat_users_block_browser
  ON public.chat_users FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY chat_friend_requests_block_browser
  ON public.chat_friend_requests FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY chat_friendships_block_browser
  ON public.chat_friendships FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY chat_user_blocks_block_browser
  ON public.chat_user_blocks FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY chat_conversations_block_browser
  ON public.chat_conversations FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY chat_conversation_members_block_browser
  ON public.chat_conversation_members FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY chat_messages_block_browser
  ON public.chat_messages FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY chat_message_user_state_block_browser
  ON public.chat_message_user_state FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY chat_attachments_block_browser
  ON public.chat_attachments FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMIT;
