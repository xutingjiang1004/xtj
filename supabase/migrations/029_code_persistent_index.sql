-- Migration 029: Code persistent project index
-- Persists workspace metadata, file index, code chunks, and build history
-- to Supabase. Enables incremental index updates and Render restart recovery.
-- Feature flag: CODE_PERSISTENT_INDEX_ENABLED

-- ── code_workspaces ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.code_workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  workspace_key   TEXT NOT NULL,
  workspace_name  TEXT NOT NULL DEFAULT '',
  source_type     TEXT NOT NULL DEFAULT 'local_folder'
                  CHECK (source_type IN ('local_folder','local_file','github')),
  repo_full_name  TEXT NOT NULL DEFAULT '',
  git_ref         TEXT NOT NULL DEFAULT '',
  generation      INTEGER NOT NULL DEFAULT 0,
  manifest_hash   TEXT NOT NULL DEFAULT '',
  index_version   INTEGER NOT NULL DEFAULT 1,
  index_status    TEXT NOT NULL DEFAULT 'ready'
                  CHECK (index_status IN ('ready','building','partial','stale','failed','needs_upgrade')),
  total_files     INTEGER NOT NULL DEFAULT 0,
  total_chunks    INTEGER NOT NULL DEFAULT 0,
  total_bytes     BIGINT NOT NULL DEFAULT 0,
  truncated       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_user_key UNIQUE (user_id, workspace_key)
);

CREATE INDEX IF NOT EXISTS idx_code_workspaces_user
  ON public.code_workspaces (user_id);

CREATE INDEX IF NOT EXISTS idx_code_workspaces_status
  ON public.code_workspaces (user_id, index_status);

-- ── code_index_files ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.code_index_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  workspace_id    UUID NOT NULL REFERENCES public.code_workspaces(id) ON DELETE CASCADE,
  path            TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  language        TEXT NOT NULL DEFAULT '',
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  modified_at     BIGINT,
  sha256          TEXT NOT NULL DEFAULT '',
  content_hash    TEXT NOT NULL DEFAULT '',
  index_status    TEXT NOT NULL DEFAULT 'active'
                  CHECK (index_status IN ('active','deleted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT uq_file_workspace_path UNIQUE (workspace_id, path)
);

CREATE INDEX IF NOT EXISTS idx_code_files_workspace
  ON public.code_index_files (workspace_id);

CREATE INDEX IF NOT EXISTS idx_code_files_path
  ON public.code_index_files (workspace_id, path);

-- ── code_index_chunks ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.code_index_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  workspace_id    UUID NOT NULL REFERENCES public.code_workspaces(id) ON DELETE CASCADE,
  file_id         UUID NOT NULL REFERENCES public.code_index_files(id) ON DELETE CASCADE,
  chunk_key       TEXT NOT NULL,
  start_line      INTEGER NOT NULL DEFAULT 0,
  end_line        INTEGER NOT NULL DEFAULT 0,
  content         TEXT NOT NULL DEFAULT '',
  token_estimate  INTEGER NOT NULL DEFAULT 0,
  content_hash    TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_chunk_file_key UNIQUE (file_id, chunk_key)
);

CREATE INDEX IF NOT EXISTS idx_code_chunks_workspace
  ON public.code_index_chunks (workspace_id);

CREATE INDEX IF NOT EXISTS idx_code_chunks_file
  ON public.code_index_chunks (file_id);

-- ── code_index_builds ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.code_index_builds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  workspace_id    UUID NOT NULL REFERENCES public.code_workspaces(id) ON DELETE CASCADE,
  generation      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'started'
                  CHECK (status IN ('started','uploading','completed','failed','cancelled')),
  scan_count      INTEGER NOT NULL DEFAULT 0,
  changed_count   INTEGER NOT NULL DEFAULT 0,
  uploaded_count  INTEGER NOT NULL DEFAULT 0,
  deleted_count   INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  error_code      TEXT,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_code_builds_workspace
  ON public.code_index_builds (workspace_id);

-- ── RLS: code_workspaces ───────────────────────────────────────────────

ALTER TABLE public.code_workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own workspaces" ON public.code_workspaces;
CREATE POLICY "Users can view own workspaces"
  ON public.code_workspaces
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "Service can manage workspaces" ON public.code_workspaces;
CREATE POLICY "Service can manage workspaces"
  ON public.code_workspaces
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── RLS: code_index_files ──────────────────────────────────────────────

ALTER TABLE public.code_index_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own index files" ON public.code_index_files;
CREATE POLICY "Users can view own index files"
  ON public.code_index_files
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "Service can manage index files" ON public.code_index_files;
CREATE POLICY "Service can manage index files"
  ON public.code_index_files
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── RLS: code_index_chunks ─────────────────────────────────────────────

ALTER TABLE public.code_index_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own index chunks" ON public.code_index_chunks;
CREATE POLICY "Users can view own index chunks"
  ON public.code_index_chunks
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "Service can manage index chunks" ON public.code_index_chunks;
CREATE POLICY "Service can manage index chunks"
  ON public.code_index_chunks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── RLS: code_index_builds ─────────────────────────────────────────────

ALTER TABLE public.code_index_builds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own index builds" ON public.code_index_builds;
CREATE POLICY "Users can view own index builds"
  ON public.code_index_builds
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "Service can manage index builds" ON public.code_index_builds;
CREATE POLICY "Service can manage index builds"
  ON public.code_index_builds
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Cleanup: delete workspace with cascade ─────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_code_workspace(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Chunks and files cascade via FK, builds cascade via FK
  DELETE FROM public.code_workspaces WHERE id = p_workspace_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_code_workspace(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_code_workspace(UUID) TO service_role;

-- ── Cleanup: mark old index versions as stale ──────────────────────────

CREATE OR REPLACE FUNCTION public.mark_workspace_index_stale(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.code_workspaces
     SET index_status = 'stale', updated_at = now()
   WHERE id = p_workspace_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_workspace_index_stale(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_workspace_index_stale(UUID) TO service_role;