-- 20260813000005_claim_notification_emails.sql
-- Atomic claim for the notification digest cron. Every predicate — type set,
-- settle/age window, read/dismissed/emailed re-check, workspace membership, and
-- preference opt-out — is embedded in ONE statement so the send/no-send decision
-- is atomic with the claim. Mirrors claim_marketing_email (20260803000004):
--   * membership EXISTS closes the removed-user leak (a user removed from a
--     workspace keeps their notification rows; nothing deletes them).
--   * pref NOT EXISTS closes the opt-out race (a candidate-then-claim design
--     could stamp emailed_at on a row the user opted out of between the two).
--   * FOR UPDATE SKIP LOCKED keeps concurrent cron runs disjoint.
create or replace function claim_notification_emails(
  p_settle_before timestamptz,
  p_after         timestamptz,
  p_limit         int
)
returns table (id uuid, user_id uuid, type text, metadata jsonb, link text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update notifications n
     set emailed_at = now()
   where n.id in (
     select n2.id from notifications n2
     where n2.type = any (array[
       'post_publish_failed','post_correction','post_message','client_message',
       'deadline_approaching','task_assigned','post_assigned','mention'
     ])
       and n2.read_at is null and n2.dismissed_at is null and n2.emailed_at is null
       and n2.created_at <= p_settle_before and n2.created_at >= p_after
       and exists (
         select 1 from workspace_members wm
         where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
       )
       and not exists (
         select 1 from notification_email_prefs p
         where p.user_id = n2.user_id and p.enabled = false
           and (p.type = n2.type or p.type = '__all__')
       )
     order by n2.created_at asc
     limit p_limit
     for update skip locked
   )
  returning n.id, n.user_id, n.type, n.metadata, n.link, n.created_at;
$$;

-- Keep the cross-user sweep cheap.
create index if not exists idx_notifications_email_pending
  on notifications (created_at)
  where read_at is null and dismissed_at is null and emailed_at is null;

-- REVOKE FROM PUBLIC also strips service_role on this instance — re-grant it.
revoke all on function claim_notification_emails(timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function claim_notification_emails(timestamptz, timestamptz, int)
  to service_role;
