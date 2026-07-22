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
-- Step 7 asserts both survived.

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
-- 6. Repair the two SURVIVING functions whose bodies name `designs`.
--    A PL/pgSQL body — and a string-bodied (AS $$...$$) SQL body — creates NO pg_depend edge on
--    the tables it names. So step 4's DROP ... CASCADE could not reach these two: it succeeded
--    silently and left them live but broken. Both would fail at call time with
--    42P01 relation "designs" does not exist. Neither name matches step 7b's '%design%' filter,
--    which is why 7c asserts on function BODIES instead.
--    They are recreated HERE — after the drops, before the assertions, inside the same
--    transaction — so the schema is never transiently broken.
--
--    CREATE OR REPLACE, not DROP + CREATE: the signature, argument names/types, return type,
--    volatility, security mode and search_path are reproduced EXACTLY from the defining
--    migration. A single deviation would create a second overload instead of replacing.
--    Each definition is followed by its original REVOKE/GRANT block, re-issued verbatim:
--    CREATE OR REPLACE resets privileges to the owner's defaults, and in this repo a
--    REVOKE ... FROM PUBLIC has already once silently stripped service_role and broken
--    edge-function calls.
-- ============================================================

-- 6a. post_media_set_from_uploads — backs the MCP set_post_media tool
--     (supabase/functions/mcp/media.ts). Post-media upload MUST keep working.
--     Source of truth: 20260707000002_post_media_set_from_uploads.sql:5-67.
--     Only change: the `design_attached` guard (that file's lines 27-29) is removed. With the
--     designs table gone no post can have a design attached, so the guard could only ever raise
--     42P01. Everything else is byte-identical.
CREATE OR REPLACE FUNCTION post_media_set_from_uploads(
  p_conta_id uuid, p_post_id bigint, p_uploaded_by uuid, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post workflow_posts;
  v_item jsonb;
  i int := 0;
  v_new_tipo text;
  v_old bigint[];
  v_new bigint[] := '{}';
  v_fid bigint;
BEGIN
  SELECT * INTO v_post FROM workflow_posts
    WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_post.status NOT IN ('rascunho','revisao_interna','correcao_cliente','enviado_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_post.status USING ERRCODE = 'P0001';
  END IF;
  IF v_post.tipo NOT IN ('feed','carrossel') THEN
    RAISE EXCEPTION 'tipo_not_image:%', v_post.tipo USING ERRCODE = 'P0001';
  END IF;

  v_new_tipo := CASE WHEN jsonb_array_length(p_items) > 1 THEN 'carrossel' ELSE 'feed' END;

  SELECT COALESCE(array_agg(file_id), '{}') INTO v_old
    FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;
  DELETE FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id INTO v_fid FROM files                                        -- P2-1 idempotent reuse
      WHERE conta_id = p_conta_id AND r2_key = v_item->>'r2_key' LIMIT 1;
    IF v_fid IS NULL THEN
      v_fid := (file_insert_with_quota(jsonb_build_object(
        'conta_id', p_conta_id, 'r2_key', v_item->>'r2_key',
        'name', COALESCE(v_item->>'filename', 'post-'||p_post_id||'-'||(i+1)),
        'kind','image', 'mime_type', v_item->>'mime_type',
        'size_bytes', (v_item->>'size_bytes')::bigint,
        'width', COALESCE(v_item->>'width',''), 'height', COALESCE(v_item->>'height',''),
        'uploaded_by', p_uploaded_by))).id;                                -- raises 'quota_exceeded'
    END IF;
    INSERT INTO post_file_links(post_id, conta_id, file_id, origin, sort_order, is_cover)
      VALUES (p_post_id, p_conta_id, v_fid, 'manual', i, i = 0);
    v_new := v_new || v_fid; i := i + 1;
  END LOOP;

  DELETE FROM files                                                        -- P2-2 GC old unreused
    WHERE conta_id = p_conta_id AND id = ANY(v_old) AND id <> ALL(v_new) AND reference_count = 0;

  UPDATE workflow_posts SET
    tipo = v_new_tipo,
    status = CASE WHEN status = 'correcao_cliente' THEN 'revisao_interna' ELSE status END
  WHERE id = p_post_id;

  RETURN jsonb_build_object('post_id', p_post_id, 'item_count', i, 'tipo', v_new_tipo,
                            'status', (SELECT status FROM workflow_posts WHERE id = p_post_id));
END; $$;

-- Re-issued verbatim from 20260707000002:66-67.
REVOKE ALL ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) TO service_role;

-- 6b. admin_workspace_last_activity — called by supabase/functions/platform-admin/index.ts:356 and
--     supabase/functions/retention-radar-cron/index.ts:50 (the cron does `if (actErr) throw actErr`,
--     so a broken function kills the whole nightly run).
--     Source of truth: 20260716000001_admin_workspace_last_activity.sql:29-60.
--     Only change: the `(SELECT max(updated_at) FROM designs WHERE conta_id = w.id)` argument
--     (that file's line 40) is removed from GREATEST. Six arguments remain, so GREATEST is still
--     valid and still returns NULL only when every source is NULL.
CREATE OR REPLACE FUNCTION admin_workspace_last_activity(workspace_ids uuid[])
RETURNS TABLE (workspace_id uuid, last_activity_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    GREATEST(
      (SELECT max(updated_at) FROM workflow_posts WHERE conta_id = w.id),
      (SELECT max(created_at) FROM clientes       WHERE conta_id = w.id),
      (SELECT max(created_at) FROM contratos      WHERE conta_id = w.id),
      (SELECT max(created_at) FROM briefings      WHERE conta_id = w.id),
      (SELECT max(created_at) FROM audit_log      WHERE conta_id = w.id),
      (SELECT max(ia.created_at)
         FROM instagram_accounts ia
         JOIN clientes c ON c.id = ia.client_id
        WHERE c.conta_id = w.id)
    )
  FROM workspaces w
  WHERE w.id = ANY(workspace_ids);
$$;

-- Re-issued verbatim from 20260716000001:57-60. SECURITY DEFINER bypasses RLS, so this must never
-- be reachable by a workspace user: it would expose activity across every workspace.
REVOKE ALL ON FUNCTION admin_workspace_last_activity(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_workspace_last_activity(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION admin_workspace_last_activity(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_workspace_last_activity(uuid[]) TO service_role;

-- ============================================================
-- 7. Fail loudly on an unexpected end state.
--    Both previous versions of this migration were wrong in the same way: an object name that
--    silently no-opped under IF EXISTS while the migration reported success. These assertions
--    turn that class of mistake into a rollback instead of a false green.
-- ============================================================
DO $$
DECLARE leftover text;
BEGIN
  -- 7a. Every target table must be gone.
  SELECT string_agg(t.tbl, ', ' ORDER BY t.tbl) INTO leftover
    FROM unnest(ARRAY['designs', 'post_designs', 'design_asset_refs', 'ai_image_generations'])
         AS t(tbl)
   WHERE to_regclass('public.' || t.tbl) IS NOT NULL;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Estúdio drop incomplete: table(s) still present: %', leftover;
  END IF;

  -- 7b. No design RPC may survive. Deliberately broader than the drop list above so that a
  --     function this repo's migration history does not know about (prod drift) is surfaced
  --     rather than silently left behind. All 19 dropped names contain 'design'.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftover
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE '%design%';
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Estúdio drop incomplete: design function(s) still present: %', leftover;
  END IF;

  -- 7c. Body-level check: NO surviving function may still name a dropped table. 7b is name-based
  --     and therefore blind to exactly the defect that made step 6 necessary — a function whose
  --     own name says nothing about Estúdio (post_media_set_from_uploads,
  --     admin_workspace_last_activity) but whose body reads `designs`. Function bodies create no
  --     pg_depend edge, so nothing else in this migration can detect them.
  --     Run against the schema as it stood BEFORE step 6, this names exactly those two functions.
  --     \m...\M are word boundaries, so `post_designs` and `designs_conta_idx` do not produce
  --     accidental matches on the bare `designs` alternative.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftover
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ '\m(designs|post_designs|design_asset_refs|ai_image_generations)\M';
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Estúdio drop left function(s) referencing a dropped table: %', leftover;
  END IF;

  -- 7d. The render sweep must be unscheduled.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE '%design%') THEN
    RAISE EXCEPTION 'Estúdio drop incomplete: a design cron job is still scheduled';
  END IF;

  -- 7e. The retained columns must have survived. Zero here means the migration overreached.
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

  -- 7f. The shared trigger functions must have survived the CASCADEs.
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

  -- 7g. No link may still claim design provenance.
  IF EXISTS (SELECT 1 FROM post_file_links WHERE origin = 'design') THEN
    RAISE EXCEPTION 'Estúdio drop incomplete: post_file_links rows still have origin = design';
  END IF;
END $$;
