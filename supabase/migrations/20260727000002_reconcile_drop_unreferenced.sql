-- =============================================================
-- Schema drift reconciliation (2/2) — DROP
-- See docs/superpowers/specs/2026-07-27-schema-drift-audit.md
--
-- Removes production objects that no migration creates and no code reads.
-- Each target was checked two ways before inclusion:
--   1. no references in apps/ or supabase/functions/
--   2. no dependent function, view, trigger or policy in the production schema
--
-- DESTRUCTIVE. Dropping a column destroys its data irreversibly. The counts
-- below are raised as NOTICEs at apply time so the deployment log records
-- exactly what was removed.
--
-- NOT INCLUDED — files.google_drive_file_id / _thumbnail_url / _view_url.
-- Those are unreferenced by code but google_drive_file_id participates in two
-- CHECK constraints (files_has_source, files_video_requires_thumbnail).
-- Dropping it would make Postgres drop both constraints wholesale, silently
-- removing the "every file has a source" invariant. That needs a deliberate
-- constraint rewrite and a check for Drive-sourced rows, so it is held back.
-- =============================================================

-- -------------------------------------------------------------
-- Report what is about to be destroyed.
-- -------------------------------------------------------------
DO $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.subscription_events') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.subscription_events' INTO n;
    RAISE NOTICE 'dropping subscription_events — % row(s) destroyed', n;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='workspaces'
               AND column_name='subscription_status') THEN
    EXECUTE $q$SELECT count(*) FROM public.workspaces
               WHERE stripe_customer_id IS NOT NULL
                  OR stripe_subscription_id IS NOT NULL
                  OR subscription_status IS NOT NULL
                  OR subscription_current_period_end IS NOT NULL
                  OR trial_ends_at IS NOT NULL$q$ INTO n;
    RAISE NOTICE 'dropping 6 workspaces billing columns — % row(s) held non-null data', n;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='instagram_accounts'
               AND column_name='updated_at') THEN
    EXECUTE 'SELECT count(*) FROM public.instagram_accounts WHERE updated_at IS NOT NULL'
      INTO n;
    RAISE NOTICE 'dropping instagram_accounts.updated_at — % row(s) held non-null data', n;
  END IF;
END $$;

-- -------------------------------------------------------------
-- subscription_events — orphan from the Stripe work. No reader anywhere;
-- its only dependency is a service-role-only RLS policy, dropped with it.
-- -------------------------------------------------------------
DROP TABLE IF EXISTS public.subscription_events;

-- -------------------------------------------------------------
-- workspaces billing columns — superseded by workspace_subscriptions
-- (migration 20260609120003), which every billing consumer actually uses:
-- services/billing.ts, stripe-webhook, billing-checkout, billing-portal,
-- platform-admin, retention-radar-cron. Keeping a second, unread copy of
-- billing state invites a future reader to trust the wrong one.
--
-- idx_ws_stripe_customer is a partial unique index on stripe_customer_id and
-- is dropped automatically with the column.
-- -------------------------------------------------------------
ALTER TABLE public.workspaces
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS subscription_cancel_at_period_end,
  DROP COLUMN IF EXISTS subscription_current_period_end,
  DROP COLUMN IF EXISTS trial_ends_at;

-- -------------------------------------------------------------
-- instagram_accounts.updated_at — never created by a migration, never read,
-- and no trigger maintains it.
-- -------------------------------------------------------------
ALTER TABLE public.instagram_accounts
  DROP COLUMN IF EXISTS updated_at;

-- -------------------------------------------------------------
-- Post-condition: confirm the drops actually took effect.
-- -------------------------------------------------------------
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(f.tbl || '.' || f.col, ', ')
    INTO remaining
  FROM (VALUES
    ('workspaces','stripe_customer_id'),
    ('workspaces','stripe_subscription_id'),
    ('workspaces','subscription_status'),
    ('workspaces','subscription_cancel_at_period_end'),
    ('workspaces','subscription_current_period_end'),
    ('workspaces','trial_ends_at'),
    ('instagram_accounts','updated_at')
  ) AS f(tbl, col)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name  = f.tbl
      AND c.column_name = f.col
  );

  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'Drop incomplete — still present: %', remaining;
  END IF;

  IF to_regclass('public.subscription_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Drop incomplete — subscription_events still present';
  END IF;
END $$;
