-- A view is an authenticated account, not a click or a device.
CREATE TABLE IF NOT EXISTS public.photo_viewers (
  photo_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  viewer_name text NOT NULL,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, viewer_name)
);
ALTER TABLE public.photo_viewers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_viewers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.photo_viewers TO service_role;
CREATE POLICY photo_viewers_browser_deny ON public.photo_viewers AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.record_photo_view(p_photo_id uuid, p_viewer_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE total_views bigint;
BEGIN
  IF p_viewer_name IS NULL OR length(btrim(p_viewer_name)) = 0 THEN RETURN 0; END IF;
  -- Serialize viewers of the same photo before counting to avoid a stale
  -- count overwriting a newer one under concurrent first visits.
  PERFORM id FROM public.posts
  WHERE id = p_photo_id AND media_type = '__photo_wall__'
    AND (visibility IS NULL OR visibility = 'public')
    AND COALESCE(is_deleted, false) = false
    AND media_url IS DISTINCT FROM '__deleted__'
    AND COALESCE((content::jsonb ->> '__pw_del__')::boolean, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  INSERT INTO public.photo_viewers (photo_id, viewer_name)
    VALUES (p_photo_id, p_viewer_name) ON CONFLICT DO NOTHING;
  SELECT count(*) INTO total_views FROM public.photo_viewers WHERE photo_id = p_photo_id;
  UPDATE public.posts SET views = total_views WHERE id = p_photo_id;
  RETURN total_views;
END;
$$;
REVOKE ALL ON FUNCTION public.record_photo_view(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_photo_view(uuid,text) TO service_role;
-- Historical click totals contain no viewer identity. Start the new metric
-- from actual account records rather than inventing historical unique users.
UPDATE public.posts p SET views = (SELECT count(*) FROM public.photo_viewers v WHERE v.photo_id = p.id)
WHERE p.media_type = '__photo_wall__';
