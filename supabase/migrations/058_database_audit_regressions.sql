-- ============================================================================
-- 058: Forward fixes for database-audit regressions.
-- Safe to re-run. This does not guess how legacy numeric interaction IDs map to
-- UUID posts, and it does not enact an account-retention policy.
-- ============================================================================

BEGIN;

-- The 001 fresh-install snapshot now declares UUID post references. For an
-- already-created schema, only convert an empty legacy BIGINT column. Numeric
-- IDs with data cannot be mapped to UUID posts without an authoritative map;
-- fail closed and require a reviewed, deployment-specific reconciliation.
DO $$
DECLARE
  v_table_name text;
  v_table regclass;
  v_type oid;
  v_has_values boolean;
BEGIN
  IF to_regclass('public.posts') IS NULL THEN
    RAISE NOTICE '[058] public.posts is absent; interaction type check skipped';
    RETURN;
  END IF;

  FOREACH v_table_name IN ARRAY ARRAY['likes', 'comments'] LOOP
    v_table := to_regclass(format('public.%I', v_table_name));
    IF v_table IS NULL THEN
      RAISE NOTICE '[058] public.% is absent; type check skipped', v_table_name;
      CONTINUE;
    END IF;

    SELECT a.atttypid INTO v_type
    FROM pg_attribute a
    WHERE a.attrelid = v_table AND a.attname = 'post_id' AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_type IS NULL THEN
      RAISE WARNING '[058] public.% has no post_id column; manual review required', v_table_name;
      CONTINUE;
    ELSIF v_type = 'uuid'::regtype THEN
      CONTINUE;
    ELSIF v_type <> 'bigint'::regtype THEN
      RAISE WARNING '[058] public.%.post_id has unsupported type %; manual review required',
        v_table_name, format_type(v_type, NULL);
      CONTINUE;
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE post_id IS NOT NULL)', v_table)
      INTO v_has_values;
    IF v_has_values THEN
      RAISE WARNING '[058] public.%.post_id is BIGINT and contains values; refusing lossy/guessed UUID mapping; manual reconciliation required',
        v_table_name;
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE %s ALTER COLUMN post_id TYPE uuid USING post_id::text::uuid', v_table);
      RAISE NOTICE '[058] converted empty public.%.post_id from BIGINT to UUID', v_table_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[058] could not safely convert public.%.post_id: %; manual review required',
        v_table_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- Reconcile deployments where 017/032 could not install the partial unique
-- index before 052 cleaned historical duplicate AI replies. Preserve the earliest
-- reply deterministically, matching 052, then establish the invariant.
DO $$
BEGIN
  IF to_regclass('public.comments') IS NULL THEN
    RAISE NOTICE '[058] public.comments is absent; AI reply index repair skipped';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.comments'::regclass AND attname = 'parent_comment_id'
      AND attnum > 0 AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.comments'::regclass AND attname = 'generated_by_ai'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE WARNING '[058] AI reply columns are absent; index repair skipped for manual review';
  ELSE
    DELETE FROM public.comments WHERE generated_by_ai IS TRUE AND parent_comment_id IS NULL;
    DELETE FROM public.comments AS c
    USING (
      SELECT id,
             row_number() OVER (
               PARTITION BY parent_comment_id
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM public.comments
      WHERE generated_by_ai IS TRUE AND parent_comment_id IS NOT NULL
    ) AS d
    WHERE c.id = d.id AND d.rn > 1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply
      ON public.comments (parent_comment_id)
      WHERE generated_by_ai = true;
  END IF;
END $$;

-- Recursively remove the retired consent-data keys in objects nested anywhere
-- in JSON objects/arrays. The helper is private to this migration and removed
-- after cleanup; privileges are restricted while it exists.
CREATE OR REPLACE FUNCTION public._audit_strip_retired_consent_keys(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF jsonb_typeof(p_value) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(e.key, public._audit_strip_retired_consent_keys(e.value)), '{}'::jsonb)
      INTO v_result
    FROM jsonb_each(p_value) AS e
    WHERE e.key NOT IN (
      'consented_contacts', 'consented_contacts_history',
      'consented_clipboard', 'consented_clipboard_history'
    );
    RETURN v_result;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(public._audit_strip_retired_consent_keys(a.value) ORDER BY a.ordinality), '[]'::jsonb)
      INTO v_result
    FROM jsonb_array_elements(p_value) WITH ORDINALITY AS a(value, ordinality);
    RETURN v_result;
  END IF;
  RETURN p_value;
