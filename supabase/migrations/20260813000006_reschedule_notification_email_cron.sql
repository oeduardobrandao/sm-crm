-- 20260813000006_reschedule_notification_email_cron.sql
-- Supersede mention-email-cron with notification-email-cron (all 8 types incl.
-- mention). MUST be applied AFTER the notification-email-cron function is
-- deployed -- the schedule fires immediately (same rule as 20260803000007).
-- Rollback: unschedule 'notification-email-cron', re-schedule 'mention-email-cron'.
-- Uses the vault.decrypted_secrets subselect form (the vault.decrypted_secret(...)
-- function form does not exist on this instance).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'mention-email-cron') then
    perform cron.unschedule('mention-email-cron');
  end if;
  if exists (select 1 from cron.job where jobname = 'notification-email-cron') then
    perform cron.unschedule('notification-email-cron');
  end if;
end $$;

select cron.schedule(
  'notification-email-cron',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/notification-email-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
