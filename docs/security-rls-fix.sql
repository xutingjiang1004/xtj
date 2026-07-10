-- xtj RLS fix script: replace blacklist-based anon access with an allowlist.
-- Run after inspecting live state with:
--   select * from pg_policies where tablename in ('posts','likes','comments','bans');
--   select * from information_schema.role_table_grants where grantee='anon';
--   select * from information_schema.routine_privileges where grantee='anon';

\i docs/security-rls.sql

-- Negative checks with anon key should fail or return zero rows for system markers:
-- __auth__, __admin_auth__, __vip__, __vip_order__, __vip_plan__, __pro_gift__,
-- __pro_gift_claim__, __ai_english_learning__, AI messages/config/memory/audit,
-- DM, report, security, attack, login and client-error records.
