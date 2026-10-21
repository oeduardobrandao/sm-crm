-- 20261015000002_schedule_notification_push_cron.sql
-- Every minute: notification-push-cron (push channel for the iOS app).
-- MUST be applied AFTER the notification-push-cron function is deployed: the
-- schedule fires immediately (same rule as 20260813000006). Without the four
-- APNS_* secrets the function claims nothing and returns skipped, so this is
-- safe to schedule before the Apple Developer account exists.
-- Rollback: select cron.unschedule('notification-push-cron');
-- Uses the vault.decrypted_secrets subselect form (the vault.decrypted_secret(...)
-- function form does not exist on this instance).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'notification-push-cron') then
    perform cron.unschedule('notification-push-cron');
  end if;
end $$;

select cron.schedule(
  'notification-push-cron',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/notification-push-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
