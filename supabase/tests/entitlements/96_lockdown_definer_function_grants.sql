\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Grant-surface assertions for 20260924000001_lockdown_definer_function_grants.sql.
--
-- Locally there is no hosted pg_default_acl granting anon/authenticated EXECUTE
-- at function-creation time (see _helpers.sql), so `anon`/`authenticated` already
-- read false here even without the fix -- this suite can't reproduce the hosted-only
-- bug itself. What it DOES guard against: a future edit to this migration (or a
-- CREATE OR REPLACE elsewhere) dropping the explicit `GRANT ... TO service_role`,
-- which would silently break every edge function / cron calling these RPCs with the
-- service-role key -- exactly the "REVOKE FROM PUBLIC also strips service_role"
-- failure mode. It also pins the intended anon/authenticated=false state so hosted
-- drift is caught by comparing prod's live proacl against this list, not by this
-- suite alone.
do $$
declare
  v_fn text;
  v_fns text[] := array[
    'public.set_story_segment_field(bigint, int, text, text)',
    'public.mark_platform_published(bigint, text, text, uuid, jsonb)',
    'public.record_post_status_change(bigint, text, text, uuid, bigint, jsonb)',
    'public.record_client_approval(bigint, text, text, text, boolean, text)',
    'public.claim_cron_triage(text, text, int)',
    'public.claim_automation_send(text, uuid, uuid, text, text, text, text, timestamptz, int)',
    'public.claim_retryable_automation_sends(int)',
    'public.fail_ineligible_automation_sends()',
    'public.mark_automation_dm_sent(uuid, text)',
    'public.automation_media_finalize(uuid, text, bigint, text)',
    'public.automation_media_release(uuid, text)',
    'public.create_instagram_connect_link(bigint, uuid, uuid, int)',
    'public.revoke_instagram_connect_link(bigint, uuid)',
    'public.briefing_audio_finalize(uuid, bigint, uuid, text, bigint, text, int)',
    'public.briefing_audio_release(uuid, bigint, uuid)',
    'public.briefing_audio_apply_transcript(uuid, bigint, uuid, text, text, int)',
    'public.ideia_audio_finalize(uuid, uuid, text, text, bigint, text, int)',
    'public.ideia_audio_release(uuid, uuid, text)',
    'public.ideia_audio_apply_transcript(uuid, uuid, text, text, int)',
    'public.ideia_file_insert_with_quota(jsonb)',
    'public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text)',
    'public.create_edit_suggestion_notification(bigint)',
    'public.create_post_approval_notification(bigint, text, text)',
    'public.insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid)',
    'public.resolve_notification_targets(uuid, bigint, text[])',
    'public.notification_deadline_candidates()',
    'public.bulk_move_items(uuid, bigint[], bigint[], bigint)',
    'public.file_insert_with_quota(jsonb)',
    'public.folder_breadcrumbs(bigint)',
    'public.folder_sizes_batch(bigint[])',
    'public.folder_total_size(bigint)',
    'public.post_file_link_set_cover(bigint)',
    'public.post_media_insert_with_quota(jsonb)',
    'public.post_media_set_from_uploads(uuid, bigint, uuid, jsonb)',
    'public.post_media_set_cover(bigint)',
    'public.import_commit_row(uuid, bigint, text, text, jsonb)',
    'public.import_resolve_cliente(uuid, bigint, jsonb)',
    'public.effective_plan_limit(uuid, text)',
    'public.expire_and_cleanup_invites()'
  ];
  -- check_resource_limit and rls_auto_enable are deliberately excluded: they have
  -- no CREATE FUNCTION in any migration in this repo (prod-only drift, locked down
  -- there manually), so has_function_privilege() on a fresh CI database would raise
  -- "function does not exist" rather than assert anything.
begin
  foreach v_fn in array v_fns loop
    assert has_function_privilege('anon', v_fn, 'EXECUTE') = false,
      format('anon must NOT execute %s', v_fn);
    assert has_function_privilege('authenticated', v_fn, 'EXECUTE') = false,
      format('authenticated must NOT execute %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE') = true,
      format('service_role must keep execute on %s (PUBLIC revoke strips it without the explicit grant)', v_fn);
  end loop;
  raise notice 'PASS 96_lockdown_definer_function_grants (% functions)', array_length(v_fns, 1);
end $$;

-- resolve_workspace_plan and effective_plan_feature are special cases: both are
-- called from code paths that execute under the QUERYING role, not the function
-- owner, so authenticated must keep EXECUTE even though the function itself is
-- otherwise a service-only helper:
--   - resolve_workspace_plan: called directly inside the RLS SELECT policies on
--     global_banners/global_popups (`... to authenticated using (... and
--     resolve_workspace_plan(...) ...)`) -- RLS policies always evaluate as the
--     querying role.
--   - effective_plan_feature: called from get_workflow_analytics
--     (LANGUAGE sql STABLE SECURITY INVOKER) -- SECURITY INVOKER runs the whole
--     function body, including internal calls, as the caller.
-- Only anon is revoked (same pattern already used by popup_trigger_matches).
do $$
declare
  v_fn text;
  v_fns text[] := array[
    'public.resolve_workspace_plan(uuid)',
    'public.effective_plan_feature(uuid, text)'
  ];
begin
  foreach v_fn in array v_fns loop
    assert has_function_privilege('anon', v_fn, 'EXECUTE') = false,
      format('anon must NOT execute %s', v_fn);
    assert has_function_privilege('authenticated', v_fn, 'EXECUTE') = true,
      format('authenticated must execute %s (called from an invoker-context code path)', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE') = true,
      format('service_role must keep execute on %s', v_fn);
  end loop;
  raise notice 'PASS 96_lockdown_definer_function_grants (invoker-context exceptions)';
end $$;
