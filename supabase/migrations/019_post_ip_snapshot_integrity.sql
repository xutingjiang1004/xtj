-- Historic rows without a lookup timestamp have no verifiable per-post IP
-- snapshot. Do not infer their region from a later user session.
UPDATE public.posts
SET
  ip_province = NULL,
  ip_city = NULL,
  ip_region_text = NULL,
  ip_region_status = NULL,
  ip_resolved_at = NULL,
  ip_region_error = NULL
WHERE ip_lookup_started_at IS NULL
  AND (
    ip_province IS NOT NULL OR ip_city IS NOT NULL OR ip_region_text IS NOT NULL
    OR ip_region_status IS NOT NULL OR ip_resolved_at IS NOT NULL OR ip_region_error IS NOT NULL
  );
