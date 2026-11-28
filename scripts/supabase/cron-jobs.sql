-- Free scheduling from Supabase (pg_cron + pg_net, both included in the free plan): calls Medoro's job endpoints, so
-- no Vercel cron, GitHub Actions or cron-job.org is needed. Run once in Supabase → SQL Editor, as the project owner.
--
-- Before running: replace the two placeholders below.
--   <APP_URL>      where the Medoro app runs, e.g. https://medoro.in   (no trailing slash)
--   <CRON_SECRET>  the same value as CRON_SECRET in the app's environment
--
-- The secret is stored encrypted in Supabase Vault, not in the job text.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store (or replace) the secret.
select vault.create_secret('<CRON_SECRET>', 'medoro_cron_secret', 'Bearer token for Medoro /api/cron/*')
where not exists (select 1 from vault.secrets where name = 'medoro_cron_secret');
-- To change it later:  select vault.update_secret((select id from vault.secrets where name = 'medoro_cron_secret'), '<NEW_SECRET>');

-- Every minute: AI HR Assistant detection and reminders, Sales Pulse, deliveries, messaging.
select cron.schedule('medoro-minute', '* * * * *', $job$
  select net.http_get(
    url := '<APP_URL>/api/cron/minute',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'medoro_cron_secret')),
    timeout_milliseconds := 60000
  );
$job$);

-- Once a day at 03:00 India time (21:30 UTC): backups, retention clean-up, KPIs, reminders (the daily jobs).
select cron.schedule('medoro-daily', '30 21 * * *', $job$
  select net.http_get(
    url := '<APP_URL>/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'medoro_cron_secret')),
    timeout_milliseconds := 300000
  );
$job$);

-- Check:   select jobname, schedule, active from cron.job;
-- Results: select status_code, content::text, created from net._http_response order by created desc limit 10;
-- Remove:  select cron.unschedule('medoro-minute'); select cron.unschedule('medoro-daily');
