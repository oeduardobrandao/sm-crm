-- Schedule design-render-sweep-cron every 2 minutes (docs/estudio-design.md §5.2 T1.6).
-- Safety net for design-render's fire-and-forget triggers (post-design-manage/MCP writes'
-- initial call, and PR 1.5's chain self-invocation): re-fires any post_designs row stuck
-- pending/rendering. Droppable and safe to overlap with a still-alive render — the
-- claim_design_render RPC's own 3-minute stale-lock means an overly-eager re-fire just no-ops.
--
-- Must be applied AFTER supabase/config.toml's [functions.design-render-sweep-cron] entry has
-- been deployed (design.md §5.2's sweep-cron ordering rule) — the schedule fires immediately.
-- Also apply 20260702000004 (claim_design_render's TOCTOU fix) first — this cron starts calling
-- claim_design_render indirectly (via design-render) right away.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...) (that
-- function form does not exist on this instance — see 20260617120000's note).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'design-render-sweep-cron') THEN
    PERFORM cron.unschedule('design-render-sweep-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'design-render-sweep-cron',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/design-render-sweep-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
