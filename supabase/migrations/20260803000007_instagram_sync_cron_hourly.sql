-- Move instagram-sync-cron from one daily run to hourly runs.
--
-- The function now claims a bounded batch per invocation (SYNC_BATCH_LIMIT,
-- default 25) ordered by stalest last_synced_at first, instead of loading every
-- eligible account into a single invocation. A daily cadence plus a batch limit
-- would cap throughput at 25 accounts/day; hourly restores headroom.
--
-- Capacity after this change: 24 runs * 25 accounts = 600 account-syncs/day.
-- The 6h last_synced_at staleness filter inside the function is unchanged, so
-- each account still syncs at most 4x/day. At 67 active accounts that is ~268
-- syncs/day against 600 of capacity.
--
-- Runtime per invocation is now bounded by the batch, not by customer count:
-- 25 accounts / concurrency 5 = 5 waves, ~30s, well under the edge-function
-- wall clock. Previously a run walked all 63 eligible accounts in one shot; if
-- that ever exceeded the wall clock the invocation would be killed after the
-- concurrency pool but before reportCronFailure, producing no cron_failures row
-- and no alert.
--
-- The command body is copied verbatim from the live job (vault.decrypted_secrets
-- is a VIEW, not a function -- an older migration used vault.decrypted_secret()
-- and every run failed until 2026-06-25).

-- Originally pushed to prod as 20260803000002; renumbered above main's tail
-- after PR #282 claimed that prefix (see 20260803000006's note). The unschedule
-- guard below makes re-applying a no-op.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instagram-sync-cron-daily') THEN
    PERFORM cron.unschedule('instagram-sync-cron-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instagram-sync-cron-hourly') THEN
    PERFORM cron.unschedule('instagram-sync-cron-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'instagram-sync-cron-hourly',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/instagram-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