END;
$$;

REVOKE ALL ON FUNCTION public._audit_strip_retired_consent_keys(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._audit_strip_retired_consent_keys(jsonb) TO service_role;

-- 057 skipped malformed JSON and non-object roots, and only removed top-level
-- keys. For candidate __user_info__ rows, scrub valid object/array JSON
-- recursively. Delete the entire metadata row when JSON is malformed, its root
-- is a scalar, or retired key names remain as serialized text after scrubbing;
-- preserving such a row would leave potentially sensitive data behind.
DO $$
DECLARE
  v_row record;
  v_content jsonb;
  v_next jsonb;
  v_scrubbed integer := 0;
  v_deleted integer := 0;
  v_remaining bigint;
BEGIN
  IF to_regclass('public.posts') IS NULL THEN
    RAISE NOTICE '[058] public.posts is absent; consent-data cleanup skipped';
    RETURN;
  END IF;

  FOR v_row IN
    SELECT id, content
    FROM public.posts
    WHERE media_type = '__user_info__'
      AND content IS NOT NULL
      AND (content LIKE '%consented_contacts%' OR content LIKE '%consented_clipboard%')
    FOR UPDATE
  LOOP
    BEGIN
      v_content := v_row.content::jsonb;
    EXCEPTION WHEN others THEN
      DELETE FROM public.posts WHERE id = v_row.id;
      v_deleted := v_deleted + 1;
      CONTINUE;
    END;

    IF jsonb_typeof(v_content) NOT IN ('object', 'array') THEN
      DELETE FROM public.posts WHERE id = v_row.id;
      v_deleted := v_deleted + 1;
      CONTINUE;
    END IF;

    v_next := public._audit_strip_retired_consent_keys(v_content);
    IF v_next IS DISTINCT FROM v_content THEN
      UPDATE public.posts SET content = v_next::text WHERE id = v_row.id;
      v_scrubbed := v_scrubbed + 1;
    END IF;

    -- Fail closed on serialized occurrences that remain (for example a JSON
    -- string containing an encoded object). This can discard safe neighboring
    -- metadata in that one __user_info__ row, but cannot retain the candidate.
    IF EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = v_row.id
        AND (p.content LIKE '%consented_contacts%' OR p.content LIKE '%consented_clipboard%')
    ) THEN
      DELETE FROM public.posts WHERE id = v_row.id;
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_remaining
  FROM public.posts
  WHERE media_type = '__user_info__'
    AND content IS NOT NULL
    AND (content LIKE '%consented_contacts%' OR content LIKE '%consented_clipboard%');

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION '[058] consent-data cleanup verification failed: % candidate rows remain', v_remaining;
  END IF;
  RAISE NOTICE '[058] consent-data cleanup verified: scrubbed % rows, deleted % unsafe candidate rows',
    v_scrubbed, v_deleted;
END $$;

DROP FUNCTION public._audit_strip_retired_consent_keys(jsonb);

-- Migration 056 grants direct PUBLIC-key callers access to a SECURITY DEFINER
-- counter. Revoke client roles; the server-side service_role remains callable.
ALTER FUNCTION public.increment_post_views(uuid) SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.increment_post_views(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_views(uuid) TO service_role;

-- Account deletion is deliberately not automated here: repository evidence
-- does not establish a complete ownership/retention map for DM recipient rows,
-- billing/audit records, storage objects, and user-keyed AI/index tables.
-- Do not run broad username-based DELETEs until a reviewed retention policy,
-- per-table inventory, resumable transaction plan, and Storage cleanup flow exist.

COMMIT;
