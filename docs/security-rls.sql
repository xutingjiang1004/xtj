-- xtj Supabase Row Level Security baseline (2026 hardened version)
-- Backend routes use service_role; anon must not write posts directly.

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON posts FROM anon;
GRANT SELECT ON posts TO anon;

DROP POLICY IF EXISTS "anon_select_posts" ON posts;
DROP POLICY IF EXISTS "anon_insert_posts" ON posts;
DROP POLICY IF EXISTS "anon_update_posts" ON posts;
DROP POLICY IF EXISTS "anon_delete_posts" ON posts;
DROP POLICY IF EXISTS anon_posts_public_read ON posts;
CREATE POLICY anon_posts_public_read ON posts FOR SELECT TO anon
USING (
  (media_type IS NULL OR media_type IN ('image','video','text','photo','album'))
  AND COALESCE(visibility, 'public') = 'public'
  AND COALESCE(is_deleted, false) IS NOT TRUE
);

-- Do not add marker blacklists here. System markers such as __auth__, __admin_auth__,
-- __vip__, __vip_order__, __vip_plan__, __pro_gift__, __pro_gift_claim__,
-- __ai_english_learning__, AI config/memory/audit rows, DM, report, security,
-- attack, login and client-error records are excluded because they are not in the
-- explicit public media_type allowlist above.

ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_likes_insert ON likes;
CREATE POLICY anon_likes_insert ON likes FOR INSERT TO anon
WITH CHECK (user_name IS NOT NULL AND btrim(user_name) <> '' AND post_id IS NOT NULL);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_comments_insert ON comments;
CREATE POLICY anon_comments_insert ON comments FOR INSERT TO anon
WITH CHECK (user_name IS NOT NULL AND btrim(user_name) <> '' AND post_id IS NOT NULL AND content IS NOT NULL AND btrim(content) <> '');

ALTER TABLE bans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_bans" ON bans;
DROP POLICY IF EXISTS bans_service_all ON bans;
DROP POLICY IF EXISTS bans_open_all ON bans;
-- No USING(true)/WITH CHECK(true) policy is created for bans; service_role bypasses RLS.
