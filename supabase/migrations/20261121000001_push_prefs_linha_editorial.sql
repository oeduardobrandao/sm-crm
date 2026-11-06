-- 20261121000001_push_prefs_linha_editorial.sql
-- Widens notification_push_prefs_type_check to every type the push cron sends.
--
-- 20261015000001 created the CHECK with the push-eligible types of the time.
-- 20261120000001 added 'linha_editorial_aprovada' and 'linha_editorial_ajustes'
-- to claim_notification_pushes, but not to this CHECK, so the CRM's new
-- "Celular" prefs column (iOS app, plan D3) could not save an opt-out for those
-- two types (the upsert would fail with 23514 and the switch roll back).
--
-- Same list as the claim allowlist plus '__all__' (master pause). The CRM test
-- apps/crm/src/lib/__tests__/notification-catalog.push-parity.test.ts reads this
-- file and the claim's array and fails if the catalog's pushEligible types drift
-- from either. Purely additive: every existing row satisfies the new CHECK.

alter table public.notification_push_prefs
  drop constraint if exists notification_push_prefs_type_check;

alter table public.notification_push_prefs
  add constraint notification_push_prefs_type_check check (type in (
    'post_approved','post_publish_failed','post_correction','post_message',
    'client_message','deadline_approaching','task_assigned','post_assigned',
    'mention','post_edit_suggestion','post_client_reference',
    'idea_submitted','briefing_answered',
    'event_invited','event_updated','event_cancelled','event_reminder',
    'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
    'linha_editorial_aprovada','linha_editorial_ajustes',
    '__all__'
  ));
