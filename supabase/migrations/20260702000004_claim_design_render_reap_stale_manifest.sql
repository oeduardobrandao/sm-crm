-- Fix a TOCTOU race in claim_design_render (PR 1.5 review finding): the sweep cron reads a
-- post_designs row, decides from that snapshot whether its render_manifest is safe to reap into
-- file_deletions, then separately calls design-render to re-fire it. Between the snapshot read
-- and the re-fire, a genuinely-alive render can legitimately finalize (creating real `files`/
-- `post_file_links` rows pointing at that exact manifest's R2 keys) without changing `rev`
-- (finalize_design_render doesn't touch `doc`, so the doc-state trigger never bumps rev). The
-- sweep's re-fire then reclaims the now-'rendered' row (claim_design_render allows reclaiming
-- ANY non-'rendering' row, no staleness check needed) and returns HTTP 200 — which the sweep
-- reads as "safe to reap the manifest I snapshotted earlier," queuing the just-finalized post's
-- live media for deletion.
--
-- Fix: the decision of "what manifest is this claim discarding" must be made atomically, inside
-- the same row lock as the reclaim itself — no caller-side snapshot can ever be race-free here.
-- claim_design_render now does this itself: it SELECTs ... FOR UPDATE first (taking the row lock
-- before deciding reclaimability, unlike the previous single-UPDATE form), and if it reclaims a
-- row that was ACTUALLY 'rendering' (not what some caller saw earlier), it queues that row's
-- CURRENT render_manifest into file_deletions in the same transaction before resetting it.
--
-- A 'pending' row's manifest is always NULL (the doc-state trigger and fail_design_render both
-- clear it), so this only ever fires for a genuinely-superseded 'rendering' attempt.
--
-- Lock ordering: unchanged risk profile — this function only ever locks post_designs (never
-- workflow_posts), same as before, so it still cannot deadlock against finalize_design_render's
-- workflow_posts-then-post_designs ordering.

CREATE OR REPLACE FUNCTION claim_design_render(p_design_id bigint)
RETURNS TABLE (design_id bigint, conta_id uuid, post_id bigint, doc jsonb, doc_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_status text;
  v_old_manifest jsonb;
  v_started_at timestamptz;
  v_reclaimable boolean;
  v_entry jsonb;
BEGIN
  SELECT pd.render_status, pd.render_manifest, pd.render_started_at
    INTO v_old_status, v_old_manifest, v_started_at
  FROM post_designs pd WHERE pd.id = p_design_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_reclaimable := (v_old_status <> 'rendering'
    OR v_started_at IS NULL
    OR v_started_at < now() - interval '3 minutes');

  IF NOT v_reclaimable THEN
    RETURN;
  END IF;

  UPDATE post_designs pd
  SET render_status = 'rendering', render_started_at = now(), render_manifest = '[]'::jsonb
  WHERE pd.id = p_design_id;

  IF v_old_status = 'rendering' AND v_old_manifest IS NOT NULL THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_old_manifest) LOOP
      INSERT INTO file_deletions (r2_key) VALUES (v_entry->>'r2_key');
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT pd.id, pd.conta_id, pd.post_id, pd.doc, pd.doc_hash
  FROM post_designs pd WHERE pd.id = p_design_id;
END;
$$;

REVOKE ALL ON FUNCTION claim_design_render(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_design_render(bigint) TO service_role;
