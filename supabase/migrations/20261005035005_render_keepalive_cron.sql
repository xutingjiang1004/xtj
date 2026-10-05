-- The main Render web service cannot wake itself while suspended.
-- Run from the existing Supabase database, independently of GitHub Actions.
DO $migration$
BEGIN
  -- Plain PostgreSQL replay/test instances don't ship these managed extensions.
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_net') THEN
    RAISE NOTICE 'Render keepalive requires managed pg_cron and pg_net; skipped on plain PostgreSQL';
    RETURN;
  END IF;
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  PERFORM cron.schedule(
    'xtj-render-keepalive',
    '3-59/10 0-17,22-23 * * *',
    $job$SELECT net.http_get(
      url := 'https://xtj.onrender.com/health',
      params := jsonb_build_object('xtj_keepalive', extract(epoch FROM clock_timestamp())::bigint::text),
      headers := '{"User-Agent":"XTJ-Supabase-KeepAlive/1.0","Cache-Control":"no-cache"}'::jsonb,
      timeout_milliseconds := 90000
    );$job$
  );
END
$migration$;
