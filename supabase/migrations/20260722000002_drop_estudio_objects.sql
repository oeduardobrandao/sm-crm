-- Estúdio retirement — drop the remaining database objects.
-- All existing design data is test data (the feature never left dark mode; confirmed 2026-07-22).
-- Apply ONLY after Tasks 1-5 are merged and deployed: no code path calls these RPCs any more
-- (verified by grep over apps/ and supabase/functions/ — zero hits).
--
-- RETAINED ON PURPOSE — both were added by 20260702000001_post_designs.sql but are consumed by
-- surviving features:
--   hub_brand.logo_file_id   → client brand kit / Hub whitelabel (hub-brand fn, HubTab.tsx)
--   post_file_links.origin   → media pipeline (apps/crm/src/store/posts.ts); 'design' rows are
--                              rewritten to 'manual' in step 2 so the media stays attached.
-- Neither column depends on any dropped object, so no CASCADE below can reach them.
--
-- ALSO RETAINED (shared, NOT Estúdio-owned — never drop these):
--   file_update_reference_count()  (20260425000002) — also drives post_file_links / ideia_files
--   enforce_plan_count_limit(...)  (20260611130002) — also drives mcp_api_keys and the count
--                                   triggers; ai_image_generations merely attached a trigger to it
-- Step 6 asserts both survived.

-- ============================================================
-- 1. Stop the render sweep BEFORE its target disappears.
--    pg_cron failures are SILENT, so an orphaned schedule (it POSTs to
--    /functions/v1/design-render-sweep-cron every 2 min, and that function is already deleted)
--    would fail invisibly forever. The job name must match 20260702000005 EXACTLY — a typo
--    no-ops under the IF EXISTS guard and leaves the schedule running.
--    Verified: 20260702000005_design_render_sweep_cron_schedule.sql:24 schedules
--    'design-render-sweep-cron' at '*/2 * * * *'. It is the only design-related cron job.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'design-render-sweep-cron') THEN
    PERFORM cron.unschedule('design-render-sweep-cron');
  END IF;
END $$;

-- ============================================================
-- 2. No link may claim design provenance once designs are gone. The rows themselves stay:
--    they point at ordinary workspace files that remain attached to their posts.
-- ============================================================
UPDATE post_file_links SET origin = 'manual' WHERE origin = 'design';

-- ============================================================
-- 3. RPCs — dropped BY NAME from the catalog, not by hand-written signature.
--    Hand-written signatures are how this migration went wrong the first time: a signature that
--    does not match silently no-ops under IF EXISTS and the migration still reports success.
--    These functions were redefined across 8 migrations and several are overloaded, so the
--    catalog is the only trustworthy source. This drops EVERY overload of each name.
--
--    Every name below was re-derived from supabase/migrations/*.sql and each is defined ONLY by
--    an Estúdio migration (20260702000001/4/6, 20260704000001/2, 20260705000001, 20260706000001/2).
--    None belongs to TikTok, Instagram publishing, media or files.
--
--    Signatures are materialised into an array BEFORE the first DROP runs, so no drop can
--    invalidate an oid that the loop has yet to render.
-- ============================================================
DO $$
DECLARE
  sigs text[];
  s    text;
BEGIN
  SELECT coalesce(array_agg(p.oid::regprocedure::text), ARRAY[]::text[])
    INTO sigs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'attach_design', 'claim_design_render', 'claim_design_render_blob',
       'create_design', 'create_post_design', 'delete_design', 'delete_post_design',
       'detach_design', 'duplicate_design', 'fail_design_render', 'finalize_design_render',
       'get_or_create_post_design', 'get_or_create_post_design_blob',
       'post_design_check_and_sync', 'post_design_diff_asset_refs',
       'save_design_blob', 'save_post_design_blob', 'set_post_designs_doc_state',
       'update_post_design'
     );

  FOREACH s IN ARRAY sigs LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', s);
  END LOOP;
END $$;

-- ============================================================
-- 4. Tables.
--    The live table is `designs` — 20260705000001_designs_first_class.sql (lines 24-25) already
--    dropped `post_designs` and `design_asset_refs` and did not recreate them. Both legacy names
--    are still listed here because an environment whose history stopped short of 20260705000001
--    would still have them; on prod and staging these two are expected no-ops.
--    design_asset_refs goes first: its DELETE trigger decremented files.reference_count, so
--    DROP TABLE (rather than deleting rows) leaves those counts untouched, which is what we want —
--    the underlying files are ordinary workspace files.
--    CASCADE is a safety net only. No surviving table has a foreign key INTO any of these four
--    (the sole inbound FK ever created was design_asset_refs.design_id → post_designs(id), and
--    both sides are dropped here), and no view or materialized view references them.
-- ============================================================
DROP TABLE IF EXISTS design_asset_refs CASCADE;
DROP TABLE IF EXISTS designs CASCADE;
DROP TABLE IF EXISTS post_designs CASCADE;

-- ============================================================
-- 5. The AI image ledger. Its BEFORE INSERT trigger (trg_limit_ai_images) is dropped with the
--    table; the shared enforce_plan_count_limit() function it called is NOT dropped.
--    20260722000001 already removed the plans.rate_ai_images_per_month column that trigger read.
-- ============================================================
DROP TABLE IF EXISTS ai_image_generations CASCADE;

-- ============================================================
-- 6. Fail loudly on an unexpected end state.
--    Both previous versions of this migration were wrong in the same way: an object name that
--    silently no-opped under IF EXISTS while the migration reported success. These assertions
--    turn that class of mistake into a rollback instead of a false green.
-- ============================================================
DO $$
DECLARE leftover text;
BEGIN
  -- 6a. Every target table must be gone.
  SELECT string_agg(t.tbl, ', ' ORDER BY t.tbl) INTO leftover
    FROM unnest(ARRAY['designs', 'post_designs', 'design_asset_refs', 'ai_image_generations'])
         AS t(tbl)
   WHERE to_regclass('public.' || t.tbl) IS NOT NULL;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Estúdio drop incomplete: table(s) still present: %', leftover;
  END IF;

  -- 6b. No design RPC may survive. Deliberately broader than the drop list above so that a
  --     function this repo's migration history does not know about (prod drift) is surfaced
  --     rather than silently left behind. All 19 dropped names contain 'design'.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftover
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE '%design%';
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Estúdio drop incomplete: design function(s) still present: %', leftover;
  END IF;

  -- 6c. The render sweep must be unscheduled.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE '%design%') THEN
    RAISE EXCEPTION 'Estúdio drop incomplete: a design cron job is still scheduled';
  END IF;

  -- 6d. The retained columns must have survived. Zero here means the migration overreached.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'hub_brand' AND column_name = 'logo_file_id'
  ) THEN
    RAISE EXCEPTION 'Estúdio drop overreached: hub_brand.logo_file_id was removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'post_file_links' AND column_name = 'origin'
  ) THEN
    RAISE EXCEPTION 'Estúdio drop overreached: post_file_links.origin was removed';
  END IF;

  -- 6e. The shared trigger functions must have survived the CASCADEs.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'file_update_reference_count'
  ) THEN
    RAISE EXCEPTION 'Estúdio drop overreached: file_update_reference_count() was removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'enforce_plan_count_limit'
  ) THEN
    RAISE EXCEPTION 'Estúdio drop overreached: enforce_plan_count_limit() was removed';
  END IF;

  -- 6f. No link may still claim design provenance.
  IF EXISTS (SELECT 1 FROM post_file_links WHERE origin = 'design') THEN
    RAISE EXCEPTION 'Estúdio drop incomplete: post_file_links rows still have origin = design';
  END IF;
END $$;
