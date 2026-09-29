create policy chat_push_browser_deny on public.chat_push_subscriptions
  for all to anon, authenticated using (false) with check (false);
